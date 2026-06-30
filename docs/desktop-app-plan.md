# MaxmaHere 桌面应用构建方案

## 目标

将 MaxmaHere（Python 后端 + Vue 前端）打包为 Windows 桌面应用，用户双击即用，无需安装 Python、Node 或任何依赖。

## 技术选型

| 层级 | 方案 | 理由 |
|------|------|------|
| 桌面外壳 | Tauri v2 | Rust 内核，安装包 ~5-10MB，内存占用低 |
| Python 打包 | PyInstaller | 将后端打包为独立 .exe，内嵌所有依赖 |
| 前端 | Vite 构建产物 | 已有生产构建，直接嵌入 Tauri |
| 安装包 | NSIS / WiX | Tauri 内置 NSIS 支持，可生成 .exe 安装程序 |

## 架构概览

```
┌─────────────────────────────────────────┐
│           Tauri v2 应用窗口              │
│  ┌───────────────────────────────────┐  │
│  │      WebView (Chromium/Edge)      │  │
│  │   加载 Vite 构建的 Vue SPA        │  │
│  │   所有 /api/* 和 /ws 请求         │  │
│  │        ↓                          │  │
│  └───────────┼───────────────────────┘  │
│              │ HTTP/WS                  │
│              ↓                          │
│  ┌───────────────────────────────────┐  │
│  │   Python 后端 (PyInstaller 打包)   │  │
│  │   FastAPI + uvicorn :8000         │  │
│  │   作为 Tauri sidecar 管理         │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## 实施阶段

### Phase 1: 后端单端口化（前置准备）

**目标**：让 FastAPI 同时提供 API 和前端静态文件，消除跨域问题。

**改动文件**：
- `api/server.py` — 添加 `StaticFiles` mount
- `web/vite.config.ts` — 调整 `base` 路径（如需要）

**具体步骤**：
1. 在 `server.py` 的 `create_app()` 末尾添加：
   ```python
   from fastapi.staticfiles import StaticFiles
   
   # 生产模式下挂载前端静态文件
   if os.getenv("MAXMA_ENV") == "production":
       dist_dir = Path(__file__).parent.parent / "web" / "dist"
       if dist_dir.exists():
           app.mount("/", StaticFiles(directory=dist_dir, html=True), name="static")
   ```
2. 确保 mount 在所有 API 路由之后（避免覆盖 `/api/*`）
3. 修复 auth token 注入：当前 `__API_TOKEN__` 在 Vite 构建时硬编码，改为运行时从 `/api/auth/token` 接口获取
4. 调整 CORS：生产模式下允许 `tauri://localhost` 和 `https://tauri.localhost`

**验收标准**：
- `MAXMA_ENV=production python main.py` 启动后，浏览器访问 `http://localhost:8000` 能看到前端页面
- API 和 WebSocket 正常工作
- 无 CORS 错误

---

### Phase 2: Python 后端 PyInstaller 打包

**目标**：将 Python 后端打包为单个 `maxma-server.exe`，可在无 Python 环境的 Windows 上运行。

**新增文件**：
- `build/maxma-server.spec` — PyInstaller 配置
- `build/build-server.bat` — 打包脚本

**具体步骤**：
1. 安装 PyInstaller：`pip install pyinstaller`
2. 创建 `build/maxma-server.spec`：
   ```python
   # -*- mode: python ; coding: utf-8 -*-
   block_cipher = None
   
   a = Analysis(
       ['main.py'],
       pathex=[],
       binaries=[],
       datas=[
           ('config', 'config'),
           ('api/data', 'api/data'),
           ('web/dist', 'web/dist'),  # 嵌入前端构建产物
       ],
       hiddenimports=[
           'uvicorn.logging',
           'uvicorn.loops',
           'uvicorn.loops.auto',
           'uvicorn.protocols',
           'uvicorn.protocols.http',
           'uvicorn.protocols.websockets',
           # ... 其他动态导入的模块
       ],
       # ...
   )
   
   exe = EXE(
       pyz,
       a.scripts,
       [],
       exclude_binaries=True,
       name='maxma-server',
       # ...
   )
   
   coll = COLLECT(
       exe,
       a.binaries,
       a.datas,
       strip=False,
       upx=True,
       name='maxma-server',
   )
   ```
3. 处理 Playwright 浏览器：Playwright 需要 Chromium 二进制，约 200MB。两个选择：
   - **方案 A**：首次运行时自动下载（推荐，减小安装包体积）
   - **方案 B**：打包进安装包（离线可用，但安装包 ~250MB+）
4. 处理数据目录：`api/data/` 包含用户数据（auth_token、memory、sessions），需要放在用户可写目录（如 `%APPDATA%/MaxmaHere/`），而非 exe 旁边
5. 创建 `build/build-server.bat`：
   ```batch
   @echo off
   echo Building MaxmaHere server...
   cd /d "%~dp0\.."
   call .venv\Scripts\activate.bat
   pyinstaller build\maxma-server.spec --clean --noconfirm
   echo Build complete: dist\maxma-server\maxma-server.exe
   ```

**验收标准**：
- `dist/maxma-server/maxma-server.exe` 可在无 Python 的 Windows 机器上运行
- 启动后监听 `127.0.0.1:8000`
- 访问 `http://localhost:8000` 返回前端页面
- API 和 WebSocket 正常

---

### Phase 3: Tauri v2 项目初始化

**目标**：创建 Tauri v2 项目骨架，配置为加载本地前端并管理 Python sidecar。

**新增目录**：
- `desktop/` — Tauri 项目根目录

**具体步骤**：
1. 安装 Rust 工具链（如未安装）：https://rustup.rs/
2. 初始化 Tauri 项目：
   ```bash
   cd D:\Maxma\MaxmaHere
   npm create tauri-app@latest desktop -- --template vue-ts --manager pnpm
   ```
   （选择 Vue + TypeScript 模板，虽然前端已存在，但需要 Tauri 的项目结构）
   
   或者更干净的方式——手动创建 Tauri 结构：
   ```
   desktop/
   ├── src-tauri/
   │   ├── Cargo.toml
   │   ├── tauri.conf.json
   │   ├── src/
   │   │   └── main.rs
   │   └── icons/
   └── (复用 web/ 作为前端源码)
   ```
3. 配置 `tauri.conf.json`：
   ```json
   {
     "productName": "MaxmaHere",
     "version": "2.6.0",
     "identifier": "com.maxmahere.app",
     "build": {
       "frontendDist": "../web/dist",
       "devUrl": "http://localhost:5173",
       "beforeDevCommand": "",
       "beforeBuildCommand": ""
     },
     "app": {
       "windows": [
         {
           "title": "MaxmaHere",
           "width": 1200,
           "height": 800,
           "resizable": true,
           "fullscreen": false
         }
       ],
       "security": {
         "csp": "default-src 'self'; connect-src 'self' http://localhost:8000 ws://localhost:8000"
       }
     },
     "bundle": {
       "active": true,
       "targets": ["nsis"],
       "icon": [
         "icons/32x32.png",
         "icons/128x128.png",
         "icons/icon.ico"
       ],
       "externalBin": [
         "binaries/maxma-server"
       ],
       "resources": [
         "resources/**/*"
       ]
     }
   }
   ```
4. 编写 `src-tauri/src/main.rs`：
   ```rust
   #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
   
   use tauri::Manager;
   use std::process::Command;
   use std::sync::Mutex;
   
   struct AppState {
       server_process: Mutex<Option<std::process::Child>>,
   }
   
   fn main() {
       tauri::Builder::default()
           .setup(|app| {
               // 启动 Python 后端 sidecar
               let sidecar = app.shell().sidecar("maxma-server")
                   .unwrap()
                   .spawn()
                   .expect("Failed to start maxma-server");
               
               app.state::<AppState>().server_process.lock().unwrap().replace(sidecar);
               
               // 等待后端就绪
               std::thread::sleep(std::time::Duration::from_secs(3));
               
               Ok(())
           })
           .on_window_event(|window, event| {
               if let tauri::WindowEvent::Destroyed = event {
                   // 窗口关闭时终止后端进程
                   if let Some(mut child) = window.state::<AppState>().server_process.lock().unwrap().take() {
                       let _ = child.kill();
                   }
               }
           })
           .invoke_handler(tauri::generate_handler![])
           .run(tauri::generate_context!())
           .expect("error while running tauri application");
   }
   ```

**验收标准**：
- `cargo tauri dev` 启动开发模式，Tauri 窗口加载前端
- 前端能正常调用后端 API
- 窗口关闭时后端进程自动终止

---

### Phase 4: Sidecar 集成与进程管理

**目标**：Tauri 正确管理 Python 后端的生命周期，处理启动、健康检查、崩溃恢复。

**改动文件**：
- `desktop/src-tauri/src/main.rs` — 增强 sidecar 管理
- `desktop/src-tauri/Cargo.toml` — 添加依赖

**具体步骤**：
1. 添加健康检查：Tauri 启动后轮询 `http://localhost:8000/api/health` 直到返回 200
2. 处理启动失败：如果后端 10 秒内未就绪，显示错误对话框
3. 崩溃恢复：监控 sidecar 进程，意外退出时自动重启（最多 3 次）
4. 优雅关闭：窗口关闭时先发送 SIGTERM，等待 5 秒，再 SIGKILL
5. 日志收集：将 sidecar stdout/stderr 重定向到 Tauri 日志系统

