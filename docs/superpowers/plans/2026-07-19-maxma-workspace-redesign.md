# Maxma Workspace Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Maxma 主页面重构为图标栏、按需会话抽屉、单一 Composer 模型入口、精简工作区头部和按需工作台，同时保持现有聊天、会话、模型、WebSocket、工具、表情包和画布数据流不变。

**Architecture:** App.vue 负责全局壳层和覆盖层，IconRail.vue 与 SessionDrawer.vue 负责导航和会话可见性，ChatView.vue 只编排当前会话工作区。ChatHeader.vue 只显示当前会话上下文和有效状态；ChatInput.vue 通过 useChatInput 的 provide/inject 回调发送消息；WorkbenchPanel.vue 继续由 useWorkbenchStore 管理打开状态、标签、卡片和交互产物。

**Tech Stack:** Vue 3 script setup、TypeScript、Pinia、Vue Router、Vite、Vitest、Vue Test Utils、Playwright。

---

## File Structure Mapping

### Create

- D:/Maxma/MaxmaHere/web/src/components/IconRail.vue：固定宽度的全局图标导航；只包含真实路由入口、会话抽屉开关和帮助入口。
- D:/Maxma/MaxmaHere/web/src/components/SessionDrawer.vue：抽屉容器；复用 SessionSidebar.vue 的会话列表和 CRUD 事件，不复制会话数据。
- D:/Maxma/MaxmaHere/web/tests/workspaceShell.spec.ts：IconRail、SessionDrawer、ChatHeader、唯一模型入口的组件回归测试。
- D:/Maxma/MaxmaHere/web/tests/playwright/workspace-layout.mjs：390x844、768x900、1280x800 的布局、溢出、焦点和入口唯一性验收。

### Modify

- D:/Maxma/MaxmaHere/web/src/App.vue：用 IconRail + SessionDrawer 替换常驻复杂侧栏编排；保留路由、RegionalErrorBoundary、MediaViewer、OnboardingView、DsToast 和全局错误事件。
- D:/Maxma/MaxmaHere/web/src/components/SessionSidebar.vue：只保留会话列表、固定/临时分组、悬停详情、右键菜单、固定/取消固定、重命名和删除确认。
- D:/Maxma/MaxmaHere/web/src/components/AppSettingsMenu.vue：只呈现已有且可执行的设置路由或动作。
- D:/Maxma/MaxmaHere/web/src/components/ChatHeader.vue：收缩为 Maxma/Agent 短名、当前会话标题、连接状态、工作台按钮和真实可用的更多菜单。
- D:/Maxma/MaxmaHere/web/src/views/ChatView.vue：重排 ChatHeader、ChatWindow、WorkflowCard、ChatInput、WorkbenchPanel；保留 useChat(sessionId)、provideChatInput、onSend、cancel、sendUserResponse、sendArtifactAction、sendPlanResponse 和引用处理。
- D:/Maxma/MaxmaHere/web/src/components/ChatInput.vue：将模型入口集中到 Composer 操作栏；保留附件、链接、图片、引用、技能、宏、表情、think path、Enter/Shift+Enter、发送/停止和错误反馈。
- D:/Maxma/MaxmaHere/web/src/components/ModelSelector.vue：改造成单个分组模型 DsSelect；每个选项显示 provider + model，选中后通过 availableModels/provider 映射调用 useChatInput.onModelChange(providerId, modelName)。ChatInput 不再渲染独立 provider DsSelect。
- D:/Maxma/MaxmaHere/web/src/components/ContextUsageBadge.vue：仅作为 Composer 操作栏的紧凑摘要；详情仍通过现有 tooltip 展示。
- D:/Maxma/MaxmaHere/web/src/components/ChatWindow.vue、MessageBubble.vue、ThinkingBlock.vue、ToolBubbleRouter.vue、ToolCallCard.vue、WorkflowCard.vue：只调整对话流容器、消息宽度和工具/工作流的可见层级，保留现有语义、事件和 sticker 渲染。
- D:/Maxma/MaxmaHere/web/src/components/WelcomeScreen.vue：快速开始继续调用 ChatView.handleQuickStart(message)，不增加第二模型选择器或无动作卡片。
- D:/Maxma/MaxmaHere/web/src/components/workbench/WorkbenchPanel.vue：保留现有 props/emits，改为按需响应式抽屉。
- D:/Maxma/MaxmaHere/web/src/components/workbench/ReasoningTimeline.vue、CanvasContainer.vue：只调整抽屉内布局，不改变数据映射和事件。
- D:/Maxma/MaxmaHere/web/src/composables/useSidebar.ts、useFloatSidebar.ts、components/FloatSidebar.vue：复用现有折叠状态和兼容入口，禁止第二份会话列表。
- D:/Maxma/MaxmaHere/web/src/assets/styles/tokens.css 及 App.vue 全局样式：只补充缺失的结构 token、min-width/min-height 和溢出边界。
- D:/Maxma/MaxmaHere/web/tests/playwright/config.mjs：默认视口固定为 1280x800，布局测试显式覆盖其余视口。

### Do Not Modify During This Redesign

