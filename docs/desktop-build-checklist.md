# Desktop Build Checklist

每次改动桌面端打包链路前，先按这个最小清单执行，避免继续沿用旧假设。

## 0. Windows-only 入口

桌面链路只支持 Windows 本地应用。不要从旧的手工步骤启动桌面测试，统一使用这些入口：

- 开发/全功能测试：`build\run-desktop-dev.bat`
- 生产打包：`build\build-desktop.bat`
- 仅重打后端 sidecar：`build\build-server.bat`
- 后端冒烟测试：`build\smoke-test-server.ps1`
- 通用环境初始化：`build\setup-dev-env.bat`
- 兼容别名：`build\setup-desktop-env.bat`

脚本会优先使用本机固定工具链路径：`D:\Rust`、`D:\VSBuildTools`、`C:\Program Files (x86)\Windows Kits`，并显式把 MSVC `link.exe` 放在 Git 自带 `link.exe` 前面。
需要排查环境时，统一运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File build\dev-tools.ps1 -Doctor
```

路径规则：

- Python sidecar 固定输出：`dist\maxma-server.exe`
- Tauri sidecar 固定复制到：`desktop\src-tauri\binaries\maxma-server-x86_64-pc-windows-msvc.exe`
- 前端生产产物固定输出：`web\dist`
- Tauri 安装包固定输出：`desktop\src-tauri\target\release\bundle\nsis`

## 1. 先判断这次改动影响到哪里

- 新增或修改了 Python 依赖、原生扩展、动态导入：
  必须检查 `build/maxma-server.spec`
- 新增或修改了前端 API、运行时鉴权、桌面环境分支：
  必须检查 `web/` 构建链路和 `desktop/src-tauri/tauri.conf.json`
- 新增或修改了 sidecar 启动方式、产物路径、复制路径：
  必须检查 `build/build-server.bat` 和 `desktop/src-tauri/binaries/`

## 2. 打包前先列出本次“新增项”和“关联文件”

- 新增了哪些第三方依赖
- 新增了哪些动态导入或 `.pyd` / `.dll` / 二进制资源
- 哪些打包文件必须同步修改
- 哪些旧产物会干扰判断，必须先清理

最低限度至少检查这些文件：

- `build/maxma-server.spec`
- `build/build-server.bat`
- `build/smoke-test-server.ps1`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/src-tauri/binaries/`
- `web/vite.config.ts`
- `docs/backend-bundle-rules.md`

## 3. 开始打包前先清理旧产物

- 清掉历史遗留的 `dist/maxma-server/` 目录产物
- 清掉旧的 `dist/maxma-server.exe`
- 不要让旧产物参与任何故障判断

## 4. 固定执行顺序

生产打包执行：

```bat
build\build-desktop.bat
```

这个脚本会按固定顺序执行：

1. 构建前端 `web\dist`
2. 打包后端 `dist\maxma-server.exe`
3. 复制 sidecar 到 `desktop\src-tauri\binaries\maxma-server-x86_64-pc-windows-msvc.exe`
4. 执行 `cargo tauri build` 生成 NSIS 安装包

开发/全功能测试执行：

```bat
build\run-desktop-dev.bat
```

这个脚本会刷新 sidecar、启动 Vite，然后打开 Tauri dev 窗口；测试时不要再手动打开浏览器。

## 5. 固定验证顺序

1. `build\build-server.bat`
2. `build\smoke-test-server.ps1`
3. `dist\maxma-server.exe`
4. 访问 `http://127.0.0.1:8000/api/auth/token`
5. 访问 `http://127.0.0.1:8000/api/health`
6. 关闭单独运行的后端
7. `build\run-desktop-dev.bat`
8. 在 Tauri 窗口验证模型列表、技能列表、MCP 列表、聊天输入框、文件/文件夹选择、图片预览
9. `build\build-desktop.bat`

## 6. 发现异常时的处理原则

- 先确认当前真实产物形态是单文件还是目录模式
- 先确认出错的是后端 sidecar、本体前端、还是 Tauri 启动链
- 只有定位到“当前真实产物”后，才继续修问题
- packaged 模式下 `/api/restart` 只允许后端退出，重启由 Tauri sidecar 监控负责；不要在后端里再 `Popen(sys.executable)`
- `/api/health` 默认应保持轻量本地就绪检查；远端 provider 探活只在显式深度检查时执行
