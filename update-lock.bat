@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo   Update dependency lock file
echo ========================================
echo.

where uv >nul 2>&1
if errorlevel 1 (
    echo [ERR] 未找到 uv。请先安装 uv。
    pause
    exit /b 1
)

echo [1/3] Compiling requirements.txt (runtime) ...
uv pip compile pyproject.toml -o requirements.txt
if errorlevel 1 (
    echo [ERR] 生成 runtime lock 文件失败。
    pause
    exit /b 1
)
echo.

echo [2/3] Compiling requirements-lock.txt (dev) ...
uv pip compile pyproject.toml --extra dev -o requirements-lock.txt
if errorlevel 1 (
    echo [ERR] 生成 dev lock 文件失败。
    pause
    exit /b 1
)
echo.

echo [3/3] Syncing local .venv with dev lock file ...
uv pip sync requirements-lock.txt
if errorlevel 1 (
    echo [ERR] 同步依赖失败。
    pause
    exit /b 1
)
echo.

echo ========================================
echo   Lock file updated: requirements-lock.txt
echo   请提交该文件到 git 以保证一致性。
echo ========================================
echo.
pause
