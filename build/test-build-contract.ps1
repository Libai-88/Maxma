param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

function Read-ProjectFile {
    param([string]$RelativePath)

    $path = Join-Path $ProjectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Missing build contract file: $RelativePath"
    }
    return Get-Content -LiteralPath $path -Raw
}

function Assert-TextContains {
    param(
        [string]$Text,
        [string]$Needle,
        [string]$Message
    )

    if (-not $Text.Contains($Needle)) {
        throw $Message
    }
}

function Assert-TextNotContains {
    param(
        [string]$Text,
        [string]$Needle,
        [string]$Message
    )

    if ($Text.Contains($Needle)) {
        throw $Message
    }
}

function Assert-Regex {
    param(
        [string]$Text,
        [string]$Pattern,
        [string]$Message
    )

    if ($Text -notmatch $Pattern) {
        throw $Message
    }
}

$portable = Read-ProjectFile "build-portable.bat"
$desktop = Read-ProjectFile "build\build-desktop.bat"
$server = Read-ProjectFile "build\build-server.bat"
$dev = Read-ProjectFile "build\run-desktop-dev.bat"
$start = Read-ProjectFile "start.bat"
$main = Read-ProjectFile "desktop\src-tauri\src\main.rs"
$config = (Read-ProjectFile "desktop\src-tauri\tauri.conf.json" | ConvertFrom-Json)

Assert-TextContains $portable "call build\build-server.bat" "portable must reuse the server/PyInstaller build chain"
Assert-TextContains $portable "build\prepare-runtime.ps1" "portable must prepare the embedded runtime"
Assert-TextContains $portable "build\prepare-assets.ps1" "portable must prepare bundled assets"
Assert-TextContains $portable "cargo tauri build --no-bundle" "portable must use the Tauri no-bundle build"
Assert-TextContains $portable "web\dist" "portable must validate the frontend dist directory"
Assert-TextContains $portable "maxma-server-x86_64-pc-windows-msvc.exe" "portable must validate the Tauri-targeted sidecar"
Assert-TextContains $portable "target\release\resources" "portable must copy Tauri's resource layout"
Assert-TextContains $portable "if errorlevel 1" "portable must stop after failed build or copy commands"
Assert-TextNotContains $portable ".workbuddy" "portable must not depend on a machine-specific Node path"

$externalBin = @($config.bundle.externalBin)
if ($externalBin.Count -ne 1 -or $externalBin[0].Replace("\", "/") -ne "binaries/maxma-server") {
    throw "Tauri externalBin must define the maxma-server sidecar under binaries"
}
$sidecarMatch = [regex]::Match($main, 'sidecar\("([^"]+)"\)')
if (-not $sidecarMatch.Success -or $sidecarMatch.Groups[1].Value -ne "maxma-server") {
    throw "Rust sidecar lookup must use the configured maxma-server sidecar"
}
Assert-TextContains $portable '"%PORTABLE_DIR%\resources\binaries\%SIDECAR_NAME%"' "portable must place the target-suffix sidecar under resource_dir\\binaries"
Assert-TextNotContains $portable '"%PORTABLE_DIR%\maxma-server.exe"' "portable must not add an unverified root sidecar copy"
Assert-TextNotContains $portable 'mkdir "%PORTABLE_DIR%\binaries"' "portable must not create a sidecar directory outside resource_dir"

$portGuardCall = 'powershell -NoProfile -ExecutionPolicy Bypass -File build\\port-guard\.ps1[^\r\n]*'
Assert-Regex $dev "$portGuardCall\r?\nif errorlevel 1" "desktop dev must exit when a port-guard call fails"
Assert-Regex $start "$portGuardCall\r?\nif errorlevel 1" "startup must exit when port-guard fails"
Assert-Regex $start 'if "%READY%"=="0" \(\s*echo \[ERR\] Backend startup timed out\.\s*exit /b 1\s*\)' "startup must exit non-zero when backend readiness times out"
Assert-Regex $start 'if "%READY%"=="0" \(\s*echo \[ERR\] Frontend startup timed out\.\s*exit /b 1\s*\)' "startup must exit non-zero when frontend readiness times out"
Assert-Regex $server "$portGuardCall[^\r\n]*\r?\nif errorlevel 1 exit /b 1" "server build must exit immediately when port-guard fails"
Assert-Regex $server 'call \.venv\\Scripts\\activate\.bat\s*\r?\nif errorlevel 1 exit /b 1' "server build must stop when venv activation fails"
Assert-TextContains $server 'set "BUN_EXE=%CD%\bun-sidecar\bun.exe"' "server build must use the bundled Bun runtime"
Assert-Regex $server '"%BUN_EXE%" install --frozen-lockfile\s*\r?\n\s*if errorlevel 1\s*\(\s*popd\s*\r?\n\s*echo \[ERROR\].*\s*exit /b 1\s*\)' "server build must stop when bundled Bun dependency preparation fails"
Assert-TextNotContains $server "where bun" "server build must not depend on a global Bun installation"
Assert-Regex $server 'rmdir /s /q "%STALE_DIST_DIR%"\s*\r?\n\s*if errorlevel 1 exit /b 1' "server build must stop when stale artifacts cannot be removed"
Assert-Regex $server 'del /f /q "%DIST_EXE%"\s*\r?\n\s*if errorlevel 1 exit /b 1' "server build must stop when the old server executable cannot be removed"
Assert-Regex $server 'endlocal\s*&\s*exit /b 0' "server build must return success explicitly only after all steps pass"

Assert-TextContains $desktop "cargo tauri build" "desktop build must retain the bundled Tauri build"
Assert-TextContains $dev "MAXMA_WEB_PORT=1420" "desktop dev must use the Tauri 1420 port"
Assert-TextContains $start "MAXMA_API_PORT%,%MAXMA_WEB_PORT%" "startup must guard both configured service ports"
Assert-TextContains $start "MAXMA_WEB_PORT=1420" "startup must use the Tauri 1420 port"

if ($config.build.devUrl -ne "http://127.0.0.1:1420") {
    throw "Tauri devUrl must match the 1420 port"
}

$beforeBuild = $config.build.beforeBuildCommand.Replace("\", "/")
if ($beforeBuild -ne "cd ../../web && npm run build") {
    throw "Tauri beforeBuildCommand must resolve web from src-tauri"
}

Write-Output "Build contract tests passed."
