# Maxma 跨项目借鉴探索报告

> 本文档探索 Maxma 从三个参考项目中学到了什么、如何借鉴、哪些没借鉴到位。
>
> - **Halo 2.1.12**（`D:\Maxma\hello-halo-2.1.12`）：Electron + React + TypeScript AI 工作站
> - **Awesome LLM Apps**（`D:\Maxma\awesome-llm-apps-main`）：100+ LLM 应用模板集合
> - **OpenHanako 0.357.17**（`D:\Maxma\openhanako-0.357.17`）：Electron + React + Hono 桌面 AI 助手

---

## 一、后端架构与功能设计

### 1.1 已借鉴并落地的设计

| # | 设计 | 来源 | Maxma 实现 | 借鉴质量 |
|---|---|---|---|---|
| 1 | 三阶段启动分层（Essential/Extended/Idle） | Halo `bootstrap/` | `api/bootstrap/idle_queue.py` | ✅ 到位：Tier 3 空闲任务队列 + `start_idle_drain` |
| 2 | Disposable 资源管理（IDisposable + DisposableStore） | Halo `platform/event/disposable.ts` | `agent/lifecycle/disposable.py` | ✅ 到位：完整移植 IDisposable / DisposableStore / MutableDisposable / combined_disposable |
| 3 | 事件去重缓存（TTL + FIFO LRU） | Halo `apps/runtime/event-dedup.ts` | `maxma_platform/event_dedup.py` | ✅ 到位：TTL + maxSize LRU 淘汰 |
| 4 | 凭据掩码统一层 | Halo `foundation/logging/redact.ts` | `api/security/credential_mask.py` | ⚠️ 部分：只做了掩码，Halo 的 `crypto-envelope`（SM4-CBC + HMAC-SM3 加密存储）+ 双 key 优先级恢复未移植 |
| 5 | JSONL 透明抄本 | Halo `apps/runtime/session-store.ts` | `api/transcript/jsonl_writer.py` + `api/routes/transcripts.py` | ✅ 到位：TranscriptWriter 线程安全 + 路径穿越防护 |
| 6 | 调度器指数退避 | Halo `platform/scheduler/timer.ts` | `agent/autonomy/scheduler.py` | ⚠️ 部分：有 MAX_CONSECUTIVE_FAILURES=5 + 封顶 24h，但 Halo 的 5 档退避表（30s→1m→5m→15m→60m）+ anchor-grid 防爆发 + 卡死自愈（2h 阈值清理）未移植 |
| 7 | 流式修复管道（空 turn / tool JSON / usage） | Halo `openai-compat-router/stream/` | `agent/stream_repair/` (4 模块) | ✅ 到位：empty_turn + tool_json_repair + usage_backfill + pipeline 集成，feature flag 控制 |
| 8 | report_to_user 完成信号 + 自动 continue | Halo `apps/runtime/execute.ts` | `agent/autonomy/completion_signal.py` | ✅ 到位：RunOutcome + detect_completion_signal + MAX_AUTO_CONTINUES=10 |
| 9 | Escalation run 边界（headless → 用户输入） | Halo `apps/runtime/execute.ts` | `agent/autonomy/escalation.py` | ✅ 到位：EscalationStore + ESCALATION_TIMEOUT_HOURS=24 |
| 10 | 工作记忆 Push 注入（# now + # History 双层） | Halo `platform/memory/DESIGN.md` | `agent/memory/working_memory.py` | ✅ 到位：WorkingMemoryStore 双层结构 + 三档注入策略 |
| 11 | Keep-alive TTL 安全网（24h 惰性剪枝） | Halo `platform/background/keep-alive.ts` | `maxma_platform/keep_alive.py` | ✅ 到位：DEFAULT_TTL_SECONDS=86400 + 惰性剪枝 |
| 12 | 循环检测（工具签名重复终止） | OpenHanako 无此机制（Maxma 独有） | `agent/loop_detector.py` | ✅ Maxma 独有设计，OpenHanako 反而缺这层防护 |
| 13 | Provider 故障转移 | OpenHanako `provider-registry.ts` | `api/providers/manager.py` + `agent/graph.py` | ✅ 到位：优先级排序 + fallback 链路 + 同 turn 工具副作用保护 |
| 14 | HITL 审批网关 | OpenHanako `approval-gateway.ts` | `agent/approval_gateway.py` + `ApprovalToolNode` | ⚠️ 部分：Maxma 是单一审批层，OpenHanako 是双 reviewer（small model 快审 + large model 深审）+ escalation 链 |
| 15 | 子 Agent 委派 | OpenHanako `subagent-tool.ts` | `tools/sub_agent/` | ⚠️ 部分：Maxma 是同步阻塞调用，OpenHanako 是 fire-and-forget + DeferredResultStore 异步回灌 |
| 16 | MCP 四协议支持 | OpenHanako `plugins/mcp/` | `tools/mcp.py` + `mcp_runtime.py` | ⚠️ 部分：Maxma 支持 stdio/SSE/HTTP/WS，但 OpenHanako 的 OAuth 提前 60s 刷新 + 自动重连退避未移植 |
| 17 | Corrective RAG | Awesome LLM Apps `rag_tutorials/corrective_rag/` | `memory/kb/grading/` + `crag_enabled` flag | ✅ 到位：文档评分 + 不相关时 query 重写 + Tavily 回退，feature flag 控制 |
| 18 | 情景记忆 session 隔离 | OpenHanako `agent.ts` 双层开关 | `memory/episodic.py` | ✅ 到位：默认按 session 隔离 + 失败轮次不投影 |

