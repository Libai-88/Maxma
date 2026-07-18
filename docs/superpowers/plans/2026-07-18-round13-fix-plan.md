# 第 13 轮修复 — encrypt-keys 端点从 audit-log 迁移到 providers

## 问题背景

第十二轮测试发现：privacy 页面"加密 API 密钥"按钮已从降级逻辑中解耦（始终显示），
但底层端点 `/api/audit-log/encrypt-keys` 随 audit-log 子系统被 OMP 替代而返回 404。
用户点击会失败，提示"加密失败"。

## 调查结论

### 后端现状

- `api/routes/audit_log.py` 文件仍存在但所有端点（`/audit-log`、`/audit-log/stats`、
  `/audit-log/clear`、`/audit-log/encrypt-keys`、`/audit-log/mcp-summary`）都是返回
  404 + `OMP replaces audit subsystem` 消息的 stub。
- 原始 `tools.crypto.encrypt_providers_yaml` 实现已随 `tools/` 目录整体移除（doc
  `了解_Maxma_大迭代_2026-07-16_11-52.md` 第 17099 行残留引用）。
- 项目当前保留的安全原语层 `api/security/credential_envelope.py` 提供：
  - `LEGACY_PREFIX = "enc:"` / `ENVELOPE_PREFIX = "encv1:"`
  - `is_legacy_encrypted(value)` / `is_credential_envelope(value)` 检测函数
  - `create_credential_envelope(plaintext, encrypt_payload=..., algorithm=..., key_id=...)`
    封装函数（要求 `encrypt_payload` 返回 `enc:<ciphertext>` legacy 字符串）
- `requirements.txt` 含 `cryptography==49.0.0`（Fernet 可用）和 `pywin32==312`。
- `app_paths.py` 提供 `PROVIDERS_YAML_PATH = API_DATA_DIR / "providers.yaml"`，
  以及 `API_DATA_DIR` 用于存放密钥文件。

### 前端现状

- `web/src/api/index.ts` 第 592-595 行：
  ```ts
  encryptApiKeys: () =>
    request<{ status: string; encrypted: number }>('/audit-log/encrypt-keys', {
      method: 'POST',
    }),
  ```
  `BASE = getApiBase()` 已包含 `/api` 前缀，故完整 URL 为
  `http://127.0.0.1:8000/api/audit-log/encrypt-keys`。
- `web/src/views/PrivacyView.vue` 第 228-241 行 `encryptKeys()` 仅调用
  `api.encryptApiKeys()` 并展示 `已加密 ${res.encrypted} 个 API 密钥`，无硬编码路径。

### 路由注册

`api/server.py` 第 102 行 `app.include_router(providers.router, prefix="/api")`，
所以 `providers.py` 中 `@router.post("/providers/encrypt-keys")` 实际路径为
`POST /api/providers/encrypt-keys`，与前端 `/providers/encrypt-keys` + BASE `/api`
拼接结果一致。

## 修复方案

### 后端：`api/routes/providers.py`

1. 在文件末尾追加 `POST /providers/encrypt-keys` 端点。
2. 加密原语实现（最小化，内联到 providers.py，不新增模块）：
   - 新增模块级私有函数 `_get_or_create_fernet_key() -> bytes`：
     从 `app_paths.API_DATA_DIR / "credential.key"` 读取或生成 Fernet key。
   - 新增模块级私有函数 `_encrypt_api_key(plaintext: str) -> str`：
     用 Fernet 加密 → base64 → 拼成 `enc:<ct>` → 经
     `create_credential_envelope` 封装为 `encv1:<envelope>` 字符串返回。
3. 端点逻辑：
   - 用 `yaml_file_lock(PROVIDERS_YAML_PATH)` + `_load_providers()` 读取。
   - 遍历每个 provider，若 `api_key` 非空且 `not is_credential_envelope(...) and
     not is_legacy_encrypted(...)` 则加密并计数 +1。
   - 若计数 > 0，用 `_save_providers(items)` 原子写回；否则不写文件。
   - 返回 `{"status": "ok", "encrypted": N}`（N 为本次新加密的数量，幂等）。

### 前端：`web/src/api/index.ts`

将第 593 行 `'/audit-log/encrypt-keys'` 改为 `'/providers/encrypt-keys'`。
保留请求方法（POST）和响应类型（`{ status: string; encrypted: number }`）。

### 不改动项

- `api/routes/audit_log.py` 中的 404 stub 保留（其他 audit-log 端点仍在用）。
- `web/src/views/PrivacyView.vue` 无需改动（按钮已无条件显示，调用
  `api.encryptApiKeys()` 即可命中新端点）。

## 回归验证

1. 备份 `app_paths.PROVIDERS_YAML_PATH`（若存在）到
   `providers.yaml.round13.bak`。
2. 直接 `curl -X POST http://127.0.0.1:8000/api/providers/encrypt-keys` 验证：
   - 返回 200 + `{"status":"ok","encrypted":N}`（不再 404）。
3. 验证 providers.yaml 中 api_key 字段被加密（值以 `encv1:` 开头）。
4. 第二次调用验证幂等（encrypted=0）。
5. **还原**：将备份的 providers.yaml 还原，确保生产配置不受影响。
   若原文件不存在，则删除测试产生的 providers.yaml。

## 后端是否需要重启

`providers.py` 的修改通过 FastAPI 路由表生效。后端若使用 `uvicorn --reload`，
修改会自动热加载。否则需监工重启后端。本修复**仅修改路由文件**，不涉及应用启动
流程；测试时会先尝试直接 curl，若 404 则需监工重启。

## 完成标志

1. 计划文件已写入（本文件）。
2. `api/routes/providers.py` 新增 `POST /providers/encrypt-keys`。
3. `web/src/api/index.ts` 端点路径迁移。
4. `cd web && npm run build` 通过。
5. 实际请求验证返回 200。
6. providers.yaml 已还原。
7. 总结报告 `2026-07-18-round13-fix-report.md` 写入。
