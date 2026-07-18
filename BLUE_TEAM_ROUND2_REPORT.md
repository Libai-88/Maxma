# 蓝队第二轮报告

## 策略选择

本轮蓝队采取 **A+B 混合策略**：

- **方向 A（挑红队的刺）**：审查红队第二轮的两项工作 —— WS rate limiter 接入 `chat.py` 与 compress 测试 mock 准确性。
- **方向 B（找新 bug）**：在未审查的后端模块（`activity_hub`、`diagnostics`、`transcripts`、`files`、`kb`、`memory`、`autonomy`、`deferred_runs`、`event_hooks`、`audit_log`、`balance`、`sticker_upload`、`mcp`、`workflows`、`skills`、`providers`、`persona`、`sessions`、`tools`、`session_manager`、`ws_registry`、`ws_event_mapper`、`credential_envelope`）、前端组件（`ModelSelector`、`HealthPanel`、`DsSelect`、stores/composables）中寻找新 bug。

每项 bug 均精准定位（文件:行号），已用 Edit 工具实际修复，并跑测试验证未引入回归。

---

## 挑红队的刺 (方向 A, 5分/个)

### A-1：WS rate limiter 接入 `chat.py` — ✅ 正确

**审查位置**：`api/routes/chat.py:331-338`

```python
# Per-session rate limiting
allowed, rate_limit_error = get_ws_rate_limiter().try_consume(session_id)
if not allowed:
    await ws.send_json({"type": "error", "payload": rate_limit_error})
    continue
```

**审查结论**：红队本轮接入正确，无可挑剔。

| 检查项 | 结果 | 说明 |
|---|---|---|
| 接入位置 | ✅ | 位于 `ping` 处理（line 317-319）之后、消息类型校验（line 321-322）之后、payload 解析之后。ping 消息不被限流，保证心跳正常。 |
| 限流维度 | ✅ | 使用 `session_id`（per-session）而非 IP。WS 长连接内同一 IP 可能有多 session，per-session 是正确的限流粒度。 |
| 响应格式 | ✅ | `{"type": "error", "payload": rate_limit_error}` 与前端 `useChat.ts` 的 `case 'error'` 处理一致。`make_error()` 返回的 payload 含 `code`/`message`/`category`/`details` 四字段，前端能正确识别 `category: "rate_limit"`。 |
| ping 豁免 | ✅ | `continue` 在 ping 分支后执行，限流代码不会处理 ping。 |
| 超限后行为 | ✅ | `continue` 跳过本轮消息处理，不消耗 sidecar 资源，WS 连接保持。 |

**红队此项工作无缺陷，蓝队不扣分。**

---

### A-2：compress 测试 mock 准确性 — ✅ 准确

**审查位置**：`tests/test_api/test_restart_and_compress.py:57-63`

```python
class _FakeSidecarClient:
    """Mock sidecar client — returns success for compact RPC."""
    async def call(self, method, params):
        if method == "compact":
            return {"compressed": True, "removed_count": 5, "detail": "压缩完成"}
        raise Exception(f"Unknown method: {method}")
```

**审查结论**：mock 与实现一致，准确无误。

**对照实现** `api/routes/session_compress.py:42-48`：

```python
result = await client.call("compact", {"session_id": sidecar_sid})
return {
    "compressed": result.get("compressed", True),
    "method": "sidecar",
    "removed_count": result.get("removed_count"),
    "detail": result.get("detail", "压缩完成"),
}
```

| mock 字段 | 实现读取方式 | mock 值 | 匹配 |
|---|---|---|---|
| `compressed` | `result.get("compressed", True)` | `True` | ✅ |
| `removed_count` | `result.get("removed_count")` | `5` | ✅ |
| `detail` | `result.get("detail", "压缩完成")` | `"压缩完成"` | ✅ |
| `method` | 实现硬编码 `"sidecar"` | 测试断言 `body["method"] == "sidecar"` | ✅ |

