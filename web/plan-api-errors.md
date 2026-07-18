# API 错误处理审计计划

## 背景

基于 QA 方法论系统性地审计前端所有 `api.xxx()` 调用处，检查错误处理是否完整。

## 审计范围

- 文件数：25 个文件（18 个组件/视图 + 7 个 store）
- API 调用点数：~70+ 处
- 核心检查：`request()` 函数在 HTTP 非 2xx 时抛出 Error，调用方是否都捕获了

## 审计结果

### 1. request() 函数分析

`src/api/index.ts` 中的 `request<T>()` 函数：
- 非 2xx 响应时：`throw new Error(detail)` —— 必须由调用方捕获
- 已自带 `ensureTokenLoaded()` 的 try-catch（行 96-98），仅 `console.warn`
- `api.restart()` 内部已处理服务端断开连接的异常（空 catch）

### 2. 已确认有正确错误处理的调用（无需修改，共 ~50 处）

| 文件 | 行号 | API 调用 | 处理方式 |
|------|------|----------|----------|
| AppSettingsMenu.vue | 81, 104, 111 | getErrorLogText / getLogFiles / clearOldLogs | try-catch + alert |
| AppSettingsMenu.vue | 134 | health | try-catch（空，轮询预期） |
| ChatInput.vue | 566, 575, 584 | listSkills / listTools / listMacros | try-catch + console.error |
| ChatInput.vue | 851 | checkPathBlocked | .catch(console.warn) |
| ChatInput.vue | 925 | uploadImage | try-catch + console.error + 回滚 |
| ChatWindow.vue | 287 | getErrorLogText | try-catch + 降级文案 |
| SessionPermissionModeControl.vue | 47, 65 | get/setSessionPermissionMode | try-catch（含 UI 反馈） |
| SubAgentCard.vue | 108, 141 | get/cancelDeferredRun | Promise.allSettled / try-catch |
| WorkflowCard.vue | 131-183 | 全部 API | try-catch + isUnavailableError |
| ChatView.vue | 318 | undoMessages | try-catch + console.error |
| EnvVarsView.vue | 103, 134 | listEnvVars / updateEnvVar | try-catch + console.error |
| MaxmaBlockerView.vue | 91-141 | 全部 API | try-catch + console.error |
| McpView.vue | 434-653 | 全部 API | try-catch + toErrorMessage + UI 反馈 |
| NewsView.vue | 106 | listNews | try-catch + console.error |
| PathWhitelistView.vue | 107-173 | 全部 API | try-catch + console.error + formError |
| PrivacyView.vue | 155, 176, 198, 215, 232 | 全部 API | try-catch + UI 反馈 |
| ProvidersView.vue | 281-493 | 全部 API | try-catch + toErrorMessage + UI 反馈 |
| SkillsView.vue | 246-399 | 全部 API（create/update/delete/list） | try-catch + UI 反馈 |
| SoulView.vue | 135-176 | 全部 API | try-catch + console.error + alert |
| stores/activity.ts | 20, 29, 96 | 全部 API | try-catch + console.error |
| stores/health.ts | 24 | health | try-catch（空，设 null） |
| stores/metrics.ts | 17, 28 | getMetrics / getMetricsHistory | try-catch + error state |
| stores/provider.ts | 45 | listProviders | try-catch + 重试 3 次 |

### 3. 需要修复的问题（共 7 处）

#### 级别 A：Store 中缺少 try-catch（6 处）

这些 store 函数的 API 调用没有任何错误处理，异常会直接抛给调用方（视图层），可能导致白屏或功能不可用。

**`stores/session.ts`（5 处）：**

1. **`refreshSessions()` 行 54** — `api.listSessions()` 无 try-catch
   - 当前行为：异常直接抛给调用方
   - 影响：`initIfNeeded()` 由外层 catch 兜底；但 `createSession()`、`deleteSession()`、`constifySession()`、`unconstifySession()` 的 refreshSessions 调用有 `.catch()` 兜底
   - 建议：保持抛出策略（意图就是让调用方决定重试），但加 `console.warn` 日志

2. **`_createSession()` 行 59** — `api.createSession()` 无 try-catch
   - 影响：`initIfNeeded()` 外层 catch 兜底；`createSession()` 无 catch 兜底
   - **建议：外层 `createSession()` 加 try-catch + console.warn**

3. **`deleteSession()` 行 75** — `api.deleteSession(id)` 无 try-catch
   - 影响：如果后端删除失败，异常直接抛给视图层
   - **建议：加 try-catch + console.warn**

4. **`constifySession()` 行 90** — `api.constifySession(id, name)` 无 try-catch
   - 影响：异常直接抛给视图层
   - **建议：加 try-catch + console.warn**

5. **`unconstifySession()` 行 95** — `api.unconstifySession(id)` 无 try-catch
   - 影响：异常直接抛给视图层
   - **建议：加 try-catch + console.warn**

**`stores/auditLog.ts`（2 处）：**

6. **`clearAll()` 行 50** — `api.clearAuditLog()` 无 try-catch
   - 影响：异常直接抛给视图层
   - **建议：加 try-catch + console.warn**

7. **`encryptKeys()` 行 56** — `api.encryptApiKeys()` 无 try-catch
   - 影响：异常直接抛给视图层
   - **建议：加 try-catch + console.warn**

#### 级别 B：空 catch 块静默吞没错误（2 处，低优先级）

8. **`ChatInput.vue:864`** — `_pick()` 函数中 `catch { /* 静默失败 */ }`
   - selectLocalPath() 失败时无任何日志，调试困难
   - **建议：至少加 `console.warn('[ChatInput] _pick failed:', e)`**

9. **`ChatInput.vue:877`** — `selectLocalPath()` 中 `api.selectFile(type)` 无 try-catch
   - 虽然调用方 _pick() 有 catch，但函数自身不处理异常
   - **建议：函数内部加 try-catch，使错误处理内聚**

10. **`SkillsView.vue:419,431`** — `toggleSkill()` 和 `viewSkill()` 使用 `fetch()` + 空 catch
    - 虽然不适用 api.xxx()，但作为 API 调用应当有日志
    - **建议：加 `console.warn` 日志**

## 修复原则

1. **级别 A（必须修）**：每个 `api.xxx()` 调用必须有错误处理（try-catch 或 .catch()）
2. **级别 B（建议修）**：生产环境的 catch 至少要有 `console.warn`
3. UI 相关的调用应该在 catch 中设置错误状态（`error.value = err.message`）

## 执行计划

1. 修改 `stores/session.ts`：`createSession()`, `deleteSession()`, `constifySession()`, `unconstifySession()` 加 try-catch
2. 修改 `stores/auditLog.ts`：`clearAll()`, `encryptKeys()` 加 try-catch
3. 修改 `ChatInput.vue`：`_pick()` catch 加日志, `selectLocalPath()` 加 try-catch
4. 修改 `SkillsView.vue`：空 catch 加 console.warn
5. 运行 `npx vue-tsc --noEmit` 验证
6. 打印审计摘要

## 不修改的说明

- `session.ts:refreshSessions()` — 保持抛出策略（意图是让调用方决定重试），调用方已有 catch 兜底
- `session.ts:_createSession()` — 仅被 `initIfNeeded()` 和 `createSession()` 调用，前者有外层 catch
- `PrivacyView.vue:198` — 批量删除时个别失败空 catch 是预期行为
- `AppSettingsMenu.vue:128` — `api.restart()` 是 fire-and-forget，服务端会断开连接
