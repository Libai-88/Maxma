/**
 * hooks-sign.ts — 给 hooks.json 盖章（A4）。
 *
 * 用法：
 *   bun bun-sidecar/src/hooks-sign.ts                 # 默认 <data>/config/hooks.json
 *   bun bun-sidecar/src/hooks-sign.ts path/to/hooks.json
 *
 * 首次会生成 hooks.secret（32 字节随机，0600）。之后任何修改 hooks.json 的
 * 行为都会让签名失效；重新跑本脚本即可。未签名配置不会被加载。
 */

import * as fs from "node:fs";

import {
  computeHooksSignature,
  ensureHooksSecret,
  hooksConfigPath,
  loadHooksConfig,
} from "./kernel/hooks/config";
import { maxmaDataRoot } from "./kernel/project-paths";
import type { HooksConfigFile } from "./kernel/hooks/hook-types";

const target = process.argv[2] ? fs.realpathSync(process.argv[2]) : hooksConfigPath();
process.env.MAXMA_HOOKS_FILE = target;

const raw = fs.readFileSync(target, "utf8");
const parsed = JSON.parse(raw) as HooksConfigFile;
if (parsed.version !== 1 || !Array.isArray(parsed.hooks)) {
  throw new Error("hooks.json 必须是 { version: 1, hooks: [...] }");
}
const secret = ensureHooksSecret(maxmaDataRoot());
parsed.signature = computeHooksSignature({ version: 1, hooks: parsed.hooks }, secret);
fs.writeFileSync(target, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");

const loaded = loadHooksConfig(maxmaDataRoot());
console.log(`已签名：${target}`);
console.log(`状态：${loaded.status}；可运行钩子：${loaded.hooks.length}`);
for (const error of loaded.errors) console.log(`- ${error}`);
