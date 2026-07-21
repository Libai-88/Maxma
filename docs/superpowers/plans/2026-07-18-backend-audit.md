# 后端 API 路由审计计划

> 审计范围：`D:/Maxma/MaxmaHere/api/routes/` 下 33 个 Python 文件（含 `__init__.py`）。
> 原则：只修改 Python 后端文件，不修改前端代码。不改变 API 接口签名。

---

## 一、Stub / 空壳路由审计

### 1.1 `audit_log.py` — 全部 404 ✓ 保持现状
- 5 个端点：`GET /audit-log`, `GET /audit-log/stats`, `POST /audit-log/clear`, `POST /audit-log/encrypt-keys`, `GET /audit-log/mcp-summary`
- 所有返回 `JSONResponse(status_code=404, content={"detail": "Audit log unavailable — OMP replaces audit subsystem"})`
- **结论**：已合理降级，保留不动。

### 1.2 `autonomy.py` — 全部 404 ✓ 保持现状
- 6 个端点：`GET/POST /autonomy/schedules`, `GET /autonomy/schedules/{schedule_id}`, `POST pause/resume`, `DELETE`
- 所有返回 `JSONResponse(status_code=404, content={"detail": "Autonomous Scout schedules are unavailable — OMP replaces autonomy"})`
- **结论**：已合理降级，保留不动。

### 1.3 `event_hooks.py` — 全部 404 ✓ 保持现状
- 7 个端点：list, get, create, update, delete, history, trigger
- 所有返回 `JSONResponse(status_code=404, ...)`
- **注意**：使用了 `async def` 但无 `await`，不影响功能但可标注 `# noqa` 或移除 async
- **结论**：功能上已合理降级，保留不动。

### 1.4 `kb.py` — 全部 503 ✓ 保持现状
- 7 个端点：CRUD + search + URL import
- 使用 `raise HTTPException(status_code=503)` — 比 JSONResponse 更规范
- **结论**：已合理降级，保留不动。

### 1.5 `session_compress.py` — 已修复 ✓ 通过 sidecar 代理
- 通过 `_try_sidecar_compact()` 尝试连接 OMP sidecar
- sidecar 不可用时返回 degraded 状态（非 crash）
- **结论**：已验证 OK。

### 1.6 `news.py` — 功能正常 ✓
- 读取 `NEWS_YAML_PATH`，按日期降序返回
- Pydantic 模型校验 + 类型注解齐全
- **结论**：OK。

---

## 二、portalocker / yaml_file_lock 依赖审计

### 2.1 `api/yaml_store.py` 已有保护
- `_check_portalocker()` 函数实际创建 Lock 实例验证运行时可用性
- 结果缓存到 `_HAS_PORTALOCKER_CACHED`（模块级全局变量）
- portalocker 不可用时降级到 `threading.Lock` — 单进程安全

### 2.2 使用 `yaml_file_lock` 的文件（均已覆盖）

| 文件 | 使用次数 | 状态 |
|------|---------|------|
| `mcp.py` | 8 | ✓ 已保护 |
| `path_whitelist.py` | 4 | ✓ 已保护 |
| `persona.py` | 1 | ✓ 已保护 |
| `providers.py` | 8 | ✓ 已保护 |

### 2.3 未使用 `yaml_store` 的文件（建议修改）

#### 2.3.1 `maxma_blocker.py` — **需要修复**
- 使用 `import yaml` + 原生 `open()` 读写
- 无原子写入（中断写会损坏文件）
- 无文件锁（并发请求可能导致数据竞争）
- **建议**：改为使用 `yaml_store.load_yaml()` / `yaml_store.dump_yaml_atomic()`

#### 2.3.2 `sticker_favorites.py` — **建议修复**
- 自实现了 `_load_yaml_safe()` / `_save_yaml_safe()`
- 无原子写入，无文件锁
- 虽然并发写概率低，但建议统一到 `yaml_store`
- **建议**：改为使用 `yaml_store.load_yaml()` / `yaml_store.dump_yaml_atomic()`

#### 2.3.3 `news.py` — 只读，可以保持
- 只有 `_load_news()` 读取操作，不写文件
- **结论**：OK 不动。

---

## 三、旧进程 / 端口占用

### 3.1 portalocker 锁自动释放
- Windows `LockFileEx` / Linux `fcntl.flock()` 均在进程终止时自动释放
- 旧进程 crash 后留下的 `.lock` 文件不会阻塞新进程

### 3.2 上一轮 `taskkill` 方案
- 已解决 sidecar (Bun) 进程占用端口的问题
- `restart.py` 中开发模式使用 `subprocess.Popen` + `sys.exit(0)` 重启
- 打包模式直接 `sys.exit(0)` 由 Tauri 监控重启

### 3.3 结论
旧进程端口占用问题已彻底解决，无需额外修改。

---

## 四、类型注解审计

### 4.1 严重缺失的文件（建议添加返回类型注解）

FastAPI 路由函数推荐标注返回类型（至少 `-> dict`），利于 IDE 补全和静态分析。