mock 返回的三个字段被实现通过 `.get()` 读取，默认值与 mock 值一致；`method` 字段由实现硬编码为 `"sidecar"`，测试断言正确。

**红队此项工作无缺陷，蓝队不扣分。**

---

## 新发现 bug (方向 B)

### 高优先级 (3分)

#### B-H1：`skills.py toggle_skill` 对 builtin skill 直接 rename 只读文件，导致 500 错误

**文件:行号**：`api/routes/skills.py:208-224`（修复前）

**Bug 描述**：

`toggle_skill` 端点切换 skill 启用/禁用状态时，直接对 `found_path` 所在目录做 `rename`。但当 skill 来自 builtin 目录（`ANTHROPIC_SKILLS_DIR`，打包内置只读）时，`found_path` 指向 builtin 文件，`rename` 会抛 `PermissionError`/`OSError: [Errno 30] Read-only file system`。

**根因**：

`_find_skill()` 对 user 目录未命中时回退到 builtin。`toggle_skill` 拿到 `found_path` 后直接 `found_path.parent / "SKILL.md"` → builtin 目录，`rename` 到 `SKILL.md.disabled` 仍在 builtin 目录，写入失败。

**对比 `update_skill`**（line 180-185）：后者明确处理了 builtin 提升逻辑 —— 先将内容拷贝到 `SKILLS_DATA_DIR / skill_id / SKILL.md`，再写入。`toggle_skill` 缺失这一步。

**复现路径**：

1. 用户安装 Maxma，builtin skills 目录含 `my-skill/SKILL.md`
2. 用户调用 `POST /api/skills/my-skill/toggle` 禁用该 skill
3. 后端尝试 `builtin/my-skill/SKILL.md.rename(builtin/my-skill/SKILL.md.disabled)`
4. PyInstaller 打包后 builtin 目录只读 → `OSError` → 500 Internal Server Error

**修复**（已用 Edit 工具应用）：

builtin skill 走单独分支：读取 builtin 内容，写入 user 目录的目标文件（toggle 后的扩展名），builtin 文件保持不动。后续 `_find_skill` 因 user 目录命中而不再回落到 builtin。

```python
if found_source == "builtin":
    content = found_path.read_text("utf-8")
    user_dir = SKILLS_DATA_DIR / name
    user_dir.mkdir(parents=True, exist_ok=True)
    target_path = user_dir / ("SKILL.md.disabled" if enabled else "SKILL.md")
    target_path.write_text(content, "utf-8")
    return {"name": name, "enabled": not enabled}
```

**验证**：`tests/test_api/test_skills_routes.py` 全部 18 项测试通过。

---

### 中优先级 (2分)

#### B-M1：`workflows.py cancel_workflow` 缺少 None 防御，`manager.store.get()` 返回 None 时崩溃

**文件:行号**：`api/routes/workflows.py:147-152`（修复前）

**Bug 描述**：

`cancel_workflow` 在 `await manager.cancel(run_id)` 后重新加载 run：`run = manager.store.get(run_id)`。若 cancel 过程中 run 被并发删除或 store 实现将 cancelled run 移除，`run` 为 `None`，随后 `_public_run(run, ...)` 访问 `run.run_id` 抛 `AttributeError: 'NoneType' object has no attribute 'run_id'`，返回 500 而非结构化错误。

**对比 `deferred_runs.py`**（line 109-111）：

```python
run = manager.store.get(run_id, parent_session_id=session_id)
if run is None:  # Defensive: the durable row must not disappear mid-request.
    raise HTTPException(status_code=404, detail="Deferred run not found")
```

`deferred_runs.py` 有防御性 None 检查，`workflows.py` 缺失。同类端点应保持一致的防御级别。

**修复**（已用 Edit 工具应用）：

