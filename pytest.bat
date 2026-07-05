@echo off
REM ============================================================
REM  MaxmaHere — pytest 一键入口
REM  始终使用项目 .venv 的 Python，避免全局环境干扰
REM ============================================================

setlocal
set "SCRIPT_DIR=%~dp0"
set "VENV_PY=%SCRIPT_DIR%.venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
    echo [ERROR] .venv not found at: %VENV_PY%
    echo Please run setup.bat first to create the virtual environment.
    exit /b 1
)

echo [INFO] Using venv Python: %VENV_PY%
"%VENV_PY%" -m pytest %*
set "EXIT_CODE=%ERRORLEVEL%"

endlocal & exit /b %EXIT_CODE%
