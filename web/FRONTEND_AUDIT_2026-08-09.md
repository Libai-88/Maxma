# Maxma 前端系统性缺陷排查报告

> 排查日期：2026-08-09
> 排查范围：`MaxmaHere/web`（Vue 3 + Vite 5 + TS + Pinia，281 个源文件）
> 方法：`vue-tsc` 类型检查（0 错误）· ESLint（1 error + 20 warnings）· Vitest 全量实跑（172 通过 / 2 失败）· 品牌色契约脚本实跑（退出码 1）· 4 路并行代码审计（性能/可靠性/可访问性/死代码）· 关键高危断言逐一手工复核

---

## 0. 总体结论（TL;DR）

**类型纪律和错误处理基线优秀**：`@ts-ignore` 0 处、`any` 仅 9 处、WS 心跳/指数退避重连/竞态防护成熟、XSS 三层防御完整、12 处定时器 11 处清理正确。但存在 **1 个核心功能性 bug、CI 前端流水线当前为红、若干内存泄漏与性能隐患、以及约 95 个文件的仓库垃圾与死代码**。

**P0（阻断）2 项 · P1（高）6 项 · P2（中）19 项**

---

## 1. 🔴 P0 — 应立即修复

### P0-1 流式输出期间按 Enter 可发送新消息 → 正在生成的回复直接丢失

**位置**：
- `composables/useChat.ts:1405-1425` — `send()` **无 `isStreaming` 守卫**，无条件 `ch.currentTurn = turn` 覆盖进行中的轮次
- `components/ChatInput.vue:437-444` — Enter 键盘路径直接调 `handleSend()`，绕过按钮的 `:disabled="disabled || isStreaming"`（流式时按钮已变成"停止"）
- `composables/useChatSend.ts:57-80` — `handleSend()` 只查 `canSend`（= `connected`，见 `ChatView.vue:379`），不含流式状态
- `composables/useChatInput.ts:121-123` — `canSubmit` 明明包含 `!isStreaming`，**但全项目无任何调用点（死代码）**

**连锁后果**：① 进行中 T1 的 events 全部留在被覆盖的 turn 对象上、从未 push 进 `turns` → 回复永久丢失；② T1 的 `done` 事件到达时错误地 finalize 新轮次 T2；③ T2 自身的 token 事件因 `currentTurn` 被置空而静默丢弃 → 第二条消息无任何回复展示。

**修复**：`send()` 内加 `if (ch.isStreaming) return false`（一行止血），并把 `canSubmit` 接入键盘路径。

### P0-2 CI 前端流水线（frontend.yml）当前是红的

实跑 CI 三个门禁，两个失败：
- **Vitest**：`npx vitest run` → **172 通过 / 2 失败**。`tests/mainStartup.spec.ts` 两用例确定性失败：mock 的 `@/utils/env` 缺 `getApiBase` 导出，而 `api/index.ts:103` 在模块顶层调用它（`let BASE = getApiBase()`）——测试与代码不同步的回归。
- **品牌色守卫**：`node scripts/check-hardcoded-colors.mjs` → **退出码 1**。`components/MarkdownEditor.vue:9` 存在硬编码 `#1C1C1C`。

**修复**：补 `getApiBase` mock + 将 `#1C1C1C` 替换为主题 token（各约 5 分钟，CI 转绿）。

---

