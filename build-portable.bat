@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

REM MaxmaHere portable build (Web distribution, Bun backend).
REM Stage 2.6: the PyInstaller/Tauri chain is removed; the deliverable is a
REM self-contained Web folder that runs `bun.exe run server.js` and serves the
REM frontend from the same process (WEB-HOST-001).

set "PROJECT_ROOT=%~dp0"
set "PORTABLE_DIR=%PROJECT_ROOT%..\MaxmaHere-Portable"
set "SERVER_DIR=%PROJECT_ROOT%dist\bun-server"

echo.
echo ========================================
echo   MaxmaHere Portable Build (Web / Bun)
echo ========================================
echo.

cd /d "%PROJECT_ROOT%"
if errorlevel 1 (
    echo [ERROR] Cannot enter project root.
    exit /b 1
)

REM Remove the previous portable output before the build scans for artifacts.
if exist "%PORTABLE_DIR%\" (
    echo [INFO] Removing previous portable output: %PORTABLE_DIR%
    rmdir /s /q "%PORTABLE_DIR%"
    if errorlevel 1 (
        echo [ERROR] Cannot remove previous portable output.
        exit /b 1
    )
)

echo [1/3] Building Bun backend bundle (server.js + runtime)...
call build\build-server.bat
if errorlevel 1 (
    echo [ERROR] Bun backend build failed.
    exit /b 1
)
if not exist "%SERVER_DIR%\server.js" (
    echo [ERROR] server.js not produced: %SERVER_DIR%\server.js
    exit /b 1
)
if not exist "%SERVER_DIR%\bun.exe" (
    echo [ERROR] bun.exe not staged: %SERVER_DIR%\bun.exe
    exit /b 1
)

echo [2/3] Assembling portable layout...
mkdir "%PORTABLE_DIR%"
if errorlevel 1 (
    echo [ERROR] Cannot create portable output directory.
    exit /b 1
)

REM Backend runtime bundle (server.js + bun.exe + sharp native node_modules)
xcopy /e /i /q "%SERVER_DIR%" "%PORTABLE_DIR%" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy backend bundle.
    exit /b 1
)

REM Frontend dist (served by the backend; bundleDir()/web/dist)
mkdir "%PORTABLE_DIR%\web" 2>nul
xcopy /e /i /q "%PROJECT_ROOT%web\dist" "%PORTABLE_DIR%\web\dist" >nul
if errorlevel 1 (
    echo [ERROR] Failed to copy frontend dist.
    exit /b 1
)

REM Bundle resources the backend reads at runtime (templates only, never user
REM data): config/personas templates, config/rules, built-in stickers,
REM .omp/skills, workflows, macros, version.py, bun-sidecar/package.json.
mkdir "%PORTABLE_DIR%\config\personas" 2>nul
xcopy /e /i /q "%PROJECT_ROOT%config\personas\AGENTS.md" "%PORTABLE_DIR%\config\personas" >nul
xcopy /e /i /q "%PROJECT_ROOT%config\personas\MAXMA.md" "%PORTABLE_DIR%\config\personas" >nul
xcopy /e /i /q "%PROJECT_ROOT%config\personas\SOUL.example.md" "%PORTABLE_DIR%\config\personas" >nul
xcopy /e /i /q "%PROJECT_ROOT%config\personas\USER.example.md" "%PORTABLE_DIR%\config\personas" >nul
if not exist "%PROJECT_ROOT%config\personas\SOUL.md" (
    echo [ERROR] Missing built-in persona: SOUL.md
    exit /b 1
)
if not exist "%PROJECT_ROOT%config\personas\SOUL.饱饱.md" (
    echo [ERROR] Missing built-in persona: SOUL.饱饱.md
    exit /b 1
)
xcopy /e /i /q "%PROJECT_ROOT%config\personas\SOUL.md" "%PORTABLE_DIR%\config\personas" >nul
xcopy /e /i /q "%PROJECT_ROOT%config\personas\SOUL.饱饱.md" "%PORTABLE_DIR%\config\personas" >nul
for %%P in (SOUL.md SOUL.饱饱.md) do (
    if not exist "%PORTABLE_DIR%\config\personas\%%P" (
        echo [ERROR] Built-in persona missing from portable output: %%P
        exit /b 1
    )
)
xcopy /e /i /q "%PROJECT_ROOT%config\rules" "%PORTABLE_DIR%\config\rules" >nul
xcopy /e /i /q "%PROJECT_ROOT%config\stickers" "%PORTABLE_DIR%\config\stickers" >nul
REM custom stickers are user uploads — never ship them
if exist "%PORTABLE_DIR%\config\stickers\custom" rmdir /s /q "%PORTABLE_DIR%\config\stickers\custom"
xcopy /e /i /q "%PROJECT_ROOT%.omp\skills" "%PORTABLE_DIR%\.omp\skills" >nul
xcopy /e /i /q "%PROJECT_ROOT%.maxma\skills" "%PORTABLE_DIR%\.maxma\skills" >nul
for %%S in (coding-starter office-starter debugging-starter document-starter spreadsheet-starter mcp-starter) do (
    if not exist "%PROJECT_ROOT%.maxma\skills\%%S\SKILL.md" (
        echo [ERROR] Bundled skill missing from source: %%S
        exit /b 1
    )
    if not exist "%PORTABLE_DIR%\.maxma\skills\%%S\SKILL.md" (
        echo [ERROR] Bundled skill missing from portable output: %%S
        exit /b 1
    )
)
if exist "%PROJECT_ROOT%workflows\" xcopy /e /i /q "%PROJECT_ROOT%workflows" "%PORTABLE_DIR%\workflows" >nul
if exist "%PROJECT_ROOT%macros\" xcopy /e /i /q "%PROJECT_ROOT%macros" "%PORTABLE_DIR%\macros" >nul
copy /y "%PROJECT_ROOT%version.py" "%PORTABLE_DIR%\version.py" >nul
mkdir "%PORTABLE_DIR%\bun-sidecar" 2>nul
copy /y "%PROJECT_ROOT%bun-sidecar\package.json" "%PORTABLE_DIR%\bun-sidecar\package.json" >nul

