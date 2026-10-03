# Maxma Agent 开箱能力交接

## 当前目标

继续完善 Maxma 面向编码与办公新手的开箱 Agent 能力：把必要的本地 Skills 随开发版、普通便携版和 Electron 桌面便携版稳定交付；核实 MCP/插件边界，避免重复已有工具或要求用户承担新增服务费用。实现应保持在 Maxma 适配层，不修改 Pi 本体。

## 用户确认的约束

- UI 实机检查使用浏览器工具即可，不使用 Computer Use。
- 不新增需要付费的外部服务，不把自定义端点或免费端点的成本/能力臆测为确定事实。
- 保持 Pi 原生能力可插拔；不要通过改动 Pi 本体实现功能。
- 范围遵守仓库根目录 AGENTS.md 交付要求：仅做当前目标所需的配套改动。
- 工作区已有的无关修改必须保留，不能覆盖、回滚或混入本任务提交。

## 当前实现发现

- Pi 依赖位于 `bun-sidecar`，Skills 通过 `DefaultResourceLoader` 和 `additionalSkillPaths` 加载。
- `bun-sidecar/src/kernel/skills.ts` 当前只把工作区 `.agents/skills` 和用户目录 `.agents/skills` 传给 Pi；开发环境因此可能扫描到大量仓库开发 Skills，但没有明确的 Maxma 随包 Skills 目录。
- `bun-sidecar/src/kernel/pi-session.ts` 在 Skills 禁用时将额外路径设为空，并传 `noSkills`；应保留此开关语义。
- Pi 的本地文档 `bun-sidecar/node_modules/@earendil-works/pi-coding-agent/docs/skills.md` 说明 Pi 启动时只注入 Skills 的名称、描述和路径，完整 `SKILL.md` 仅在任务匹配时加载。应基于此特性把资源做成精简、按需载入的本地 Skills。
- MCP 配置在 `api/data/mcp_servers.yaml`，适配位于 `bun-sidecar/src/kernel/mcp.ts`。Pi 适配当前支持 stdio 与 streamable HTTP；SSE、WebSocket 不能当作可用能力宣传。MCP 服务可能需要用户自行安装本地程序或配置凭据，应作为可选项，不预设用户已有服务。
- `/api/plugins` 旧路由只是 stub，安装/卸载返回 501；Maxma/Pi 路径应优先用 Pi 原生 Skills、MCP、inline extensions。
- Maxma 当前随包提供 7 个 Pi 默认工具与 5 个 Maxma 自定义工具；网页搜索、浏览器自动化、GitHub 等外部能力应通过用户主动配置的 MCP 提供，避免重复内置与额外费用。
- `build-desktop-portable.ps1` 目前复制 `.omp/skills` 到运行目录；`build-portable.bat` 也复制旧 `.omp/skills`。新 Skills 若加入，需沿用应用只读资源根目录 `MAXMA_BUNDLE_DIR` 并同步两个打包流程。
- Electron 桌面运行时的 bundle root 在 `desktop/electron/main.cjs` 设置为打包资源目录；构建清单在 `desktop/electron-builder.config.cjs`。桌面打包现有校验强制检查两个内置人格文件。

## 本轮工作区状态

仓库：`D:\Maxma\MaxmaHere`。已有多处工作区修改，本轮没有编辑代码或构建产物。修改文件包括便携构建脚本、Electron 打包配置、persona 测试及多个 Vue 页面。不得清理这些变更。

## 建议下一步

1. 明确随包 Skills 的资源目录和开发版/便携版/Electron 的统一定位，并补充独立单元测试验证扫描结果、路径和禁用行为。
2. 根据新手真实流程，仅加入小而通用、可复用的编码与办公 Skills；Skills 指令应可调用 Maxma 当前已有工具，不引入不必要依赖。
3. MCP 保留为可选连接能力；只有经过实际验证、无服务费且不重复 Maxma 内置工具的场景，才提供内置示例或新手说明。
4. 更新 `build-portable.bat`、`build-desktop-portable.ps1`，验证便携包含资源且路径不指向用户可写数据目录。
5. 运行 Skills 相关测试、后端/sidecar 检查与便携构建资源校验。若需要界面实测，只用浏览器工具。
6. 本次已有未提交修改很多。完成后审阅 diff、只报告本任务文件；不要为了遵循旧 skill 的“提交”指引而把无关工作区改动一起提交。

## 建议使用的 Skills

- `implement`：按小范围实现并跑相关检查。
- `code-review`：完成后检查本次 diff 的范围和兼容性。
- `diagnosing-bugs`：若发现启动、发现或装载异常，再用于定位。