**验收标准**：
- 启动应用后，后端在 5 秒内就绪
- 后端崩溃时自动重启，前端显示"正在重连..."
- 关闭窗口后无残留进程

---

### Phase 5: 安装包构建

**目标**：生成 Windows 安装程序（.exe），用户双击安装即可使用。

**改动文件**：
- `desktop/src-tauri/tauri.conf.json` — NSIS 配置
- `desktop/src-tauri/templates/` — 安装程序自定义脚本（可选）

**具体步骤**：
1. 配置 NSIS：
   ```json
   {
     "bundle": {
       "windows": {
         "nsis": {
           "installMode": "currentUser",
           "languages": ["SimpChinese"],
           "displayLanguageSelector": false
         }
       }
     }
   }
   ```
2. 准备图标：生成 `icon.ico`（256x256）、`icon.png`（512x512）等
3. 构建安装包：
   ```bash
   cd desktop/src-tauri
   cargo tauri build
   ```
4. 产物位于 `desktop/src-tauri/target/release/bundle/nsis/MaxmaHere_2.6.0_x64-setup.exe`

**验收标准**：
- 安装包大小 < 300MB（含 Python 运行时 + 依赖）
- 安装后桌面快捷方式可用
- 首次启动无报错
- 卸载干净（注册表、AppData 清理）

