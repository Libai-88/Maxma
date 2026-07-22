@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ═══════════════════════════════════════════════
:: MaxmaHere 便携版一键构建脚本
:: 用法：双击 build-portable.bat 或在终端运行
:: 输出：MaxmaHere-Portable\ 文件夹
:: ═══════════════════════════════════════════════

set PROJECT_ROOT=%~dp0
set PORTABLE_DIR=%PROJECT_ROOT%..\MaxmaHere-Portable
set NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2\node.exe

echo.
echo ╔══════════════════════════════════════╗
echo ║   MaxmaHere 便携版构建工具 v2.6.6  ║
echo ╚══════════════════════════════════════╝
echo.

:: 检查 Node.js
if not exist "%NODE%" (
    echo [错误] 未找到 Node.js: %NODE%
    echo 请确认 .workbuddy 运行时已安装。
    pause
    exit /b 1
)
echo [1/5] Node.js 已就绪: %NODE%

:: 构建前端
echo [2/5] 构建前端...
cd /d "%PROJECT_ROOT%web"
rmdir /s /q dist 2>nul
call "%NODE%" node_modules\vite\bin\vite.js build
if %ERRORLEVEL% neq 0 (
    echo [错误] 前端构建失败
    pause
    exit /b 1
)
echo       前端构建完成

:: 构建 Rust 二进制
echo [3/5] 构建桌面客户端...
cd /d "%PROJECT_ROOT%desktop"
cargo build --release --manifest-path src-tauri\Cargo.toml
if %ERRORLEVEL% neq 0 (
    echo [错误] Rust 编译失败
    pause
    exit /b 1
)
echo       桌面客户端编译完成

:: 组装便携文件夹
echo [4/5] 组装便携版...

:: 清空旧输出
rmdir /s /q "%PORTABLE_DIR%" 2>nul
mkdir "%PORTABLE_DIR%"

:: 复制 Rust 二进制
copy /y "%PROJECT_ROOT%desktop\src-tauri\target\release\maxma-here.exe" "%PORTABLE_DIR%\" >nul

:: 复制侧载服务器（如已构建）
if exist "%PROJECT_ROOT%desktop\src-tauri\binaries\maxma-server.exe" (
    copy /y "%PROJECT_ROOT%desktop\src-tauri\binaries\maxma-server.exe" "%PORTABLE_DIR%\" >nul
) else if exist "%PROJECT_ROOT%desktop\src-tauri\target\release\maxma-server.exe" (
    copy /y "%PROJECT_ROOT%desktop\src-tauri\target\release\maxma-server.exe" "%PORTABLE_DIR%\" >nul
) else (
    echo [警告] 未找到 maxma-server.exe，将不会启动后端
)

:: 复制前端产物
xcopy /e /i /q "%PROJECT_ROOT%web\dist" "%PORTABLE_DIR%\dist" >nul

:: 复制运行时资源（Node.js + 默认配置）
xcopy /e /i /q "%PROJECT_ROOT%desktop\src-tauri\resources" "%PORTABLE_DIR%\resources" >nul

:: 迁移用户配置（Provider Key / MCP / Persona / 数据库）
echo [5/5] 迁移用户配置...
set APPDATA_DIR=%APPDATA%\MaxmaHere
if not exist "%APPDATA_DIR%" mkdir "%APPDATA_DIR%"
if not exist "%APPDATA_DIR%\api\data" mkdir "%APPDATA_DIR%\api\data"
if not exist "%APPDATA_DIR%\config\personas" mkdir "%APPDATA_DIR%\config\personas"
if exist "%PROJECT_ROOT%api\data\providers.yaml" (
    copy /y "%PROJECT_ROOT%api\data\providers.yaml" "%APPDATA_DIR%\api\data\providers.yaml" >nul
    echo       providers.yaml  OK
)
if exist "%PROJECT_ROOT%api\data\mcp_servers.yaml" (
    copy /y "%PROJECT_ROOT%api\data\mcp_servers.yaml" "%APPDATA_DIR%\api\data\mcp_servers.yaml" >nul
    echo       mcp_servers.yaml  OK
)
if exist "%PROJECT_ROOT%api\data\maxma.db" (
    copy /y "%PROJECT_ROOT%api\data\maxma.db" "%APPDATA_DIR%\api\data\maxma.db" >nul
    echo       maxma.db (设置数据库)  OK
)
if exist "%PROJECT_ROOT%config\personas\SOUL.md" (
    copy /y "%PROJECT_ROOT%config\personas\*.md" "%APPDATA_DIR%\config\personas\" >nul
    copy /y "%PROJECT_ROOT%config\personas\*.yaml" "%APPDATA_DIR%\config\personas\" >nul 2>nul
    echo       personas  OK
)

echo.
echo ╔══════════════════════════════════════╗
echo ║  ✓ 构建完成！                       ║
echo ║                                    ║
echo ║  便携版位于:                        ║
echo ║  %PORTABLE_DIR%                     ║
echo ║                                    ║
echo ║  使用方式:                          ║
echo ║  双击 maxma-here.exe 启动           ║
echo ║                                    ║
echo ║  首次启动需要十几秒，               ║
echo ║  请等待窗口出现完整界面。            ║
echo ╚══════════════════════════════════════╝

:: 打开便携版文件夹
explorer "%PORTABLE_DIR%"

pause