## 2. 🟠 P1 — 高（可靠性 / 内存泄漏）

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| P1-1 | **ThinkingWave resize 监听器永久泄漏**：匿名箭头函数无法 `removeEventListener`，onUnmounted 只清了 rAF/observer | `components/ThinkingWave.vue:240,245-249` | 该组件随 `v-if="isStreaming"` 每次流式对话挂载/卸载 → **每次对话泄漏一个 window 监听器 + canvas 闭包**。`WavyBackground.vue:142` 同款（当前为死代码） |
| P1-2 | **activity 流双连接竞态**：连接建立中切走再切回 → 旧连接 abort 的 catch 读到已翻转的 `_intentionalClose=false` → 走 `_onDisconnect()` 调度重连；新连接成功路径（`:165-168`）**未清 `reconnectTimer`** → 双 SSE 流并存 | `stores/activity.ts:165-168, 186-196, 225-235` | 活动记录重复（`records.push` 不去重）、连接数只增不减、UI 闪烁 |
| P1-3 | **历史加载无 in-flight 去重**：A→B→A 快速切换且后端慢时，两次 watch 回调都看到 `turns.length===0` → 并发两次 `/messages` 加载 → 历史整段重复并**被持久化** | `composables/useChat.ts:1336-1379` | 消息重复显示，重启后仍重复 |
| P1-4 | **后台会话 context_usage 污染全局徽标**：切到会话 B 后，会话 A 继续流式的 `context_usage` 事件无条件写入全局 store（`artifact` 事件有 sid 守卫而它没有） | `composables/useChat.ts:539-556, 622-630` | 上下文用量徽标显示错误数据，用户误判压缩时机 |
| P1-5 | **api.request 无超时**：无 AbortController/超时，后端挂起时 `saving/loading` 状态**永久卡死**无法恢复（对比 `stores/activity.ts:124` 有 15s 超时兜底） | `api/index.ts:187-213` | 保存/刷新/删除操作无超时提示 |
| P1-6 | **HTTP 401 无统一处理**：只有 WS 关闭码 4001 触发 token 刷新（`useChat.ts:424-427`）；无 WS 连接时 token 失效 → 所有请求持续 401，用户只能整页重启 | `api/index.ts:203-211` | 恢复路径缺失 |

---

## 3. 🟡 P2 — 中（性能 / 可访问性 / 代码卫生）

### 3.1 性能

| # | 问题 | 位置 |
|---|---|---|
| P2-1 | 记忆列表全量渲染无虚拟化（几百上千张卡片 DOM 全挂）+ 每 15s 全量刷新 | `views/MemoryView.vue:116,307` |
| P2-2 | 每轮消息全量 `JSON.stringify` turns 到 localStorage（O(n²) 主线程序列化），turns 数组无上限 | `useChat.ts:175-185` |
| P2-3 | App 级 5 套常驻装饰动画（canvas rAF + CSS infinite + 全局 mousemove，`SmoothCursor` 甚至隐藏系统光标）无性能开关，后台不暂停 | `App.vue:34-38` |
| P2-4 | TextGlitch 120ms 高频乱码重渲染，首页常驻开启（`enable-on-hover="false"`） | `TextGlitch.vue:51` / `WelcomeScreen.vue:27` |
| P2-5 | **桌面应用依赖 Google Fonts 境外 CDN**（4 个字体家族），本地仅打包 MapleMono——断网/国内环境字体整体回退 | `index.html:12` |
| P2-6 | markdown-vendor chunk 364.6KB（katex 重）在首屏关键路径 | 构建产物（dist_old/assets） |

### 3.2 可访问性（对照 `DsOverlay.vue` 已有完整 focus-trap 实现，属遗漏而非技术限制）

| # | 问题 | 位置 |
|---|---|---|
| P2-7 | 工具卡片/JSON 折叠区 `role="button"` 却无 `tabindex`/`@keydown`，键盘完全不可操作（聊天主流程核心交互） | `ToolCallCard.vue:3,65`、`tools/_shared/BubbleChrome.vue:3` |
| P2-8 | 消息右键菜单（引用/复制/撤回）仅 `contextmenu` 事件可达，无 Shift+F10、无焦点移入/还原 | `useContextMenu.ts:65`、`ContextMenu.vue:146` |
| P2-9 | 设置弹窗 AnimatedModal 无焦点陷阱/移入/还原，Tab 会逃逸到背景 | `inspira/AnimatedModal.vue`（使用者 `AppSettingsMenu.vue:16`） |
| P2-10 | 设置表单（Provider/MCP/人设/设置）label 无 `for`/`id` 关联，读屏只播报"编辑文本" | `ProvidersView:166`、`McpView:290`、`SoulView:82`、`SettingsView:40` |
| P2-11 | **主题对比度不达标**：金継 `text-secondary` 实测 3.41:1（注释声称 WCAG AA≥4.5:1），另 4 套主题 tertiary 临界失败 | `themes/kintsugi.css:16-17` 等 5 个主题文件 |
| P2-12 | 消息流/打字指示器无 `aria-live`/`role="status"`——聊天应用关键场景缺失 | `ChatWindow.vue:8,170,184` |
| P2-13 | 会话删除按钮 `opacity:0` 仍可 Tab 聚焦（看不见的按钮） | `SessionItem.vue:231-238` |

