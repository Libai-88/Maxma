<#
.SYNOPSIS
    Download the official Bun Windows binary (pinned version) and place it at
    bun-sidecar/bun.exe so PyInstaller bundles it into the packaged backend.
.DESCRIPTION
    In production the backend launches the oh-my-pi sidecar via the bundled
    bun.exe: _resolve_bun_path() in api/pi_bridge/sidecar_manager.py looks for
    bun-sidecar/bun.exe under the PyInstaller _MEIPASS directory. This script
    prepares that binary at build time so the packaged artifact can start the
    agent engine on a clean machine.

    Shares the download cache with prepare-runtime.ps1
    (%LOCALAPPDATA%/MaxmaBuildCache) to avoid repeated downloads.
.PARAMETER BunVersion
    Pinned Bun version (kept in sync with the dev environment).
.PARAMETER CacheDir
    Download cache directory.
#>

param(
    [string]$BunVersion = "1.3.14",
    [string]$CacheDir = "$env:LOCALAPPDATA\MaxmaBuildCache"
)

$ErrorActionPreference = "Stop"

$BunUrl = "https://github.com/oven-sh/bun/releases/download/bun-v$BunVersion/bun-windows-x64.zip"
$ProjectRoot = Resolve-Path "$PSScriptRoot\.."
$BunSidecarDir = Join-Path $ProjectRoot "bun-sidecar"
$TargetBunExe = Join-Path $BunSidecarDir "bun.exe"

function Invoke-DownloadWithCache {
    param([string]$Url, [string]$CachePath)
    if (Test-Path $CachePath) {
        Write-Host "[cache] hit: $CachePath"
        return $CachePath
    }
    Write-Host "[download] $Url"
    New-Item -ItemType Directory -Force -Path (Split-Path $CachePath) | Out-Null
    Invoke-WebRequest -Uri $Url -OutFile $CachePath -UseBasicParsing
    return $CachePath
}

Write-Host "=== prepare-bun: Bun $BunVersion (Windows x64) ===" -ForegroundColor Cyan

$zipPath = Invoke-DownloadWithCache -Url $BunUrl -CachePath (Join-Path $CacheDir "bun-windows-x64-$BunVersion.zip")

# Extract to cache dir, then pull bun.exe out
$extractDir = Join-Path $CacheDir "bun-extract-$BunVersion"
if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

# The zip contains a bun-windows-x64/ subdir; locate bun.exe recursively
$bunExe = Get-ChildItem -Path $extractDir -Recurse -Filter "bun.exe" | Select-Object -First 1
if (-not $bunExe) {
    Write-Host "[error] bun.exe not found in the downloaded archive" -ForegroundColor Red
    exit 1
}

Copy-Item $bunExe.FullName $TargetBunExe -Force
Write-Host "[ok] bun.exe -> $TargetBunExe" -ForegroundColor Green

# Verify the binary runs
try {
    $ver = & $TargetBunExe --version
    Write-Host "[ok] bundled bun version: $ver"
} catch {
    Write-Host "[warn] could not verify bun.exe version: $_" -ForegroundColor Yellow
}

Write-Host "=== prepare-bun complete ===" -ForegroundColor Green