echo [3/3] Portable marker, launcher and data directory...
REM portable.flag: app-paths.ts + the launcher detect this to write data beside
REM the executable (data/) instead of %APPDATA%.
for /f "tokens=2 delims==" %%V in ('findstr /c:"__version__" "%PROJECT_ROOT%version.py"') do set "APP_VERSION=%%V"
set "APP_VERSION=%APP_VERSION: =%"
set "APP_VERSION=%APP_VERSION:"=%"
(echo MaxmaHere Portable Mode Marker
echo version=!APP_VERSION!
echo built=%DATE% %TIME%) > "%PORTABLE_DIR%\portable.flag"
if not exist "%PORTABLE_DIR%\portable.flag" (
    echo [ERROR] Failed to create portable.flag marker.
    exit /b 1
)

REM Launcher: runs the bundled backend with explicit path env vars so the
REM flattened server.js resolves bundleDir()/dataDir() correctly.
(
    echo @echo off
    echo chcp 65001 ^>nul
    echo setlocal EnableExtensions
    echo set "SCRIPT_DIR=%%~dp0"
    echo set "MAXMA_BUNDLE_DIR=%%SCRIPT_DIR%%"
    echo set "MAXMA_EXE_DIR=%%SCRIPT_DIR%%"
    echo set "MAXMA_DATA_DIR=%%SCRIPT_DIR%%data"
    echo set "PI_CODING_AGENT_DIR=%%SCRIPT_DIR%%data\pi"
    echo set "MAXMA_SERVE_WEB=1"
    echo set "MAXMA_ENV=production"
    echo if "%%MAXMA_API_PORT%%"=="" set "MAXMA_API_PORT=8000"
    echo set "MAXMA_BUN_PORT=%%MAXMA_API_PORT%%"
    echo echo Starting MaxmaHere on http://127.0.0.1:%%MAXMA_API_PORT%% ...
    echo start "MaxmaHere" "%%SCRIPT_DIR%%bun.exe" run "%%SCRIPT_DIR%%server.js"
    echo set "READY=0"
    echo for /L %%%%i in ^(1,1,60^) do ^(
    echo     curl -s --fail http://127.0.0.1:%%MAXMA_API_PORT%%/api/health ^>nul 2^>^&1
    echo     if not errorlevel 1 ^(set "READY=1" ^& goto :backend_ready^)
    echo     ping -n 2 127.0.0.1 ^>nul
    echo ^)
    echo :backend_ready
    echo if "%%READY%%"=="0" ^(
    echo     echo Backend did not become ready within 60 seconds.
    echo     pause
    echo     exit /b 1
    echo ^)
    echo start "" "http://127.0.0.1:%%MAXMA_API_PORT%%/"
    echo echo Backend launched. Browser opened automatically.
    echo pause
) > "%PORTABLE_DIR%\MaxmaHere.bat"

REM Pre-create the data root + seed default configs for first-run UX.
if not exist "%PORTABLE_DIR%\data\" mkdir "%PORTABLE_DIR%\data"
set "API_DATA_DIR=%PORTABLE_DIR%\data\api\data"
if not exist "%API_DATA_DIR%" mkdir "%API_DATA_DIR%"
if exist "%PROJECT_ROOT%resources\default-config\mcp_servers.yaml" (
    if not exist "%API_DATA_DIR%\mcp_servers.yaml" copy /y "%PROJECT_ROOT%resources\default-config\mcp_servers.yaml" "%API_DATA_DIR%\mcp_servers.yaml" >nul 2>&1
)
if exist "%PROJECT_ROOT%api\data\news.yaml" (
    if not exist "%API_DATA_DIR%\news.yaml" copy /y "%PROJECT_ROOT%api\data\news.yaml" "%API_DATA_DIR%\news.yaml" >nul 2>&1
)

REM Strip git placeholders from the shipped tree.
for /r "%PORTABLE_DIR%" %%F in (.gitkeep) do del "%%F" 2>nul

echo.
echo ========================================
echo   Portable build complete
echo   Output: %PORTABLE_DIR%
echo     server.js / bun.exe / node_modules\
echo     web\dist\  config\  .omp\skills\  .maxma\skills\  version.py
echo     portable.flag  data\  MaxmaHere.bat
echo ========================================

REM Post-build verification
set "VERIFY_OK=1"
for %%F in (server.js bun.exe portable.flag MaxmaHere.bat) do (
    if not exist "%PORTABLE_DIR%\%%F" (
        echo [VERIFY FAIL] %%F is missing
        set "VERIFY_OK=0"
    )
)
if not exist "%PORTABLE_DIR%\node_modules\sharp" (
    echo [VERIFY FAIL] node_modules\sharp is missing
    set "VERIFY_OK=0"
)
if not exist "%PORTABLE_DIR%\web\dist\index.html" (
    echo [VERIFY FAIL] web\dist\index.html is missing
    set "VERIFY_OK=0"
)
if not exist "%PORTABLE_DIR%\version.py" (
    echo [VERIFY FAIL] version.py is missing
    set "VERIFY_OK=0"
)
if not "%VERIFY_OK%"=="1" (
    echo [ERROR] Post-build verification failed. Portable layout is incomplete.
    exit /b 1
)
echo [VERIFY] All critical files present. Portable layout is complete.
endlocal & exit /b 0
