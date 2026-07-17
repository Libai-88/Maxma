# 计划：补齐 Provider 管理端点（CRUD + 测试 + 发现模型）

- 日期：2026-07-17
- 作者：独立后端工程师（sub-agent）
- 工作目录：`d:\Maxma\MaxmaHere`
- 分支：`feat/omp-native-refactor-phase1`

## 1. 背景与目标

前端 `ProvidersView.vue` 通过 `web/src/api/index.ts` 调用 9 个 provider 端点，但后端
`api/routes/providers.py` 仅实现 `GET /providers`（返回硬编码列表），缺失 8 个端点。

本计划补齐以下端点，使用 YAML 持久化（`app_paths.PROVIDERS_YAML_PATH`），保持向后兼容。

| # | 端点 | 前端方法 | 现状 |
|---|---|---|---|
| 1 | `GET /providers` | `listProviders` | ✅ 已实现（硬编码），需改为 yaml 读取 |
| 2 | `POST /providers` | `createProvider` | ❌ 缺失 |
| 3 | `GET /providers/{id}` | `getProvider` | ❌ 缺失 |
| 4 | `PUT /providers/{id}` | `updateProvider` | ❌ 缺失 |
| 5 | `DELETE /providers/{id}` | `deleteProvider` | ❌ 缺失 |
| 6 | `POST /providers/test` | `testConnection` | ❌ 缺失 |
| 7 | `POST /providers/discover-models` | `discoverModels` | ❌ 缺失 |
| 8 | `POST /providers/{id}/test` | `testExistingProvider` | ❌ 缺失 |
| 9 | `POST /providers/{id}/discover-models` | `discoverModelsForExisting` | ❌ 缺失 |

## 2. 现状调研结论

### 2.1 现有 `api/routes/providers.py`

- 仅 `GET /providers`，返回 6 个硬编码 provider（openai/anthropic/deepseek/google/openrouter/ollama）。
- 字段：`id, label, models, context_window`（无 `provider_type / api_key / base_url / enabled`）。

### 2.2 `app_paths.PROVIDERS_YAML_PATH`

- `app_paths.py:82` → `API_DATA_DIR / "providers.yaml"`
- 开发模式：`d:\Maxma\MaxmaHere\api\data\providers.yaml`
- 打包模式：`%APPDATA%/MaxmaHere/api/data/providers.yaml`
- 文件可能不存在（首次运行）。

### 2.3 `api/yaml_store.py` 工具

- `load_yaml(path, default=None)` — 文件不存在/为空/解析失败 → 返回 `default`
- `dump_yaml_atomic(path, data)` — 原子写入（tempfile + os.replace + fsync）
- `yaml_file_lock(path, timeout=5)` — 上下文管理器，进程内 `threading.Lock` + 跨进程 `portalocker`

### 2.4 参考 `api/routes/mcp.py`

模块级常量 `MCP_YAML_PATH = MCP_CONFIG_PATH`，便于测试通过 `monkeypatch.setattr` 替换。
读写均包裹在 `with yaml_file_lock(MCP_YAML_PATH):` 内。`_load_raw()` / `_save_raw()` 辅助函数。

### 2.5 前端类型（`web/src/types/provider.ts`）

```ts
interface ProviderConfig {
  id: string
  provider_type: string
  label: string
  api_key: string
  base_url: string
  models: string[]
  enabled: boolean
  context_window?: number
  priority?: number
  health_status?: 'ok' | 'degraded' | 'error' | 'unknown'
  // …其他 health_* 运行时字段（未持久化）
}
interface TestConnectionResponse {
  status: 'ok' | 'error'
  latency_ms: number | null
  detail: string | null
  reason_code?: string | null
  // …其他可选字段
}
interface DiscoverModelsResponse { models: string[] }
```

### 2.6 前端 API 调用（`web/src/api/index.ts:295-340`）