### 1.2 未借鉴但有价值的设计

#### 来自 Halo

| # | 设计 | 文件路径 | 价值 | 未借鉴原因 |
|---|---|---|---|---|
| A1 | 凭据加密存储（crypto-envelope SM4-CBC + HMAC-SM3） | `foundation/crypto-envelope.ts` | 本地存储的 API key 加密，防配置文件被复制 | Maxma 当前用明文 YAML 存储，可考虑加密 |
| A2 | 双 key 优先级凭据恢复 | `foundation/crypto-envelope.ts` | 持久化 master key + legacy seed 双轨，永不重新生成损坏的 key | Maxma 无加密层所以暂不需要 |
| A3 | 调度器 anchor-grid 防爆发 | `platform/scheduler/timer.ts` | `Math.ceil(elapsed / interval)` 防离线期间累积爆发 | Maxma 退避策略较简单 |
| A4 | 调度器卡死自愈（2h 阈值） | `platform/scheduler/timer.ts` | `STUCK_JOB_THRESHOLD_MS=2h` 清理卡死 job | Maxma 无此机制 |
| A5 | 渲染进程崩溃自愈 | `main/index.ts` | 60s 滑窗 3 次重试 + relaunch | Tauri 前端崩溃恢复未实现 |
| A6 | Mid-turn 消息注入 | `services/agent/inject-message.ts` | agent 执行中追加消息，下一个 tool boundary 吸收 | Maxma 不支持执行中追加 |
| A7 | MCP 工具名 belt-and-suspenders 脱敏 | `services/agent/stream-processor.ts` | `mcp:<server>` → `mcp:<redacted>` | Maxma telemetry 未做此脱敏 |

#### 来自 OpenHanako

