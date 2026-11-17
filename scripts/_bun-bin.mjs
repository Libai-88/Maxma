#!/usr/bin/env node
/**
 * scripts/_bun-bin.mjs — 找一个**真的能跑**的 bun（内部共享工具，不是可独立执行的脚本）。
 *
 * ## 为什么需要它
 *
 * 本机（Windows）PATH 里没有 bun，只有仓内的便携运行时 `bun-sidecar/bun.exe`；
 * CI（ubuntu）则相反，PATH 里有 bun、仓内没有 exe。于是同一段
 * `spawn("bun", …)` 在两边各挂一次：
 *   - 本机：`ENOENT: no such file or directory, uv_spawn 'bun'` —— 6 个
 *     `verify-ui-*.mjs` 全都因此跑不起来（而它们的用途恰恰是"验证能不能正常用"）；
 *   - 只认绝对路径的话，CI 又要写死平台后缀。
 *
 * 这里沿用 `check-type-budget.mjs` 已经验证过的解析顺序，并额外认 `MAXMA_BUN`
 * （那 6 个 UI 脚本的文档里一直写着用它覆盖）：
 *   MAXMA_BUN → BUN_BIN → PATH 上的 bun → <root>/bun-sidecar/bun.exe → <root>/bun-sidecar/bun
 *
 * 每个候选都实跑 `--version` 才认，避免"文件在但跑不动"（比如架构不符）被当成可用。
 * 全部失败返回 null——**由调用方报错并退出**，绝不静默降级（静默降级正是本项目
 * 反复踩的"死检查发绿灯"同一个坑）。
 */

import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * @param {{ root?: string }} [opts] 仓库根目录（默认从本文件位置推导：scripts/ 的上一级）
 * @returns {string|null} 可执行的 bun 路径；找不到返回 null
 */
export function resolveBun(opts = {}) {
  const root = opts.root ?? path.resolve(import.meta.dir, "..");
  const candidates = [];
  if (process.env.MAXMA_BUN) candidates.push(process.env.MAXMA_BUN);
  if (process.env.BUN_BIN) candidates.push(process.env.BUN_BIN);
  candidates.push("bun");
  candidates.push(path.join(root, "bun-sidecar", "bun.exe"));
  candidates.push(path.join(root, "bun-sidecar", "bun"));

  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"], { encoding: "utf8", stdio: "ignore" });
      return c;
    } catch {
      // 试下一个候选
    }
  }
  return null;
}

/**
 * 取到 bun，取不到就打印可读原因并退出——**不返回一个可能是坏掉的默认值**。
 * @param {{ root?: string, what?: string }} [opts]
 * @returns {string}
 */
export function requireBun(opts = {}) {
  const bin = resolveBun(opts);
  if (bin) return bin;
  console.error("✗ 找不到可执行的 bun（MAXMA_BUN / BUN_BIN / PATH / bun-sidecar/bun(.exe) 都试过了）");
  if (opts.what) console.error(`  ${opts.what} 需要它来起后端，无法继续。`);
  process.exit(1);
}
