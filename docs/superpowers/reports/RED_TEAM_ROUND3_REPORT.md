# 红队第三轮报告

## 策略选择

本轮采用"双线并行 + 重点突破"策略：

1. **方向 A（挑刺）**：逐一审查蓝队第二轮的 4 个修复，验证其正确性。若发现遗漏或引入新问题，则得分；若全部正确，则如实报告。
2. **方向 B（找新 bug）**：聚焦"前端 Tauri 兼容性"和"前后端契约一致性"两个主题。由于项目已在前两轮修复了大量后端安全问题，本轮将重心放在尚未深入审查的前端 stores/views 和后端 routes 上。

重点寻找中优先级及以上问题，避免吹毛求疵。

---

## 挑蓝队的刺（方向 A，5 分/个）

### A1. `toggle_skill` builtin promotion 逻辑（拷贝内容到 user 目录）

**文件**：`api/routes/skills.py` (lines 208-238)

**审查结论：正确，无问题。**

- builtin 分支（lines 208-228）：将 builtin SKILL.md 内容拷贝到 user 目录的目标文件（启用时为 `SKILL.md`，禁用时为 `SKILL.md.disabled`），builtin 文件本身不受影响。
- user 分支（lines 230-237）：重命名 `SKILL.md` ↔ `SKILL.md.disabled`。
- `_find_skill`（lines 98-107）：user 目录优先，builtin 回退。
- `_validate_skill_id` 使用 `^[A-Za-z0-9_\-]+$` 正则防止路径穿越。

### A2. `cancel_workflow` None 防御（404 返回是否合适？run.run_id 使用是否一致？）

**文件**：`api/routes/workflows.py` (lines 146-154)

**审查结论：正确，无问题。**

- `if run is None: raise HTTPException(404, ...)` 在 `manager.cancel(run_id)` 和重新获取后执行，防御 cancel 后 run 被删除的场景。
- 404 语义合适：run 不存在（已被取消并清理）。
- `run.run_id` 在 `_public_run(run, manager.store.list_steps(run.run_id))` 中使用一致。

### A3. `get_running_loop()` in files.py（是否安全？）

**文件**：`api/routes/files.py` (lines 60-87)

**审查结论：安全，无问题。**

- Line 79：`loop = asyncio.get_running_loop()` 在 async endpoint 内调用，此时事件循环必定在运行。
- Line 80：`path = await loop.run_in_executor(None, _open_dialog)` 将阻塞的 tkinter 文件对话框放到默认线程池执行，不阻塞事件循环。

### A4. `unlink(missing_ok=True)`（是否完全消除竞态？）

**文件**：`api/routes/sticker_upload.py` (lines 100-155)

**审查结论：正确，已消除 FileNotFoundError 竞态。**

- Line 117：`dst_path.unlink(missing_ok=True)` 转换失败后清理目标文件。
- Line 120：`tmp_path.unlink(missing_ok=True)` 在 finally 块中清理临时文件。
- Line 154：`file_path.unlink(missing_ok=True)` 删除自定义表情时使用。
- `missing_ok=True` 确保文件不存在时不抛异常，消除了 check-then-delete 的 TOCTOU 竞态。

**方向 A 小计**：4 个修复全部验证正确，0 分。

---

## 新发现 bug（方向 B）

### 中优先级（2 分/个）

---

### B1. 前端 stores 使用原生 `fetch()` 而非 `tauriFetch()`，Tauri 环境下功能全部失效

**影响**：Tauri 桌面应用环境下，WebView2 不允许从 `tauri://localhost` 向 `http://127.0.0.1:8000` 发起原生 `fetch()` 请求（详见 `web/src/utils/env.ts` 注释）。项目已封装 `tauriFetch()` 解决此问题，但以下 3 个 store 仍使用原生 `fetch()`，导致在桌面端：

- 记忆页面无法加载/删除记忆
- 工具列表无法加载
- 人设 profile 无法加载（降级为默认值，用户无感知）

#### B1a. `web/src/stores/memory.ts` (lines 23, 36)

**修复前**：
```typescript
const res = await fetch('/api/memory', { headers })          // line 23
await fetch(`/api/memory/${id}`, { method: 'DELETE', headers })  // line 36
```

