# Pinia Stores 缺陷审计与修复计划

## 文件范围

`D:/Maxma/MaxmaHere/web/src/stores/` 下共 14 个文件：

| 文件 | 行数 | 备注 |
|------|------|------|
| activity.ts | 105 | SSE 事件流 + 活动记录 |
| auditLog.ts | 72 | 审计日志查询/清理 |
| chat.ts | 152 | 聊天频道管理 + 模型设置 |
| health.ts | 48 | 健康检查轮询 |
| memory.ts | 43 | 记忆查询/删除 |
| metrics.ts | 50 | 指标轮询 |
| onboarding.ts | 92 | 引导流程持久化 |
| persona.ts | 42 | 角色档案 |
| provider.ts | 92 | Provider 列表（已有 loadingPromise 保护） |
| session.ts | 147 | 会话 CRUD + localStorage 持久化 |
| sidebar.ts | 61 | 侧边栏展开/折叠 |
| tools.ts | 44 | 工具列表 |
| workbench.ts | 284 | 工作台 Canvas 状态 + 持久化 |

---

## 审计项 1：错误处理完整性

### 1.1 auditLog.ts — 2 处缺少 try-catch

- **`clearAll()` (L49-52)**: `api.clearAuditLog()` 和 `refreshAll()` 无 try-catch
- **`encryptKeys()` (L55-58)**: `api.encryptApiKeys()` 无 try-catch

### 1.2 session.ts — 3 处缺少 try-catch

- **`refreshSessions()` (L49-56)**: `api.listSessions()` 无 try-catch，失败时直接抛错
- **`_createSession()` (L58-62)**: `api.createSession()` 和 `localStorage.setItem()` 无 try-catch
- **`switchSession()` (L69-72)**: `localStorage.setItem()` 无 try-catch

### 1.3 chat.ts — `removeTurnsFromStorage` (L77-78)
- `localStorage.removeItem()` 无 try-catch（隐私模式下可能抛异常）

### 1.4 session.ts — `cleanupOrphanedCaches()` (L124-139)
- `localStorage.length`、`localStorage.key(i)`、`localStorage.removeItem(key)` 均无 try-catch

### 1.5 chat.ts — `cleanupOrphanedCaches()` (L96-104)
- `localStorage.length`、`localStorage.key(i)`、`localStorage.removeItem(key)` 均无 try-catch

---

## 审计项 2：竞态条件保护

### 2.1 已有保护 — 无需修改
- **provider.ts**: `_loadingPromise` 模式 (L33, L41-67) — 并发调用复用 promise ✓
- **session.ts**: `_initPromise` 模式 (L13, L17) — initIfNeeded 防并发 ✓

### 2.2 缺少保护 — 低优先级，暂不修改
- **session.ts `refreshSessions()`**: 被 `deleteSession`、`constifySession`、`unconstifySession`、`createSession` 多处调用，无防并发保护。但由于每次都是独立的 API 读取，不会导致数据损坏，仅浪费流量。

---

## 审计项 3：localStorage 访问安全

### 3.1 所有未保护的 localStorage 调用

| 文件 | 行号 | 调用 | 风险 |
|------|------|------|------|
| chat.ts | 78 | `localStorage.removeItem()` | **缺少 try-catch** |
| chat.ts | 97-101 | `localStorage.length` / `.key()` / `.removeItem()` | **缺少 try-catch** |
| session.ts | 61 | `localStorage.setItem()` (在 _createSession 中) | **缺少 try-catch** |
| session.ts | 71 | `localStorage.setItem()` (在 switchSession 中) | **缺少 try-catch** |
| session.ts | 132-136 | `localStorage.length` / `.key()` / `.removeItem()` | **缺少 try-catch** |

---

## 审计项 4：暴露不可变状态

所有 store 均正确返回 `ref` / `computed` 原始对象，未发现 unwrapped 值。 ✅

---

## 修复方案

### 修改清单

#### A) auditLog.ts
1. `clearAll()` — 包裹 `api.clearAuditLog()` + `refreshAll()` 在 try-catch 中
2. `encryptKeys()` — 包裹 `api.encryptApiKeys()` 在 try-catch 中

#### B) session.ts
3. `_createSession()` — 包裹 `api.createSession()` 和 `localStorage.setItem()` 在 try-catch 中
4. `refreshSessions()` — 包裹 `api.listSessions()` 在 try-catch 中（失败时保留现有 sessions 值）
5. `switchSession()` — 包裹 `localStorage.setItem()` 在 try-catch 中
6. `cleanupOrphanedCaches()` — 包裹所有 localStorage 操作在 try-catch 中

#### C) chat.ts
7. `removeTurnsFromStorage()` — 包裹 `localStorage.removeItem()` 在 try-catch 中
8. `cleanupOrphanedCaches()` — 包裹所有 localStorage 操作在 try-catch 中

---

## 修改原则

- 不改变外部接口（函数签名、返回值类型）
- API 调用失败时打印 `console.warn` 而不是静默吞异常（使问题可观测）
- localStorage 失败时以 `console.warn` 或静默处理，确保不阻塞正常流程
