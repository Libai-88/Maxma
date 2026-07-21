# 红队 Round 4 报告

**竞赛比分**: 红队 21 / 蓝队 48
**报告日期**: 2026-07-18
**测试基线**: 1820 passed, 4 failed (均为既有失败: providers encryption×2, mcp note×1, bun path×1)

---

## 方向 A：蓝队 Round 3 工作复核（0 分）

对蓝队 R3 三项修复逐一验证，**全部正确无误**，红队无法在此方向得分。

### A1. McpView.vue 的 loadSeq 拆分
- **文件**: `web/src/views/McpView.vue` (lines 460-588, 834)
- **结论**: ✅ 正确。loadSeq 拆分逻辑清晰，所有引用均已同步更新，无遗漏引用、无悬空变量。

### A2. useChat.ts 的 tauriFetch 替换
- **文件**: `web/src/composables/useChat.ts` (lines 1-15, 540-569)
- **结论**: ✅ 正确。tauriFetch 替换完整，`res.ok` 处理合理（非 ok 时抛出含状态码的错误，符合 API 客户端统一契约）。

### A3. ID_PATTERN 改为 `+` 量词
- **文件**: `web/src/views/SkillsView.vue` (lines 168-177, 314-322) → 后端 `api/routes/skills.py` (line 23)
- **结论**: ✅ 正确。前端 `ID_PATTERN = /^[A-Za-z0-9_-]+$/` 与后端 `_SKILL_ID_RE = re.compile(r'^[A-Za-z0-9_\-]+$')` 完全一致，量词 `+` 匹配后端。

---

## 方向 B：新区域 Bug 搜寻

### 审查范围

在已有"已修复区域"清单之外，对以下区域进行了深度审查（80+ 文件）：

**前端组件**（含本轮新增审查）:
- 已审（前轮）: ChatWindow, MessageBubble, ChatInput, ToolCallCard, FloatSidebar, ContextMenu, SessionSidebar, ThemePicker, WelcomeScreen, ApprovalBubble, HealthPanel, NewsCard, PlanCard, RenderMarkdown, ThinkingBlock, TaskTrackerBar, HtmlSandbox, Sparkline, BarChartMini, StickerPicker, ModelSelector
- 本轮新增: ToolPanel, SubAgentCard, AutocompletePanel, MediaViewer, MarkdownEditor, ToolBubbleRouter, PulsePanel, ModelSettingsPanel

**前端 composables**: useChatInput, useTheme, useSidebar, useFloatSidebar, useHealthPolling, useMarkdownPersist, useMediaTransform, useSelectionQuote, useGlobalShortcut, sessionAliveCache, useMediaViewer, usePaperTexture, useStickerPerformance, useStickerSegments, stickerUtils

**前端 views**: ChatView, HooksView, KbView, NewsView, PlaygroundView, ProvidersView, SoulView, UserView, ActivityView, AppearanceView, AuditLogView, EnvVarsView, MaxmaBlockerView, PathWhitelistView, PrivacyView, MetricsView, MemoryView, OnboardingView, NotFoundView

**前端 utils**: markdown, references, thinkPath, floatingPosition, error, providerDiagnostics

**后端**: activity_hub, diagnostics, health, autonomy, event_hooks, audit_log, persona, tools, providers (deep), mcp (deep), transcripts (deep), ws_registry, ws_event_mapper, jsonl_writer, session_manager, stickers, kb, restart, errors, const_session_store, chat, session_adapter, approval_adapter, sidecar_manager, rpc_client, security_adapter, dependencies, runtime_status, context_usage, interaction, cors_config, logging_config, metrics, db/core, db/auth, db/providers, db/hooks, credential_envelope, credential_mask, idle_queue, artifacts/schema, request_log, auth, deferred_runs