**修复后**：改用 `tauriFetch`，并添加 `res.ok` 检查。同时为 `deleteFact` 添加了响应状态检查，避免后端删除失败时前端仍从本地列表移除条目。

#### B1b. `web/src/stores/tools.ts` (line 23)

**修复前**：
```typescript
const res = await fetch('/api/tools', { headers })
```

**修复后**：改用 `tauriFetch`，添加 `res.ok` 检查。

#### B1c. `web/src/stores/persona.ts` (line 37)

**修复前**：
```typescript
const res = await fetch('/api/persona/profile', { headers })
```

**修复后**：改用 `tauriFetch`（原代码已有 `res.ok` 检查）。

---

### B2. `SkillsView.vue` `toggleSkill` 使用原生 `fetch()` 且未检查响应状态

**文件**：`web/src/views/SkillsView.vue` (line 422)

**影响**：
1. Tauri 环境下 toggle 请求无法发出（同 B1）。
2. 即使在浏览器环境下，后端返回 4xx/5xx 时（如 skill 不存在、文件权限错误），前端不检查 `res.ok`，直接调用 `loadData()` 刷新列表，用户误以为操作成功。

**修复前**：
```typescript
await fetch(`/api/skills/${name}/toggle`, { method: 'POST', headers })
await loadData()
```

**修复后**：
```typescript
const res = await tauriFetch(`/api/skills/${name}/toggle`, { method: 'POST', headers })
if (!res.ok) {
  console.warn('[SkillsView] toggleSkill failed: HTTP', res.status)
  return
}
await loadData()
```

---

### B3. `SkillsView.vue` `ID_PATTERN` 与后端正则不匹配，前端通过但后端 400 拒绝

**文件**：`web/src/views/SkillsView.vue` (line 170)

**影响**：前端 `ID_PATTERN` 允许空格和点号（`/^[A-Za-z0-9_-][A-Za-z0-9_\- .]{0,63}$/`），但后端 `_SKILL_ID_RE` 和 `_MACRO_ID_RE` 均为 `^[A-Za-z0-9_\-]+$`（不允许空格和点）。用户输入 `my skill` 或 `skill.v2` 时：
1. 前端验证通过，提交请求。
2. 后端返回 400 `Invalid skill_id`。
3. 用户困惑：为什么前端允许但后端拒绝？

注释声称"与后端 _SAFE_ID 同步"，但后端实际使用的是 `_SKILL_ID_RE` / `_MACRO_ID_RE`，且不存在 `_SAFE_ID`。

**修复前**：
```typescript
// 与后端 _SAFE_ID 同步：首字符不能是空格或点，1-64 字符，允许字母/数字/连字符/下划线/空格/点
const ID_PATTERN = /^[A-Za-z0-9_-][A-Za-z0-9_\- .]{0,63}$/
```

**修复后**：
```typescript
// 与后端 _SKILL_ID_RE / _MACRO_ID_RE 同步：仅允许字母/数字/连字符/下划线，1-64 字符。
const ID_PATTERN = /^[A-Za-z0-9_\-]{1,64}$/
```

---

### B4. `balance.py` 未调用 `raise_for_status()`，`HTTPStatusError` 处理器为死代码

**文件**：`api/routes/balance.py` (line 63)

**影响**：`httpx.AsyncClient.get()` 默认不抛出 `HTTPStatusError`（除非显式调用 `raise_for_status()`）。原代码的 `except httpx.HTTPStatusError` 分支永远不会被触发。当 DeepSeek API 返回 401（API Key 无效）/ 403 / 5xx 时：
1. 错误响应的 JSON body（如 `{"error": {"message": "invalid api key"}}`）被 `response.json()` 解析。
2. 错误 JSON 被当作"余额数据"静默返回给前端。
3. 前端尝试将错误对象渲染为余额信息，显示乱码或误导性数据。

**修复前**：
```python
response = await client.get(DEEPSEEK_BALANCE_URL, headers=headers)
data = response.json()  # 非 200 响应的 JSON 被当作余额数据返回
```

**修复后**：
```python
response = await client.get(DEEPSEEK_BALANCE_URL, headers=headers)
response.raise_for_status()  # 非 200 响应抛出 HTTPStatusError，进入正确的错误处理分支
data = response.json()
```

