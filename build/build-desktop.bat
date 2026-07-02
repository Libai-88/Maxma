@echo off
REM MaxmaHere Windows ?????????
REM ???desktop\src-tauri\target\release\bundle\nsis\*.exe

setlocal
cd /d "%~dp0\.."

call build\setup-dev-env.bat
if errorlevel 1 exit /b 1

echo ============================================
echo   MaxmaHere Desktop Build
echo ============================================
echo.

echo [1/2] ?? Python sidecar ?????...
call build\build-server.bat
if errorlevel 1 exit /b 1

echo.
echo [2/2] ?? Tauri ???...
cd desktop\src-tauri
cargo tauri build
if errorlevel 1 (
    echo [ERROR] Tauri ??????
    exit /b 1
)

echo.
echo ============================================
echo   ??????
echo   ??????desktop\src-tauri\target\release\bundle\nsis
echo ============================================
