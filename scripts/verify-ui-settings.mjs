/**
 * scripts/verify-ui-settings.mjs — 验证新增的 pi 设置项在界面里真的可见（SETTINGS-VIS-001）。
 *
 * ## 为什么需要
 *
 * 登记表里加了键、后端能读写，都不代表**用户看得见**。这一轮补的 10 个 pi 真实键
 * （压缩余量、缓存预热、默认思考档位、图片开关…）此前在全仓零引用，
 * 用户只能手改 settings.json。类型对得上、schema 里有，也可能因为面板漏渲染而白做。
 *
 * ## 用法
 *
 *   bun scripts/verify-ui-settings.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";

const REPO = path.resolve(import.meta.dir, "..");
const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? 8188);

let backend = null;
let dataDir = process.env.MAXMA_DATA_DIR ?? "";
const base = process.env.BASE ?? `http://127.0.0.1:${BACKEND_PORT}`;

async function waitHealth(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + "/api/health");
      if (r.ok) return true;
    } catch { /* 未就绪 */ }
    await Bun.sleep(400);
  }
  return false;
}

const failures = [];
const fail = (m) => { failures.push(m); console.error("  ✗ " + m); };

try {
  if (!process.env.BASE) {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-uiset-"));
    backend = spawn(process.env.MAXMA_BUN ?? "bun", ["run", path.join(REPO, "bun-backend", "src", "server.ts")], {
      cwd: path.join(REPO, "bun-backend"),
      env: {
        ...process.env,
        MAXMA_DATA_DIR: dataDir,
        MAXMA_BUNDLE_DIR: REPO,
        MAXMA_EXE_DIR: REPO,
        MAXMA_BUN_PORT: String(BACKEND_PORT),
        MAXMA_API_PORT: String(BACKEND_PORT),
        MAXMA_BUN_HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  if (!(await waitHealth())) throw new Error(`后端未就绪（${base}）`);
  {
    const probe = await fetch(base + "/api/auth/token").catch(() => null);
    if (!probe?.ok) throw new Error(`端口 ${BACKEND_PORT} 上有别的进程在监听，请先结束它或换 BACKEND_PORT`);
  }

  const token = (await (await fetch(base + "/api/auth/token")).json()).token;
  const H = { "x-maxma-token": token, "content-type": "application/json" };

  // 后端层先确认这些键真的登记了（界面渲染的前提）
  const schema = await (await fetch(base + "/api/settings/schema", { headers: H })).json();
  const paths = new Set((schema.settings ?? []).map((s) => s.path));
  const want = [
    "compaction.reserveTokens", "compaction.keepRecentTokens", "branchSummary.skipPrompt",
    "cacheWarming", "defaultThinkingLevel", "hideThinkingBlock",
    "images.autoResize", "images.blockImages",
  ];
  const missing = want.filter((k) => !paths.has(k));
  if (missing.length) fail(`登记表缺少：${missing.join(", ")}`);

  // 写入一个值，确认引擎侧真的接收（不是只存文件）
  const put = await fetch(base + "/api/settings", {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ path: "compaction.reserveTokens", value: 24000 }),
  });
  if (!put.ok) fail(`PUT compaction.reserveTokens 失败 HTTP ${put.status}`);
  const got = await (await fetch(base + "/api/settings?paths=compaction.reserveTokens", { headers: H })).json();
  if (got["compaction.reserveTokens"] !== 24000) fail(`读回不一致：${JSON.stringify(got)}`);

  const ob = await fetch(base + "/api/onboarding/state", {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ completed: true, preferences: { displayName: "验证用", language: "zh-CN", workspace: "personal" } }),
  });
  if (!ob.ok) fail(`标记引导完成失败 HTTP ${ob.status}`);

  const driverPath = path.join(REPO, "scripts", "_ui-settings-driver.cjs");
  if (!fs.existsSync(driverPath)) throw new Error(`缺少界面驱动脚本：${driverPath}`);

  const driverEnv = { ...process.env, DRIVE_BASE: base };
  delete driverEnv.ELECTRON_RUN_AS_NODE;
  delete driverEnv.ELECTRON_NO_ATTACH_CONSOLE;

  const driver = spawn(path.join(REPO, "desktop", "node_modules", "electron", "dist", "electron.exe"), [driverPath], {
    env: driverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  driver.stdout.on("data", (c) => { out += String(c); });
  driver.stderr.on("data", (c) => { out += String(c); });

  const code = await new Promise((res) => {
    const timer = setTimeout(() => { try { driver.kill(); } catch { /* */ } res(-1); }, Number(process.env.UI_TIMEOUT_MS ?? 180_000));
    driver.on("exit", (c) => { clearTimeout(timer); res(c ?? -1); });
  });

  const match = out.match(/DRIVE_RESULT (\{.*\})/);
  if (!match) {
    fail(`界面驱动没有返回结果（exit=${code}）`);
    console.error("驱动输出片段：\n" + out.slice(-1500));
  } else {
    const r = JSON.parse(match[1]);
    console.log("界面驱动结果：", JSON.stringify(r, null, 2));
    if (!r.modelTab) fail("「模型行为」面板未渲染出缓存预热 / 默认思考档位");
    if (!r.imagesTab) fail("「图片」面板未渲染出自动缩放 / 禁止发送图片");
    if (r.compactionFields !== 3) fail(`「上下文管理」新增字段只有 ${r.compactionFields}/3`);
    if (r.consoleErrors?.length) fail(`浏览器 console 有 ${r.consoleErrors.length} 条错误`);
    if (r.modelTab && r.imagesTab && r.compactionFields === 3 && !r.consoleErrors?.length) {
      console.log("✅ 设置页：三个面板的 pi 真实键全部可见，零 console 错误");
    }
  }
  if (code !== 0 && !failures.length) fail(`界面驱动退出码非 0：${code}`);
} catch (err) {
  fail(String(err?.message ?? err));
} finally {
  try { backend?.kill(); } catch { /* */ }
  if (dataDir && !process.env.MAXMA_DATA_DIR) {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  }
}

if (failures.length) {
  console.error(`\n❌ 设置页验证失败（${failures.length} 项）`);
  process.exit(1);
}
console.log("\n✅ 设置页验证通过");
process.exit(0);