- D:/Maxma/MaxmaHere/web/src/composables/useChat.ts、D:/Maxma/MaxmaHere/web/src/api/**、D:/Maxma/MaxmaHere/api/**、D:/Maxma/MaxmaHere/web/src/utils/wsProtocol.ts：不改 REST、WebSocket URL、事件类型、payload、重连或消息生命周期。
- D:/Maxma/MaxmaHere/web/src/stores/chat.ts、provider.ts、session.ts、workbench.ts：只消费已有状态和 action，不改存储键、action 名或数据结构。
- D:/Maxma/MaxmaHere/web/src/components/StickerInline.vue、StickerPicker.vue、StickerContextMenu.vue、D:/Maxma/MaxmaHere/web/src/composables/stickerUtils.ts：不把表情包降级为纯文本。

## Invariants and Interfaces

- SessionSidebar props 保持 sessions: SessionInfo[]、activeId: string、可选 sessionStatuses、可选 collapsed；emits 保持 create、switch(id: string)、delete(id: string)、constify(id: string, name: string)、unconstify(id: string)。
- SessionDrawer 对外复用同一组 props/emits；打开/关闭只控制可见性，不卸载 ChatView，不触发 WebSocket 重建。
- ChatView 保持 provideChatInput({ isStreaming, canSend: connected, initialProviderId: selectedProviderId, initialModelName: selectedModelName, thinkPathEnabled, quotedSelections, quoteCandidate, onSend, onStop: cancel, onModelChange, onCommitQuote: commitCandidate, onRemoveQuote: removeQuote }) 的字段和回调语义。
- useChatInput 的 send(text, refs, thinkPathId)、stop()、onModelChange(providerId, modelName)、commitQuote()、removeQuote(id) 继续是 Composer 唯一行为接口；ChatInput 不直接创建 WebSocket。
- WorkbenchPanel 保持 isOpen: boolean、activeTab: WorkbenchTab、cardCount: number props，以及 close、set-tab(tab: WorkbenchTab) emits；WorkbenchTab 仍为 reasoning | canvas。
- ChatWindow、MessageBubble、ToolBubbleRouter、ToolCallCard 和 tools/* 的 action payload 不改；handleToolAction、handlePin、handleArtifactAction 继续使用当前字段。
- useSessionStore 的 initIfNeeded、createSession、switchSession、deleteSession、constifySession、unconstifySession、generateSessionTitle 仍是唯一会话 action；抽屉不得复制请求。
- useSidebarStore/useSidebar 是唯一 sidebar 可见性来源；localStorage 键 maxma_sidebar_collapsed 不变。
- useWorkbenchStore 继续负责 isOpen、activeTab、cards、addCard、removeCard、addArtifact、markArtifactActionSubmitted；关闭工作台不得清空 cards 或重置 active tab。
- useChat(sessionId) 仍按 session 管理 WebSocket；不能改变 connectSession、ensureConnected、send、cancel、重连、ping/pong 或历史恢复流程。
- 仍使用当前 Vite 代理和 WebSocket 地址解析；不可在组件中硬编码 ws://localhost:5173 或直接拼接后端 URL。
- 文本、引用、文件/文件夹/图片引用、技能、宏、<sticker:...> 和 agent 返回的 [表情:...]、[表情包:...] 标记保持原样；视觉层只负责解析和展示。

## Known Test Baseline

- D:/Maxma/MaxmaHere/web/tests/streamTextSnapshots.spec.ts 当前引用缺失模块 D:/Maxma/MaxmaHere/web/src/composables/streamTextSnapshots；因此现阶段运行该文件或全量 Vitest 会出现已知基线失败。
- 该缺失模块问题不属于本次视觉重构；本计划不修复它，也不得把它作为本次重构的失败原因或必然修复项。
- 重构相关测试必须通过；env.spec.ts、viteProxy.spec.ts、stickerUtils.spec.ts、modelSelector.spec.ts、sessionStore.spec.ts、工具/工作台测试和新增 workspaceShell.spec.ts 必须作为可执行门禁保留。
- 全量回归时必须单独报告 streamTextSnapshots.spec.ts 的已知失败；只有存在独立、明确的修复提交时，才能把该测试从基线报告中移出，不能在本重构提交中顺带修复或归因。

## Phase 0: Baseline and Split Checklist

### Task 0.1: Record current structure and contracts

Files:
- Read: D:/Maxma/MaxmaHere/web/src/App.vue
- Read: D:/Maxma/MaxmaHere/web/src/views/ChatView.vue
- Read: D:/Maxma/MaxmaHere/web/src/components/SessionSidebar.vue
- Read: D:/Maxma/MaxmaHere/web/src/components/ChatInput.vue
- Read: D:/Maxma/MaxmaHere/web/src/components/workbench/WorkbenchPanel.vue
- Read: D:/Maxma/MaxmaHere/web/src/composables/useChat.ts
- Test target: D:/Maxma/MaxmaHere/web/tests/playwright/workspace-layout.mjs

- [ ] Step 1: Start the existing services and capture the baseline.
  Run from D:/Maxma/MaxmaHere/web: bun run dev -- --host 127.0.0.1 --port 5173. Keep the existing backend at 127.0.0.1:8000. Inspect /, /providers, /activity and /appearance at 390x844, 768x900 and 1280x800.
  Expected: current page and routes load before redesign changes; the current sidebar, header, Composer and workbench can be measured.

- [ ] Step 2: Extract the current contract list.
  Run: rg -n "defineProps|defineEmits|provideChatInput|useSessionStore|useSidebar|useWorkbenchStore|new WebSocket|send\(|cancel\(" D:/Maxma/MaxmaHere/web/src
  Expected: results identify the contracts listed in this plan; no later task creates a second session store, sidebar state or WebSocket client.

- [ ] Step 3: Commit the plan-only baseline.
  Run: git add D:/Maxma/MaxmaHere/docs/superpowers/plans/2026-07-19-maxma-workspace-redesign.md; git commit -m "docs: add Maxma workspace redesign implementation plan"
  Expected: commit contains only the requested plan file.

## Phase 1: Shell and Information Architecture

### Task 1.1: Add the icon rail

Files:
- Create: D:/Maxma/MaxmaHere/web/src/components/IconRail.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/Icon.vue
- Modify: D:/Maxma/MaxmaHere/web/src/App.vue
- Test: D:/Maxma/MaxmaHere/web/tests/workspaceShell.spec.ts

- [ ] Step 1: Write the icon rail contract test.
  Assert that the mounted rail renders nav[aria-label="主导航"], links to /, /activity and the existing settings route, and emits toggle-session-drawer from button[aria-label="会话"]. Every icon button must have a non-empty aria-label and a minimum 44px hit area.

- [ ] Step 2: Implement stable rail selectors.
  Use root .icon-rail, .icon-rail__brand, .icon-rail__nav, .icon-rail__session-toggle and .icon-rail__footer. Use router-link for existing routes, Icon for glyphs, aria-current="page" for the active route, and emit('toggle-session-drawer') for the session button. Do not include provider, health, model, tool or context controls.

- [ ] Step 3: Mount the rail before the main workspace.
  In App.vue render <IconRail @toggle-session-drawer="toggleSessionDrawer" /> as the first child of .app-layout. Keep RegionalErrorBoundary, router-view, MediaViewer, OnboardingView, DsToast, useGlobalShortcut and useHealthPolling in their current responsibilities.

- [ ] Step 4: Run the focused test.
  Run: cd D:/Maxma/MaxmaHere/web; bun x vitest run tests/workspaceShell.spec.ts -t "icon rail"
  Expected: PASS; links, accessible labels and the drawer event are present.

- [ ] Step 5: Commit the isolated rail change.
  Run: git add D:/Maxma/MaxmaHere/web/src/components/IconRail.vue D:/Maxma/MaxmaHere/web/src/components/Icon.vue D:/Maxma/MaxmaHere/web/src/App.vue D:/Maxma/MaxmaHere/web/tests/workspaceShell.spec.ts; git commit -m "feat: add Maxma icon navigation rail"

### Task 1.2: Convert the session sidebar into an accessible drawer

Files:
- Create: D:/Maxma/MaxmaHere/web/src/components/SessionDrawer.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/SessionSidebar.vue
- Modify: D:/Maxma/MaxmaHere/web/src/App.vue
- Modify: D:/Maxma/MaxmaHere/web/src/composables/useSidebar.ts
- Modify: D:/Maxma/MaxmaHere/web/src/components/FloatSidebar.vue
- Modify: D:/Maxma/MaxmaHere/web/src/composables/useFloatSidebar.ts
- Test: D:/Maxma/MaxmaHere/web/tests/workspaceShell.spec.ts

- [ ] Step 1: Add drawer interaction tests first.
  Test that button[aria-label="会话"] opens aside[aria-label="会话抽屉"], focuses button[aria-label="关闭会话抽屉"], closes on Escape, and returns focus to the trigger. Test that the original create, switch, delete, constify and unconstify events reach App handlers.

- [ ] Step 2: Implement the drawer wrapper without duplicating data.
  SessionDrawer props: open: boolean, sessions: SessionInfo[], activeId: string, optional sessionStatuses. Emits: close, create, switch(id: string), delete(id: string), constify(id: string, name: string), unconstify(id: string). Render one SessionSidebar inside aside[aria-label="会话抽屉"]. Desktop width is clamp(280px, 24vw, 320px); mobile width is min(320px, calc(100vw - 56px)); mobile adds .session-drawer__scrim.

- [ ] Step 3: Remove unrelated permanent sidebar content.
  In SessionSidebar.vue remove only ModelSettingsPanel, ToolPanel and the default-open .session-intro-card. Keep SessionItem, hover details, context menu, constify form, delete confirmation and all existing emits. Replace the empty state with one short row containing 暂无已保存会话 and the existing create event.

- [ ] Step 4: Wire focus and responsive behavior.
  App.vue keeps sessionStore as the only source of sessions/sessionId and passes the existing status and CRUD handlers. Add watch(open) focus management, keydown Escape and scrim click handling. useSidebar remains the only collapse state. FloatSidebar must not mount another SessionSidebar.

- [ ] Step 5: Run session tests.
  Run: cd D:/Maxma/MaxmaHere/web; bun x vitest run tests/sessionStore.spec.ts tests/workspaceShell.spec.ts -t "session drawer|session CRUD"
  Expected: PASS; opening the drawer does not change sessionId, create a WebSocket or duplicate session list.

- [ ] Step 6: Commit the drawer change.
  Run: git add D:/Maxma/MaxmaHere/web/src/components/SessionDrawer.vue D:/Maxma/MaxmaHere/web/src/components/SessionSidebar.vue D:/Maxma/MaxmaHere/web/src/App.vue D:/Maxma/MaxmaHere/web/src/composables/useSidebar.ts D:/Maxma/MaxmaHere/web/src/components/FloatSidebar.vue D:/Maxma/MaxmaHere/web/src/composables/useFloatSidebar.ts D:/Maxma/MaxmaHere/web/tests/workspaceShell.spec.ts; git commit -m "feat: move session management into drawer"

## Phase 2: Header and Composer Ownership

### Task 2.1: Reduce the workspace header to current context

Files:
- Modify: D:/Maxma/MaxmaHere/web/src/components/ChatHeader.vue
- Modify: D:/Maxma/MaxmaHere/web/src/views/ChatView.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/StatusBadge.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/SessionPermissionModeControl.vue
- Test: D:/Maxma/MaxmaHere/web/tests/workspaceShell.spec.ts

- [ ] Step 1: Add header ownership assertions.
  Assert that .chat-header contains exactly one StatusBadge, one .workbench-toggle-btn, a truncated .header-session-title, and no .model-selector or .context-usage-badge. Assert that a long persona description is not rendered as a full-width header paragraph.

- [ ] Step 2: Implement the compact header.
  Use semantic header.chat-header with .header-context, .header-session-title, .header-status and .header-actions. Keep Maxma profile name/avatar and render profile.name plus the current session title; put full persona/scene behind a real title or accessible details action. Keep StatusBadge and the workbench toggle.

- [ ] Step 3: Move low-frequency controls behind a real menu.
  Place private mode, auto approve and SessionPermissionModeControl :session-id="sessionId" under button[aria-label="更多会话操作"]. The menu must call unchanged setPrivateMode, setAutoApprove and the existing permission action. Do not render a disabled task button or a second context badge.

- [ ] Step 4: Run the header test.
  Run: cd D:/Maxma/MaxmaHere/web; bun x vitest run tests/workspaceShell.spec.ts -t "header ownership"
  Expected: PASS; header shows current context and status only.

- [ ] Step 5: Commit the header boundary.
  Run: git add D:/Maxma/MaxmaHere/web/src/components/ChatHeader.vue D:/Maxma/MaxmaHere/web/src/views/ChatView.vue D:/Maxma/MaxmaHere/web/src/components/StatusBadge.vue D:/Maxma/MaxmaHere/web/src/components/SessionPermissionModeControl.vue D:/Maxma/MaxmaHere/web/tests/workspaceShell.spec.ts; git commit -m "refactor: reduce workspace header to active context"

### Task 2.2: Make Composer the only model entry

Files:
- Modify: D:/Maxma/MaxmaHere/web/src/components/ModelSelector.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/ChatInput.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/ContextUsageBadge.vue
- Modify: D:/Maxma/MaxmaHere/web/src/views/ChatView.vue
- Test: D:/Maxma/MaxmaHere/web/tests/modelSelector.spec.ts
- Test: D:/Maxma/MaxmaHere/web/tests/workspaceShell.spec.ts

- [ ] Step 1: Write unique-entry tests.
  Assert that the main workspace contains exactly one visible .composer-model-selector, that it contains exactly one visible DsSelect/role="combobox", that .chat-input .provider-select is absent, that .chat-header .model-selector is absent, and that .chat-header .context-usage-badge is absent. Select one grouped provider + model option and assert that the existing onModelChange(providerId, modelName) callback receives the mapped pair. Assert send is disabled while canSend is false and stop appears while isStreaming is true.

- [ ] Step 2: Refactor ModelSelector.vue into one grouped model control.
  Keep the existing useChatStore.availableModels source and provider metadata mapping. Render one root .composer-model-selector with one DsSelect/role="combobox" only; each option value is the existing model id and its label visibly contains both provider and model, for example "本地 · combo". On selection, resolve the selected model id through availableModels to obtain providerId and modelName, then call the existing onModelChange(providerId, modelName) path. Do not render a separate provider DsSelect, do not add a WebSocket, and do not add a localStorage key.

- [ ] Step 3: Place the single control only in ChatInput.vue.
  Remove ModelSelector from the ChatHeader slot in ChatView.vue and remove the independent provider DsSelect from ChatInput.vue. Render exactly one ModelSelector in the Composer operation bar; when its grouped model selection resolves to an existing providerId/modelName pair, call chatInput.onModelChange(providerId, modelName). Keep selectedProviderId/selectedModelName persistence in ChatView.onModelChange and leave store, WebSocket and send payload behavior unchanged.

- [ ] Step 4: Keep context usage local to Composer.
  Render exactly one ContextUsageBadge beside .composer-model-selector. Keep contextUsage, percentage thresholds, tooltip and CSSOM width update. Remove header usage and make input toolbar groups shrinkable with min-width: 0 and flex-wrap: wrap.

- [ ] Step 5: Run model/input regression tests.
  Run: cd D:/Maxma/MaxmaHere/web; bun x vitest run tests/modelSelector.spec.ts tests/workspaceShell.spec.ts tests/stickerUtils.spec.ts tests/env.spec.ts tests/viteProxy.spec.ts
  Expected: PASS; one model entry is visible, selection reaches the existing callback, and sticker parsing passes.

- [ ] Step 6: Commit Composer ownership.
  Run: git add D:/Maxma/MaxmaHere/web/src/components/ModelSelector.vue D:/Maxma/MaxmaHere/web/src/components/ChatInput.vue D:/Maxma/MaxmaHere/web/src/components/ContextUsageBadge.vue D:/Maxma/MaxmaHere/web/src/views/ChatView.vue D:/Maxma/MaxmaHere/web/tests/modelSelector.spec.ts D:/Maxma/MaxmaHere/web/tests/workspaceShell.spec.ts; git commit -m "refactor: make Composer the single model entry"

### Task 2.3: Preserve Composer input behavior while simplifying visual hierarchy

Files:
- Modify: D:/Maxma/MaxmaHere/web/src/components/ChatInput.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/WelcomeScreen.vue
- Modify: D:/Maxma/MaxmaHere/web/src/views/ChatView.vue
- Test: D:/Maxma/MaxmaHere/web/tests/workspaceShell.spec.ts
- Test: D:/Maxma/MaxmaHere/web/tests/stickerUtils.spec.ts

- [ ] Step 1: Add keyboard and payload cases.
  Test Enter sends only when isComposing is false and shiftKey is false; Shift+Enter inserts a newline; streaming swaps btn-send for btn-stop; attachment refs, quote refs, think path and sticker tags remain in the arguments passed to useChatInput.send.

- [ ] Step 2: Reorder the Composer.
  Keep file-refs-bar, quoted-selections-bar and link-input-bar conditional on data. Keep input-area as the only editor, btn-add-file, btn-sticker, btn-send, btn-stop, ThinkPathChooser, AutocompletePanel and StickerPicker with current handlers. Make chat-input flex column with min-width: 0 and max-height: min(42vh, 420px); input-body scrolls internally after the existing resize limit.

- [ ] Step 3: Keep WelcomeScreen actions real.
  Keep @start="handleQuickStart" and chatInputInstance.send(message) in ChatView. Remove welcome controls that do not call a real action or add a second model selector.

- [ ] Step 4: Run behavior tests.
  Run: cd D:/Maxma/MaxmaHere/web; bun x vitest run tests/workspaceShell.spec.ts tests/stickerUtils.spec.ts tests/env.spec.ts tests/viteProxy.spec.ts
  Expected: PASS; keyboard behavior, payloads, quotes, attachments, skills, macros, stickers, environment handling and proxy behavior remain intact. Do not include streamTextSnapshots.spec.ts in this Composer gate because its missing import is a known independent baseline.

- [ ] Step 5: Commit Composer layout.
  Run: git add D:/Maxma/MaxmaHere/web/src/components/ChatInput.vue D:/Maxma/MaxmaHere/web/src/components/WelcomeScreen.vue D:/Maxma/MaxmaHere/web/src/views/ChatView.vue D:/Maxma/MaxmaHere/web/tests/workspaceShell.spec.ts D:/Maxma/MaxmaHere/web/tests/stickerUtils.spec.ts; git commit -m "refactor: simplify Maxma Composer layout"

## Phase 3: Conversation Stream and Workbench Drawer

### Task 3.1: Make the conversation stream the primary scroll container

Files:
- Modify: D:/Maxma/MaxmaHere/web/src/views/ChatView.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/ChatWindow.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/MessageBubble.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/ThinkingBlock.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/ToolBubbleRouter.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/ToolCallCard.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/WorkflowCard.vue
- Test: D:/Maxma/MaxmaHere/web/tests/toolResultPresentation.spec.ts

- [ ] Step 1: Add stream structure assertions.
  Assert .chat-main-column has min-height: 0, .chat-window is the message overflow container, .chat-input-wrapper remains visible, and empty workflow has no workflow-card node. Add render cases for Markdown, code, tool status, [表情包:开心], image and streaming answer.

- [ ] Step 2: Apply the stream layout boundary.
  Use .chat-workbench-layout display:flex flex:1 1 auto min-width:0 min-height:0 overflow:hidden; .chat-main-column display:flex flex:1 1 auto min-width:0 min-height:0 overflow:hidden; .chat-window flex:1 1 auto min-height:0 overflow-y:auto overflow-x:hidden; and .chat-input-wrapper flex:0 0 auto min-width:0. Do not use page fixed heights that push Composer below the viewport.

- [ ] Step 3: Preserve message and sticker semantics.
  Keep ChatWindow props and action emits. Keep MessageBubble stickerUrl, StickerInline, stripStickerDirectives, Markdown renderer, image viewer and message actions. Use max-width:min(100%, 760px) and overflow-wrap:anywhere at narrow widths. Keep WorkflowCard conditional on real data.

- [ ] Step 4: Run stream regression tests.
  Run: cd D:/Maxma/MaxmaHere/web; bun x vitest run tests/toolResultPresentation.spec.ts tests/stickerUtils.spec.ts tests/workflowCard.spec.ts tests/env.spec.ts tests/viteProxy.spec.ts
  Expected: PASS; auto-scroll, tool actions, conditional workflow, sticker images, environment handling and proxy behavior remain intact. Separately run streamTextSnapshots.spec.ts only to record its known missing-module baseline; do not repair or attribute that failure to this visual task.

- [ ] Step 5: Commit stream layout.
  Run: git add D:/Maxma/MaxmaHere/web/src/views/ChatView.vue D:/Maxma/MaxmaHere/web/src/components/ChatWindow.vue D:/Maxma/MaxmaHere/web/src/components/MessageBubble.vue D:/Maxma/MaxmaHere/web/src/components/ThinkingBlock.vue D:/Maxma/MaxmaHere/web/src/components/ToolBubbleRouter.vue D:/Maxma/MaxmaHere/web/src/components/ToolCallCard.vue D:/Maxma/MaxmaHere/web/src/components/WorkflowCard.vue D:/Maxma/MaxmaHere/web/tests/toolResultPresentation.spec.ts; git commit -m "refactor: prioritize conversation stream layout"

### Task 3.2: Convert WorkbenchPanel into an on-demand responsive drawer

Files:
- Modify: D:/Maxma/MaxmaHere/web/src/components/workbench/WorkbenchPanel.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/workbench/ReasoningTimeline.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/workbench/CanvasContainer.vue
- Modify: D:/Maxma/MaxmaHere/web/src/views/ChatView.vue
- Modify: D:/Maxma/MaxmaHere/web/src/stores/workbench.ts
- Test: D:/Maxma/MaxmaHere/web/tests/canvasWorkspace.spec.ts
- Test: D:/Maxma/MaxmaHere/web/tests/interactiveArtifactCards.spec.ts
- Test: D:/Maxma/MaxmaHere/web/tests/workspaceShell.spec.ts

- [ ] Step 1: Add state-preservation tests.
  Assert default isOpen is false; addCard opens the workbench and selects canvas; close leaves cards and activeTab unchanged; reopening restores the same tab and count. Assert WorkbenchPanel emits set-tab with reasoning/canvas and close without mutating the store directly.

- [ ] Step 2: Implement responsive drawer modes.
  Keep root .workbench-panel and add role="complementary", aria-label="工作台", .workbench-scrim, .workbench-header, .workbench-tabs, .workbench-body and button.workbench-close. At min-width:1280px use width:clamp(320px, 30vw, 420px); at 768px-1279px use an overlay capped at min(420px, 88vw); below 768px use a full-width sheet. The panel must not create a second page scroll container.

- [ ] Step 3: Add focus and close behavior.
  On open focus the close button; Escape and scrim click emit close; close returns focus to the header workbench button. Keep ReasoningTimeline :turns="allTurns", CanvasContainer :cards="workbench.cards", @remove="workbench.removeCard" and @artifact-action="handleArtifactAction" connected through ChatView.

- [ ] Step 4: Run workbench tests.
  Run: cd D:/Maxma/MaxmaHere/web; bun x vitest run tests/canvasWorkspace.spec.ts tests/interactiveArtifactCards.spec.ts tests/workspaceShell.spec.ts -t "workbench"
  Expected: PASS; tabs, cards, artifact actions, focus and responsive transitions preserve existing behavior.

- [ ] Step 5: Commit workbench drawer.
  Run: git add D:/Maxma/MaxmaHere/web/src/components/workbench/WorkbenchPanel.vue D:/Maxma/MaxmaHere/web/src/components/workbench/ReasoningTimeline.vue D:/Maxma/MaxmaHere/web/src/components/workbench/CanvasContainer.vue D:/Maxma/MaxmaHere/web/src/views/ChatView.vue D:/Maxma/MaxmaHere/web/src/stores/workbench.ts D:/Maxma/MaxmaHere/web/tests/canvasWorkspace.spec.ts D:/Maxma/MaxmaHere/web/tests/interactiveArtifactCards.spec.ts D:/Maxma/MaxmaHere/web/tests/workspaceShell.spec.ts; git commit -m "feat: make workbench an on-demand drawer"

## Phase 4: Responsive Tokens, Accessibility and Dawn Visual Alignment

### Task 4.1: Establish layout tokens and overflow boundaries

Files:
- Modify: D:/Maxma/MaxmaHere/web/src/assets/styles/tokens.css
- Modify: D:/Maxma/MaxmaHere/web/src/App.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/IconRail.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/SessionDrawer.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/ChatHeader.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/ChatInput.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/workbench/WorkbenchPanel.vue
- Test: D:/Maxma/MaxmaHere/web/tests/playwright/workspace-layout.mjs

- [ ] Step 1: Define only missing structural tokens.
  Add named tokens such as --workspace-rail-width: 56px, --workspace-drawer-width: clamp(280px, 24vw, 320px), --workspace-gap and dedicated drawer z-index values only when equivalents do not exist. Keep existing theme variables for colors, typography, radius, border, shadow, duration and accent.

- [ ] Step 2: Apply the three breakpoints.
  At max-width:767px keep a 56px rail, hide long labels, use min(320px, calc(100vw - 56px)) drawer width, hide header tags, wrap Composer groups and keep send/stop controls at least 44px. At 768px-1279px keep the rail stable, use overlay drawer/workbench and readable Composer controls. At min-width:1280px use the stable rail, 280-320px session drawer when open, and a right workbench only when opened.

- [ ] Step 3: Enforce root and flex-child constraints.
  Set html, body, #app, .app-layout, .main to width:100%, min-width:0, min-height:0; set .app-layout display:flex overflow:hidden and .main flex:1 1 auto overflow:hidden. Set long-text flex children min-width:0; use overflow-wrap:anywhere for messages and ellipsis plus title for header/session labels.

- [ ] Step 4: Run build and layout smoke.
  Run: cd D:/Maxma/MaxmaHere/web; bun run build; bun x playwright test tests/playwright/workspace-layout.mjs --config tests/playwright/config.mjs
  Expected: TypeScript/Vite build succeeds; required viewports have no horizontal overflow and visible Composer/send controls.

- [ ] Step 5: Commit responsive boundaries.
  Run: git add D:/Maxma/MaxmaHere/web/src/assets/styles/tokens.css D:/Maxma/MaxmaHere/web/src/App.vue D:/Maxma/MaxmaHere/web/src/components/IconRail.vue D:/Maxma/MaxmaHere/web/src/components/SessionDrawer.vue D:/Maxma/MaxmaHere/web/src/components/ChatHeader.vue D:/Maxma/MaxmaHere/web/src/components/ChatInput.vue D:/Maxma/MaxmaHere/web/src/components/workbench/WorkbenchPanel.vue D:/Maxma/MaxmaHere/web/tests/playwright/workspace-layout.mjs; git commit -m "style: enforce responsive workspace boundaries"

### Task 4.2: Apply Dawn-inspired Maxma visual hierarchy and accessibility

Files:
- Modify: D:/Maxma/MaxmaHere/web/src/App.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/IconRail.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/SessionDrawer.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/ChatHeader.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/ChatInput.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/MessageBubble.vue
- Modify: D:/Maxma/MaxmaHere/web/src/components/workbench/WorkbenchPanel.vue
- Test: D:/Maxma/MaxmaHere/web/tests/workspaceShell.spec.ts

- [ ] Step 1: Apply the visual rules without importing Codex branding.
  Use existing Dawn/warm-paper tokens for warm neutral surfaces, restrained borders, compact shadows and clear accent states. Keep Maxma, its logo, persona wording and Chinese labels. Do not add Atelier Agent, Codex marks, fixed four-column dimensions, decorative background characters or a permanent right panel.

- [ ] Step 2: Add semantic landmarks and accessible names.
  Use nav, main, header, aside, section and form for rail, workspace, drawer, stream, workbench and Composer. Add aria-expanded to toggles, aria-controls to stable IDs, aria-live="polite" to connection status, and aria-label/title to icon-only actions. Ensure active route uses aria-current="page" and is not conveyed by color alone.

- [ ] Step 3: Verify keyboard order and reduced motion.
  Check keyboard order rail chat -> session toggle -> drawer close/new/session item -> workspace header -> Composer selector -> textarea -> send/stop -> workbench toggle -> workbench close/tabs. Add prefers-reduced-motion rules for rail/drawer/workbench transitions and preserve focus-visible outline.

- [ ] Step 4: Run accessibility tests.
  Run: cd D:/Maxma/MaxmaHere/web; bun x vitest run tests/workspaceShell.spec.ts tests/modelSelector.spec.ts tests/sessionPermissionModeControl.spec.ts tests/permissionModeControl.spec.ts; bun x playwright test tests/playwright/workspace-layout.mjs --config tests/playwright/config.mjs
  Expected: PASS; controls have accessible names, focus returns correctly and reduced-motion CSS does not remove content.

- [ ] Step 5: Commit visual/accessibility boundary.
  Run: git add D:/Maxma/MaxmaHere/web/src/App.vue D:/Maxma/MaxmaHere/web/src/components/IconRail.vue D:/Maxma/MaxmaHere/web/src/components/SessionDrawer.vue D:/Maxma/MaxmaHere/web/src/components/ChatHeader.vue D:/Maxma/MaxmaHere/web/src/components/ChatInput.vue D:/Maxma/MaxmaHere/web/src/components/MessageBubble.vue D:/Maxma/MaxmaHere/web/src/components/workbench/WorkbenchPanel.vue D:/Maxma/MaxmaHere/web/tests/workspaceShell.spec.ts; git commit -m "style: align Maxma workspace hierarchy and accessibility"

## Phase 5: Integrated Regression and Browser Acceptance

### Task 5.1: Add the viewport acceptance suite

Files:
- Create: D:/Maxma/MaxmaHere/web/tests/playwright/workspace-layout.mjs
- Modify: D:/Maxma/MaxmaHere/web/tests/playwright/config.mjs
- Test against: App.vue, IconRail.vue, SessionDrawer.vue, ChatView.vue, ChatInput.vue, WorkbenchPanel.vue

- [ ] Step 1: Implement the three viewport cases.
  For each 390x844, 768x900 and 1280x800, navigate to http://localhost:5173/, wait for provider/session initialization, then assert document.documentElement.scrollWidth <= window.innerWidth, .icon-rail visible, .chat-input-wrapper visible, .btn-send or .btn-stop visible, and .composer-model-selector count equals 1.
  Expected: no horizontal scroll, one Composer model entry and visible input/send controls at every required viewport.

- [ ] Step 2: Test drawer/workbench behavior in each mode.
  Click button[aria-label="会话"], assert aside[aria-label="会话抽屉"] visible, press Escape and assert it closes. Click workbench toggle, assert role=complementary aria-label=工作台 visible, close it, and assert .chat-window remains scrollable. At 390px assert overlay/sheet mode; at 1280px assert opened panel does not change document width.

- [ ] Step 3: Test keyboard-only workflow.
  Use page.keyboard to reach session toggle, open/close drawer, focus the single model selector, focus textarea, type and submit a message with Enter, then open/close workbench. Assert focus returns to each trigger after its overlay closes.

- [ ] Step 4: Commit the acceptance suite.
  Run: git add D:/Maxma/MaxmaHere/web/tests/playwright/workspace-layout.mjs D:/Maxma/MaxmaHere/web/tests/playwright/config.mjs; git commit -m "test: add Maxma workspace viewport acceptance"

### Task 5.2: Run the full regression gate and review the diff

Files:
- Test: all D:/Maxma/MaxmaHere/web/tests/*.spec.ts
- Test: D:/Maxma/MaxmaHere/web/tests/playwright/smoke.mjs
- Test: D:/Maxma/MaxmaHere/web/tests/playwright/workspace-layout.mjs
- Verify: D:/Maxma/MaxmaHere/web/src/composables/useChat.ts
- Verify: D:/Maxma/MaxmaHere/web/src/stores/chat.ts
- Verify: D:/Maxma/MaxmaHere/web/src/stores/provider.ts
- Verify: D:/Maxma/MaxmaHere/web/src/stores/session.ts
- Verify: D:/Maxma/MaxmaHere/web/src/stores/workbench.ts

- [ ] Step 1: Run the focused unit suite.
  Run: cd D:/Maxma/MaxmaHere/web; bun x vitest run tests/env.spec.ts tests/viteProxy.spec.ts tests/sessionStore.spec.ts tests/modelSelector.spec.ts tests/stickerUtils.spec.ts tests/toolResultPresentation.spec.ts tests/canvasWorkspace.spec.ts tests/interactiveArtifactCards.spec.ts tests/workspaceShell.spec.ts
  Expected: PASS; environment/proxy, sessions, model selection, stickers, tools, canvas and shell contracts pass. The focused suite intentionally excludes streamTextSnapshots.spec.ts because its missing @/composables/streamTextSnapshots import is a known independent baseline.

- [ ] Step 1a: Report the known stream snapshot baseline separately.
  Run: cd D:/Maxma/MaxmaHere/web; bun x vitest run tests/streamTextSnapshots.spec.ts
  Expected: FAIL at the existing missing @/composables/streamTextSnapshots import. Record this as pre-existing baseline debt, do not modify that import in this redesign, and do not attribute the failure to the redesign.

- [ ] Step 2: Run build and existing smoke tests.
  Run: cd D:/Maxma/MaxmaHere/web; bun run build; bun x playwright test tests/playwright/smoke.mjs tests/playwright/workspace-layout.mjs --config tests/playwright/config.mjs
  Expected: vue-tsc and Vite build succeed; route, theme, provider, console-error and responsive checks pass.

- [ ] Step 3: Run backend/provider regression.
  Run from D:/Maxma/MaxmaHere: python -m pytest -q tests
  Expected: existing backend/provider tests pass without a protocol diff.

- [ ] Step 4: Inspect the final diff for prohibited changes.
  Run: git diff --stat HEAD~6..HEAD; git diff -- D:/Maxma/MaxmaHere/web/src/composables/useChat.ts D:/Maxma/MaxmaHere/web/src/api D:/Maxma/MaxmaHere/api D:/Maxma/MaxmaHere/web/src/utils/wsProtocol.ts
  Expected: protocol diff is empty; changes are limited to planned shell, component layout, style token and test files. Confirm no storage key, WebSocket event, endpoint, payload, provider model name, sticker directive or session action changed.

- [ ] Step 5: Record final browser acceptance.
  At 390x844, 768x900 and 1280x800 confirm: icon rail stays visible; drawer opens/closes without changing current session or recreating WebSocket; header contains current context/status/workbench only; exactly one visible composer-model-selector exists; context usage appears only beside it; Composer/send-stop/latest message are visible; no document horizontal scroll; [表情:...] and [表情包:...] render images; workbench preserves cards and active tab; Escape and focus return work for both overlays.

- [ ] Step 6: Create the final integrated commit.
  Run: git add D:/Maxma/MaxmaHere/web/src D:/Maxma/MaxmaHere/web/tests; git commit -m "feat: complete Maxma workspace frontend redesign"
  Expected: final commit contains only planned frontend shell/component/style/test changes; no backend, provider, WebSocket, agent or unrelated existing change is reverted.

## Self-Review Checklist

- [ ] Every design section is mapped: icon rail and drawer in Phase 1; header and single model ownership in Phase 2; conversation stream and conditional workflow in Phase 3; workbench drawer in Phase 3; responsive tokens, Dawn visual direction and accessibility in Phase 4; required viewport and regression acceptance in Phase 5.
- [ ] Every contract uses current names: provideChatInput, onSend, onStop, onModelChange, useSessionStore, useSidebar, useWorkbenchStore, WorkbenchTab, close and set-tab.
- [ ] No task changes REST, WebSocket, event type, payload, session ID, localStorage key, provider protocol, tool registry, sticker parser or workbench card data.
- [ ] Every changed selector, interface, command and expected result is stated in its task.
- [ ] The plan is limited to the requested implementation-plan file; executing it is a separate operation.
