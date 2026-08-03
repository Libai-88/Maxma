<#
.SYNOPSIS
    Embedded runtime preparation (no-op).
.DESCRIPTION
    The Bun sidecar is now compiled into a single-file executable
    (maxma-engine.exe) that embeds its own Bun runtime. The separate
    node/python/uv runtimes are no longer shipped, so this step downloads
    nothing. The compiled sidecar is produced by build-server.bat via
    bun-sidecar/build-compiled.mjs and staged under
    desktop/src-tauri/resources/runtime/.
.PARAMETER ResourcesDir
    Tauri resources directory path, defaults to two levels up from script location.
.PARAMETER CacheDir
    Kept for call-site compatibility; unused.
#>
param(
    [string]$ResourcesDir = "$PSScriptRoot\..\desktop\src-tauri\resources",
    [string]$CacheDir = "$env:LOCALAPPDATA\MaxmaBuildCache"
)

$ErrorActionPreference = "Stop"

Write-Host "=== prepare-runtime: no-op ===" -ForegroundColor Cyan
Write-Host "[skip] node/python/uv downloads removed; maxma-engine.exe bundles Bun runtime" -ForegroundColor Yellow
Write-Host "[ok]  sidecar output: $ResourcesDir\runtime\maxma-engine.exe"
