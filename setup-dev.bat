@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ========================================
echo   MaxmaHere Dev Environment Setup
echo ========================================
echo.

if not exist "main.py" (
    echo [ERR] 请确保在项目根目录运行此脚本。
    pause
    exit /b 1
)

REM 检查 uv 是否已安装
where uv >nul 2>&1
if errorlevel 1 (
    echo [ERR] 未找到 uv。请先安装 uv：
    echo       powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 ^| iex"
    echo       或访问 https://docs.astral.sh/uv/getting-started/installation/
    pause
    exit /b 1
)

echo [1/4] uv version:
uv --version
echo.

echo [2/4] Creating virtual environment with Python 3.13 ...
uv venv --clear
if errorlevel 1 (
    echo [ERR] 创建虚拟环境失败。
    pause
    exit /b 1
)
echo.

echo [3/4] Syncing dependencies from requirements-lock.txt ...
uv pip sync requirements-lock.txt
if errorlevel 1 (
    echo [ERR] 安装依赖失败。
    pause
    exit /b 1
)
echo.

echo [4/4] Running tests to verify environment ...
.venv\Scripts\python.exe -m pytest tests -p no:langsmith_plugin -q
if errorlevel 1 (
    echo [ERR] 测试验证失败，请检查上方错误信息。
    pause
    exit /b 1
)
echo.

echo ========================================
echo   开发环境配置完成！
echo   Python: .venv\Scripts\python.exe
echo   运行测试: .venv\Scripts\python.exe -m pytest tests
echo   启动项目: .venv\Scripts\python.exe main.py web
echo ========================================
echo.
pause