| 文件 | 缺失情况 | 建议 |
|------|---------|------|
| `balance.py` | `get_deepseek_balance` 无返回类型 | 加 `-> dict` |
| `deferred_runs.py` | 4 个端点无返回类型 | 加 `-> dict` |
| `diagnostics.py` | `export_error_log`, `list_log_files`, `cleanup_old_log_files` 等 | 加 `-> dict` |
| `env_vars.py` | `update_env_var`, `batch_update_env_vars` 无返回类型 | 加 `-> dict` |
| `files.py` | `select_file` 无返回类型 | 加 `-> dict` |
| `macros.py` | 全部 5 个端点无返回类型 | 加 `-> dict` |
| `maxma_blocker.py` | `delete_blocker` 无返回类型 | 加 `-> dict` |
| `mcp.py` | 全部端点无返回类型 | 加 `-> dict` |
| `memory.py` | 2 个端点无返回类型 | 加 `-> dict` |
| `metrics.py` | 2 个端点无返回类型 | 加 `-> dict` |
| `path_whitelist.py` | `delete_whitelist`, `check_path_blocked` 无返回类型 | 加 `-> dict` |
| `persona.py` | `create_new_persona`, `get_persona_profile` 等无返回类型 | 加 `-> dict` |
| `restart.py` | `restart_server` 无返回类型 | 加 `-> dict` |
| `sessions.py` | 大部分端点无返回类型 | 加 `-> dict` |
| `skills.py` | 全部端点无返回类型 | 加 `-> dict` |
| `sticker_favorites.py` | 全部端点无返回类型 | 加 `-> dict` |
| `sticker_upload.py` | `list_custom_stickers`, `delete_custom_sticker` 无返回类型 | 加 `-> dict` |
| `stickers.py` | 全部端点无返回类型 | 加 `-> dict` |
| `tool_stats.py` | `list_tools` 无返回类型 | 加 `-> dict` |
| `transcripts.py` | 2 个端点无返回类型 | 加 `-> dict` |
| `upload.py` | 3 个端点无返回类型 | 加 `-> dict` |
| `audit_log.py` | stub 路由无返回类型 | 加 `-> dict`（低优先级） |
| `autonomy.py` | stub 路由无返回类型 | 加 `-> dict`（低优先级） |
| `event_hooks.py` | stub 路由无返回类型 | 加 `-> dict`（低优先级） |
| `kb.py` | stub 路由无返回类型 | 加 `-> dict`（低优先级） |

### 4.2 已有返回类型的文件（无需修改）
- `activity.py` — 已有 `-> dict`
- `chat.py` — WebSocket 端点不需要
- `providers.py` — 多数有 `-> dict[str, Any]`
- `workflows.py` — 多数有 `-> dict[str, object]`
- `session_compress.py` — 已有 `-> dict`
- `news.py` — 有 `response_model`（等价）
- `mcp_test.py` — 有 `response_model` + `-> TestConnectionResponse`
- `env_vars.py` — 部分有 `response_model`（g心态等价）

---

## 五、计划执行的修改

> 所有修改遵循：不改变 API 接口签名，不引入新功能，只做代码质量和安全加固。

### 修改组 A：yaml_store 统一化（2 个文件）

#### A1. `maxma_blocker.py` — 使用 yaml_store
- 将 `import yaml` → `from api.yaml_store import load_yaml, dump_yaml_atomic`
- `_load()` 改用 `load_yaml()`
- `_save()` 改用 `dump_yaml_atomic()`

#### A2. `sticker_favorites.py` — 使用 yaml_store
- `_load_yaml_safe()` → `load_yaml()`
- `_save_yaml_safe()` → `dump_yaml_atomic()`

### 修改组 B：类型注解增强（所有非 stub 路由文件）

对以下 21 个非 stub 文件的路由函数添加 `-> dict` 返回类型注解：
- `balance.py` — 1 个端点
- `deferred_runs.py` — 4 个端点
- `diagnostics.py` — 6 个端点
- `env_vars.py` — 2 个端点
- `files.py` — 1 个端点
- `macros.py` — 5 个端点
- `maxma_blocker.py` — 1 个端点
- `mcp.py` — 10 个端点
- `memory.py` — 2 个端点
- `metrics.py` — 2 个端点
- `path_whitelist.py` — 2 个端点
- `persona.py` — 3 个端点
- `restart.py` — 1 个端点
- `sessions.py` — 12 个端点
- `skills.py` — 6 个端点
- `sticker_favorites.py` — 8 个端点
- `sticker_upload.py` — 2 个端点
- `stickers.py` — 4 个端点
- `tool_stats.py` — 1 个端点
- `transcripts.py` — 2 个端点
- `upload.py` — 3 个端点

**约 78 个端点**需要添加 `-> dict`。

### 不修改的文件
- `activity.py` — 已有类型 ✓
- `chat.py` — WebSocket ✓
- `providers.py` — 已有类型 ✓
- `workflows.py` — 已有类型 ✓
- `news.py` — 有 response_model ✓
- `session_compress.py` — 已有类型 ✓
- `mcp_test.py` — 已有类型 ✓
- 4 个 stub 文件（`audit_log.py`, `autonomy.py`, `event_hooks.py`, `kb.py`）— 低优先级，计划不修改

---

## 六、实施顺序

1. **修改组 A**：`maxma_blocker.py` + `sticker_favorites.py` → yaml_store 统一化
2. **修改组 B**：21 个文件批量添加 `-> dict` 类型注解
3. **验证**：启动测试后端，curl 测试关键端点
4. **输出审计摘要**

---

## 七、验证方案

```bash
# 1. 启动后端（测试模式）
cd D:/Maxma/MaxmaHere
python -m uvicorn main:app --port 14289

# 2. 测试 stub 端点
curl -s http://localhost:14289/api/audit-log
curl -s http://localhost:14289/api/autonomy/schedules
curl -s http://localhost:14289/api/event-hooks
curl -s http://localhost:14289/api/kb/documents

# 3. 测试正常端点
curl -s http://localhost:14289/api/news
curl -s http://localhost:14289/api/macros
curl -s http://localhost:14289/api/sessions

# 4. 测试 yaml_store 路径
curl -s http://localhost:14289/api/mcp/servers
curl -s http://localhost:14289/api/providers
curl -s http://localhost:14289/api/path-whitelist
```