**集成层**: 前后端 API 契约（api/index.ts ↔ routes/*）、WebSocket 事件流（chat.py ↔ session-bridge.ts）、错误传播链（tauriFetch → SubAgentCard → 用户）

**Bun Sidecar**: session-bridge.ts (orchestratePrompt/DoneGuard/handleCancelGuard)

---

### 🟡 中优先级 Bug（1 个，已修复）

#### B-1. SubAgentCard.vue 404 检测正则失效导致功能禁用时持续无效轮询

- **文件**: `web/src/components/SubAgentCard.vue:100`
- **优先级**: 中（Medium）
- **状态**: ✅ 已修复

**Bug 描述**:

`isUnavailableError` 函数使用正则 `/(?:\\s|^)404(?:\\s|$)/` 检测 404 错误。该正则存在双重转义缺陷：

```javascript
// 原代码（有缺陷）
return error instanceof Error && /(?:\\s|^)404(?:\\s|$)/.test(error.message)
```

在 JavaScript 正则字面量中，`\\s` 表示字面量反斜杠后跟 `s`（即字符串 `\s`），而非空白符。因此该正则仅匹配以下情形：
- 字符串以 `404` 开头（`^` 分支可用）
- 字符串以 `404` 结尾（`$` 分支可用）
- 字符串中包含字面量 `\s404\s`（实际永不出现）

**实际错误格式**: API 客户端 (`web/src/api/index.ts:161`) 抛出的错误格式为：
```javascript
const userMsg = `API 请求失败 (${res.status})`
// 404 时为: "API 请求失败 (404)"
```

其中 `404` 被圆括号包裹（`(` 和 `)`），既非字符串首尾，也非字面量 `\s`。因此正则 **永不匹配**，`isUnavailableError` 恒返回 `false`。

**影响**:

后端 `api/routes/deferred_runs.py:25` 在异步子任务功能未启用时返回 404：
```python
raise HTTPException(status_code=404, detail="Deferred sub-agent runs are unavailable")
```

由于正则失效，SubAgentCard 无法识别此 404：
1. `refresh()` 中不会将 `available.value` 置为 `false`，卡片不会自动隐藏
2. `schedulePolling()` 持续每 4 秒轮询已禁用的端点
3. `cancelRun()` 中同样无法识别 404，取消失败时卡片不隐藏
4. 造成不必要的网络请求资源浪费与不良用户体验

**修复**:

将正则改为 `/\b404\b/`，使用词边界 `\b` 正确匹配括号包裹的 `404`（圆括号 `(` `)` 为非单词字符，与数字 `4` 之间存在词边界）：

```javascript
// 修复后
function isUnavailableError(error: unknown): boolean {
  // 匹配错误消息中的 404 状态码。使用 \b 词边界以适配
  // "API 请求失败 (404)" 这类括号包裹格式（括号是非单词字符，与数字间存在词边界）。
  return error instanceof Error && /\b404\b/.test(error.message)
}
```

**验证**:
- 前端测试全部通过（47 tests passed）
- SubAgentCard 专项测试 3/3 通过
- 既有失败 `streamTextSnapshots.spec.ts` 与本修复无关（孤立测试文件，见下文低优先级项）

---

### 🟢 低优先级问题（2 个，未修复，仅记录）

#### B-2. ToolPanel.vue 搜索名称时大小写不一致

- **文件**: `web/src/components/ToolPanel.vue:37`
- **优先级**: 低（Low）
- **状态**: ⚠️ 未修复（低于中优先级阈值）

```javascript
const q = search.value.toLowerCase()
// t.name.includes(q) — q 已小写，但 t.name 未小写化
// t.label?.toLowerCase().includes(q) — 正确
// t.description?.toLowerCase().includes(q) — 正确
```

`t.name` 搜索时未 `.toLowerCase()`，而 `t.label` 和 `t.description` 均已小写化。若工具名含大写字母，按小写搜索将无法匹配。实际影响较小（工具名通常为小写标识符如 `file_read`）。

#### B-3. 孤立测试文件 streamTextSnapshots.spec.ts 导入不存在的模块

- **文件**: `web/tests/streamTextSnapshots.spec.ts`
- **优先级**: 低（Low）
- **状态**: ⚠️ 未修复（低于中优先级阈值）

该测试文件导入 `@/composables/streamTextSnapshots`，但该模块在代码库中不存在（`web/src/composables/` 下无 `streamTextSnapshots.ts`，且 `appendStreamText`/`createStreamTextSnapshot`/`snapshotStreamText` 函数在整个 `src/` 下均无定义）。

这导致 `npx vitest run` 始终有 1 个 suite 失败：
```
FAIL  tests/streamTextSnapshots.spec.ts
Error: Failed to resolve import "@/composables/streamTextSnapshots"
```

属于遗留的孤立测试文件（可能为 TDD 先写的测试但实现未落地，或重构后测试未同步清理）。

---

### 未发现 Bug 的区域说明

经深度审查，以下区域代码质量高，未发现中优先级及以上问题：

**安全防护**: 路径遍历防护（normpath+resolve+startswith）、凭据加密（encv1 信封格式）、MCP 环境变量黑名单、HMAC 签名工件令牌+nonce 防重放、DOMParser HTML 消毒、fail-closed 安全适配器、CSP-safe CSSOM 全量替换 `:style` 绑定。

**并发与状态**: 活动会话序列号防竞态、SessionManager 异步锁+TTL 清理+活跃任务取消、SidecarManager 生命周期锁、Metrics 单例双重检查锁定、YAML 原子写入（portalocker+threading.Lock 双重保护）、SessionMap SQLite WAL 模式。

**Sidecar 协议**: `orchestratePrompt` 的 DoneGuard 模式保证 `error` 后必发 `done`（finally 块），`chat.py` 的 `turn_done` 等待逻辑无悬挂风险。已验证 `chat.py:175-179` 的 error handler 不设 `turn_done` **不是 bug**（依赖 sidecar 协议保证）。

**API 契约**: `api/index.ts` 与后端路由的路径/方法/参数一致，`encodeURIComponent` 包裹用户输入防注入，Token 版本号防 `resetToken()` 与 `ensureTokenLoaded()` finally 块竞态。

---

## 修复验证

### 前端测试结果
```
Test Files  1 failed | 16 passed (17)
     Tests  47 passed (47)
```
- 失败的 1 个 suite (`streamTextSnapshots.spec.ts`) 为**既有失败**，与本轮修复无关
- SubAgentCard 专项测试 3/3 全部通过
- 所有其他 16 个 suite / 47 个测试全部通过

### 后端测试结果（未变动）
```
1820 passed, 4 failed (均为既有失败)
```
本轮未修改后端代码，后端测试状态不变。

---

## 得分统计

| 方向 | 项 | 优先级 | 得分 |
|------|-----|--------|------|
| A | 蓝队 R3 复核（3 项均正确） | - | 0 分 |
| B-1 | SubAgentCard 404 正则失效 | 中 | 2 分 |
| B-2 | ToolPanel 搜索大小写不一致 | 低 | 1 分 |
| B-3 | 孤立测试文件导入失败 | 低 | 1 分 |

**本轮合计得分**: 4 分（中优先级 2 + 低优先级 2）

---

## 结论

本轮红队在方向 A 未得分（蓝队 R3 三项修复全部正确）。方向 B 经 80+ 文件深度审查，发现 1 个中优先级 bug（已修复）和 2 个低优先级问题（记录未修复）。

代码库整体防御质量极高：安全防护完备、并发控制严谨、Sidecar 协议有保证、API 契约一致。所发现的中优先级 bug 属于正则转义细节缺陷（`\\s` vs `\s`），在代码审查中容易被忽略。