| # | 设计 | 文件路径 | 价值 | 未借鉴原因 |
|---|---|---|---|---|
| B1 | 非阻塞 Deferred 子 Agent | `lib/tools/subagent-tool.ts` | fire-and-forget + 后台回灌，父不阻塞 | Maxma 子 Agent 是同步阻塞调用 |
| B2 | 双 Reviewer Approval Gateway | `lib/approval-gateway.ts` | small model 快审 + large model 深审 + escalation | Maxma 是单一审批层，无 LLM reviewer |
| B3 | Cache-preserving Session Compaction | `core/session-compactor.ts` | 压缩时保护 KV cache 前缀 + 结构化摘要模板 | Maxma 有 session_compress 路由但无 cache 友好压缩 |
| B4 | Memory Ticker v4 传送带 | `lib/memory/memory-ticker.ts` | 按天滚动 + 断点续跑 + 5 步 daily | Maxma 记忆是全量重算式 |
| B5 | FactStore 无向量（FTS5 + CJK ngram） | `lib/memory/fact-store.ts` | 抛弃 embedding，用 LLM 标签 + FTS5 全文搜索 | Maxma 用 ChromaDB 向量，可考虑 FTS5 补充 |
| B6 | 双层沙盒（PathGuard + OS 级） | `lib/sandbox/` | 应用层 PathGuard + macOS seatbelt / Linux bwrap / Win32 | Maxma 沙盒仅 firejail，无 OS 级隔离 |
| B7 | Hub 统一消息路由 | `hub/index.ts` | 桌面/Bridge/cron 统一路由表 | Maxma 无多平台消息需求 |
| B8 | 声明式 Provider 插件注册表 | `core/provider-registry.ts` | 30+ Provider 静态声明能力 | Maxma Provider 管理较简单 |
| B9 | Workflow Tool（确定性 JS 编排） | `lib/tools/workflow-tool.ts` | 确定性脚本编排 Agent 调用 + journal 断点续跑 | Maxma 无 workflow 概念 |
| B10 | Execution Lease（远程写操作租约） | `core/execution-lease-service.ts` | 远程写操作 5 分钟 TTL 租约 | Maxma 无远程操作需求 |
| B11 | Bridge 多平台接入 | `lib/bridge/bridge-manager.ts` | Telegram/飞书/钉钉/QQ/微信统一接入 | Maxma 无 IM 接入需求 |
| B12 | decorrelated jitter 重试 | `shared/retry.ts` | AWS 推荐的去相关抖动退避 | Maxma 用固定指数退避 |

#### 来自 Awesome LLM Apps

| # | 设计 | 文件路径 | 价值 | 未借鉴原因 |
|---|---|---|---|---|
| C1 | 前端工具 + renderAndWaitForResponse | `ai-dashboard-canvas-agent/src/components/chat/actions/` | 工具调用在前端渲染交互式 UI + 等待用户确认 | Maxma 工具气泡是只读展示，无前端工具 |
| C2 | CopilotKit CoAgent 状态共享 | `ai-dashboard-canvas-agent/src/components/dashboard/` | Agent 修改 state 时前端自动更新 | Maxma 是 WebSocket 推送，非状态同步 |
| C3 | LLM 失败优雅降级为启发式 | `devpulse_ai/agents/relevance_agent.py` | LLM 不可用时回退到基于规则的评分 | Maxma 工具调用失败是直接报错 |
| C4 | Agent 按角色分配不同模型 | `devpulse_ai/agents/` | 分类用 mini 模型，综合用强模型 | Maxma 单一模型走天下 |
| C5 | 自我进化 Agent Skills | `self-improving-agent-skills/backend/` | 三 Agent 协作优化 SKILL.md（执行→分析→变异→评估） | Maxma 自治层有 manage_skills 但无自动优化闭环 |
| C6 | 信任门控 + 哈希链审计 | `trust_gated_agent_team/` | 信任评分 + SHA-256 哈希链防篡改审计 | Maxma 有 audit_log 但无信任评分 |
| C7 | Always-on Agent（观察/调度/投递分离） | `always_on_hn_briefing_agent/` | Scout/Scheduler/Delivery 三层独立 | Maxma 自治层是单一 runner |
| C8 | ThreadPoolExecutor 隔离子 Agent 流 | `ai-deep-research-agent/agent/tools.py` | 子 Agent 流式输出不泄露到父 Agent | Maxma 子 Agent 流式未隔离 |

### 1.3 后端差距总结