```python
if run.status in {"queued", "running"}:
    await manager.cancel(run_id)
    run = manager.store.get(run_id)
    if run is None:  # Defensive: the durable row must not disappear mid-request.
        raise HTTPException(status_code=404, detail="Workflow run not found")
return _public_run(run, manager.store.list_steps(run.run_id))
```

同时将 `list_steps(run_id)` 改为 `list_steps(run.run_id)`，与 `get_workflow`（line 143）保持一致，避免 URL 参数与对象字段的不一致隐患。`resume_workflow` 同步修正 `list_steps(refreshed.run_id)`。

**验证**：`tests/test_api/test_workflows_routes.py` + `test_workflows_routes_enabled.py` 全部 41 项测试通过。

---

### 低优先级 (1分)

#### B-L1：`files.py select_file` 使用已废弃的 `asyncio.get_event_loop()`

**文件:行号**：`api/routes/files.py:79`（修复前）

**Bug 描述**：

```python
loop = asyncio.get_event_loop()
path = await loop.run_in_executor(None, _open_dialog)
```

Python 3.10+ 中 `asyncio.get_event_loop()` 在无运行中事件循环时会发出 `DeprecationWarning`，Python 3.12+ 在主线程外会抛 `RuntimeError`。项目工程约定明确要求「Scheduler tasks must use `asyncio.get_running_loop()` instead of deprecated `asyncio.get_event_loop()`」（见项目 memory）。

**修复**（已用 Edit 工具应用）：

```python
loop = asyncio.get_running_loop()
```

在 async 端点内 `get_running_loop()` 总是可用且无废弃警告。

**验证**：`tests/test_api/test_files.py` + `test_files_dpi_scaling.py` + `test_files_extra.py` 全部 17 项测试通过。

---

#### B-L2：`sticker_upload.py delete_custom_sticker` TOCTOU 竞态，`unlink` 缺少 `missing_ok`

**文件:行号**：`api/routes/sticker_upload.py:151-154`（修复前）

**Bug 描述**：

```python
if not file_path.exists():       # check
    raise HTTPException(404, ...)
file_path.unlink()               # use — 期间文件可能被另一请求删除
```

`exists()` 检查与 `unlink()` 之间存在 TOCTOU 窗口。若并发请求先删除该文件，`unlink()` 抛 `FileNotFoundError` → 500。虽然概率低，但属于可避免的竞态。

**修复**（已用 Edit 工具应用）：

```python
file_path.unlink(missing_ok=True)
```

`exists()` 检查保留用于 404 响应（用户友好），`unlink(missing_ok=True)` 兜底竞态。

**验证**：`tests/test_api/test_sticker_upload.py` + `test_sticker_upload_extra.py` 全部 20 项测试通过。

---

## 统计

| 维度 | 数量 |
|---|---|
| 方向 A 审查项 | 2 |
| 方向 A 挑刺成功（红队缺陷） | 0（红队两项工作均正确） |
| 方向 B 发现 bug | 4 |
| - 高优先级 | 1（B-H1） |
| - 中优先级 | 1（B-M1） |
| - 低优先级 | 2（B-L1, B-L2） |
| 已实际修复（Edit 工具） | 4 |
| 修复涉及文件 | `api/routes/skills.py`, `api/routes/workflows.py`, `api/routes/files.py`, `api/routes/sticker_upload.py` |
| 本轮新增得分 | 3 + 2 + 1 + 1 = **7 分** |

---

## 验证结果

### 测试运行

```
.venv\Scripts\python.exe -m pytest --tb=short
```

**结果**：`1820 passed, 4 failed, 7 skipped in 22.83s`

4 项失败均为**修复前已存在的 pre-existing failures**，与本轮改动无关：

