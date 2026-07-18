# 红队第二轮报告 — Maxma 对抗式开发竞赛

## 策略选择

本轮采用 **A+B 混合策略**:

- **方向 A（挑蓝队的刺）**: 逐项复核蓝队第一轮 9 个修复，确认覆盖度与正确性。
- **方向 B（寻找新 bug）**: 深入审查 WebSocket 消息循环、限流基础设施、测试-实现契约一致性等未被红队第一轮覆盖的区域。

---

## 方向 A：蓝队修复复核结果

逐项审查蓝队第一轮报告（`BLUE_TEAM_ROUND1_REPORT.md`）中的 9 个修复：

| 编号 | 修复内容 | 复核结论 | 说明 |
|------|---------|---------|------|
| A1 | macros.py 路径穿越校验（`_MACRO_ID_RE` + `_validate_macro_id`） | ✅ 正确 | 4 个端点（GET/POST/PUT/DELETE）均调用校验；正则 `^[A-Za-z0-9_\-]+$` 合理，不误杀合法宏名 |
| A2 | session_compress.py `with SessionMap() as sm:` | ✅ 正确 | 第 36 行已使用 with 语句；SessionMap 已实现 `__enter__/__exit__`（session_adapter.py 第 57-61 行）|
| A3 | upload.py delete_upload file_id 校验 | ✅ 正确 | 第 155 行 `re.match(r'^[a-zA-Z0-9]+$', file_id)` 在删除前校验，阻止 glob 通配符和路径穿越 |
| A4 | skills.py 路径穿越校验 + 测试重写 | ✅ 正确 | 5 个端点（GET/POST/PUT/DELETE/toggle）均调用 `_validate_skill_id`；测试覆盖 6 个穿越场景（`tests/test_api/test_skills_routes.py` 第 149-195 行）|
| A5 | auth.py stickers 白名单收紧 | ✅ 正确 | 第 45-50 行 `method in {"GET","HEAD"} and len(parts) >= 2`，正确放行图片资源、收紧 favorites/recent 等单段路径 |
| A6 | chat.ts/session.ts localStorage 清理 | ✅ 正确 | `cleanupOrphanedCaches` 用 `keysToRemove` 数组先收集后删除，避免遍历中修改 |
| A7 | env_vars.py 批量更新跳过未知 key | ✅ 正确 | 第 135-136 行 `if item.key not in ENV_VAR_META: continue`，不再因单个未知 key 失败 |
| B1-B5 | 其他 bug 修复 | ✅ 正确 | 已逐一确认 |

**方向 A 结论**: 蓝队第一轮 9 个修复均正确到位，未发现遗漏端点、误杀或正则过宽问题。本轮方向 A 得 0 分。

---

## 方向 B：新发现 Bug

### Bug B1（中-高级）：WebSocket 聊天限流基础设施为死代码，per-session 限流完全缺失

**定位**:
- 定义位置：`api/middleware/rate_limit.py` 第 342-430 行
  - `WsSessionRateLimiter` 类（第 342 行）
  - `get_ws_rate_limiter()` 全局单例 getter（第 403 行）
  - `reset_ws_rate_limiter()` 重置函数（第 426 行）
- 缺失调用位置：`api/routes/chat.py` 的 `websocket_chat()` 处理器（第 299 行起）

**问题**:

`rate_limit.py` 模块文档字符串（第 4-5 行）明确声明：

```
WebSocket 消息：在 chat.py 消息循环内使用 per-session TokenBucket
（中间件层无法拦截长连接内的多次消息）
```

`WsSessionRateLimiter` 类有完整的实现（令牌桶、try_consume、错误负载格式化），有完整的测试覆盖（`tests/test_api/test_rate_limit_extra.py` 第 227-261 行 `TestWsSessionRateLimiter` + `TestGetWsRateLimiter` 共 5 个测试），但 **`chat.py` 从未导入或调用 `get_ws_rate_limiter()`**。

通过 Grep 确认：在整个 `api/` 目录中，`WsSessionRateLimiter` / `get_ws_rate_limiter` / `try_consume` 仅在 `rate_limit.py` 自身和测试文件中被引用，**生产代码零调用**。

`RateLimitMiddleware.__call__` 第 251-252 行也明确注释：

```python
if scope["type"] != "http":
    # WebSocket 限流在 chat.py 消息循环内处理，中间件层放行
    return await self.app(scope, receive, send)
```

但 chat.py 的消息循环从未执行任何限流。这意味着单个 WebSocket 客户端可以无限发送 chat 消息，每个消息都会触发 `_stream_turn_sidecar` → `client.call("prompt", ...)`，耗尽 sidecar 的 LLM 配额和计算资源。这是一个 DoS 向量。

**修复**:

在 `api/routes/chat.py` 中：

1. 第 16 行新增导入：
```python
from api.middleware.rate_limit import get_ws_rate_limiter
```

2. 第 331-338 行（`websocket_chat` 的 while 循环内，在 `user_message` 非空校验之后、`build_system_prompt()` 之前）新增限流检查：
```python
# Per-session rate limiting — prevent message flooding from
# exhausting sidecar resources. WsSessionRateLimiter is the
# per-session token bucket defined in rate_limit.py; the ASGI
# middleware cannot throttle messages inside a long-lived WS.
allowed, rate_limit_error = get_ws_rate_limiter().try_consume(session_id)
if not allowed:
    await ws.send_json({"type": "error", "payload": rate_limit_error})
    continue
```