**核心差距**（按优先级排序）：

1. **子 Agent 异步化**（B1）：Maxma 的子 Agent 是同步阻塞调用，父 Agent 必须等待子 Agent 完成。OpenHanako 的 fire-and-forget + DeferredResultStore 让父 Agent 可以继续做别的事。这是**架构级差距**。

2. **审批网关双 reviewer**（B2）：Maxma 的审批是"全 ask_user"或"全 auto"二选一。OpenHanako 用 small model 快速审核 + large model 深度审核 + escalation 链，兼顾成本和安全。Maxma 的 `ApprovalGateway` 可以引入 LLM reviewer 层。

3. **Session Compaction cache 友好**（B3）：Maxma 有 `session_compress` 路由但压缩时不保护 KV cache 前缀。OpenHanako 的 `cache-preserving-compaction` 把 summarization instruction 放到 cached prefix 之后，让静态前缀保持不变。

4. **记忆系统传送带模式**（B4）：Maxma 的记忆是"每次全量重算"式。OpenHanako 的 Memory Ticker v4 按"传送带"分阶段：每 10 轮滚动摘要 + session 结束 final 摘要 + 每天一次 compileDaily。week 段从 LLM 编译降级为纯文件装配（零 LLM 成本）。

5. **代码执行沙盒双层隔离**（B6）：Maxma 沙盒仅 firejail（Linux）。OpenHanako 是应用层 PathGuard + OS 级 seatbelt/bwrap/Win32 restricted token 双层防护。

6. **LLM 失败优雅降级**（C3）：Maxma 工具调用失败是直接报错。Awesome LLM Apps 在 LLM 不可用时自动回退到基于规则的启发式逻辑，标记 "Heuristic (LLM unavailable)"。

---

## 二、前端 UI、交互与功能设计

### 2.1 已借鉴并落地的设计

| # | 设计 | 来源 | Maxma 实现 | 借鉴质量 |
|---|---|---|---|---|
| F1 | 12 套主题系统（CSS 变量 + data-theme） | OpenHanako `themes/` | `web/src/themes/` 11 个主题 + `useTheme.ts` | ✅ 到位：warm-paper/midnight/high-contrast/grass-aroma/coral/delve/deep-think/absolutely/dawn/midnight-contrast + auto |
| F2 | 动画系统（@keyframes + cubic-bezier 缓动） | OpenHanako `globals.css` | `web/src/assets/styles/animations.css` + `tokens.css` | ✅ 到位：hana-* 前缀动画 + 三档动效时长 + 4 条缓动曲线 |
| F3 | 工具调用专属气泡（按工具类型路由） | Halo `ToolCard.tsx` + Awesome LLM Apps `ToolCard.tsx` | `web/src/components/tools/registry.ts` + 14 类专属气泡 | ✅ 到位：TodoBubble/PythonBubble/FilesBubble/FileEditBubble/GitStatusBubble 等 |
| F4 | Markdown 全家桶（KaTeX + 代码高亮 + task-list） | Halo `react-markdown` 插件链 | `web/src/components/RenderMarkdown.vue` | ✅ 到位：markdown-it + katex + 代码高亮 |
| F5 | PlanCard 计划展示（步骤状态 + 编辑模式） | Halo `TodoCard.tsx` | `web/src/components/PlanCard.vue` | ✅ 到位：步骤状态 done/failed/running/skipped + 编辑模式 + 重规划提示 |
| F6 | 侧边栏 + 主内容区布局 | OpenHanako `App.tsx` | `web/src/App.vue` | ✅ 到位：SessionSidebar + 主区 + LeavesOverlay |
| F7 | RegionalErrorBoundary 错误隔离 | OpenHanako `App.tsx` | `web/src/components/ui/RegionalErrorBoundary.vue` | ✅ 到位 |
| F8 | 贴纸/表情系统 | Maxma 独有 | `config/stickers/` + `StickerInline.vue` + `StickerPicker.vue` | ✅ Maxma 独有设计，参考项目无此功能 |
| F9 | 私密模式（Ctrl+K） | Maxma 独有 | `ChatWindow.vue` 全局监听 | ✅ Maxma 独有 |
| F10 | 工作台面板（推理时间线 + 画布卡片） | Awesome LLM Apps `Workspace.tsx` | `web/src/components/workbench/` | ✅ 到位：ReasoningTimeline + CanvasContainer + CodeCard/SummaryCard/TableCard |

