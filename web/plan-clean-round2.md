# 清理计划：round 2

## 任务 1：移除未使用的 API 方法

### 方法 1：`getDeepSeekBalance`（api/index.ts 行 ~289-290）

**文件**：`D:/Maxma/MaxmaHere/web/src/api/index.ts`

**影响范围**：
- 删除行 289-290 的方法定义
- 删除行 9 的 `DeepSeekBalanceResponse` 导入（该类型仅被此方法使用）
- `types/index.ts` 中的 `DeepSeekBalanceResponse` 和 `BalanceInfo` 接口不再被任何代码引用，可选择性删除

---

### 方法 2：`getMcpAuditSummary`（api/index.ts 行 ~561-562）

**文件**：`D:/Maxma/MaxmaHere/web/src/api/index.ts`

**影响范围**：
- 删除行 561-562 的方法定义
- 删除行 70 的 `McpAuditSummaryResponse` 导入（该类型仅被此方法使用）
- `types/audit-log.ts` 中的 `McpAuditSummaryResponse` 和 `McpAuditSummaryEntry` 接口不再被任何代码引用，可选择性删除

---

### 方法 3：`clearErrorLog`（api/index.ts 行 ~700-703）

**文件**：`D:/Maxma/MaxmaHere/web/src/api/index.ts`

**影响范围**：
- 仅删除行 700-703 的方法定义，无其他引用

---

## 任务 2：ContextUsage 类型重复定义

### 现状

两个同名但不同结构的 `ContextUsage`：

| 文件 | 字段 | 用途 |
|------|------|------|
| `types/index.ts` 行 505-511 | `current_tokens`, `max_tokens`, `usage_percent`, `model_name`, `breakdown?` | API 响应类型（后端 snake_case） |
| `types/chat.ts` 行 10-16 | `estimatedTokens`, `maxTokens`, `percentage`, `messageCount`, `modelName` | UI 展示类型（前端 camelCase） |

### 引用关系

- `types/index.ts` 的 `ContextUsage` 被以下文件使用：
  - `api/index.ts`：`getContextUsage` 方法的返回类型
  - `composables/useChat.ts`：`SessionChannel.contextUsage` 字段、事件处理中的类型推导
  - `stores/chat.ts`：`SessionChannel.contextUsage` 字段类型（行 18）

- `types/chat.ts` 的 `ContextUsage`（别名 `UIUsage`）被以下文件使用：
  - `stores/chat.ts`：`contextUsage` ref 的类型（行 49）、`updateContextUsage` 参数类型（行 111）

### 处理方案

由于两个接口字段结构不同，不能简单统一。建议：

1. **`types/chat.ts` 中将 `ContextUsage` 重命名为 `ChatContextUsage`**，消除同名歧义
2. **更新 `stores/chat.ts`**：导入 `ChatContextUsage` 替代 `ContextUsage as UIUsage`
3. **更新 `useChat.ts`**：将构造 UI usage 对象的代码显式标注为 `ChatContextUsage` 类型（可选，类型推导已足够）

这样既消除了重复命名的混淆，又保留了各自的字段结构（API snake_case vs UI camelCase），且改动最小。

---

## 任务 3：`encryptApiKeys` 调用检查

**结果**：已确认被调用，无需删除。

```text
D:/Maxma/MaxmaHere/web/src/stores/auditLog.ts:56:    const res = await api.encryptApiKeys()
D:/Maxma/MaxmaHere/web/src/views/PrivacyView.vue:232:    const res = await api.encryptApiKeys()
```

---

## 修改清单

| # | 文件 | 操作 | 风险 |
|---|------|------|------|
| 1 | `api/index.ts` | 删除 `getDeepSeekBalance` 方法定义 | 低 |
| 2 | `api/index.ts` | 从 import 行删除 `DeepSeekBalanceResponse` | 低 |
| 3 | `api/index.ts` | 删除 `getMcpAuditSummary` 方法定义 | 低 |
| 4 | `api/index.ts` | 删除 `McpAuditSummaryResponse` 的 import 行（行 70） | 低 |
| 5 | `api/index.ts` | 删除 `clearErrorLog` 方法定义 | 低 |
| 6 | `types/chat.ts` | 将 `ContextUsage` 重命名为 `ChatContextUsage` | 低 |
| 7 | `stores/chat.ts` | 更新导入：`import type { ChatContextUsage } from '../types/chat'` | 低 |
| 8 | `stores/chat.ts` | 将 `UIUsage` 替换为 `ChatContextUsage` | 低 |
| 9 | `types/index.ts` | 可选：删除 `BalanceInfo` 和 `DeepSeekBalanceResponse` | 低 |
| 10 | `types/audit-log.ts` | 可选：删除 `McpAuditSummaryResponse` 和 `McpAuditSummaryEntry` | 低 |

## 验证

修改后执行：

```bash
cd D:/Maxma/MaxmaHere/web && npx vue-tsc --noEmit
```
