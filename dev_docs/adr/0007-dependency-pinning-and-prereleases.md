# ADR 0007: 依赖口径——预发布钉死、运行类型对齐、未用依赖清零

**日期**：2026-11-17
**起因**：开发质量诊断（`Maxma-开发质量诊断-20261117.md`）的 P1-3 / P1-4：依赖卫生 C+。

## 决定

1. **`@deepseek-ai/dsh-*` 四个包钉在 `0.1.7-rc.2`，且必须是精确版本（不带 `^` / `~`）。**
   它们是 DSH 插件宿主真正复用的运行时类：`dsh-credentials`（凭据双键空间
   `CredentialProvider`）、`dsh-llm`（`LlmRuntime`）、`dsh-commands`（`CommandRuntime`）、
   以及 `dsh-codearts-auth` 的上游。当前其公开版本**只有 `-rc` 系列**，没有稳定版可用。

   rc 的含义是"同一版本号下的内容仍可能被替换"，语义版本保护在预发布段上是失效的。
   因此这里不用版本区间（`^0.1.7-rc.2` 在 npm 语义下会放进任何 `0.1.7-rc.x`，
   而 rc 段的排序规则又会把 `0.1.7` 正式版当成更大——一次性把整个引擎运行时换掉）。
   精确钉死 + `bun.lock` + CI 的 `bun install --frozen-lockfile`，三者一起保证
   "同一份 lock 装出同一棵树"。

   **升级流程**（刻意保持手动）：
   ```bash
   cd bun-backend && bun add -x @deepseek-ai/dsh-credentials@<ver> ...   # 四个一起改
   bun test && bun x tsc --noEmit                                        # 引擎契约面
   cd ../bun-sidecar && bun install --frozen-lockfile && bun test        # 引擎家族一致性
   ```
   `bun-sidecar/tests/engine-boundary.test.ts` 会校验两把 lock 里 `@earendil-works/*`
   逐包相等；`dsh-*` 目前只在 backend 侧，改动不影响该断言。

2. **`@types/bun` 钉到与本机/CI 运行时同版本（`1.3.14`）。**
   此前 `bun-backend` 写的是 `"latest"`（实测解析到 `1.4.2`），而 `bun-sidecar` 是 `1.3.14`、
   便携运行时也是 `1.3.14`：类型比运行时新，意味着**类型检查会替一个不存在的 API 背书**。
   现在 backend / sidecar / web 三处统一 `1.3.14`。升级 bun 运行时与类型必须同一次提交。

3. **未用依赖清零（web 侧 9 个）。**
   逐个用全仓 `src/**` 检索确认零引用后删除：

   | 依赖 | 依据 |
   |---|---|
   | `@codemirror/commands`、`@codemirror/lang-markdown`、`@codemirror/language`、`@codemirror/state`、`@codemirror/theme-one-dark`、`@codemirror/view`、`codemirror` | `src` 内 `codemirror` 命中 0 处 |
   | `recharts` | `src` 内只有 `solid-glass.css` 的 `.recharts-*` 选择器；两条规则已随依赖一并删除 |
   | `next-themes` | `src` 内只有 `components/ui/sonner.tsx` 的一行注释（该文件注明"SPA 不使用 next-themes provider"） |

   删除后 `npm ci` 少装 64 个包；`vite build` / `tsc` / `bun test` / 颜色与间距守卫全绿。

## 影响与边界

- `solid-glass.css` 的 `[data-slot="chart"] .recharts-*` 与 `.recharts-tooltip-wrapper` 两条规则被删除，
  注释同步改写（不留"描述一个已不存在的组件"的死注释）。`.bg-chart-1..5` 这类颜色词汇**保留**：
  它们是通用 token（`--chart-*`），不绑定具体图表库。
- `web/eslint.config.js` 与 `web/scripts/lint-changed.mjs` 新增的依赖（`eslint`、`@eslint/js`、
  `typescript-eslint`、`eslint-plugin-react-hooks`）只作为 devDependency，不进产物。
- **未验证**：`-rc` 版本在私有 registry 上的可得性未做异地复现（本机 `node_modules` 已就位）；
  若该包从 registry 撤版，CI 的 `--frozen-lockfile` 会在安装阶段直接失败（这是期望行为，
  比静默换一个 rc 好）。