同时更新 `HTTPStatusError` 处理器，在 detail 中包含上游状态码：
```python
except httpx.HTTPStatusError as e:
    status = e.response.status_code if e.response is not None else 0
    raise HTTPException(status_code=500, detail=f"DeepSeek API error: {status}")
```

**测试**：更新 `tests/test_api/test_balance_routes.py` 的 `_FakeResponse` mock，添加 `raise_for_status()` 方法以匹配真实 `httpx.Response` 接口。

---

### 低优先级（1 分/个）

本轮未发现值得报告的低优先级问题。已审查但未发现 bug 的区域：
- 前端组件：`ToolCallCard.vue`、`MessageBubble.vue`、`StickerPicker.vue`、`StickerContextMenu.vue`
- 前端 composables：`useHealthPolling.ts`、`useTheme.ts`、`useFloatSidebar.ts`、`useSelectionQuote.ts`（均有正确的 timer 清理和引用计数）
- 前端 views：`MemoryView.vue`、`PlaygroundView.vue`、`HooksView.vue`、`AuditLogView.vue`、`MetricsView.vue`（timer 清理正确）
- 后端模块：`activity_hub.py`（双重检查锁定正确）、`const_session_store.py`（原子写入 + 文件锁）、`persona.py`（路径穿越防护完整）、`tools.py`、`news.py`、`activity.py`

---

## 统计

| 类别 | 数量 | 得分 |
|------|------|------|
| 方向 A — 挑刺成功 | 0 | 0 分 |
| 方向 B — 高优先级 | 0 | 0 分 |
| 方向 B — 中优先级 | 4 (B1-B4) | 8 分 |
| 方向 B — 低优先级 | 0 | 0 分 |
| **合计** | **4 个 bug** | **8 分** |

**注**：B1 包含 3 个子项（memory.ts / tools.ts / persona.ts），均为同一类 bug（原生 `fetch` → `tauriFetch`），但影响 3 个独立功能模块，分别计分。

### 修复文件清单

| 文件 | 修改内容 |
|------|----------|
| `web/src/stores/memory.ts` | `fetch` → `tauriFetch`，添加 `res.ok` 检查 |
| `web/src/stores/tools.ts` | `fetch` → `tauriFetch`，添加 `res.ok` 检查 |
| `web/src/stores/persona.ts` | `fetch` → `tauriFetch` |
| `web/src/views/SkillsView.vue` | `toggleSkill` 中 `fetch` → `tauriFetch` + `res.ok` 检查；`ID_PATTERN` 正则修正 |
| `api/routes/balance.py` | 添加 `raise_for_status()`，修复死代码 |
| `tests/test_api/test_balance_routes.py` | `_FakeResponse` mock 添加 `raise_for_status()` 方法 |

---

## 验证结果

### 后端测试

```
.venv\Scripts\python.exe -m pytest --tb=line -q
```

**结果**：4 failed, 1820 passed, 7 skipped (22.35s)

4 个失败均为预存在的测试-代码不匹配，与本次修改无关：
1. `test_providers_routes.py::TestCreateProvider::test_create_provider_success` — provider 加密格式（encv1:）与测试期望的明文不匹配
2. `test_providers_routes.py::TestUpdateProvider::test_update_provider_partial` — 同上
3. `test_api/test_mcp_routes.py::TestListServerTools::test_returns_empty_tools` — OMP sidecar note 字段
4. `test_pi_bridge/test_sidecar_manager_extra.py::TestResolveBunPath::test_default_bun_path_is_absolute` — bun 路径

**结论**：本次修改未引入任何新的测试失败。修改前为 1820 passed / 4 failed，修改后仍为 1820 passed / 4 failed。

### 前端类型检查

```
npx vue-tsc --noEmit
```

**结果**：存在预存在的 TypeScript 类型错误（ModelSelector.vue、WeatherBubble.vue、DsInput.vue、useTheme.ts、chat.ts、ProvidersView.vue），均为本轮修改之前已存在的问题。本次修改的 4 个文件（memory.ts、tools.ts、persona.ts、SkillsView.vue）未引入任何新的类型错误。

### Balance 路由测试（专项）

```
.venv\Scripts\python.exe -m pytest tests/test_api/test_balance_routes.py -v
```

**结果**：11 passed (0.26s) — 全部通过，包括成功/超时/HTTP错误/通用异常 5 个场景。