### 2.2 未借鉴但有价值的前端设计

#### 来自 Halo

| # | 设计 | 文件路径 | 价值 | 未借鉴原因 |
|---|---|---|---|---|
| H1 | ThoughtProcess 垂直时间线 + 懒加载 | `renderer/components/chat/ThoughtProcess.tsx` | IntersectionObserver 懒加载 + viewport 外 minHeight 占位 | Maxma 工具气泡无懒加载，长对话时可能卡顿 |
| H2 | StreamingBubble 快照分段 + textBlockVersion | `renderer/components/chat/StreamingBubble.tsx` | tool_use 出现时快照 + 上滚动画，100% 可靠的新文本块信号 | Maxma 流式渲染无快照分段 |
| H3 | Pulse 面板（实时任务流 + 指纹优化） | `renderer/components/pulse/PulseList.tsx` | 正在生成/等待输入/未读完成的会话聚合成任务面板 + 派生指纹跳过未变字段重算 | Maxma 无 Pulse 面板 |
| H4 | 友好动作摘要 | `renderer/components/chat/thought-utils.ts` | 折叠态头部显示"Reading config.json..."而非原始工具名 | Maxma 工具气泡显示原始工具名 |
| H5 | 工具错误用 amber 而非 red | `renderer/components/chat/ThoughtProcess.tsx` | AI 内部反馈（如"先读再编辑"）用 amber，AI 会自愈，红色误导用户 | Maxma 错误用红色 |
| H6 | Canvas 多 Tab（CodeMirror/Html/Json/Markdown） | `renderer/components/canvas/CanvasTabs.tsx` | 多文件 Tab 叠加 + CodeMirror 编辑器 | Maxma 工作台是卡片式，无文件编辑 Tab |
| H7 | 快捷键系统（Cmd+K/Cmd+Shift+F/Cmd+F） | `renderer/hooks/useSearchShortcuts.ts` | 全局搜索 + 空间搜索 + 对话搜索三档 | Maxma 仅 Ctrl+K 一个全局快捷键 |

#### 来自 OpenHanako

