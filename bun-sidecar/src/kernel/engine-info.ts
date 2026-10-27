/**
 * kernel/engine-info.ts — 引擎身份的唯一出口（pi 版本 + 包名）。
 *
 * ## 为什么放这里而不是 bun-backend
 *
 * `docs`/`kernel/types.ts` 立的纪律是"只有本目录允许 import `@earendil-works/*`"。
 * 后端要展示引擎版本，也必须经这里出去，否则纪律又多一个绕过者。
 *
 * ## 为什么读 pi 的 VERSION 常量而不是它的 package.json
 *
 * 发布形态里 pi 被**内联进 `server.js`**（`bun-backend/build-server.mjs` 的 external
 * 清单只含插件栈与 sharp），产物目录根本没有
 * `node_modules/@earendil-works/`——按文件读版本在便携包里必然失败。
 * `VERSION` 是 pi 根面导出的常量，内联后依然可读。
 *
 * 旧实现 `capabilities.ts:sidecarVersion()` 读的是 `bun-sidecar/package.json` 里
 * `maxma-sidecar` 的产品版本（0.1.0），却把它当"引擎版本"展示——那跟 pi 是哪个
 * 版本毫无关系，正是这次审计里"文档/展示与事实脱钩"的一例。
 */

import { VERSION as PI_CODING_AGENT_VERSION, getAgentDir } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";

/** pi 引擎（pi-coding-agent）的版本号，形如 "0.99.0"。 */
export function engineVersion(): string {
  return PI_CODING_AGENT_VERSION;
}

/** 引擎标识，供 /api/capabilities 与诊断导出如实标注"当前跑的是哪个引擎的哪个版本"。 */
export function engineIdentity(): { name: string; version: string } {
  return { name: "@earendil-works/pi-coding-agent", version: PI_CODING_AGENT_VERSION };
}

/**
 * 引擎配置目录落点诊断。
 *
 * ## 为什么要有这个
 *
 * 便携版与桌面壳靠一个环境变量把 pi 的配置目录搬进包内数据目录
 * （`desktop/electron/main.cjs:121`、`start.bat:10` 等注入 `PI_CODING_AGENT_DIR`），
 * 而这个名字是 pi **自己拼出来的**：`config.js:432` 的
 * `ENV_AGENT_DIR = ${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`。
 * 上游一改命名（或改 `getAgentDir()` 的回落语义），注入就**静默失效**：
 * 便携包会把会话/凭据/设置写进用户主目录的 `~/.pi/agent`，既不迁移也不报错。
 *
 * ## 判据
 *
 * 不去比字符串（那等于再赌一次 env 名），而是**验结果**：直接问引擎
 * `getAgentDir()` 现在解析到哪儿，再判断它是否落在期望的数据目录内。
 * env 名换了、回落逻辑变了，这里都会当场发现。
 */
export function agentDirDiagnostics(expectedRoot?: string): {
  agent_dir: string;
  expected_root: string | null;
  inside_expected: boolean | null;
} {
  let agentDir = "";
  try {
    agentDir = getAgentDir();
  } catch (err) {
    agentDir = `(getAgentDir 失败: ${String(err)})`;
  }
  if (!expectedRoot) return { agent_dir: agentDir, expected_root: null, inside_expected: null };

  const resolvedAgent = path.resolve(agentDir);
  const resolvedExpected = path.resolve(expectedRoot);
  const inside =
    resolvedAgent === resolvedExpected ||
    resolvedAgent.startsWith(resolvedExpected + path.sep);
  return { agent_dir: resolvedAgent, expected_root: resolvedExpected, inside_expected: inside };
}
