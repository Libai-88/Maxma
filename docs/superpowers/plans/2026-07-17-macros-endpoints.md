# Macros 管理端点补齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 5 个 macros REST 端点（GET/POST/PUT/DELETE），让前端 ChatInput 能正常加载/管理宏。

**Architecture:** 新建 `api/routes/macros.py`，参考 `api/routes/skills.py` 的 APIRouter 模式。复用 `app_paths.MACROS_DIR`（builtin 只读）和 `MACROS_DATA_DIR`（user 可写）两个目录，合并扫描后按 id 去重（user 优先）。Macro 文件格式为 `macros/{name}/MACRO.md`，解析器同时兼容 frontmatter 格式（TS sidecar 创建）和首行标题格式。

**Tech Stack:** FastAPI + APIRouter + pathlib + pytest TestClient + monkeypatch

---

## 现状关键发现

### 路由注册（手动，非自动发现）
`api/server.py:18` 用 `from api.routes import ...` 显式导入，`api/server.py:91-121` 用 `app.include_router(router, prefix="/api")` 逐个注册。**没有 `collect_submodules` 或目录遍历自动发现机制**。

➡️ **需要监工手动在 `api/server.py` 添加两行**（我不允许修改该文件）：
```python
# 在 line 18 附近添加导入：
from api.routes import macros as macros_router
# （或加到现有的多行 import 中）

# 在 line 121 附近添加注册：
app.include_router(macros_router.router, prefix="/api")
```

### Macro 文件格式
TS sidecar (`bun-sidecar/src/tools/config/manage_macros.ts:56`) 创建时用 frontmatter：
```
---
name: "x"
description: "y"
---

content
```
但用户任务描述说"第一行是 description（可能用 `# 标题` 或纯文本）"。两种格式都可能存在，解析器需同时兼容。

### 目录现状
`d:\Maxma\MaxmaHere\macros\` 当前只有 `.gitkeep`（无示例宏），开发模式下 `MACROS_DIR` 与 `MACROS_DATA_DIR` 都指向此目录。

---

## File Structure

| 文件 | 责任 | 操作 |
|---|---|---|
| `api/routes/macros.py` | 5 个 REST 端点 + macro 文件解析/扫描辅助函数 | 新建 |
| `tests/test_macros_routes.py` | TestClient + monkeypatch 测试所有端点 | 新建 |
| `docs/superpowers/plans/2026-07-17-macros-endpoints.md` | 本计划 | 新建 |

**不修改**：`app_paths.py`、`api/server.py`、前端文件、其他路由。

---

## Task 1: 创建计划文件并提交

**Files:**
- Create: `docs/superpowers/plans/2026-07-17-macros-endpoints.md`

- [x] **Step 1: 写计划**（本文件）
- [ ] **Step 2: 提交计划**
```bash
git add docs/superpowers/plans/2026-07-17-macros-endpoints.md
git commit -m "docs: add macros endpoints implementation plan"
```

---

## Task 2: 编写测试文件（TDD — 先写失败测试）

**Files:**
- Create: `tests/test_macros_routes.py`

测试用 `monkeypatch.setattr(macros_mod, "MACROS_DIR", ...)` 和 `MACROS_DATA_DIR` 重定向到 `tmp_path`，与 `test_skills_routes.py` 模式一致。

- [ ] **Step 1: 写测试文件**

覆盖以下场景：
- `TestListMacros`: 空目录 / builtin+user 合并 / user 覆盖 builtin 去重 / 非目录跳过
- `TestGetMacro`: user 优先 / builtin fallback / frontmatter 格式解析 / 首行标题格式解析 / 404
- `TestCreateMacro`: 成功 / name 缺失 400 / 已存在 409 / 写入文件验证
- `TestUpdateMacro`: user 更新 / builtin 提升到 user / 404 / 部分字段更新
- `TestDeleteMacro`: user 删除 / builtin 403 / 不存在 404

- [ ] **Step 2: 运行测试确认失败**
```bash
.venv\Scripts\python.exe -m pytest tests/test_macros_routes.py -v
```
Expected: FAIL（`api.routes.macros` 模块不存在）

- [ ] **Step 3: 提交失败测试**
```bash
git add tests/test_macros_routes.py
git commit -m "test: add failing tests for macros routes (TDD)"
```

---

## Task 3: 实现 macros.py 让测试通过

**Files:**
- Create: `api/routes/macros.py`

- [ ] **Step 1: 实现路由**

核心逻辑：
- `_parse_macro_file(path)`: 兼容 frontmatter（`---\n...\n---\n\ncontent`）和首行标题（`# desc\ncontent`）两种格式
- `_scan_macros(d, source)`: 扫描目录下所有 `{name}/MACRO.md`，返回 MacroInfo 列表
- `GET /macros`: 合并 builtin + user，按 id 去重（user 优先）
- `GET /macros/{id}`: user 优先查找，fallback builtin，返回 MacroDetail
- `POST /macros`: 写入 `MACROS_DATA_DIR/{name}/MACRO.md`，已存在 409
- `PUT /macros/{id}`: 找现有（user 优先），builtin 则提升到 user 目录写入
- `DELETE /macros/{id}`: 仅删 user 目录，builtin 返回 403

- [ ] **Step 2: 运行测试确认通过**
```bash
.venv\Scripts\python.exe -m pytest tests/test_macros_routes.py -v
```
Expected: PASS

- [ ] **Step 3: ruff 检查**
```bash
.venv\Scripts\python.exe -m ruff check api/routes/macros.py
```
Expected: All checks passed

- [ ] **Step 4: 提交实现**
```bash
git add api/routes/macros.py
git commit -m "feat: add macros management REST endpoints"
```

---

## Task 4: 回归验证

- [ ] **Step 1: 全量测试无回归**
```bash
.venv\Scripts\python.exe -m pytest tests/ -q
```
Expected: 无新增失败

- [ ] **Step 2: 最终 ruff 检查**
```bash
.venv\Scripts\python.exe -m ruff check api/routes/macros.py
```

---

## 路由注册交接说明（给监工）

⚠️ **本任务不修改 `api/server.py`**。需监工手动添加：

1. 在 `api/server.py` 顶部 import 区（约 line 18-41）添加：
```python
from api.routes import macros as macros_router
```

2. 在 `create_app()` 的 REST routes 区（约 line 91-121）添加：
```python
app.include_router(macros_router.router, prefix="/api")
```

未注册前，前端调用仍会 404。测试文件直接 `app.include_router(router)` 自建 app，不依赖 server.py 注册，故测试可独立通过。

---

## Self-Review

**1. Spec coverage:**
- GET /macros → Task 3 `list_macros` ✓
- GET /macros/{id} → Task 3 `get_macro` ✓
- POST /macros → Task 3 `create_macro` ✓
- PUT /macros/{id} → Task 3 `update_macro` ✓
- DELETE /macros/{id} → Task 3 `delete_macro` ✓
- 路由注册 → 计划记录，监工手动 ✓
- TDD → Task 2 先失败测试，Task 3 实现 ✓

**2. Placeholder scan:** 无 TBD/TODO，所有步骤含具体代码或命令。

**3. Type consistency:** MacroInfo/MacroDetail 字段名（id/name/description/content/path/source）与前端 types 一致。
