# Maxma 作为 pi 前端壳：能力完整保留计划

> 目标：**pi 的能力完整保留，并在 Maxma 上充分发挥**。Maxma 是展示层与控制层，不重复实现 pi 已有的机制。
> 编制日期：2026-11-13。依据：pi 1.5.0 文档与 `dist/index.d.ts`、Maxma kernel/REST/前端实读、两轮独立审计。

## 判定原则

1. **pi 有 → Maxma 必须能看见、能控制**（除非是纯终端 UI 概念，见 §5 明确排除项）。
2. **不重复实现**：pi 的机制优先直接用，Maxma 只做桥接与呈现。
3. **界面不撒谎**：没接的能力不许在界面上摆着；接了但受限的要标注原因。
4. 每项都要有回归锁 + 真实界面验证，不做"测试绿但页面空"。

---

## 一、扩展体系（P0，最严重）

### 现状（已实测）

| 事实 | 证据 |
|---|---|
| 外部扩展**能**被发现并加载 | 在 `~/.pi/agent/extensions/` 放测试扩展，`createAgentSession` 返回的 `extensionsResult.errors` 明确点名该路径并报其内部 API 错误 → 发现链路是通的 |
| **UI 上下文从未注入** | 全仓无 `bindExtensions` / `setUIContext` 调用；`runner` 回落到 `noOpUIContext` |
| `noOpUIContext.confirm` **恒返回 `false`** | `dist/core/extensions/runner.js:132-135` |
| `extensionsResult` 被丢弃 | `pi-session.ts:123` 写的是 `const { session } = await createAgentSession(...)` |
| 扩展管理页无 extensions tab | `ExtensionView.tsx:16` 只有 `['tools','skills','mcp']` |

### 后果

任何使用 `ctx.ui.confirm/select/input` 的扩展在 Maxma 里**静默失效**。`confirm` 恒 `false` 意味着安全类扩展（pi 官方示例 `confirm-destructive.ts`、`dirty-repo-guard.ts`）会**静默拒绝一切操作**——不是报错，是行为错误，用户看不出原因。

### 要做

1. **注入 UI 上下文**
   - `pi-session.ts` 解构 `extensionsResult`，调 `session.bindExtensions({ uiContext, mode: "rpc" })`（或 `runner.setUIContext`）。
   - `uiContext` 实现 `select / confirm / input / editor / notify`，通过 WS 发给前端，等前端回 `extension_ui_response`。
   - 复用现有 `ask_user` 通道模式：已有 `tool_call_id` 归属、超时、审批门。**不新建第二套交互机制**。
   - `mode` 用 `"rpc"`：官方文档说 RPC 模式下 `hasUI=true`、对话框可用，TUI 专属方法降级为 no-op。

2. **新增 WS 事件**（三侧登记，按既有纪律）
   - 出站：`extension_ui_request { id, method, title, options?, message?, placeholder?, timeout? }`
   - 入站：`extension_ui_response { id, value? / confirmed? / cancelled? }`
   - 登记进 `MAXMA_ENGINE_WS_EVENTS` 或 `BACKEND_SYNTHESIZED_EVENTS`（取决于归属），并进 `SERVER_EVENT_HANDLER_TYPES`。

3. **前端对话框**
   - `components/chat/ExtensionPromptDialog.tsx`：select（列表）/ confirm（是/否）/ input（单行）/ editor（多行）。
   - 复用现有 `AlertDialog` 底座与 `confirmAction` 风格。
   - 超时按后端给的 `timeout` 倒计时，到期自动按官方默认值回填。

4. **扩展管理页新增 tab**
   - 列出已加载扩展（名称、路径、来源 scope、是否有错误）。
   - 错误要可见：`extensionsResult.errors` 直接呈现，不再静默吞掉。
   - 只读为主（启用/禁用需要 pi 的 `disabledBuiltinExtensions` 与 settings `extensions` 键，属二期）。

### 锁

- 单测：`bindExtensions` 被调用；`uiContext.confirm` 真的走到 WS 往返（用假 WS 驱动）。
- 单测：`extensionsResult.errors` 非空时，能力清单/扩展页能读到（不静默）。
- 结构锁：`pi-session.ts` 里 `createAgentSession` 的返回值必须解构 `extensionsResult`（防退回 `const { session }`）。
- 真实界面：放一个用 `ctx.ui.confirm` 的测试扩展，点开界面确认弹窗出现、两个按钮都能回传。

---

## 二、会话树与分叉（P1，壳最该做的事）

### 现状

pi 的 `AgentSession` **直接提供**（Maxma 已持有 `record.session`，无需换 API）：