### 3.3 代码卫生与死代码

| # | 问题 | 规模 |
|---|---|---|
| P2-14 | 零引用死组件 + 死视图 + 死 composable + api 死方法 | 25 个组件（约 3000 行）、2 个视图（`AuditLogView`/`KbView`，router 仅 redirect）、3 个 composable/入口（`useMagnetic`/`streamTextSnapshots`/`splash/main.ts`）、10 个 api 方法（`compressSession`/`getContextUsage`/`getErrorLog`/`getMcpRegistryDetail`/`getProvider`/`getSession`/`getWorkflowRun`/`listDeferredRuns`/`mcpOAuthCallback`/`reloadMcp`） |
| P2-15 | **web/ 根目录垃圾**：13 个 `vite.config.ts.timestamp-*.mjs`、9 个 `round*.cjs`（265KB）、69 个已跟踪的 `plan-*.md`、`nul`/`src/NUL`（Windows 保留名）、`tsc-*.txt`、`vitest-*.log`、`dist_old/` 23MB——且 **web/ 没有任何 .gitignore** | 约 95 个文件 + 23MB |
| P2-16 | `dist/` 构建产物不完整（只有 fonts/images 无 assets）——`emptyOutDir:false` + rename 隔离策略的副作用，打包链路需确认完整重建 | `vite.config.ts:66-70` |
| P2-17 | MessageBubble 与 ThinkingBlock 各约 100 行重复的流式渲染逻辑（`streamTextSnapshots.ts` 正是废弃的半成品抽象） | 两组件 |
| P2-18 | `/g` 正则 `.test()` 的 lastIndex 泄漏 → 内联表情指令间歇性失效 | `useChat.ts:187,863` |
| P2-19 | lint 1 error：`useChat.ts:1237` 冗余响应式表达式（`arr.slice()` 已触发追踪，该行可删）+ `:165` stale eslint-disable | 1 行 |

---

## 4. 已核实无问题（避免重复劳动）

- **安全**：XSS 三层防御完整（`utils/markdown.ts` DOMParser 白名单消毒 + `contentNeedsIsolation` 沙箱判定 + `HtmlSandbox.vue` opaque-origin iframe 含导航护栏/错误上报）；CSP `script-src 'self'` 严格；token 有 `tokenLoadVersion` 版本号防竞态
- **WS 可靠性**：指数退避 + ±25% jitter、30s 心跳 + 35s pong 超时主动 close(4000)、断线中断轮次落盘恢复；12 处定时器全部有清理（仅 ThinkingWave 一处例外）
- **类型纪律**：`vue-tsc --noEmit` 0 错误
- **`checkPathBlocked` 路由有效**：`api/routes/maxma_blocker.py:134` 定义 + `api/server.py:222` 注册，前端调用成立（注：`web/_AUDIT_backend_routes.txt` 已过期，本次据此排除了一个误报，该审计文档需重新生成）

---

## 5. 建议修复顺序

1. **P0-1**：`send()` 加 `isStreaming` 守卫 + 接线 `canSubmit`（约 30 分钟）
2. **P0-2**：补 `getApiBase` mock + 替换 MarkdownEditor 硬编码色（约 15 分钟，CI 转绿）
3. **P1**：ThinkingWave 监听器清理（5 分钟）→ activity 竞态 → 历史加载去重 → 后台 context_usage 守卫 → request 超时 → 401 统一处理
4. **P2**：按性价比依次处理性能项（P2-1~6）→ a11y 项（P2-7~13，多为几行改动）→ 死代码清理（P2-14~19）

---

*报告生成：系统性代码审查 · 2026-08-09 · 数据来源：静态检查实跑 + 4 路并行代码审计 + 关键断言手工复核*