---

### Phase 6: 数据持久化与更新机制

**目标**：用户数据（memory、sessions、config）存储在正确位置，支持应用更新。

**数据目录规划**：
```
%APPDATA%/MaxmaHere/
├── data/
│   ├── auth_token.yaml
│   ├── memory/
│   ├── sessions/
│   └── uploads/
├── config/
│   └── personas/
└── logs/
```

**具体步骤**：
1. 修改后端代码，将数据目录从项目内改为 `%APPDATA%/MaxmaHere/`
2. 首次运行时自动创建目录结构并复制默认配置
3. 配置 Tauri 自动更新（可选，需要更新服务器）：
   ```rust
   // src-tauri/src/main.rs
   tauri::Builder::default()
       .plugin(tauri_plugin_updater::Builder::new().build())
   ```

**验收标准**：
- 用户数据不在安装目录（Program Files）
- 卸载应用后用户数据保留
- 更新应用不丢失用户数据

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| PyInstaller 打包后体积过大 | 安装包 > 500MB | 使用 `--exclude-module` 排除无用依赖；考虑 Nuitka 替代 |
| Playwright 浏览器依赖 | 额外 200MB | 首次运行时下载，或改用轻量级浏览器自动化方案 |
| Tauri sidecar 进程管理复杂 | 残留进程、端口冲突 | 实现健康检查 + 崩溃恢复 + 优雅关闭 |
| Windows Defender 误报 | 用户不敢安装 | 代码签名证书（$200-400/年） |
| 不同 Windows 版本兼容性 | Win10/Win11 差异 | 测试 Win10 21H2+ 和 Win11 |

## 时间估算

| 阶段 | 工作量 | 前置依赖 |
|------|--------|----------|
| Phase 1: 后端单端口化 | 0.5 天 | 无 |
| Phase 2: PyInstaller 打包 | 1-2 天 | Phase 1 |
| Phase 3: Tauri 初始化 | 1 天 | Phase 1 |
| Phase 4: Sidecar 集成 | 1 天 | Phase 2 + 3 |
| Phase 5: 安装包构建 | 0.5 天 | Phase 4 |
| Phase 6: 数据持久化 | 1 天 | Phase 5 |
| **总计** | **5-6 天** | |

## 下一步行动

1. **立即可做**：Phase 1（后端单端口化）——改动小、无依赖、为后续所有阶段打基础
2. **环境准备**：安装 Rust 工具链、PyInstaller
3. **技术验证**：先手动跑通 `PyInstaller 打包` + `Tauri sidecar 加载`，确认可行性

是否现在开始实施 Phase 1？
