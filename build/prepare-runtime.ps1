<#
.SYNOPSIS
    Download and extract embedded runtime (Node.js + Python embeddable + uv) to Tauri resources directory.
.DESCRIPTION
    Called during build, output goes to desktop/src-tauri/resources/runtime/.
    Download cache to %LOCALAPPDATA%/MaxmaBuildCache/ to avoid repeated downloads.
.PARAMETER ResourcesDir
    Tauri resources directory path, defaults to two levels up from script location.
.PARAMETER CacheDir
    Download cache directory, defaults to %LOCALAPPDATA%/MaxmaBuildCache.
#>

param(
    [string]$ResourcesDir = "$PSScriptRoot\..\desktop\src-tauri\resources",
    [string]$CacheDir = "$env:LOCALAPPDATA\MaxmaBuildCache"
)

$ErrorActionPreference = "Stop"

# -- Pinned versions --
$NodeVersion = "v20.18.1"
$PythonVersion = "3.13.13"
$UvVersion = "0.5.11"

$NodeUrl = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
$PythonUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$UvUrl = "https://github.com/astral-sh/uv/releases/download/$UvVersion/uv-x86_64-pc-windows-msvc.zip"

$RuntimeDir = Join-Path $ResourcesDir "runtime"
$NodeDir = Join-Path $RuntimeDir "node"
$PythonDir = Join-Path $RuntimeDir "python"
$UvDir = Join-Path $RuntimeDir "uv"

# -- Helper functions --

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

function Expand-ZipToDir {
    param([string]$ZipPath, [string]$DestDir)
    if (Test-Path $DestDir) { Remove-Item $DestDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
    Expand-Archive -Path $ZipPath -DestinationPath $DestDir -Force
}

# -- Main flow --

Write-Host "=== prepare-runtime: downloading embedded runtime ===" -ForegroundColor Cyan

# 1. Node.js
Write-Host "`n[1/3] Node.js $NodeVersion" -ForegroundColor Yellow
$nodeZip = Invoke-DownloadWithCache -Url $NodeUrl -CachePath (Join-Path $CacheDir "node-$NodeVersion-win-x64.zip")
Expand-ZipToDir -ZipPath $nodeZip -DestDir $NodeDir
# Node.js zip extracts to node-vX.Y.Z-win-x64/ subdir, need to lift
$nodeSubDir = Get-ChildItem $NodeDir -Directory | Select-Object -First 1
if ($nodeSubDir) {
    Move-Item "$($nodeSubDir.FullName)\*" $NodeDir -Force
    Remove-Item $nodeSubDir.FullName -Force
}
Write-Host "[ok] Node.js -> $NodeDir"

# 2. Python embeddable
Write-Host "`n[2/3] Python $PythonVersion embeddable" -ForegroundColor Yellow
$pyZip = Invoke-DownloadWithCache -Url $PythonUrl -CachePath (Join-Path $CacheDir "python-$PythonVersion-embed-amd64.zip")
Expand-ZipToDir -ZipPath $pyZip -DestDir $PythonDir

# Python embeddable post-processing: enable site-packages + install pip
$pthFile = Get-ChildItem $PythonDir -Filter "python*._pth" | Select-Object -First 1
if ($pthFile) {
    $content = Get-Content $pthFile.FullName
    # uncomment "import site"
    $content = $content | ForEach-Object { if ($_ -match "^#\s*import site") { "import site" } else { $_ } }
    # ensure Lib\site-packages path is present so pip can install packages
    if (-not ($content | Where-Object { $_ -match "^Lib\\site-packages" })) {
        $content = @($content | Where-Object { $_ -ne "" }) + @("Lib\site-packages", "")
    }
    Set-Content $pthFile.FullName -Value $content
    Write-Host "[ok] site-packages enabled: $($pthFile.Name)"
}

# Create Lib\site-packages directory so pip has a target
$sitePackagesDir = Join-Path $PythonDir "Lib\site-packages"
New-Item -ItemType Directory -Force -Path $sitePackagesDir | Out-Null

# Install pip
# Note: user may have a global pip.ini with target=D:\PythonLibraries\site-packages
# that hijacks every `pip install`. We must override via PIP_TARGET env var
# pointing to the embeddable's Lib\site-packages. Also clear PYTHONUSERBASE /
# PYTHONPATH to prevent user-site hijack. Use .NET ProcessStartInfo for full
# control over the child process environment.
$getPipUrl = "https://bootstrap.pypa.io/get-pip.py"
$getPipPath = Join-Path $env:TEMP "get-pip.py"
Invoke-WebRequest -Uri $getPipUrl -OutFile $getPipPath -UseBasicParsing

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "$PythonDir\python.exe"
$psi.Arguments = '"' + $getPipPath + '" --quiet --no-warn-script-location'
$psi.UseShellExecute = $false
# Copy current env vars, but skip PYTHONUSERBASE / PYTHONPATH to avoid hijack
foreach ($k in [System.Environment]::GetEnvironmentVariables().Keys) {
    if ($k -ne 'PYTHONUSERBASE' -and $k -ne 'PYTHONPATH' -and $k -ne 'PIP_TARGET') {
        $psi.EnvironmentVariables[$k] = [System.Environment]::GetEnvironmentVariable($k)
    }
}
# Force pip to install into the embeddable's Lib\site-packages
$psi.EnvironmentVariables["PIP_TARGET"] = $sitePackagesDir
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$proc = [System.Diagnostics.Process]::Start($psi)
$outTask = $proc.StandardOutput.ReadToEndAsync()
$errTask = $proc.StandardError.ReadToEndAsync()
$proc.WaitForExit()
$stdout = $outTask.Result
$stderr = $errTask.Result
if ($proc.ExitCode -ne 0) {
    Write-Host "[error] pip install failed (exit code $($proc.ExitCode))" -ForegroundColor Red
    Write-Host $stdout
    Write-Host $stderr -ForegroundColor Red
    exit 1
}
Remove-Item $getPipPath -Force
Write-Host "[ok] pip installed"

# 3. uv
Write-Host "`n[3/3] uv $UvVersion" -ForegroundColor Yellow
$uvZip = Invoke-DownloadWithCache -Url $UvUrl -CachePath (Join-Path $CacheDir "uv-$UvVersion.zip")
Expand-ZipToDir -ZipPath $uvZip -DestDir $UvDir
Write-Host "[ok] uv -> $UvDir"

Write-Host "`n=== prepare-runtime complete ===" -ForegroundColor Green
Write-Host "Output: $RuntimeDir"