| # | 设计 | 文件路径 | 价值 | 未借鉴原因 |
|---|---|---|---|---|
| O1 | ProcessFoldBlock 长流程折叠 | `desktop/src/react/components/chat/ProcessFoldBlock.tsx` | 连续 assistant 消息折叠成一行摘要 + 可展开 | Maxma 工具调用过程全部展开，长对话时刷屏 |
| O2 | ChatArea 多 session alive 缓存（MAX_ALIVE=5） | `desktop/src/react/components/chat/ChatArea.tsx` | visibility:hidden 保持 scrollTop，切换不丢滚动位置 | Maxma 切换 session 重新渲染，丢失滚动位置 |
| O3 | SubagentCard 静态卡 + 实时流订阅分离 | `desktop/src/react/components/chat/SubagentCard.tsx` | 聊天流静态卡不订阅 child session 高频流，打开时才订阅 | Maxma 子 Agent 在主聊天流同步展示 |
| O4 | InteractiveCard（iframe http + 主题变量注入） | `desktop/src/react/components/chat/InteractiveCard.tsx` | 卡片 HTML 经本地 server http 提供（避免 CSP 阻断）+ 主题 CSS 变量注入 iframe | Maxma 无交互式卡片 |
| O5 | SettingsConfirmCard（设置修改确认卡） | `desktop/src/react/components/chat/SettingsConfirmCard.tsx` | Agent 改设置先生成确认卡（toggle/list/text 三种控件），用户确认后通过 REST API resolve | Maxma 设置修改走设置页，非聊天流交互卡 |
| O6 | MoodBlock 可折叠情绪区块 | `desktop/src/react/components/chat/MoodBlock.tsx` | Agent 输出的 `<mood>` 标签渲染为可折叠区块（默认收起） | Maxma 后端 `_strip_mood_tags()` 直接剥离，前端不展示 |
| O7 | Jian 笺（右侧工作区笔记编辑器） | `desktop/src/react/components/right-workspace/` | Agent 工作笔记做成右侧抽屉式编辑器 | Maxma 工作台无笔记概念 |
| O8 | PlanModeButton 4 档权限模式 | `desktop/src/react/components/input/PlanModeButton.tsx` | auto/operate/ask/read_only 4 档权限 + SVG 图标 | Maxma 有 approval_gateway 但前端无 4 档切换器 |
| O9 | ActivityPanel 三桶分类 | `desktop/src/react/components/ActivityPanel.tsx` | 活动按 automation/patrol/other 三桶分类 + Agent Tab 切换 | Maxma 活动页是平铺列表 |
| O10 | WorkflowCard 两级展开 | `desktop/src/react/components/right-workspace/WorkflowCard.tsx` | workflow → phase → node → 实时流逐层下钻 | Maxma 无 workflow 概念 |
| O11 | OnboardingApp 6 步引导 | `desktop/src/react/onboarding/OnboardingApp.tsx` | 语言→名字→Provider→Model→主题→工作区→教程 | Maxma 无引导流程 |
| O12 | 纸质纹理背景 | `desktop/src/themes/warm-paper.css` | `--bg-texture` base64 PNG 实现纸质纹理 | Maxma 有 usePaperTexture composable 但需确认是否完整 |

#### 来自 Awesome LLM Apps

| # | 设计 | 文件路径 | 价值 | 未借鉴原因 |
|---|---|---|---|---|
| A1 | Agentic Canvas（聊天是侧栏，画布是主舞台） | `ai-dashboard-canvas-agent/src/app/page.tsx` | Agent 输出是可交互的可视化工件（图表/KPI/面板） | Maxma 工作台是卡片式，非 Canvas 范式 |
| A2 | 前端工具 + renderAndWaitForResponse | `ai-dashboard-canvas-agent/src/components/chat/actions/` | 工具调用在前端渲染交互式 UI + 等待用户确认/拒绝 | Maxma 工具气泡是只读展示 |
| A3 | ThinkPath 引导式思维路径 | `thinkpath_chatbot_app/main.js` | 生成 4 种思维路径（每种 3 步），用户选择执行深度，节省 60-70% token | Maxma 无此交互模式 |
| A4 | 玻璃拟态设计系统 | `ai-deep-research-agent/src/app/globals.css` | 完整设计令牌 + backdrop-filter blur + 抽象形状背景 | Maxma 有 design-system.css 但无玻璃拟态 |
| A5 | 状态感知动效 | `ai-deep-research-agent/src/app/globals.css` | 执行中=旋转，进行中=呼吸，新项=滑入 | Maxma 动画较基础 |
| A6 | 特化工具卡片配置表 | `ai-deep-research-agent/src/components/ToolCard.tsx` | `TOOL_CONFIG` 映射表：每个工具配置 icon/getDisplayText/getResultSummary | Maxma 有 registry.ts 但无 getDisplayText/getResultSummary |
| A7 | 骨架屏加载 | `multimodal_video_moment_finder/frontend/app/page.tsx` | 3 个占位卡片带 shimmer 动画 + 递增 animationDelay | Maxma 无骨架屏 |

### 2.3 前端差距总结

**核心差距**（按优先级排序）：

1. **长流程折叠**（O1）：Maxma 的工具调用过程全部展开，长对话时刷屏。OpenHanako 的 ProcessFoldBlock 把连续 assistant 消息折叠成一行摘要 + 可展开。这是**最影响体验的差距**。

