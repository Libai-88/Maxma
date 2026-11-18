/**
 * scripts/new-extension.mjs — 在仓库里生成一个能直接运行的用户扩展。
 *
 * 用法：bun scripts/new-extension.mjs hello-tools
 * 产物：<agentDir>/extensions/hello-tools/{index.ts,README.md}
 *
 * 与 Maxma「扩展」页的「新建扩展」按钮共用同一份模板
 * （bun-sidecar/src/kernel/extension-template.ts），避免两处各写一套。
 *
 * 为什么必须用 bun 跑：模板模块是 TypeScript，且要读 pi 的 agentDir 规则。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isValidExtensionName,
  renderExtensionScaffold,
} from "../bun-sidecar/src/kernel/extension-template.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2];

if (!name) {
  console.error("用法：bun scripts/new-extension.mjs <name>（例如 hello-tools）");
  process.exit(2);
}
if (!isValidExtensionName(name)) {
  console.error(
    `扩展名不合法：${name}\n` +
      "要求：小写字母开头，只允许 a-z、0-9 与连字符，长度 2–32（例如 hello-tools）。",
  );
  process.exit(2);
}

// 与 pi 的 getAgentDir() 同一条规则：PI_CODING_AGENT_DIR 优先，否则 ~/.pi/agent。
const agentDir = process.env.PI_CODING_AGENT_DIR
  ? path.resolve(process.env.PI_CODING_AGENT_DIR)
  : path.join(os.homedir(), ".pi", "agent");
const extensionsRoot = path.join(agentDir, "extensions");
const target = path.join(extensionsRoot, name);

if (fs.existsSync(target)) {
  console.error(`同名扩展已存在：${target}\n换一个名字，或先手动删除旧目录。`);
  process.exit(1);
}

const files = renderExtensionScaffold({ name, dir: target });
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, "index.ts"), files.index, "utf8");
fs.writeFileSync(path.join(target, "README.md"), files.readme, "utf8");

console.log(`已创建：${target}`);
console.log(`  index.ts   —— 示例工具 + 斜杠命令 /${name}`);
console.log(`  README.md  —— 三步上手`);
console.log("");
console.log("下一步：");
console.log("  1. 在 Maxma「扩展」页点「重新探测」，确认状态是「已启用」且没有错误");
console.log("  2. 新建一个对话，让模型调用示例工具，或输入 /" + name);
console.log(`  3. 改代码：${path.join(target, "index.ts")}`);
