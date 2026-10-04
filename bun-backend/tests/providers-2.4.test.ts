/**
 * tests/providers-2.4.test.ts — Provider/MCP 凭据批单测（阶段 2.4）。
 *
 * 覆盖：CRUD 契约（409/422/404 形状）、api_key Fernet 加密落盘（Python 交叉
 * 解密）、encrypt-keys 明文迁移幂等、URL 校验（元数据地址黑名单）、
 * opencode-zen 内置注入、balance 凭据缺失 400。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;
let prevBundleDir: string | undefined;
let prevDeepSeek: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-prov-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  prevBundleDir = process.env.MAXMA_BUNDLE_DIR;
  prevDeepSeek = process.env.DEEPSEEK_API_KEY;
  process.env.MAXMA_DATA_DIR = dataDir;
  process.env.MAXMA_BUNDLE_DIR = dataDir;
  delete process.env.DEEPSEEK_API_KEY;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  if (prevBundleDir === undefined) delete process.env.MAXMA_BUNDLE_DIR;
  else process.env.MAXMA_BUNDLE_DIR = prevBundleDir;
  if (prevDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = prevDeepSeek;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function authHeader(): Record<string, string> {
  const { Database } = require("bun:sqlite") as {
    Database: new (p: string, o?: object) => { query: (s: string) => { get: () => { token: string } | null } };
  };
  const db = new Database(path.join(dataDir, "api", "data", "maxma.db"), { readonly: true });
  try {
    const row = db.query("SELECT token FROM auth_tokens ORDER BY id DESC LIMIT 1").get();
    return { "x-maxma-token": row?.token ?? "" };
  } finally {
    db.close();
  }
}

async function makeApp() {
  const { createApp } = await import("../src/server");
  return createApp();
}

const jsonH = () => ({ "content-type": "application/json", ...authHeader() });

describe("providers CRUD（阶段 2.4）", () => {
  test("create → list → get → update → delete 全链路", async () => {
    const app = await makeApp();
    const h = jsonH();

    const created = await app.request("/api/providers", {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        id: "myprov",
        label: "My Prov",
        base_url: "https://api.example.com/v1",
        api_key: "sk-secret-123",
        models: ["m1", "m2"],
        context_window: 64000,
      }),
    });
    expect(created.status).toBe(200);
    const p = (await created.json()) as Record<string, unknown>;
    expect(p.id).toBe("myprov");
    expect(p.api_key).toBe("");
    expect(p.api_key_configured).toBe(true);
    expect(p.context_window).toBe(64000);

    // 重复 id → 409
    const dup = await app.request("/api/providers", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ id: "myprov", label: "X", base_url: "https://a.com/v1" }),
    });
    expect(dup.status).toBe(409);

    // GET 详情
    const got = await app.request("/api/providers/myprov", { headers: h });
    expect(got.status).toBe(200);
    expect(((await got.json()) as Record<string, unknown>).label).toBe("My Prov");

    // update（仅更新提供字段；api_key 掩码值原样保留——Python 不做 sentinel 回填，契约保持）
    const upd = await app.request("/api/providers/myprov", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ label: "Renamed", enabled: false }),
    });
    expect(upd.status).toBe(200);
    const u = (await upd.json()) as Record<string, unknown>;
    expect(u.label).toBe("Renamed");
    expect(u.enabled).toBe(false);
    expect(u.api_key).toBe("");
    expect(u.api_key_configured).toBe(true);

    // delete
    const del = await app.request("/api/providers/myprov", { method: "DELETE", headers: h });
    expect(del.status).toBe(200);
    expect((await app.request("/api/providers/myprov", { headers: h })).status).toBe(404);
  }, 20000);

  test("校验：缺字段/空 label/非法 URL → 422 Pydantic 形状", async () => {
    const app = await makeApp();
    const h = jsonH();

    const missing = await app.request("/api/providers", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ label: "X", base_url: "https://a.com/v1" }),
    });
    expect(missing.status).toBe(422);
    const mBody = (await missing.json()) as { detail: Array<{ loc: string[]; type: string }> };
    expect(mBody.detail[0]!.type).toBe("missing");
    expect(mBody.detail[0]!.loc).toEqual(["body", "id"]);

    const emptyLabel = await app.request("/api/providers", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ id: "x", label: "", base_url: "https://a.com/v1" }),
    });
    expect(emptyLabel.status).toBe(422);

    const badUrl = await app.request("/api/providers", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ id: "x", label: "X", base_url: "ftp://a.com/v1" }),
    });
    expect(badUrl.status).toBe(422);
    const bBody = (await badUrl.json()) as { detail: Array<{ msg: string; type: string }> };
    expect(bBody.detail[0]!.msg).toContain("base_url must be an absolute HTTP(S) URL");
    expect(bBody.detail[0]!.type).toBe("value_error");
  }, 20000);

  test("URL 校验：元数据地址/带凭据/query 拒绝，本地/私网放行", () => {
    const { validateProviderBaseUrl } = require("../src/routes/providers") as {
      validateProviderBaseUrl: (v: unknown) => string;
    };
    expect(validateProviderBaseUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/v1");
    expect(validateProviderBaseUrl("http://192.168.1.10:8000/v1")).toBe("http://192.168.1.10:8000/v1");
    for (const bad of [
      "http://169.254.169.254/latest/meta-data",
      "http://metadata.google.internal/v1",
      "http://2852039166/v1", // 十进制 169.254.169.254
      "http://0.0.0.0/v1",
      "http://224.0.0.1/v1",
      "https://user:pass@a.com/v1",
      "https://a.com/v1?x=1",
      "https://a.com/v1#frag",
      "https://a.com:99999/v1",
      "https://a.com\\evil/v1",
      "",
    ]) {
      expect(() => validateProviderBaseUrl(bad)).toThrow();
    }
  });

  test("api_key 加密落盘 → Python cryptography 可解（真实凭据互认）", async () => {
    const app = await makeApp();
    const res = await app.request("/api/providers", {
      method: "POST",
      headers: jsonH(),
      body: JSON.stringify({ id: "px", label: "P", base_url: "https://a.com/v1", api_key: "sk-python-check-42" }),
    });
    expect(res.status).toBe(200);

    const python = [
      path.resolve(import.meta.dir, "..", "..", ".venv", "Scripts", "python.exe"),
      path.resolve(import.meta.dir, "..", "..", ".venv", "bin", "python"),
    ].find((p) => fs.existsSync(p));
    if (!python) return; // 无 venv 时跳过（credential-2.4.test.ts 已锁定格式互认）

    const { parseCredentialEnvelope } = await import("../src/security/credential-envelope");
    const stored = (await import("../src/routes/providers")).loadProviders().find((entry) => entry.id === "px");
    const env = parseCredentialEnvelope(String(stored?.api_key));
    const script = `from cryptography.fernet import Fernet\nprint(Fernet(open(r"${path.join(dataDir, "api", "data", "credential.key")}", 'rb').read()).decrypt("${env.ciphertext}".encode()).decode())\n`;
    const tmp = path.join(dataDir, "verify.py");
    fs.writeFileSync(tmp, script, "utf8");
    const r = Bun.spawnSync([python, tmp]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString().trim()).toBe("sk-python-check-42");
  }, 20000);

  test("encrypt-keys 迁移：明文加密、已加密跳过（幂等）", async () => {
    const { loadProviders, saveProviders, migratePlaintextKeysToEncrypted } = await import(
      "../src/routes/providers"
    );
    saveProviders([
      { id: "a", label: "A", base_url: "https://a.com/v1", api_key: "sk-plain-a" },
      { id: "b", label: "B", base_url: "https://b.com/v1", api_key: "" },
      { id: "c", label: "C", base_url: "https://c.com/v1", api_key: "encv1:already" },
    ]);
    const n = migratePlaintextKeysToEncrypted();
    expect(n).toBe(1);
    const items = loadProviders();
    expect(String(items.find((e) => e.id === "a")!.api_key)).toMatch(/^encv1:/);
    expect(items.find((e) => e.id === "b")!.api_key).toBe("");
    expect(items.find((e) => e.id === "c")!.api_key).toBe("encv1:already");
    // 二次运行幂等
    expect(migratePlaintextKeysToEncrypted()).toBe(0);
  }, 20000);

  test("损坏 providers.yaml → 写入拒绝 503（PROVIDERS-CORRUPT-001）", async () => {
    const app = await makeApp();
    fs.writeFileSync(path.join(dataDir, "api", "data", "providers.yaml"), "\tinvalid: [\nunclosed", "utf8");
    const res = await app.request("/api/providers", {
      method: "POST",
      headers: jsonH(),
      body: JSON.stringify({ id: "x", label: "X", base_url: "https://a.com/v1" }),
    });
    expect(res.status).toBe(503);
  }, 20000);

  test("GET /providers 惰性注入 opencode-zen 内置供应商（列表首位、凭据不下发）", async () => {
    const app = await makeApp();
    const res = await app.request("/api/providers", { headers: jsonH() });
    expect(res.status).toBe(200);
    const { providers } = (await res.json()) as { providers: Array<Record<string, unknown>> };
    expect(providers[0]!.id).toBe("opencode-zen");
    expect(providers[0]!.api_key).toBe("");
    expect(providers[0]!.api_key_configured).toBe(true);
    expect(providers[0]!.builtin).toBe(true);
    expect(Array.isArray(providers[0]!.models)).toBe(true);
    // 幂等：再次 GET 不重复注入
    const res2 = await app.request("/api/providers", { headers: jsonH() });
    const { providers: p2 } = (await res2.json()) as { providers: Array<Record<string, unknown>> };
    expect(p2.filter((e) => e.id === "opencode-zen").length).toBe(1);
  }, 20000);

  test("内置免费供应商不可修改或删除", async () => {
    const app = await makeApp();
    const h = jsonH();
    await app.request("/api/providers", { headers: h });

    const update = await app.request("/api/providers/opencode-zen", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ enabled: false }),
    });
    expect(update.status).toBe(403);

    const remove = await app.request("/api/providers/opencode-zen", {
      method: "DELETE",
      headers: h,
    });
    expect(remove.status).toBe(403);

    const list = await app.request("/api/providers", { headers: h });
    const { providers } = (await list.json()) as { providers: Array<Record<string, unknown>> };
    expect(providers.some((entry) => entry.id === "opencode-zen" && entry.enabled === true)).toBe(true);
  }, 20000);

  test("balance：无 DEEPSEEK_API_KEY → 400", async () => {
    const app = await makeApp();
    const res = await app.request("/api/deepseek-balance", { headers: jsonH() });
    expect(res.status).toBe(400);
  }, 20000);
});