2. **多 session alive 缓存**（O2）：Maxma 切换 session 重新渲染，丢失滚动位置。OpenHanako 用 visibility:hidden 保持 scrollTop，MAX_ALIVE=5 缓存。

3. **全局快捷键体系**（H7）：Maxma 仅 Ctrl+K 一个快捷键。Halo 有 Cmd+K/Cmd+Shift+F/Cmd+F 三档搜索 + Esc/Enter 处理。OpenHanako 有斜杠命令 + Xing Prompt。

4. **友好动作摘要**（H4）：Maxma 工具气泡显示原始工具名（如 `file_read`）。Halo 折叠态头部显示"Reading config.json..."友好摘要。

5. **工具错误视觉**（H5）：Maxma 工具错误用红色。Halo 用 amber（warning），因为 AI 内部反馈会自愈，红色误导用户。

6. **4 档权限模式切换器**（O8）：Maxma 有 `approval_gateway_enabled` flag 但前端无 4 档切换器。OpenHanako 的 PlanModeButton 让用户在 auto/operate/ask/read_only 间切换。

7. **交互式卡片**（O4/A2）：Maxma 工具气泡是只读展示。OpenHanako 的 InteractiveCard + Awesome LLM Apps 的 renderAndWaitForResponse 让工具调用变成可交互的 UI 组件。

8. **Onboarding 引导**（O11）：Maxma 无首次启动引导。OpenHanako 有 6 步引导（语言→名字→Provider→Model→主题→工作区→教程）。

---

## 三、借鉴情况总表

### 3.1 借鉴到位（18 项）

| 领域 | 设计 | 来源 |
|---|---|---|
| 后端-架构 | 三阶段启动分层 | Halo |
| 后端-架构 | Disposable 资源管理 | Halo |
| 后端-架构 | 事件去重缓存 | Halo |
| 后端-架构 | JSONL 透明抄本 | Halo |
| 后端-架构 | Keep-alive TTL 安全网 | Halo |
| 后端-功能 | 流式修复管道 | Halo |
| 后端-功能 | report_to_user 完成信号 | Halo |
| 后端-功能 | Escalation run 边界 | Halo |
| 后端-功能 | 工作记忆 Push 注入 | Halo |
| 后端-功能 | 循环检测 | Maxma 独有 |
| 后端-功能 | Provider 故障转移 | OpenHanako |
| 后端-功能 | Corrective RAG | Awesome LLM Apps |
| 后端-功能 | 情景记忆 session 隔离 | OpenHanako |
| 前端-UI | 12 套主题系统 | OpenHanako |
| 前端-UI | 动画系统 | OpenHanako |
| 前端-UI | 工具调用专属气泡 | Halo + Awesome LLM Apps |
| 前端-UI | PlanCard 计划展示 | Halo |
| 前端-UI | 工作台面板 | Awesome LLM Apps |

### 3.2 借鉴了但不到位（4 项）

| 领域 | 设计 | 来源 | 差距 |
|---|---|---|---|
| 后端 | 凭据掩码 | Halo | 只做了掩码，未做 crypto-envelope 加密存储 + 双 key 恢复 |
| 后端 | 调度器指数退避 | Halo | 有 MAX_CONSECUTIVE_FAILURES + 封顶，缺 5 档退避表 + anchor-grid + 卡死自愈 |
| 后端 | HITL 审批网关 | OpenHanako | 单一审批层，缺双 reviewer（small+large）+ escalation 链 |
| 后端 | 子 Agent 委派 | OpenHanako | 同步阻塞调用，缺 fire-and-forget + DeferredResultStore 异步回灌 |
| 后端 | MCP 四协议 | OpenHanako | 缺 OAuth 提前 60s 刷新 + 自动重连退避 |

### 3.3 完全未借鉴但有价值（19 项）