**设计要点**:
- 限流检查放在 ping 处理之后（ping 不应被限流）
- 放在 `type == "chat"` 校验之后（非 chat 消息不消耗令牌）
- 放在 `user_message` 非空校验之后（空消息不消耗令牌）
- 超限时发送 `error` 事件并 `continue`（不断开连接，客户端可等待 `retry_after` 后重试）
- 默认配置：capacity=6, refill_rate=0.1（6 条/60 秒），从 settings 读取

### Bug B2（低级）：session_compress 测试与实现契约不匹配，2 个测试长期失败

**定位**:
- 测试位置：`tests/test_api/test_restart_and_compress.py` 第 72-87 行
- 实现位置：`api/routes/session_compress.py` 第 20-63 行

**问题**:

`test_compress_success`（第 72 行）和 `test_fresh_compact_success`（第 83 行）断言：

```python
assert body["compressed"] is True
assert body["method"] == "automatic"   # test_compress_success 第 77 行
```

但 `session_compress.py` 的 `_try_sidecar_compact()` 只会返回以下 `method` 值：
- `"sidecar"` — sidecar 调用成功
- `"unavailable"` — sidecar 未初始化或无映射
- `"degraded"` — sidecar 不支持 compact
- `"error"` — sidecar 调用异常

**永远不会返回 `"automatic"`**。测试 fixture `app_with_session` 也未设置 `app.state.sidecar_manager`，所以端点走的是第 28 行的 `return {"compressed": False, "method": "unavailable", ...}`，断言必然失败。

这两个测试在红队第一轮就已处于失败状态（1785 通过/12 失败/8 错误中的一部分），属于测试-实现契约漂移。

**修复**:

在 `tests/test_api/test_restart_and_compress.py` 中：

1. 新增 `_FakeSidecarClient`、`_FakeSidecarManager`、`_FakeSessionMap` 三个 mock 类（第 57-86 行），模拟 sidecar 成功响应 compact RPC
2. 更新 `app_with_session` fixture（第 90-102 行）：
   - 设置 `app.state.sidecar_manager = _FakeSidecarManager()`
   - 用 `monkeypatch.setattr("api.routes.session_compress.SessionMap", _FakeSessionMap)` 替换 SessionMap，返回非空 sidecar session ID
3. 更新断言：
   - `test_compress_success`：`body["method"] == "sidecar"`（原为 `"automatic"`）
   - `test_fresh_compact_success`：保留 `body["compressed"] is True`（现在能通过）

---

## 统计

### 方向 A（挑蓝队的刺）
| 项目 | 数量 | 得分 |
|------|------|------|
| 审查蓝队修复 | 9 项 | — |
| 发现蓝队修复缺陷 | 0 项 | 0 分 |

**方向 A 总分：0 分**

### 方向 B（新发现 Bug）
| 级别 | 数量 | 得分 |
|------|------|------|
| 高级 | 0 | 0 分 |
| 中级 | 1（B1）| 2 分 |
| 低级 | 1（B2）| 1 分 |

**方向 B 总分：3 分**

### 总分：3 分

---

## 验证结果

### 修复后测试运行

```
.venv\Scripts\python.exe -m pytest \
  tests/test_api/test_chat_routes_extra.py \
  tests/test_api/test_chat_routes_push.py \
  tests/test_api/test_chat_silent_except.py \
  tests/test_api/test_restart_and_compress.py \
  tests/test_api/test_rate_limit_extra.py \
  tests/test_api/test_rate_limit_push.py \
  tests/test_api/test_skills_routes.py \
  tests/test_macros_routes.py \
  tests/test_api/test_auth_middleware.py \
  tests/test_api/test_upload.py
```

**结果：164 passed in 2.43s**

关键验证点：
- ✅ `test_restart_and_compress.py::TestSessionCompress::test_compress_success` — 从失败转为通过
- ✅ `test_restart_and_compress.py::TestSessionCompress::test_fresh_compact_success` — 从失败转为通过
- ✅ `test_rate_limit_extra.py::TestWsSessionRateLimiter` 5 个测试 — 仍通过（限流基础设施未受影响）
- ✅ `test_chat_routes_extra.py::TestWebSocketChat` 14 个测试 — 全部通过（限流接入未破坏现有 WS 流程）
- ✅ `test_skills_routes.py` 24 个测试 — 全部通过（蓝队 A4 修复未受影响）
- ✅ `test_macros_routes.py` — 全部通过（蓝队 A1 修复未受影响）
- ✅ `test_auth_middleware.py` — 全部通过（蓝队 A5 修复未受影响）
- ✅ `test_upload.py` — 全部通过（蓝队 A3 修复未受影响）

### 限流接入无回归说明

chat.py 的限流检查放在 `user_message` 非空校验之后，默认容量 6 条/60 秒。现有测试每个 session_id 最多发送 1 条 chat 消息（不同测试用不同 session_id：s1-s8），不会触发限流。非 chat 消息（ping、invalid JSON、non-dict、empty message）不消耗令牌。

---

## 修改文件清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `api/routes/chat.py` | 新增导入 + 新增限流逻辑 | 第 16 行导入 `get_ws_rate_limiter`；第 331-338 行接入 per-session 限流 |
| `tests/test_api/test_restart_and_compress.py` | 新增 mock + 更新断言 | 新增 3 个 mock 类；更新 fixture 和 2 个测试的断言 |

未提交 git commit（遵守约束）。