| 方法 | 位置 | 现状 |
|---|---|---|
| `navigateTree(targetId, {summarize, customInstructions, label})` | `agent-session.d.ts:874` | 未接 |
| `getUserMessagesForForking()` | `:888` | 未接 |
| `getSessionStats()` | `:897` | 未接 |
| `exportToHtml(path, opts)` | `:905` | 未接 |
| `setSessionName(name)` | `:862` | 未接 |

`SessionManager`（`record.session.sessionManager`）另有 `getTree()`、`getBranch()`、`getLabel()`、`appendLabelChange()`、`branchWithSummary()`、`branch()`、`getEntries()`。

`fork` / `newSession` / `switchSession` 在 **`AgentSessionRuntime`** 上——Maxma 用的是 `createAgentSession`（单会话），**这两条需要迁移到 Runtime 或另找路径**（见下）。

### 要做

1. **只读树**（成本低，先做）
   - RPC `get_tree`：`sessionManager.getTree()` + `getLeafId()`，返回节点 `{id, parentId, type, role?, preview, label?, timestamp, isLeaf}`。
   - REST `GET /api/sessions/:id/tree`。
   - 前端 `SessionTreeView`：树状/缩进视图，可点节点看该条消息预览，高亮当前 leaf。
   - 这会立刻让用户看见"这个会话分过哪些支"。

2. **树内导航**（`navigateTree`，成本低）
   - RPC `navigate_tree`：转发 `navigateTree`。
   - 前端在树上点"回到这里"→ 调 RPC → 刷新消息。
   - `summarize: true` 时对离开的分支生成摘要（pi 原生能力）。

3. **分叉**（成本中，路径已验证）
   - 两条路径，**已实测选 B**：
     - ~~A：迁移到 `AgentSessionRuntime`~~ —— 改动 `pi-session.ts` 的会话持有结构与 `record` 生命周期，风险高。
     - **B：`SessionManager.forkFrom(sourcePath, targetCwd)` 建新会话文件，再走现有 `create_session(resume_session_id)`**。
   - 实测（2026-11-13）：
     - `SessionManager.forkFrom(src, dir)` 返回可用 manager，`getSessionId()` / `getEntries()` 正常。
     - **按 entry 分叉已验证**：`forkFrom` 复制整个会话后，在副本上 `branch(targetId)` 收窄 → `getLeafId() === targetId`、`getBranch().length` 为该点的条目数。
   - 所以完整流程是：`forkFrom(src, cwd)` → `branch(targetEntryId)` → 用新 session 文件走 `create_session(resume_session_id)`。
   - 注意：`forkFrom` 会生成**新 session id**，前端要把它当新会话插入列表。

4. **会话重命名 / 统计 / 导出**
   - `setSessionName` → RPC + 前端重命名入口（侧栏已有位置）。
   - `getSessionStats` → 会话详情面板（token/cost/消息数，含被压缩掉的历史）。
   - `exportToHtml` → 「导出为 HTML」按钮（写用户选的路径）。

### 锁

- `get_tree` 返回的节点数/父子关系与真实 JSONL 一致（用真实会话文件断言）。
- `navigateTree` 后 leaf 真的变了，且 `get_messages` 随之变化。
- 前端树视图：真实界面点节点 → 消息区变化。
- 导出：生成的文件存在且含消息正文。

---

## 三、设置与模型可见性（P1）

### 现状

pi 的 `settings.md` 里有、Maxma `MAXMA_SETTINGS_KEYS` 里**没有**的真实键：

| 键 | 默认值 | 影响 |
|---|---|---|
| `compaction.reserveTokens` | 16384 | 压缩触发点，直接影响长对话体验 |
| `compaction.keepRecentTokens` | 20000 | 压缩后保留多少 |
| `compaction.modelOverrides` | — | 按模型定制 |
| `branchSummary.reserveTokens` / `skipPrompt` | — | 分支摘要行为 |
| `cacheWarming` | `"streaming"` | 缓存预热（省钱） |
| `enabledModels` | 全部 | 模型循环范围 |
| `defaultThinkingLevel` | `"medium"` | 新会话思考档位 |
| `modelThinkingLevels` | — | 按模型的思考档位 |
| `hideThinkingBlock` | false | 是否隐藏思考 |
| `images.autoResize` / `blockImages` | — | 图片处理 |

反过来，`MAXMA_SETTINGS_KEYS` 里有 23 条 `consumer:"none"`（OMP 遗留），界面若不显示已算诚实，但值得复核是否还有面板在暴露。

### 要做

1. 把上表 `consumer:"pi"` 的键补进登记表（`engineReal: true`），并在设置页暴露。
2. `cacheWarming` 是**全局设置**（文档明确），要标出"仅全局"。
3. 复核 `consumer:"none"` 的 23 条：面板里还显示的一律移除或标"不生效"。
4. 虚拟模型：`registerVirtualModel` + `session.routedModel`。这项要单独评估——它是 pi 的高级路由能力，接进来需要产品设计（如何展示"虚拟模型 → 实际模型"）。