- `testConnection({ api_key, base_url, provider_type? })` → `POST /providers/test`
- `discoverModels({ api_key, base_url, provider_type? })` → `POST /providers/discover-models`
- `testExistingProvider(id)` → `POST /providers/{id}/test`（无 body）
- `discoverModelsForExisting(id)` → `POST /providers/{id}/discover-models`（无 body）

### 2.7 现有测试

- `tests/test_api/test_providers_routes.py` 测试 `GET /providers` 返回 6 个硬编码 provider
  （含 `openai/anthropic/deepseek/google/openrouter/ollama`），每个有 `label/models/context_window`。
- **必须保持该测试通过**：yaml 为空时 fallback 到硬编码默认列表。

### 2.8 依赖

- `httpx>=0.27.0` 已在 `pyproject.toml` 中。
- `portalocker` / `pyyaml` 已在依赖中。

## 3. 设计

### 3.1 YAML 文件格式

```yaml
providers:
  - id: deepseek
    provider_type: openai
    label: DeepSeek
    api_key: sk-xxx
    base_url: https://api.deepseek.com/v1
    models:
      - deepseek-chat
      - deepseek-reasoner
    enabled: true
    context_window: 64000
```

顶层 key 固定为 `providers`（list）。文件不存在或为空时视为 `[]`。

### 3.2 模块结构（`api/routes/providers.py`）

```python
PROVIDERS_YAML_PATH = app_paths.PROVIDERS_YAML_PATH  # 模块级常量，便于 monkeypatch

_DEFAULT_PROVIDERS = [ ... ]  # 硬编码 fallback 列表（保留现有 6 项）

def _load_providers() -> list[dict]: ...
def _save_providers(items: list[dict]) -> None: ...
def _find_provider(items, provider_id) -> dict | None: ...

# 端点
@router.get("/providers")
@router.post("/providers")
@router.get("/providers/{id}")
@router.put("/providers/{id}")
@router.delete("/providers/{id}")
@router.post("/providers/test")
@router.post("/providers/discover-models")
@router.post("/providers/{id}/test")
@router.post("/providers/{id}/discover-models")
```

### 3.3 关键决策

1. **GET /providers fallback**：yaml 文件不存在或 `providers` 为空 → 返回硬编码 `_DEFAULT_PROVIDERS`。
   保持 `tests/test_api/test_providers_routes.py` 通过。

2. **POST/PUT/DELETE 严格走 yaml**：写操作不触发 fallback。若 yaml 为空则视为 `[]`。

3. **POST /providers/test 与 /discover-models 不真正调用 LLM**：
   - `/test`：`GET {base_url}/models`（OpenAI 兼容），10s 超时，测延迟；任何异常返回
     `{status:"error", latency_ms:null, detail:str(e)}`。
   - `/discover-models`：`GET {base_url}/models`，解析 `data[].id`，异常返回 `{models:[]}`。
   - 使用 `httpx.Client`（同步），不阻塞事件循环太久（10s 上限）。

4. **POST /providers/{id}/test 与 /{id}/discover-models**：先从 yaml 读取 provider
   （不存在 → 404），再复用上面两个端点的核心逻辑。

5. **Pydantic 模型**：用 `ProviderCreateBody` / `ProviderUpdateBody` /
   `TestConnectionBody` / `DiscoverModelsBody` 显式声明请求体，避免 dict 弱类型。
   - `ProviderCreateBody`：`id` 必填，其他字段可选，由后端补默认值。
   - `ProviderUpdateBody`：所有字段可选（`model_dump(exclude_unset=True)` 做部分更新）。

6. **并发安全**：所有读写 yaml 的端点用 `with yaml_file_lock(PROVIDERS_YAML_PATH):` 包裹。

7. **测试隔离**：用 `monkeypatch.setattr(providers_mod, "PROVIDERS_YAML_PATH", tmp_path/"providers.yaml")`
   覆盖路径常量，避免污染真实数据目录。

## 4. 实施步骤（TDD）