| 失败测试 | 原因 | 是否本轮引入 |
|---|---|---|
| `test_mcp_routes.py::TestListServerTools::test_returns_empty_tools` | 实现返回多一个 `note` 字段，测试断言未更新 | ❌ pre-existing |
| `test_sidecar_manager_extra.py::TestResolveBunPath::test_default_bun_path_is_absolute` | `_DEFAULT_BUN_PATH` 非绝对路径 | ❌ pre-existing |
| `test_providers_routes.py::TestCreateProvider::test_create_provider_success` | 加密后 `api_key` 为 `encv1:...`，测试期望明文 `sk-xxx` | ❌ pre-existing（任务描述已注明） |
| `test_providers_routes.py::TestUpdateProvider::test_update_provider_partial` | 同上，期望 `sk-new` | ❌ pre-existing（任务描述已注明） |

### 修复文件测试明细

| 修复文件 | 关联测试 | 结果 |
|---|---|---|
| `api/routes/skills.py` | `tests/test_api/test_skills_routes.py` (18 项) | ✅ 全通过 |
| `api/routes/workflows.py` | `tests/test_api/test_workflows_routes.py` (17 项) + `test_workflows_routes_enabled.py` (24 项) | ✅ 全通过 |
| `api/routes/files.py` | `tests/test_api/test_files.py` (5 项) + `test_files_dpi_scaling.py` (6 项) + `test_files_extra.py` (6 项) | ✅ 全通过 |
| `api/routes/sticker_upload.py` | `tests/test_api/test_sticker_upload.py` (15 项) + `test_sticker_upload_extra.py` (5 项) | ✅ 全通过 |

**结论**：4 项修复均未引入任何回归，全部测试结果与修复前一致（1820 passed, 4 pre-existing failures）。

---

## 审查覆盖范围（未发现 bug 的区域）

以下区域已审查但未发现可修复 bug，记录以避免重复审查：

- **后端 stub 路由**：`event_hooks.py`、`audit_log.py`、`autonomy.py`、`kb.py`、`memory.py` —— 均为 404/503 stub，无逻辑 bug。
- **`deferred_runs.py`**：cancel 端点有正确 None 防御，audit 端点有 ImportError 兜底。
- **`transcripts.py`**：路径穿越防护完整（regex + normpath + resolve + startswith）。
- **`providers.py`**：加密逻辑正确，`_get_or_create_fernet_key` 在 async 单线程下无竞态（无 await 间隙）。
- **`mcp.py`**：env 黑名单校验在 create/update 双路径执行，transport 校验完整。
- **`session_manager.py`**：cleanup_expired 在锁内完成，delete 在锁外 cancel 任务避免死锁。
- **`ws_registry.py`**：RLock 保护，register/unregister/get 三方法均线程安全。
- **`ws_event_mapper.py`**：validate_event + enrich_event + make_*_event 辅助函数均正确。
- **`credential_envelope.py`**：versioned envelope 编解码正确，base64 padding 处理合规。
- **`chat.py`**：WS rate limiter 接入位置、ping 豁免、error 格式均正确（见 A-1）。
- **前端 stores**：`session.ts`（cleanupOrphanedCaches 空列表防御）、`chat.ts`、`health.ts`（fast→slow polling 切换逻辑正确）、`activity.ts`（SSE 降级轮询 + intentionalClose 标记）。
- **前端组件**：`ModelSelector.vue`、`HealthPanel.vue`、`DsSelect.vue`（groupedOptions 聚合、aria 属性、rafThrottle）均无 bug。
- **`activity_hub.py rehydrate_orphans`**：虽是返回 0 的 stub，但未被生产代码调用（仅测试引用），属 dead code，不构成可触发 bug。

---

## 本轮总结

- **红队第二轮工作质量高**：WS rate limiter 接入与 compress 测试 mock 两项均无缺陷，蓝队方向 A 未得分。
- **蓝队方向 B 得分 7 分**：发现并修复 4 个真实 bug（1 高 + 1 中 + 2 低），全部精准定位、实际修复、测试验证通过。
- **累计比分**（假设红队本轮也得分）：蓝队本轮 +7 分，继续扩大领先优势。
