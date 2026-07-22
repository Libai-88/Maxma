# Tauri Portable Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一便携版与正式 Tauri/PyInstaller 产物链路，并修复生产桌面端的 sidecar 资源、端口等待、API/资源 URL 与错误遮罩。

**Architecture:** `build/build-server.bat` 继续负责前端、Bun、PyInstaller 和后端 smoke test；`prepare-runtime.ps1` 与 `prepare-assets.ps1` 继续负责 Tauri `resources/`。便携版只复用这些正式阶段，再用 Tauri 的正式构建结果组装目录。Tauri Rust 进程是端口和环境变量的唯一来源，Vue 仅通过命令获取端口并等待同一端口的健康检查。

**Tech Stack:** Windows batch/PowerShell, PyInstaller, Tauri 2/Rust, FastAPI/pytest, Vue 3/Vite/TypeScript/Vitest。

---

## Worker 隔离

每个 worker 只能修改其分配的文件；测试文件也按 worker 独占。任何 worker 不得修改另一个 worker 的文件，不得共享同一源码文件。集成验证只运行命令，不改文件；本计划执行期间不提交 commit。

- **Worker A / 构建链路:** `build-portable.bat`、`desktop/src-tauri/tauri.conf.json`、新建 `tests/test_build_pipeline.py`。只读参考 `build/build-desktop.bat`、`build/build-server.bat`、`build/prepare-runtime.ps1`、`build/prepare-assets.ps1`、`build/prepare-bun.ps1`、`build/maxma-server.spec`。
- **Worker B / Tauri 与后端运行时:** `app_paths.py`、`desktop/src-tauri/src/main.rs`、`desktop/src-tauri/src/port_manager.rs`、`tests/test_app_paths/test_runtime_dir.py`、`tests/test_api/test_server.py`。
- **Worker C / 前端启动与 URL:** `web/index.html`、`web/src/main.ts`、`web/src/utils/env.ts`、`web/src/composables/stickerUtils.ts`、`web/src/components/StickerInline.vue`、`web/tests/env.spec.ts`、新建 `web/tests/startup-error.spec.ts`。

## Task 1: 统一便携版构建流程

- [ ] **Step 1: 先写失败的构建契约测试。**

  在 `tests/test_build_pipeline.py` 中读取脚本文本，断言 `build-portable.bat` 调用 `build\build-server.bat`、`prepare-runtime.ps1`、`prepare-assets.ps1` 和 `cargo tauri build --no-bundle`，输出复制的是 Tauri 产物、带 target-triple 的 sidecar 和 `desktop\src-tauri\resources`；同时断言不再出现旧的 `PROJECT_ROOT%desktop\...`、`%PROJECT_ROOT%api\...` 路径。

- [ ] **Step 2: 运行 RED。**

  ```powershell
  .\.venv\Scripts\python.exe -m pytest tests/test_build_pipeline.py -q
  ```

  预期：FAIL，当前脚本仍直接执行 `cargo build` 并引用旧路径。

- [ ] **Step 3: 实现最小构建改动。**

  让 `build-portable.bat` 从仓库根目录依次调用正式 server、runtime、assets 阶段；随后在 `desktop\src-tauri` 执行 `cargo tauri build --no-bundle`，按 `tauri.conf.json` 的 `frontendDist`、`resources`、`externalBin` 约定组装 `MaxmaHere-Portable`。只在 `tauri.conf.json` 中修正实际产物布局需要的资源/sidecar 声明，不复制开发目录或用户数据作为运行时资源。

- [ ] **Step 4: 运行 GREEN 与构建验证。**

  ```powershell
  .\.venv\Scripts\python.exe -m pytest tests/test_build_pipeline.py -q
  call build-portable.bat
  $required = @(
    'D:\Maxma\MaxmaHere-Portable\maxma-here.exe',
    'D:\Maxma\MaxmaHere-Portable\maxma-server-x86_64-pc-windows-msvc.exe',
    'D:\Maxma\MaxmaHere-Portable\resources\runtime',
    'D:\Maxma\MaxmaHere-Portable\resources\assets'
  )
  $required | ForEach-Object { if (-not (Test-Path $_)) { throw "Missing portable artifact: $_" } }
  ```

## Task 2: 固化 sidecar 环境、资源路径和端口契约

- [ ] **Step 1: 先写失败测试。**

  在 Rust 单元测试中覆盖：首选端口被占用时选择 `8000..=8010` 内的下一个可用端口；sidecar 环境同时包含 `MAXMA_ENV=production`、选定的 `MAXMA_API_PORT`、Tauri `resource_dir` 对应的 `MAXMA_RESOURCES_DIR`。在 `test_runtime_dir.py` 覆盖 `MAXMA_RESOURCES_DIR` 优先于 frozen/开发 fallback；在 server 测试中覆盖 production 模式挂载 `web/dist` 的 API/静态入口。

