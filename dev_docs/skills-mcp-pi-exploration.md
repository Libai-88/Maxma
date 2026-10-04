# Skills、MCP 与 Pi 扩展探索清单

> 调研日期：2026-10-04（GitHub 热度为本次查询时的快照，不代表长期质量）
>
> 范围：寻找可为 Maxma 提供随包候选或按需安装候选的开源 Skills、国内友好 MCP 和 Pi 扩展。本轮只做研究，不安装、不修改配置、不执行打包。

## 结论摘要

1. **首批最值得做成 Maxma 原生技能的方向**：Superpowers 的需求澄清/TDD/调试方法、Caveman 的按需压缩思想、科研写作的 evidence-first 流程、文档/表格质量检查流程。建议重写为 Maxma 自有最小技能，而不是直接复制整个上游仓库。
2. **最适合做“可选连接器”而非随包启用的 MCP**：Jina、Playwright、百度地图、百度网盘、阿里云 CloudOps、火山引擎。它们都涉及网络、账户、外部数据或高影响操作，默认关闭更合理。
3. **最值得研究的 Pi 扩展**：`pi-web-access`、`pi-intercom`、`pi-messenger`、`narumiruna/pi-extensions` 和 `ogulcancelik/pi-extensions` 中的 session recall、subagents、compaction、LSP 组件。Maxma 已有实时协作、目标、技能发现和原生文件工具，不能直接重复装配。
4. **不建议直接随包复制的项目**：许可证缺失或混合、依赖远端账户、拥有 shell/浏览器/文件写入权限、会改变 Agent 全局行为、或仅为个人配置的项目。它们可以进入“按需安装/人工审计”目录。

## 分级规则

| 等级 | 含义 |
| --- | --- |
| A：可转化内置 | 许可证清晰、主要是 Markdown/模板/纯本地逻辑，与 Maxma 能力边界匹配；仍需逐文件审计并保留来源和版本。 |
| B：可选内置目录 | 项目有价值，但需要用户主动启用、API key、网络、浏览器、账号或高权限；随包只放经过审计的 manifest/安装说明。 |
| C：研究/不直接内置 | 许可证、供应链、运行权限、维护状态或与 Maxma 的兼容性不足；仅保留链接和评估结果。 |

## Skills 候选

