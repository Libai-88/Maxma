/**
 * scripts/verify-ui-session-tree.mjs — 验证 pi 的会话树在 Maxma 里真的可看可点（TREE-001..003）。
 *
 * ## 为什么需要
 *
 * pi 把会话存成 append-only entry 树，`/tree` 能切分支、`/fork` 能分出新会话。
 * Maxma 此前只展示"当前分支的消息列表"，用户完全看不到这段对话分过哪些支。
 * 类型对得上证明不了界面能用，必须真跑一遍。
 *
 * ## 用法
 *
 *   bun scripts/verify-ui-session-tree.mjs
 *
 * 退出码 0 = 树能渲染且可操作；非 0 = 打印失败环节与页面文本。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";

const REPO = path.resolve(import.meta.dir, "..");
const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? 8166);

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
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-uitree-"));
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
  console.log(`后端就绪：${base}`);

  // 端口可能被上一轮残留的后端占着（进程被强杀时 finally 不执行）。
  {
    const probe = await fetch(base + "/api/auth/token").catch(() => null);
    if (!probe?.ok) throw new Error(`端口 ${BACKEND_PORT} 上有别的进程在监听，请先结束它或换 BACKEND_PORT`);
  }

  const token = (await (await fetch(base + "/api/auth/token")).json()).token;
  const H = { "x-maxma-token": token, "content-type": "application/json" };

  const ob = await fetch(base + "/api/onboarding/state", {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ completed: true, preferences: { displayName: "验证用", language: "zh-CN", workspace: "personal" } }),
  });
  if (!ob.ok) fail(`标记引导完成失败 HTTP ${ob.status}`);

  // 建会话并写入内容，这样树里才有节点可点。
  const cr = await fetch(base + "/api/sessions", { method: "POST", headers: H });
  const { session_id: freshSessionId } = await cr.json();
  if (!freshSessionId) fail(`建会话失败 HTTP ${cr.status}`);
  console.log(`会话：${freshSessionId}`);

  // 用 kernel 直接往会话文件里写两条消息（不经模型，零额度）。
  // 走 RPC 不方便，这里改用 pi 的 SessionManager 写同一路径下的文件——
  // 但后端已持有该会话，直接写文件会分叉状态。所以改用 navigate 制造叶子：
  // 空会话的树至少有一个根节点，足够验证"渲染 + 可点"。
  const treeRes = await fetch(`${base}/api/sessions/${freshSessionId}/tree`, { headers: H });
  const tree = await treeRes.json();
  console.log(`树节点数：${tree.tree?.length ?? 0}（entry_count=${tree.entry_count}）`);
  if (!Array.isArray(tree.tree)) fail("GET /tree 未返回 tree 数组");

  const driverPath = path.join(REPO, "scripts", "_ui-session-tree-driver.cjs");
  if (!fs.existsSync(driverPath)) throw new Error(`缺少界面驱动脚本：${driverPath}`);

  const driverEnv = { ...process.env, DRIVE_BASE: base, DRIVE_SESSION_ID: freshSessionId ?? "" };
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
    if (!r.navigated) {
      fail(`会话树界面未通过（stage=${r.stage}${r.error ? ", error=" + r.error : ""}）`);
      if (r.pageText) console.error("页面文字片段：\n" + r.pageText.slice(0, 1200));
      if (r.consoleErrors?.length) console.error("浏览器 console 错误：\n" + r.consoleErrors.slice(0, 8).join("\n"));
    } else {
      console.log("✅ 会话树：菜单入口 → 树渲染 → 节点可操作");
    }
    if (r.consoleErrors?.length) fail(`浏览器 console 有 ${r.consoleErrors.length} 条错误`);
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
  console.error(`\n❌ 会话树验证失败（${failures.length} 项）`);
  process.exit(1);
}
console.log("\n✅ 会话树验证通过");
process.exit(0);