- [ ] **Step 2: 运行 RED。**

  ```powershell
  .\.venv\Scripts\python.exe -m pytest tests/test_app_paths/test_runtime_dir.py tests/test_api/test_server.py -q
  cargo test --manifest-path desktop/src-tauri/Cargo.toml port_manager
  ```

  预期：新增契约断言先失败，失败原因必须是环境变量或端口/资源行为缺失，而不是测试导入错误。

- [ ] **Step 3: 实现最小运行时改动。**

  在 `main.rs` 集中生成 sidecar 环境：注入 `MAXMA_ENV=production`、Rust 选出的端口、`app.path().resource_dir()` 和父 PID；前端通过现有 `get_api_port` 命令读取同一个端口。保留 `port_manager.rs` 的可用端口扫描，并让 `app_paths.py` 明确按 `MAXMA_RESOURCES_DIR -> frozen bundle fallback -> executable sibling fallback` 解析只读资源；生产 API 静态目录必须来自 PyInstaller bundle 内的 `web/dist`。

- [ ] **Step 4: 运行 GREEN。**

  ```powershell
  .\.venv\Scripts\python.exe -m pytest tests/test_app_paths/test_runtime_dir.py tests/test_api/test_server.py -q
  cargo test --manifest-path desktop/src-tauri/Cargo.toml
  ```

## Task 3: 修复 Tauri 前端等待、错误遮罩和生产 URL

- [ ] **Step 1: 先写失败测试。**

  在 `web/tests/env.spec.ts` 覆盖浏览器仍使用 `/api` 和 Vite WS proxy、Tauri production 使用 Rust 返回的实际端口、`waitForBackend` 只在该端口健康检查成功后返回 true；在 `web/tests/startup-error.spec.ts` 覆盖 backend 超时、Vue 全局异常和未捕获 rejection 都显示可重试的全屏错误遮罩。覆盖贴纸/后端资源 URL 不再使用 Tauri 下的相对 `/api/...`。

- [ ] **Step 2: 运行 RED。**

  ```powershell
  Push-Location web
  npx vitest run tests/env.spec.ts tests/startup-error.spec.ts
  Pop-Location
  ```

  预期：新增断言先失败，且不是由 jsdom 初始化或动态 import mock 错误造成。

- [ ] **Step 3: 实现最小前端改动。**

  `env.ts` 统一 `getApiBase/getBackendOrigin/getWsBase` 的 Tauri production 绝对 URL，并让所有后端图片/贴纸请求复用该 helper；`main.ts` 在挂载前等待后端，超时或全局异常时保留应用可见的全屏错误遮罩和重试动作；`index.html` 提供不依赖 Vue 的启动/错误容器，保证资源加载或 Vue 尚未挂载时也能反馈错误。

- [ ] **Step 4: 运行 GREEN、类型检查和生产构建。**

  ```powershell
  Push-Location web
  npx vitest run tests/env.spec.ts tests/startup-error.spec.ts
  npx vue-tsc --noEmit
  npm run build
  Pop-Location
  ```

## 集成验收

在三个 worker 各自测试全绿后，只运行以下命令，不允许集成 worker 修改文件：

```powershell
call build\build-server.bat
powershell -NoProfile -ExecutionPolicy Bypass -File build\prepare-runtime.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File build\prepare-assets.ps1
Push-Location desktop\src-tauri
cargo tauri build
Pop-Location
call build-portable.bat
```

验收标准：

- 正式 Tauri 与便携版都使用同一 PyInstaller sidecar、Bun、runtime、Playwright、ONNX 资源准备链路，且便携目录没有旧路径或缺失资源。
- Tauri 启动时 sidecar 收到 `MAXMA_ENV=production`、真实选定端口和有效 `MAXMA_RESOURCES_DIR`；占用 8000 时前后端一致使用回退端口。
- 前端在 sidecar 健康前不发业务 API 请求；生产 API、WebSocket、贴纸/图片资源都指向运行时端口；启动失败或全局异常显示错误遮罩而非只写 console。
- `pytest`、Rust `cargo test`、Vitest、`vue-tsc`、前端 build、正式 Tauri build 和便携版产物检查全部通过；不提交 commit。

## 风险与回滚

- Tauri `--no-bundle` 的 sidecar 相邻布局可能因 CLI 版本不同而变化；以 `tauri.conf.json` 的 `externalBin` 解析和便携启动 smoke test 为准，失败时只回滚 Worker A 的布局改动。
- PyInstaller onefile 首次解压可能超过等待时间；保持 Rust 与前端同一超时预算，并用首次冷启动验证，不降低现有 90 秒上限。
- 端口环境变量是进程级共享状态；Rust 测试需串行运行，禁止测试并行修改同一环境变量。