| 领域 | 项目 / 热度快照 | 类型与主要能力 | 许可证 | 依赖 / 成本 | Maxma 适配判断 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| 通用 Agent Skills | [anthropics/skills](https://github.com/anthropics/skills)（约 179.6k） | 官方 Agent Skills 示例；覆盖文档、表格、演示、视觉、MCP 创建、企业工作流等；每个目录有 `SKILL.md` | 仓库说明为多数 Apache-2.0，但目录需逐项核验 | 部分技能需要 Python、Office/渲染器或外部服务 | 结构与 Maxma `.maxma/skills` 高度匹配；整仓复制会引入大量重复和不同许可证 | **A（精选迁移）**：优先研究文档/表格/演示的流程和检查清单，不直接整包复制 |
| 官方插件目录 | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)（约 37.4k） | 官方维护的插件目录，含 skills、commands、agents 和可选 `.mcp.json` | 目录仓库 Apache-2.0；第三方插件许可证须逐插件核验 | 插件可能执行 MCP、读写文件或安装软件 | 它是目录/分发源，不等于所有插件都安全可内置 | **C（索引源）**：只借鉴清单，逐插件审计后再进入 Maxma 市场 |
| 软件工程方法 | [obra/superpowers](https://github.com/obra/superpowers)（约 295.1k） | 需求澄清、分段设计、计划、TDD、系统调试、代码审查、子 Agent 协作；README 明确列出 Pi 适配 | MIT | 主要是提示词/技能；执行阶段仍需要 Agent 原有工具 | 与 Maxma 的 brief → live steering → review 闭环互补，但会与现有 `coding-starter`、`debugging-starter` 重叠 | **A（精选重写）**：吸收工作流和验收标准，避免直接启用第二套全局规则 |
| 工程插件集合 | [wshobson/agents](https://github.com/wshobson/agents)（约 40.2k） | 多 harness 插件市场；仓库声明约 94 个插件、184 个 skills、202 个 agents，支持 Codex、OpenCode、Pi 等 | MIT | 各插件依赖不同；部分含 MCP、hooks、命令 | 覆盖面大，但粒度和权限差异大，整包会造成上下文膨胀和重复工具 | **B/C**：按领域筛选后逐项迁移，不接入整个 marketplace |
| Agent 性能与记忆 | [affaan-m/ECC](https://github.com/affaan-m/ECC)（约 272.7k） | skills、instincts、memory、security、research-first、性能和上下文管理 | MIT | 依项目配置；可能改变 Agent 的全局行为 | 可为 Maxma 的成本控制、记忆和研究流程提供素材；与现有 goal/evolution/skills 系统重叠 | **B（研究素材）**：抽取独立、可验证的规则，不直接引入全局钩子 |
| 成本优化 | [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)（约 109.7k） | 通过更短的 Agent 输出和网页压缩降低输入/输出 token；仓库同时包含 skill、CLI/proxy 和 benchmark | Apache-2.0 | CLI/proxy 可能改变请求链路；成本效果依模型和任务而异 | “短而不丢信息”的提示规范可内置；代理层不应默认替换 Maxma 的模型请求链 | **A（规则）/ B（代理）**：先迁移压缩原则和可测 benchmark，代理仅做实验开关 |
| 科研写作 | [SyntaxSmith/nature-writing-skill](https://github.com/SyntaxSmith/nature-writing-skill)（约 150） | Nature 系列论文的 abstract、intro、results、methods、discussion、figure 写作和审稿 checklist；基于 44 篇 OA 论文整理 | **未声明许可证** | Markdown 资料；论文内容和引用仍需用户提供/核验 | 内容领域高度匹配，且本机已存在 Nature 系列研究技能；许可证阻止直接随包复制 | **C（仅参考）**：先取得授权或自行重写，不复制原文语料 |
| 科研投稿 | [cLin-c/paper-skill](https://github.com/cLin-c/paper-skill)（约 114） | evidence-first 论文写作、润色、审稿、翻译、SCI/IEEE/Nature 投稿和 LaTeX/Overleaf 流程 | MIT | 需要文献、LaTeX 或用户的投稿材料；检索能力另配 | 与现有 `research`、`paper-reproduction` 及本机 Nature 技能有重叠，适合比较流程质量 | **A/B（精选重写）**：吸收证据边界、引用核验、投稿 checklist |
| 安全研究 | [trailofbits/skills](https://github.com/trailofbits/skills)（约 7.4k） | 漏洞发现、安全审计、模糊测试、逆向和安全工程工作流 | CC-BY-SA-4.0 | 可能需要编译器、分析器、容器或网络；输出需专家复核 | 对代码安全价值高，但 ShareAlike 和高风险操作不适合无审计整包 | **B**：只做显式“安全审计模式”，不默认启用 |
| 大规模技能目录 | [pm-claude-skills](https://github.com/mohitagw15856/pm-claude-skills)（约 1.4k） | README 宣称 1166 个跨工具技能，覆盖项目管理、专业文档和决策 | MIT | 数量大；质量、重复度和各技能依赖需逐项检查 | 可作候选发现源，不适合作为 Maxma 随包集合 | **C（索引源）**：只挑选经测试的少量技能 |
| 技能目录 | [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)（约 55.1k） | 社区资源目录，包含 skills、插件、工具和工作流链接 | 仓库标注为 Other/未明确标准许可证 | 依链接项目而异 | 目录有发现价值，但不能把列表条目当作可再分发代码 | **C（索引源）** |
| 本地已有 | Maxma `.maxma/skills` 与本机 Nature 技能集合 | 已有 coding、debugging、document、office、spreadsheet、research、paper-reproduction、frontend、git、knowledge 等 | 以本地文件及各技能来源为准 | 已随当前开发环境存在；便携包只复制项目内已批准目录 | 新候选必须先做重复/覆盖分析，不能简单叠加 | **基线**：后续候选评估都以现有技能为差分 |

## MCP 候选

| 领域 | 项目 / 热度快照 | 能力 | 许可证 | 凭据 / 网络 / 权限 | Maxma 适配判断 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| 官方 MCP 参考 | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)（约 91.0k） | 官方/参考 MCP 服务器集合；适合查看 filesystem、fetch、GitHub 等服务器实现和协议惯例 | 仓库为 NOASSERTION；必须按子目录核验 | 各服务器差异很大 | Maxma 已有原生文件/办公工具；不应把整仓作为随包运行时 | **C（参考源）**：只选协议和测试思路 |
| 浏览器自动化 | [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)（约 37.8k） | Playwright 驱动浏览器，页面检查、操作、截图和网页工作流 | Apache-2.0 | Node、浏览器运行时、网络；网页内容是外部不可信输入 | 能补足 Maxma 当前浏览器缺口，但高权限、安装体积和 prompt injection 风险明显 | **B**：按需安装/用户启用，默认不连 |
| 网页搜索/阅读 | [jina-ai/MCP](https://github.com/jina-ai/MCP)（约 869） | `read_url`、网页/PDF 转 Markdown、搜索、截图、embedding/rerank 等远程工具 | Apache-2.0 | 远程 `https://mcp.jina.ai/v1`；部分能力可免 key，完整能力通常需 `JINA_API_KEY` | 对科研和网页阅读很有价值；远端服务、隐私和可用性需明确展示 | **B**：提供连接模板，默认关闭；不打包 key |
| 国内地图/位置 | [baidu-maps/mcp](https://github.com/baidu-maps/mcp)（约 445） | 地理编码、POI、驾车/步行/骑行/公交路线、天气、交通、IP 定位 | MIT | 百度地图 AK；访问外部位置数据 | 国内用户友好、边界清晰，适合作为首个国内 MCP 模板 | **B**：用户填 AK 后启用；写操作保持审批 |
| 国内云运维 | [aliyun/alibaba-cloud-ops-mcp-server](https://github.com/aliyun/alibaba-cloud-ops-mcp-server)（约 131） | Alibaba Cloud CloudOps MCP Server，面向云资源运维 | Apache-2.0 | 阿里云账号/STS、网络；可能影响生产资源 | 价值高但属于高影响工具，不能随包默认打开 | **B/C**：仅连接器目录，凭据分级和只读默认 |
| 国内云服务集合 | [volcengine/mcp-server](https://github.com/volcengine/mcp-server)（约 328） | 火山引擎 MCP servers 集合 | MIT | 火山引擎凭据和网络；具体 server 权限逐项不同 | 可覆盖国内搜索、云服务或内容场景，但必须按子 server 做权限审计 | **B/C**：精选只读服务，不整仓启用 |
| 国内网盘 | [baidu-netdisk/mcp](https://github.com/baidu-netdisk/mcp)（约 132） | 文件列表、文档/图片/视频查询、上传、复制、删除、移动、重命名和搜索 | MIT | 百度网盘账号/OAuth；有本地文件上传和删除等写操作 | 对中文用户实际价值高，但远端文件访问和删除风险高 | **B**：只提供按需配置；删除/移动必须二次审批 |
| 国内搜索（社区） | [Evilran/baidu-mcp-server](https://github.com/Evilran/baidu-mcp-server)（约 28） | 百度搜索、网页抓取和 LLM 友好格式化，带限流/错误处理 | MIT | 网络；网页内容不可信；社区维护 | 可作为国内搜索备选，但官方性和热度不足，和 Jina 能力重复 | **C/B**：先做可用性、安全和结果质量对比 |
| ModelScope | [modelscope/modelscope-mcp-server](https://github.com/modelscope/modelscope-mcp-server)（约 27） | ModelScope 官方 MCP server | Apache-2.0 | 该仓库已标为 Deprecated；服务可用性需确认 | 不应把已弃用仓库作为新内置依赖；Maxma 已有 ModelScope marketplace 相关能力 | **C（不采用）** |
| GitHub 开发协作 | [github/github-mcp-server](https://github.com/github/github-mcp-server) | GitHub issue、PR、仓库和代码协作工具 | MIT | GitHub token、网络；写 issue/PR 和代码操作有权限风险 | 对代码 Agent 很有用，但 Maxma 目前可通过 API/本地 Git 覆盖部分场景 | **B**：用户授权后按需连接，最小 token 权限 |
| 本地文件系统 | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) 中的 filesystem 参考 | 目录/文件读写 | 按子目录核验 | 本地路径权限 | Maxma 已有原生文件工具和路径边界，重复接入会扩大攻击面 | **C（不重复内置）** |
| 数据库 | MCP 官方/社区 SQL 服务器 | 数据库查询、分析和迁移 | 各项目不同 | 数据库凭据；读写影响大 | 当前 Maxma 没有通用数据库工作流，适合企业按需安装而非便携包 | **C/B**：只读连接器优先 |

## Pi 扩展候选

| 领域 | 项目 / 热度快照 | 主要能力 | 许可证 | 运行边界 | Maxma 适配判断 | 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| Pi 扩展集合 | [narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions)（约 652） | 可独立安装的 coding、research、browser automation、workflow、observability 和 terminal 扩展；README 示例含 goal、statusline、LSP | MIT | Pi 扩展拥有完整用户权限；每个 npm 包需单独审计 | 适合作为 Pi 兼容性研究源；Maxma 已实现部分 goal/status/skills 能力 | **B/C**：精选移植，避免整集合并 |
| Pi 扩展集合 | [ogulcancelik/pi-extensions](https://github.com/ogulcancelik/pi-extensions)（约 553） | session recall、上下文压缩、自动权限、Codex 风格 subagents、worktree、SSH、图片裁剪等 | MIT | 其中 auto-permissions、SSH、subagents、worktree 权限较高 | 与 Maxma 的实时协作、目标、上下文和权限系统有大量可比较设计 | **B**：优先研究 session recall/compaction；高权限扩展仅按需 |
| 网页访问 | [nicobailon/pi-web-access](https://github.com/nicobailon/pi-web-access)（约 1.6k） | Pi 的网页搜索和内容抽取扩展 | MIT | 网络、网页不可信；底层服务/凭据需查看版本配置 | 可补 Maxma 的网页搜索缺口，但与 Jina MCP 可能重复 | **B**：在 Pi 原生扩展与 Jina MCP 中二选一做适配 |
| 多 Agent 群聊 | [nicobailon/pi-messenger](https://github.com/nicobailon/pi-messenger)（约 715） | 本地 broker、agent 加入/预留路径/发送消息，用于多 Agent 协作 | **仓库许可证需进一步核验** | 本地 IPC/broker；跨会话写入和协作状态 | 理念与 Maxma 人机实时协作相关，但 Maxma 已有实时事件与 session 体系 | **C/B**：只借鉴协议和交互，不直接内置未知许可证代码 |
| Pi 会话 1:1 通讯 | [nicobailon/pi-intercom](https://github.com/nicobailon/pi-intercom)（约 525） | 会话间定向消息、状态发现、overlay；可与子 Agent 协作 | MIT | 本地 broker/IPC；完整用户权限 | 比群聊更接近 Maxma 的“用户把信息转给另一个 Agent”场景 | **B**：研究其消息模型，优先与 Maxma session bridge 统一 |
| Pi 状态/终端体验 | [nicobailon/pi-powerline-footer](https://github.com/nicobailon/pi-powerline-footer)（约 449） | 状态栏、上下文和运行状态展示 | 需核验 | 主要 UI/终端状态 | Maxma 是桌面 UI，直接内置收益有限 | **C（仅借鉴）** |
| Pi 配置工作流 | [HazAT/pi-config](https://github.com/HazAT/pi-config)（约 452） | plan → todos → execute → review 的 Pi 配置工作流，含会话旁路文件 | MIT | 个人配置、安装脚本、可能含外部 runtime 和凭据配置 | 可作为完整工作流案例，但不是可直接嵌入的插件包 | **C/B（参考）** |
| Pi fork | [code-yeongyu/senpi](https://github.com/code-yeongyu/senpi)（约 462） | 面向 Pi 的 extension-first fork | MIT | 需要评估 fork 与 Maxma sidecar 的 API/版本分叉 | Fork 不是单个可控插件，升级和兼容成本高 | **C（不直接采用）** |
| 目标模式 | [code-yeongyu/pi-goal](https://github.com/code-yeongyu/pi-goal) | 持久化目标/目标追踪扩展 | MIT | Pi 会话文件 | Maxma 已有 goal RPC、goal 状态和目标事件 | **C（不重复）** |

## 按场景的优先级矩阵

| 场景 | 第一候选 | 第二候选 | 适合的交付形态 | 关键验收 |
| --- | --- | --- | --- | --- |
| 新手不会描述需求 | Superpowers + Maxma task-brief | ECC 的 research-first 规则 | Maxma 原生 skill | 提问轮次下降、首次成功率上升、不过度提问 |
| 代码编程 | Superpowers | wshobson/agents、ECC | 精选 skill，不整包插件 | TDD、调试、review 与现有权限模式不冲突 |
| 降低 token 成本 | Caveman 的压缩原则 | ECC 的上下文/记忆规则 | 可选 skill + benchmark；代理层默认关闭 | 输出正确率、输入 token、延迟和失败率的差分测试 |
| 文档办公 | Anthropic skills 的 doc/xlsx/ppt 思路 | Maxma office/document/spreadsheet starter | Maxma 原生技能或本地库 | 文件格式、保留原稿、渲染/打开复核 |
| 学术科研 | 现有 Nature 系列技能 + paper-skill | nature-writing-skill（需授权） | 精选重写 + 文献工具连接器 | 引用可追溯、证据边界、不能臆造文献 |
| 网页检索 | Jina MCP | pi-web-access / Playwright MCP | 连接器目录，默认关闭 | prompt injection 隔离、域名/数据范围、超时 |
| 国内位置服务 | 百度地图 MCP | 火山/阿里云按需服务 | 可选 MCP 模板 | AK 安全、调用计费、只读默认 |
| 国内文件服务 | 百度网盘 MCP | 本地文件原生工具 | 可选 MCP，写操作二次审批 | OAuth、删除/移动确认、路径和数据外泄 |
| 多 Agent 协作 | pi-intercom | pi-messenger | 研究协议后接入 Maxma session 协作层 | 消息去重、权限、断线和生命周期 |

## 随包内置的共同门槛

候选项目只有同时满足下列条件，才进入下一轮实现评审：

- 许可证和再分发范围明确；许可证缺失、混合或 ShareAlike 项目不得直接复制进便携包。
- 代码、技能文本、脚本、npm/PyPI 依赖和远程端点均有固定版本或提交号记录。
- 默认不携带 API key、OAuth token、个人配置、遥测开关或外部 MCP 连接。
- 运行权限可拆分：只读、联网、浏览器、shell、写文件、删除/生产运维分别声明并默认最小化。
- 能在 Maxma 现有技能和原生工具覆盖之外提供清晰增量；重复能力优先合并为 Maxma 自有实现。
- 有最小 smoke test：技能加载、依赖缺失、网络超时、恶意网页/路径、错误回传和卸载/禁用。
- 能在便携 Windows 环境运行，或明确标记为“仅配置模板/仅联网服务”，不阻塞离线启动。

## 推荐的下一轮评审顺序

1. **Superpowers 精选迁移**：需求澄清、计划、TDD、系统调试、review，和现有三阶段协作闭环做差分测试。
2. **Caveman 成本实验**：只验证提示压缩/网页摘要规则，不引入代理；记录 token、质量和延迟。
3. **科研技能合规评审**：优先 MIT 的 `paper-skill`，对未声明许可证的 Nature 技能只做结构借鉴或先联系作者。
4. **Jina 与 Playwright 二选一**：Jina 适合轻量搜索/阅读，Playwright 适合交互式网页；先做安全隔离和超时测试。
5. **百度地图 MCP 模板**：作为国内 MCP 的低风险样板；百度网盘、阿里云和火山引擎放到只读/账户授权设计之后。
6. **Pi intercom/messenger 对比**：不复制代码，先对比消息模型与 Maxma 已有 steer/follow-up、session 和广播机制。

## 来源与限制

- 项目链接均指向项目的一手仓库或官方目录；许可证、星标和 README 能力描述以调研时仓库状态为准。
- 热度不是安全性、正确性或维护质量的证明；本清单未执行候选项目代码、未安装 npm/PyPI 包、未连接远程 MCP。
- “国内友好”表示国内服务商/数据源或在中国网络环境有现实适配价值，不表示服务永久免费、无需备案或一定可用。
- 本文件是候选研究表，不是已批准的随包清单；任何实现前都需要逐项目许可证、依赖、权限和运行时测试。