| 优先级 | 领域 | 设计 | 来源 |
|---|---|---|---|
| 🔴 高 | 后端 | 子 Agent 异步化（fire-and-forget） | OpenHanako |
| 🔴 高 | 后端 | 双 Reviewer Approval Gateway | OpenHanako |
| 🔴 高 | 后端 | Cache-preserving Session Compaction | OpenHanako |
| 🔴 高 | 后端 | 记忆传送带模式（按天滚动 + 断点续跑） | OpenHanako |
| 🔴 高 | 前端 | 长流程折叠（ProcessFoldBlock） | OpenHanako |
| 🔴 高 | 前端 | 多 session alive 缓存（MAX_ALIVE=5） | OpenHanako |
| 🔴 高 | 前端 | 全局快捷键体系 | Halo |
| 🟡 中 | 后端 | 双层沙盒（PathGuard + OS 级） | OpenHanako |
| 🟡 中 | 后端 | LLM 失败优雅降级为启发式 | Awesome LLM Apps |
| 🟡 中 | 后端 | 自我进化 Agent Skills 闭环 | Awesome LLM Apps |
| 🟡 中 | 前端 | 友好动作摘要 | Halo |
| 🟡 中 | 前端 | 4 档权限模式切换器 | OpenHanako |
| 🟡 中 | 前端 | Onboarding 引导流程 | OpenHanako |
| 🟡 中 | 前端 | 交互式卡片（iframe http + 主题注入） | OpenHanako |
| 🟢 低 | 后端 | 凭据加密存储（crypto-envelope） | Halo |
| 🟢 低 | 后端 | decorrelated jitter 重试 | OpenHanako |
| 🟢 低 | 后端 | FactStore 无向量（FTS5 + CJK ngram） | OpenHanako |
| 🟢 低 | 前端 | Pulse 面板（实时任务流） | Halo |
| 🟢 低 | 前端 | ThinkPath 引导式思维路径 | Awesome LLM Apps |

---

## 四、设计哲学对比

### Halo 的设计哲学
- **分阶段启动**：首屏必需 / 窗口可见后 / 空闲时三档，绝不阻塞首屏
- **Pull+Push 双通道**：renderer 既能监听事件也能主动查询，解决 HMR 重载后竞态
- **修复而非报错**：流式修复管道修复国产模型的破损输出，而非直接报错让用户看到乱码
- **观看是读不是订阅**：headless run 不推事件，前端按需轮询拉取

### OpenHanako 的设计哲学
- **Agent 是数据+行为实体，不持有引擎引用**：严格单向依赖，消除循环引用
- **确定性工作不用 LLM**：SignalCollector 明确标注"NOT an agent"
- **传送带而非全量重算**：记忆系统分阶段增量，week 段零 LLM 成本
- **修复而非报错**：Stream Guard 修复国产模型的工具协议碎片
- **双层防护**：应用层 PathGuard + OS 级沙盒
- **渐进式披露**：experience 工具先返回索引，有参才返回详情

### Awesome LLM Apps 的设计哲学
- **前端不是聊天的附属品，而是 Agent 的画布**：Dashboard Canvas 让 Agent 输出变成可视化工件
- **工具调用是人类可见、可审批的过程**：renderAndWaitForResponse 实现人在回路
- **优雅降级是第一公民**：LLM 失败时自动回退到启发式
- **Agent 可以优化 Agent**：三 Agent 协作的技能自优化闭环
- **模型按角色选型**：分类用 mini，综合用强模型

### Maxma 的独有设计哲学
- **人设系统三层结构**：Identity / Yuan / Ishiki，yuan 模板输出 `<mood>` 内部状态
- **贴纸/表情系统**：按情绪分类的贴纸库 + 内联嵌入消息
- **私密模式**：Ctrl+K 切换，不写入长期记忆
- **循环检测**：工具签名重复 3 次终止（OpenHanako 缺这层防护）

---

*最后更新：2026-07-10*
