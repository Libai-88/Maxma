/**
 * tests/codeintel.test.ts — C1/C2/C3 的索引、符号、定义/引用与语法诊断。
 *
 * 用独立临时库与临时工作区，证明：
 *   - 后台索引能进入 ready，FTS 搜索命中、忽略目录不进入索引；
 *   - TS AST 抽取函数/类/方法，定义按精确名优先；
 *   - 引用扫描有行号，且不会把子串当成引用；
 *   - 语法诊断能报出真实错误，而不是永远空数组。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  findDefinition,
  findReferences,
  getCodeIndexStatus,
  listSymbols,
  searchCode,
  startCodeIndex,
  syntaxDiagnostics,
} from "../src/codeintel/service";

let root = "";
let dbPath = "";
let previousDb: string | undefined;
let previousData: string | undefined;

function write(relative: string, content: string): void {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
}

async function waitReady(timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = getCodeIndexStatus(undefined, [{ path: root, label: "fixture" }])[0];
    if (status && (status.status === "ready" || status.status === "error" || status.status === "cancelled")) {
      if (status.status === "error") throw new Error(status.error ?? "index failed");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("index did not finish in time");
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-codeintel-"));
  dbPath = path.join(root, "..", `${path.basename(root)}.db`);
  previousDb = process.env.MAXMA_CODE_INDEX_DB;
  previousData = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_CODE_INDEX_DB = dbPath;
  process.env.MAXMA_DATA_DIR = root;
});

afterEach(() => {
  if (previousDb === undefined) delete process.env.MAXMA_CODE_INDEX_DB;
  else process.env.MAXMA_CODE_INDEX_DB = previousDb;
  if (previousData === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = previousData;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
});

describe("代码索引与代码智能", () => {
  test("后台索引 → ready，FTS 命中，忽略 node_modules", async () => {
    write("src/alpha.ts", `
export interface AlphaOptions { retries: number }
export class AlphaService {
  runNebulaTask(input: string): string { return input + "-nebula"; }
}
export function alphaEntry(value: string): string { return value; }
const localToken = "nebula-unique-token";
`);
    write("src/note.md", "这是 # 文档：nebula-unique-token 在文档里也要可搜。");
    write("node_modules/bad/index.ts", `export function shouldNotAppear() { return "nebula-unique-token"; }`);
    startCodeIndex(root, { label: "fixture", force: true });
    await waitReady();
    const status = getCodeIndexStatus(undefined, [{ path: root, label: "fixture" }])[0];
    expect(status?.status).toBe("ready");
    expect(status?.fileCount).toBe(2);

    const hits = searchCode("nebula-unique-token", 20);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.relPath === "src/alpha.ts")).toBe(true);
    expect(hits.some((hit) => hit.relPath.includes("node_modules"))).toBe(false);
  });

  test("TS 符号：类/方法/函数/接口/变量；定义精确优先", async () => {
    write("src/beta.ts", `
export interface BetaOptions { mode: string }
export class BetaRunner {
  execute(): void {}
}
export function betaEntry(): number { return 1; }
const betaValue = 2;
`);
    startCodeIndex(root, { force: true });
    await waitReady();
    const symbols = listSymbols({ path: path.join(root, "src/beta.ts"), limit: 100 });
    expect(symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual(
      expect.arrayContaining(["interface:BetaOptions", "class:BetaRunner", "method:execute", "function:betaEntry", "variable:betaValue"]),
    );
    const definition = findDefinition("betaEntry");
    expect(definition[0]?.relPath).toBe("src/beta.ts");
    expect(definition[0]?.line).toBeGreaterThan(0);
  });

  test("引用按词边界：beta 不命中 betaEntry；定义位置有标记", async () => {
    write("src/ref.ts", `
export function targetSymbol(): string { return "ok"; }
const value = targetSymbol();
const unrelated = "targetSymbolExtra";
`);
    startCodeIndex(root, { force: true });
    await waitReady();
    const references = findReferences("targetSymbol", 50);
    expect(references.length).toBeGreaterThanOrEqual(2);
    expect(references.some((reference) => reference.isDefinition)).toBe(true);
    expect(references.some((reference) => reference.preview.includes("targetSymbolExtra"))).toBe(false);
  });

  test("语法诊断：真实错误返回行号；合法文件 0 条", () => {
    write("src/broken.ts", "export function broken( { return 1 }\n");
    const broken = path.join(root, "src/broken.ts");
    const diagnostics = syntaxDiagnostics(broken);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.severity).toBe("error");

    write("src/good.ts", "export function good(): number { return 1 }\n");
    expect(syntaxDiagnostics(path.join(root, "src/good.ts"))).toEqual([]);
  });
});
