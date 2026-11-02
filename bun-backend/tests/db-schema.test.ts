import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Database } from "bun:sqlite";
import { makeTempDataDir } from "./_helpers/tmp";

/**
 * db/core.ts schema 回归锁：无人读取的 path_whitelist 死表不再被创建。
 *
 * 背景：上一代 Python 路径白名单执行层已随阶段二 cutover 整体删除，
 * `path_whitelist` 表全仓零读写方（见 docs/security-contract.md §3），
 * 却仍留在 v1 初始 schema 里被每个新库创建——一张永远 0 行、没有任何
 * SELECT/INSERT 指向它的表。它唯一的"作用"是给 UI 文案提供"这层还在"的错觉。
 *
 * 处置是「就地删 v1 声明」而非新增 drop 迁移（理由写在 core.ts v1 块上方注释）：
 * 本文件把该选择的两侧后果都钉住——新库不再有该表；已带该表的老库升级路径不破。
 */

let dataDir = "";
let previousDataDir: string | undefined;

const BACKEND_SRC = path.join(import.meta.dir, "..", "src");
const SIDECAR_SRC = path.join(import.meta.dir, "..", "..", "bun-sidecar", "src");

function dbFile(): string {
  return path.join(dataDir, "api", "data", "maxma.db");
}

/** 列出库内全部表名（readonly 打开，用完即关，避免 WAL 句柄泄漏影响后续迁移）。 */
function tablesIn(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (
      db
        .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
  } finally {
    db.close();
  }
}

function maxVersion(dbPath: string): number | null {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.query("SELECT MAX(version) AS v FROM schema_version").get() as
      | { v: number | null }
      | null;
    return row?.v ?? null;
  } finally {
    db.close();
  }
}

/** 逐文件剥注释后搜关键字：注释里提一句不能算数（对齐 web/tests 的同类断言风格）。 */
function sourceFilesMentioning(root: string, needle: string): string[] {
  const hits: string[] = [];
  function collect(dir: string): void {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) collect(full);
      else if (/\.(ts|tsx)$/.test(name)) {
        const src = fs
          .readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        if (src.includes(needle)) hits.push(path.relative(root, full));
      }
    }
  }
  collect(root);
  return hits;
}

beforeEach(() => {
  dataDir = makeTempDataDir("maxma-db-schema");
  previousDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(async () => {
  // 路径是惰性 env 读的，但 initializedForPath 缓存必须清掉，否则下一个用例跳过迁移。
  const { resetDbInitForTest } = await import("../src/db/core");
  resetDbInitForTest();
  if (previousDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("path_whitelist 死表", () => {
  test("新建数据库不再创建 path_whitelist，v1 其余建表语句照常生效", async () => {
    // 动态 import 是刻意的（对齐 llm-usage-migration / evolution-ledger）：db/core 带
    // 模块级 initializedForPath 缓存，必须在 MAXMA_DATA_DIR 指向本用例临时目录后才求值。
    const { initializeDatabase, SCHEMA_VERSION } = await import("../src/db/core");
    initializeDatabase();

    const tables = tablesIn(dbFile());
    expect(tables).not.toContain("path_whitelist");
    // 正向锁定：本次只摘掉 path_whitelist 这一条建表语句，v1 其余建表必须逐条照常生效，
    // 否则「删死表」与「误删活表 / 整段 v1 被删空」在这个测试里无法区分。
    // 注意这里只断言"建表语句仍在跑"，不等于每张表都有读取方：maxma_blocker /
    // const_sessions / event_hooks 也已迁到 YAML 或暂无消费方，那是独立工作项
    // （docs/security-contract.md §3），本次范围严格限定在 path_whitelist。
    expect(tables).toContain("maxma_blocker");
    expect(tables).toContain("schema_version");
    expect(tables).toContain("providers");
    expect(tables).toContain("auth_tokens");
    expect(tables).toContain("const_sessions");
    expect(tables).toContain("event_hooks");
    expect(maxVersion(dbFile())).toBe(SCHEMA_VERSION);
  });

  test("携带遗留 path_whitelist 表的 v1 老库仍能一路升到最新版本", async () => {
    // 忠实复现老用户：v1 时代建库（含 path_whitelist），停在 v1。
    // 若改成新增 drop 迁移，slice(current) 的续跑逻辑要重新排号；就地删 v1 不动
    // SCHEMA_VERSION，所以这里必须验证「老库照旧逐版补齐」这条路径没被破坏。
    const dbPath = dbFile();
    const seed = new Database(dbPath);
    seed.exec(
      `CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at REAL NOT NULL);
       CREATE TABLE providers (
         id TEXT PRIMARY KEY, provider_type TEXT NOT NULL DEFAULT 'openai', label TEXT NOT NULL,
         api_key TEXT NOT NULL DEFAULT '', base_url TEXT NOT NULL DEFAULT '',
         models TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1,
         context_window INTEGER NOT NULL DEFAULT 256000,
         created_at REAL NOT NULL DEFAULT (julianday('now')),
         updated_at REAL NOT NULL DEFAULT (julianday('now'))
       );
       CREATE TABLE auth_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL,
         created_at REAL NOT NULL DEFAULT (julianday('now')));
       CREATE TABLE event_hooks (hook_id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '',
         hook_type TEXT NOT NULL DEFAULT '', config TEXT NOT NULL DEFAULT '{}',
         action TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
         enabled INTEGER NOT NULL DEFAULT 1, created_at REAL NOT NULL DEFAULT (julianday('now')),
         last_triggered REAL, trigger_count INTEGER NOT NULL DEFAULT 0);
       CREATE TABLE const_sessions (session_id TEXT PRIMARY KEY, const_name TEXT NOT NULL DEFAULT '',
         metadata TEXT NOT NULL DEFAULT '{}', messages BLOB,
         created_at REAL NOT NULL DEFAULT (julianday('now')));
       CREATE TABLE path_whitelist (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL,
         description TEXT NOT NULL DEFAULT '', recursive INTEGER NOT NULL DEFAULT 0);
       CREATE TABLE maxma_blocker (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL,
         description TEXT NOT NULL DEFAULT '');
       INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (1, julianday('now'));`,
    );
    seed.close();

    const { initializeDatabase, SCHEMA_VERSION } = await import("../src/db/core");
    initializeDatabase();

    expect(maxVersion(dbPath)).toBe(SCHEMA_VERSION);
    const tables = tablesIn(dbPath);
    // 后续版本的表补齐 = 迁移链没断
    expect(tables).toContain("llm_usage_calls");
    expect(tables).toContain("evolution_rules");
    expect(tables).toContain("deferred_runs");
    // 老库里那张零行遗留表原地保留（不 drop）：无读取方 ⇒ 无行为影响，
    // 而贸然 DROP 会让"回滚到旧版本"的用户丢数据。UI 已不再宣称它存在。
    expect(tables).toContain("path_whitelist");
  });

  test("后端与引擎源码里没有任何 path_whitelist 读写方（死表不会悄悄复活）", () => {
    // 这条是"死表"这一事实本身的边界锁：若将来恢复该层，必须先加执行代码，
    // 再同步改写 UI 文案与 docs/security-contract.md §3，而不是只把表建回来。
    expect(sourceFilesMentioning(BACKEND_SRC, "path_whitelist")).toEqual([]);
    expect(sourceFilesMentioning(SIDECAR_SRC, "path_whitelist")).toEqual([]);
  });
});