### 锁

- 登记表新增键后，`engine-boundary.test.ts` 的三方对账（登记表/面板键/后端键）仍绿。
- 实测：改 `compaction.reserveTokens` → 建新会话 → `get_settings` 读回一致。

---

## 四、Prompt templates 与其他（P2）

| 项 | pi 提供 | 成本 | 说明 |
|---|---|---|---|
| Prompt templates | `additionalPromptTemplatePaths` | 低 | 接上后用户能在 `~/.pi/agent/prompts/` 放 `.md` 当斜杠命令 |
| `get_entries` 增量同步 | `since` 游标 | 中 | 跨重启的 durable cursor，可优化前端加载 |
| `session.reload()` | SDK 有 | 低 | 重载扩展/技能/模板，替代"重建会话" |
| 嵌套工具调用 | `parentToolCallId` / `nestedCalls` | 中 | 只渲染顶层工具会漏掉子调用 |
| `context_edit` | `appendContextEdit` | 中 | 软删除/改写未来上下文 |

---

## 五、明确排除（pi 有但不适用于 Web 壳）

| 项 | 为什么排除 |
|---|---|
| TUI 组件（`AssistantMessageComponent` 等） | 终端渲染，Web 用自己的 React 组件 |
| `themes`（终端主题） | Maxma 有自己的 Solid Glass 主题体系 |
| `keybindings` | 终端键位；Web 用浏览器原生 |
| `terminal.*` 设置 | 终端专属 |
| `tuiMode` / `fullscreen*` | 终端专属 |
| `ctx.ui.custom()` | RPC/SDK 模式下返回 `undefined`，官方明示不支持 |
| `onTerminalInput` / `setEditorComponent` 等 | 同上，官方列为 RPC 模式降级项 |

这些**不算缺口**，但应在文档里写清，避免后续接手者重复调研。

---

## 六、执行顺序建议

```
第一阶段（1 个 PR）：扩展 UI 上下文
  ├─ bindExtensions + uiContext 实现
  ├─ WS 事件三侧登记
  ├─ 前端对话框组件
  ├─ 扩展页新增 tab + 错误可见
  └─ 锁：结构锁 + 往返单测 + 真实界面

第二阶段（1-2 个 PR）：会话树只读 + 导航
  ├─ get_tree RPC/REST + 前端树视图
  ├─ navigate_tree + 分支摘要
  └─ 锁：真实会话文件断言 + 界面验证

第三阶段（1 个 PR）：设置补齐
  ├─ 补 pi 真实键进登记表与面板
  ├─ 复核 23 条 none
  └─ 锁：三方对账 + 实测读写

第四阶段（评估后定）：分叉、虚拟模型、导出
```

**为什么这个顺序**：扩展 UI 是唯一会让现有功能**静默出错**的（confirm 恒 false），必须先修；会话树是壳最该做且成本已探明；设置补齐风险最低可以放后面。

---

## 七、待确认

1. ~~分叉走 A 还是 B~~ —— **已验证走 B**（`forkFrom` + `branch`），见 §二.3。
2. **虚拟模型要不要接** —— 它是 pi 的高级能力，但产品上如何呈现"自动路由"（`session.model` 是虚拟选择，`session.routedModel` 才是实际模型）需要设计，建议单独讨论。
3. **扩展的启用/禁用** —— 需要 pi 的 settings `extensions` 键与 `disabledBuiltinExtensions`，且涉及安全（扩展有完整系统权限），建议二期并配套安全说明。

## 八、已完成的调研（避免重复劳动）

本轮已实测并确认、后续不必再查：

| 结论 | 证据 |
|---|---|
| 外部扩展能被发现并加载 | 放测试扩展到 `~/.pi/agent/extensions/`，`extensionsResult.errors` 点名该路径 |
| UI 上下文从未注入 | 全仓无 `bindExtensions`/`setUIContext`；`runner.js:132` 的 `noOpUIContext.confirm` 恒 `false` |
| `navigateTree`/`getUserMessagesForForking`/`getSessionStats`/`exportToHtml`/`setSessionName` 都在 `AgentSession` 上 | `agent-session.d.ts:862-905` |
| `getTree()` 可用 | 实测 2 条 entry → 1 个根节点 |
| 按 entry 分叉可行 | `forkFrom` + `branch(targetId)` → leaf 与分支长度均正确 |
| pi 的 `reserveTokens`/`keepRecentTokens`/`cacheWarming`/`enabledModels`/`defaultThinkingLevel` 在 Maxma 零引用 | 全仓 grep 无命中 |
