/**
 * 对**已构建的便携包**做真实用户路径验证：首启列出人格 → 逐个切换。
 * 直接跑包内 bun.exe + server.js（不改代码、不带 MAXMA_BUNDLE_DIR 之外的注入），
 * 复刻用户"解包即可用"的状态。退出码 0 = 路径通。
 *
 * 用法：bun scripts/verify-portable-user-path.mjs [便携包目录]
 */
import * as fs from "node:fs";
import * as path from "node:path";

const portableDir = process.argv[2] ?? path.resolve(import.meta.dir, "../../MaxmaHere-Portable");
const bunExe = path.join(portableDir, "bun.exe");
const serverJs = path.join(portableDir, "server.js");

if (!fs.existsSync(bunExe) || !fs.existsSync(serverJs)) {
  console.error(`✗ 找不到便携包运行文件：${portableDir}`);
  process.exit(2);
}

/**
 * 数据目录：默认用**便携包自己的 `data/`**，与 `build/portable-smoke-test.ps1`
 * 的做法一致——那是"解包即可用"的真实形态，也是本仓已被证明可跑通的路径。
 *
 * 为什么不另建临时目录：本仓的开发/CI 环境对**新建**目录的写入可能被沙箱拒绝
 * （实测子进程 `mkdir` 直接 EPERM，紧接着 SQLite 也 CANTOPEN），
 * 而这与被测的便携包毫无关系，会让验证以假失败收场。
 * 用便携包自带的 data/ 既避开该限制，也贴近用户真实运行状态；
 * 验证结束后按冒烟脚本同样的规则清理运行时产物（保留预置配置）。
 */
const dataDir = path.join(portableDir, "data");
fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
const port = 8123;

const proc = Bun.spawn([bunExe, "run", serverJs], {
  cwd: portableDir,
  env: {
    ...process.env,
    MAXMA_DATA_DIR: dataDir,
    MAXMA_BUNDLE_DIR: portableDir,
    MAXMA_EXE_DIR: portableDir,
    PI_CODING_AGENT_DIR: path.join(dataDir, "pi"),
    MAXMA_BUN_PORT: String(port),
    MAXMA_API_PORT: String(port),
    MAXMA_BUN_HOST: "127.0.0.1",
    MAXMA_ENV: "production",
    MAXMA_SERVE_WEB: "1",
  },
  stdout: "pipe",
  stderr: "pipe",
});

let failures = [];
// 收集子进程输出：后端起不来时，**必须把它的报错打出来**，
// 否则这里只会给出"未就绪"这种无法定位的结论（正是本仓反复在修的那种失败方式）。
let childOut = "";
const drain = async (stream, tag) => {
  if (!stream) return;
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    childOut += `[${tag}] ${decoder.decode(chunk)}`;
    if (childOut.length > 8000) childOut = childOut.slice(-8000);
  }
};
void drain(proc.stdout, "out");
void drain(proc.stderr, "err");

try {
  const base = `http://127.0.0.1:${port}`;

  // 等就绪
  let ready = false;
  for (let i = 0; i < 120; i++) {
    await Bun.sleep(500);
    try {
      const r = await fetch(base + "/api/health");
      if (r.ok) { ready = true; break; }
    } catch { /* 未就绪 */ }
  }
  if (!ready) {
    throw new Error(
      `便携包后端未就绪（端口 ${port}）。子进程已退出=${proc.exitCode !== null}` +
        `\n--- 子进程输出 ---\n${childOut || "(无输出)"}`,
    );
  }

  const token = (await (await fetch(base + "/api/auth/token")).json()).token;
  const H = { "x-maxma-token": token, "content-type": "application/json" };

  // ① 首启列出人格（用户目录空，模板目录有内容）
  const list = await (await fetch(base + "/api/personas", { headers: H })).json();
  const files = (list.personas ?? []).map((p) => p.file);
  console.log("人格列表:", files.join(", ") || "(空)");
  console.log("active_file:", list.active_file);
  if (files.length === 0) failures.push("首启人格列表为空（模板未被列出）");

  // ② 逐个切换 —— 这正是修复前全部 404 的路径
  for (const file of files) {
    const res = await fetch(base + "/api/personas/active", {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ file }),
    });
    const ok = res.status === 200;
    console.log(`  切换 ${file} -> ${res.status}`);
    if (!ok) failures.push(`切换 ${file} 失败（HTTP ${res.status}）`);
  }

  // ③ 切完后 active_file 必须跟随
  const after = await (await fetch(base + "/api/personas", { headers: H })).json();
  console.log("切换后 active_file:", after.active_file);
  if (files.length > 0 && after.active_file !== files.at(-1)) {
    failures.push(`active_file 未跟随（期望 ${files.at(-1)}，实得 ${after.active_file}）`);
  }

  // ④ 免费渠道：不得把实测不可用的模型放出来
  const providers = await (await fetch(base + "/api/providers", { headers: H })).json();
  const zen = (providers.providers ?? []).find((p) => p.id === "opencode-zen");
  const freeModels = (zen?.models ?? []).map((m) => String(m));
  console.log("免费渠道模型:", freeModels.join(", ") || "(无)");
  const bad = freeModels.filter((m) => ["beam-free", "space-bunny-free"].includes(m));
  if (bad.length) failures.push(`免费渠道仍放出实测不可用的模型: ${bad.join(", ")}`);
  if (freeModels.includes("mimo-v2.6-flash-free") === false && freeModels.length > 0) {
    failures.push("免费渠道列表里没有主模型 mimo-v2.6-flash-free");
  }
} catch (err) {
  failures.push(String(err?.message ?? err));
} finally {
  try { proc.kill(); } catch { /* 已退出 */ }
  // 清理本次运行产生的运行时产物，但保留预置配置（与 build/portable-smoke-test.ps1 同规则）
  const keep = new Set([
    path.join(dataDir, "api", "data", "mcp_servers.yaml"),
    path.join(dataDir, "api", "data", "news.yaml"),
  ]);
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); try { fs.rmdirSync(p); } catch { /* 非空则留 */ } }
      else if (!keep.has(p)) { try { fs.rmSync(p, { force: true }); } catch { /* 占用则留 */ } }
    }
  };
  walk(dataDir);
  console.log(`(已清理便携包 data/ 的运行时产物，保留预置配置)`);
}

if (failures.length) {
  console.error("\n❌ 便携包用户路径验证未通过：");
  for (const f of failures) console.error("   - " + f);
  process.exit(1);
}
console.log("\n✅ 便携包用户路径验证通过");
