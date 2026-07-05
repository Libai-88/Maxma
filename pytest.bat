@echo off
REM ============================================================
REM  MaxmaHere - pytest entry point
REM  Always use project .venv Python to avoid global env issues
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
