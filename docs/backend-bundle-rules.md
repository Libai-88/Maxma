# 后端打包规则

> 本文档描述当前 PyInstaller 后端打包边界。实际行为以 `build/maxma-server.spec`、`build/build-server.bat` 和 `build/smoke-test-server.ps1` 为准。

## 必需输入

### Python 代码

- `main.py`
- `api/`
- `agent/`
- `config/`
- `app_paths.py`

Agent 推理由外部 Bun sidecar 执行。Python 后端不再依赖 Agent 图框架或旧 Python Tool 目录作为当前执行路径。

### 运行资源

spec 当前明确收集：

- `web/dist`
- 内置人设模板
- 内置贴纸分类
- `anthropic_skills`
- `macros`
- `bun-sidecar/src`
- `bun-sidecar/package.json`
- `bun-sidecar/node_modules`
- `bun-sidecar/bun.exe`

用户人设、Provider、Token、SQLite、上传文件和日志属于运行时数据，不能递归打入 bundle。

### 动态导入和原生扩展

- `api.pi_bridge.*` 等运行时模块加入 `hiddenimports`
- cffi 原生后端和本地 `.pyd` 由 spec 收集
- `tools/` 中仍被打包流程依赖的动态子模块通过 `collect_submodules("tools")` 收集
- 新增带 `.pyd`、`.dll` 或运行时动态导入的依赖，必须同步更新 spec 并进行真实启动验证

## 需要重新检查打包的变更

出现以下任一情况，都要检查 spec、资源清单和 smoke test：

- 新增 Python 依赖
- 新增动态 import
- 新增运行时读取的 Markdown、模板、配置或静态资源
- 修改 sidecar 启动、环境变量、认证或 Provider 初始化
- 新增原生扩展或外部二进制
- 修改 `app_paths.py` 的 frozen/resource 路径

## 验证顺序

```text
1. build\\build-server.bat
2. build\\smoke-test-server.ps1
3. 确认 dist\\maxma-server.exe 可以启动
4. 确认 /api/health 返回成功
5. 确认 /api/auth/token 返回成功
6. 确认 /api/providers 可以访问
7. 再执行桌面开发或桌面安装包构建
```

构建失败时，优先检查资源是否进入 spec、PyInstaller 使用的 `.venv` 是否正确、sidecar 是否随 bundle 一起存在，不要先猜测前端问题。

## 设计约束

- 后端健康检查只验证本地服务是否启动，不调用远程模型。
- 打包构建不得读取开发机用户配置作为默认资源。
- 生产模式的可写数据必须落在 `app_paths.DATA_DIR`，不能写入 PyInstaller 临时目录。
- Tauri 注入的 `MAXMA_RESOURCES_DIR`、端口和父进程信息必须与 Python 和前端使用的值保持一致。