每步先写测试再实现，每完成 2-3 个端点提交一次。

### Step A：重写 `GET /providers`（TDD）

- 测试：`tests/test_providers_routes.py::test_list_fallback_when_yaml_missing` — yaml 不存在时返回 6 个默认 provider。
- 测试：`test_list_returns_yaml_data_when_present` — yaml 有数据时返回 yaml 内容。
- 实现：`_load_providers()` + `_DEFAULT_PROVIDERS` + `list_providers()`。

提交点 1：`feat(providers): rewrite GET /providers to read from yaml with hardcoded fallback`

### Step B：`POST /providers`（创建）

- 测试：`test_create_provider_success` — 创建 deepseek provider，返回完整对象，yaml 持久化。
- 测试：`test_create_provider_duplicate_id_409`。
- 测试：`test_create_provider_defaults` — 未传 enabled/provider_type 时补默认值。
- 实现：`ProviderCreateBody` + `create_provider()`。

提交点 2：`feat(providers): add POST /providers (create) with id uniqueness check`

### Step C：`GET/PUT/DELETE /providers/{id}`

- 测试：`test_get_provider_by_id` / `test_get_provider_404`。
- 测试：`test_update_provider_partial` / `test_update_provider_404`。
- 测试：`test_delete_provider_success` / `test_delete_provider_404`。
- 实现：三个端点 + `_find_provider()`。

提交点 3：`feat(providers): add GET/PUT/DELETE /providers/{id}`

### Step D：`POST /providers/test` 与 `/discover-models`

- 测试：用 `httpx.MockTransport` 模拟 `/models` 响应。
  - `test_test_connection_ok` — 200 响应，返回 latency_ms。
  - `test_test_connection_network_error` — 异常 → status:error。
  - `test_discover_models_ok` — 返回 model id 列表。
  - `test_discover_models_error_returns_empty` — 异常 → models:[]。
- 实现：`TestConnectionBody` / `DiscoverModelsBody` + 两个端点。
  - 内部辅助：`_http_get_models(base_url, api_key)` 返回 `(status, latency_ms, detail, models)`。

提交点 4：`feat(providers): add POST /providers/test and /providers/discover-models`

### Step E：`POST /providers/{id}/test` 与 `/{id}/discover-models`

- 测试：`test_test_existing_provider_uses_yaml_config` / `test_test_existing_provider_404`。
- 测试：`test_discover_models_for_existing_provider` / `test_discover_models_for_existing_404`。
- 实现：两个端点，复用 Step D 的 `_http_get_models()`。

提交点 5：`feat(providers): add POST /providers/{id}/test and /{id}/discover-models`

### Step F：最终验证

- `pytest tests/test_providers_routes.py -v`
- `pytest tests/ -q`（确认无回归，特别是 `tests/test_api/test_providers_routes.py` 仍通过）
- `ruff check api/routes/providers.py`

提交点 6（如需修复）：`test/chore` 提交。

## 5. 风险与约束

- **不修改其他文件**：仅触碰 `api/routes/providers.py`、`tests/test_providers_routes.py`、本计划文件。
- **保持 `tests/test_api/test_providers_routes.py` 通过**：靠 GET fallback 实现。
- **不真正调用 LLM**：test/discover-models 只请求 `/models` 端点。
- **httpx 同步客户端**：在 async 端点中调用同步 httpx 会阻塞事件循环，但 10s 超时可接受；
  若需更严谨可改用 `httpx.AsyncClient`。本计划采用 `httpx.AsyncClient` 以与 FastAPI async 端点一致。

## 6. 验收清单

- [ ] 9 个端点全部实现并通过测试
- [ ] `pytest tests/test_providers_routes.py -v` 全绿
- [ ] `pytest tests/ -q` 无回归
- [ ] `ruff check api/routes/providers.py` 无错误
- [ ] 至少 5 个语义化提交
- [ ] GET /providers 在 yaml 缺失时返回硬编码默认列表（向后兼容）
