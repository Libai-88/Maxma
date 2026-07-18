# P0 阻塞问题修复计划

## 问题 1：health.py 未捕获 JsonRpcError

**现状**：
- `api/health.py` 第 125-126 行调用 `client.call("get_health", {"probe": True})`
- Sidecar (`bun-sidecar/src/session-bridge.ts` 第 553 行) 未实现 `get_health`，返回 `Unknown method`
- Python 端 `client.call()` 抛出 `JsonRpcError`，当前被第 146 行的 `except Exception` 捕获，返回 `status="error"`
- `JsonRpcError` 定义在 `api/pi_bridge/rpc_client.py:14`，可通过 `api.pi_bridge` 导入

**修复方案**（`api/health.py`）：
1. 在文件顶部增加导入：`from api.pi_bridge import JsonRpcError`
2. 将第 116-150 行的 try-except 结构调整为：
   - 在 `except asyncio.TimeoutError` 之后、`except Exception` 之前，插入 `except JsonRpcError` 分支
   - 该分支返回 `ComponentHealth(status="degraded", detail=f"Sidecar RPC 不可用: {e}")`
   - 保留原有的 `except Exception` 作为兜底

**影响**：健康检查中 LLM 组件从 `"error"` 降为 `"degraded"`，整体 health status 仍为 `"degraded"`（而非 `"error"`），更符合"sidecar 功能降级而非系统错误"的语义。

---

## 问题 2：`GET /narrative` 和 `GET /moment` 路由不存在

**现状**：
- `api/index.ts` 中定义了 `getNarrative()` → `GET /narrative` 和 `getMoment()` → `GET /moment`
- 后端无对应路由实现
- 前端调用方：
  - `MemoryPanel.vue` 第 234 行调用 `api.getNarrative()` — 但该组件**未被任何活跃视图/组件引用**（MemoryView.vue 使用独立的 memory store，不引用 MemoryPanel）
  - `MomentCard.vue` 第 60 行调用 `api.getMoment()` — 仅被 `MemoryPanel.vue` 引用
  - 两组件均为死代码

**修复方案**（`web/src/api/index.ts`）：
1. 删除 `getNarrative()` 方法（第 256-258 行）
2. 删除 `getMoment()` 方法（第 259-261 行）
3. 删除第 5-6 行的 `NarrativeResponse, MomentResponse` import

**不清理**：`MemoryPanel.vue` 和 `MomentCard.vue` 组件本身 — 属于额外清理范围，非 P0 阻塞。

---

## 问题 3：`POST /providers/{id}/health` 路由不存在

**现状**：
- `api/index.ts` 中定义了 `checkProviderHealth(id)` → `POST /providers/${id}/health`
- 后端 `providers.py` 无此路由
- `grep` 确认前端**没有任何组件**调用 `checkProviderHealth`

**修复方案**（`web/src/api/index.ts`）：
1. 删除 `checkProviderHealth()` 方法（第 347-350 行）
2. 删除第 17 行的 `ProviderHealthCheckResponse` import

**不清理**：`types/provider.ts` 中的 `ProviderHealthCheckResponse` 接口定义 — 属于额外清理范围，非 P0 阻塞。

---

## 执行顺序

1. `api/health.py` — 添加 JsonRpcError 导入 + try-except 结构调整
2. `web/src/api/index.ts` — 删除 3 个方法 + 3 个相关类型 import
3. 运行 `npx vue-tsc --noEmit` 验证前端编译无错误
4. 打印修改摘要

## 验证方法

- 前端：`cd web && npx vue-tsc --noEmit` 确认无类型错误
- 后端：启动后 `GET /health?probe_remote=true` 应返回 LLM 组件 `status="degraded"` 而非 `"error"`
