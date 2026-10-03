/**
 * tests/persona-2.2d.test.ts — persona 路由单测（阶段 2.2d）。
 *
 * 覆盖：SOUL/USER 读写、变体文件名校验、多人格 CRUD（创建 frontmatter/
 * 409/删除回退/重命名活跃跟随）、profile 解析与占位符防御。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;
let prevBundleDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-persona-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  prevBundleDir = process.env.MAXMA_BUNDLE_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  process.env.MAXMA_BUNDLE_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
  fs.mkdirSync(path.join(dataDir, "config", "personas"), { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "config", "personas", "SOUL.md"),
    "# 饱饱\n\n温暖体贴又有点调皮的大姐姐\n默认居住在一个吵闹的小公寓，窗外有一条马路\n风格：playful、调皮、温暖\n",
  );
  fs.writeFileSync(path.join(dataDir, "config", "personas", "USER.md"), "- **称呼**：（Agent 对你的称呼）\n");
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  if (prevBundleDir === undefined) delete process.env.MAXMA_BUNDLE_DIR;
  else process.env.MAXMA_BUNDLE_DIR = prevBundleDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function makeApp() {
  const { createApp } = await import("../src/server");
  return createApp();
}

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

describe("persona 路由（阶段 2.2d）", () => {
  test("GET/PUT /api/persona：SOUL 读写 + 无效 type 400", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };

    const soul = await app.request("/api/persona?type=soul", { headers: authHeader() });
    expect(soul.status).toBe(200);
    expect(((await soul.json()) as { content: string }).content).toContain("饱饱");

    const updated = await app.request("/api/persona?type=user", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ content: "- **称呼**：小美\n" }),
    });
    expect(updated.status).toBe(200);
    expect(fs.readFileSync(path.join(dataDir, "config", "personas", "USER.md"), "utf8")).toContain("小美");

    const bad = await app.request("/api/persona?type=other", { headers: authHeader() });
    expect(bad.status).toBe(400);
  });

  test("变体文件名防穿越：非法名 400", async () => {
    const app = await makeApp();
    const res = await app.request(`/api/persona?type=soul&variant=${encodeURIComponent("../evil.md")}`, {
      headers: authHeader(),
    });
    expect(res.status).toBe(400);
  });

  test("多人格：创建（frontmatter 注入防御）→ 列表 → 切换 → 删除回退", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };

    // 创建：description 含 YAML 特殊字符（B-012 注入防御）
    const created = await app.request("/api/personas", {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        name: "饱饱",
        description: 'x"\nmemory: persona',
        memory: "isolated",
      }),
    });
    expect(created.status).toBe(201);
    const cb = (await created.json()) as { file: string; memory_mode: string };
    expect(cb.file).toBe("SOUL.饱饱.md");
    expect(cb.memory_mode).toBe("persona"); // B-011 归一

    // frontmatter 注入防御（B-012）：换行/引号被 YAML 转义为值的一部分，无键注入。
    // 注：Bun.YAML.stringify 输出 flow 风格，与 pyyaml block 风格不同，但均为合法 YAML。
    const soulContent = fs.readFileSync(path.join(dataDir, "config", "personas", "SOUL.饱饱.md"), "utf8");
    const fmText = soulContent.split("---")[1] ?? "";
    const fm = Bun.YAML.parse(fmText) as Record<string, unknown>;
    expect(fm.description).toBe('x"\nmemory: persona');

    const dup = await app.request("/api/personas", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ name: "饱饱" }),
    });
    expect(dup.status).toBe(409);

    // 列表 + 切换
    const list = (await (await app.request("/api/personas", { headers: authHeader() })).json()) as {
      personas: Array<{ file: string; active: boolean }>;
      active_file: string;
    };
    expect(list.personas.some((p) => p.file === "SOUL.饱饱.md")).toBe(true);

    const switched = await app.request("/api/personas/active", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ file: "SOUL.饱饱.md" }),
    });
    expect(((await switched.json()) as { status: string }).status).toBe("ok");

    // 删除活跃人格 → 自动回退 SOUL.md
    const deleted = await app.request("/api/personas/SOUL.饱饱.md", { method: "DELETE", headers: authHeader() });
    expect(((await deleted.json()) as { status: string }).status).toBe("deleted");
    const after = (await (await app.request("/api/personas", { headers: authHeader() })).json()) as {
      active_file: string;
    };
    expect(after.active_file).toBe("SOUL.md");
  });

  test("重命名：内容标题同步 + 独立记忆跟随 + 活跃指向更新", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };

    // 建 SOUL.小饱.md + 独立记忆 + 切活跃
    fs.writeFileSync(path.join(dataDir, "config", "personas", "SOUL.小饱.md"), "# 小饱\n\n描述\n");
    fs.writeFileSync(path.join(dataDir, "config", "personas", "memory_SOUL.小饱.yaml"), "{}\n");
    await app.request("/api/personas/active", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ file: "SOUL.小饱.md" }),
    });

    console.log("[dbg] dataDir:", dataDir, "| personasDir:", path.join(dataDir, "config", "personas"));
    console.log("[dbg] dir listing:", fs.readdirSync(path.join(dataDir, "config", "personas")).join(","));
    const renamed = await app.request("/api/personas/SOUL.小饱.md/rename", {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ new_name: "大饱" }),
    });
    const rb = (await renamed.json()) as { status: string; file: string };
    console.log("[dbg] rename status:", renamed.status, "body:", JSON.stringify(rb));
    expect(rb.status).toBe("renamed");
    expect(rb.file).toBe("SOUL.大饱.md");

    expect(fs.existsSync(path.join(dataDir, "config", "personas", "SOUL.大饱.md"))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "config", "personas", "SOUL.小饱.md"))).toBe(false);
    expect(fs.readFileSync(path.join(dataDir, "config", "personas", "SOUL.大饱.md"), "utf8").startsWith("# 大饱")).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "config", "personas", "memory_SOUL.大饱.yaml"))).toBe(true);

    const list = (await (await app.request("/api/personas", { headers: authHeader() })).json()) as {
      active_file: string;
    };
    expect(list.active_file).toBe("SOUL.大饱.md");
  });

  test("模板人格可读取，保存时写入用户目录", async () => {
    const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-persona-bundle-"));
    const templateDir = path.join(bundleDir, "config", "personas");
    fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(path.join(templateDir, "SOUL.模板.md"), "# 模板人格\n\n来自只读模板\n");
    const userDir = path.join(dataDir, "config", "personas");
    fs.rmSync(path.join(userDir, "SOUL.模板.md"), { force: true });
    process.env.MAXMA_BUNDLE_DIR = bundleDir;
    const app = await makeApp();
    const read = await app.request("/api/persona?type=soul&variant=SOUL.%E6%A8%A1%E6%9D%BF.md", { headers: authHeader() });
    expect(read.status).toBe(200);
    expect(((await read.json()) as { content: string }).content).toContain("来自只读模板");
    const saved = await app.request("/api/persona?type=soul&variant=SOUL.%E6%A8%A1%E6%9D%BF.md", { method: "PUT", headers: { "content-type": "application/json", ...authHeader() }, body: JSON.stringify({ content: "# 我的模板人格\n" }) });
    expect(saved.status).toBe(200);
    expect(fs.readFileSync(path.join(userDir, "SOUL.模板.md"), "utf8")).toContain("我的模板人格");
    fs.rmSync(bundleDir, { recursive: true, force: true });
  });

  test("profile：解析 SOUL/USER + 占位符回退'你'", async () => {
    const app = await makeApp();
    const profile = (await (await app.request("/api/persona/profile", { headers: authHeader() })).json()) as {
      name: string;
      nickname: string;
      greeting: string;
    };
    expect(profile.name).toBe("饱饱");
    expect(profile.nickname).toBe("你"); // 占位符防御
    expect(profile.greeting).toBe("你，你来啦。");
  });
});
