<#
.SYNOPSIS
    下载并解压嵌入式运行时（Node.js + Python embeddable + uv）到 Tauri resources 目录。
.DESCRIPTION
    构建时调用，产物释放到 desktop/src-tauri/resources/runtime/。
    下载缓存到 %LOCALAPPDATA%/MaxmaBuildCache/ 避免重复下载。
.PARAMETER ResourcesDir
    Tauri resources 目录路径，默认为脚本所在目录上两级的 desktop/src-tauri/resources。
.PARAMETER CacheDir
    下载缓存目录，默认为 %LOCALAPPDATA%/MaxmaBuildCache。
#>

param(
    [string]$ResourcesDir = "$PSScriptRoot\..\desktop\src-tauri\resources",
    [string]$CacheDir = "$env:LOCALAPPDATA\MaxmaBuildCache"
)

$ErrorActionPreference = "Stop"

# ── 版本固定 ──
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

# ── 工具函数 ──

function Invoke-DownloadWithCache {
    param([string]$Url, [string]$CachePath)
    if (Test-Path $CachePath) {
        Write-Host "[cache] 命中缓存: $CachePath"
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

# ── 主流程 ──

Write-Host "=== prepare-runtime: 下载嵌入式运行时 ===" -ForegroundColor Cyan

# 1. Node.js
Write-Host "`n[1/3] Node.js $NodeVersion" -ForegroundColor Yellow
$nodeZip = Invoke-DownloadWithCache -Url $NodeUrl -CachePath (Join-Path $CacheDir "node-$NodeVersion-win-x64.zip")
Expand-ZipToDir -ZipPath $nodeZip -DestDir $NodeDir
# Node.js zip 解压后有一层 node-vX.Y.Z-win-x64/ 子目录，需要提升
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

# Python embeddable 后处理：启用 site-packages + 安装 pip
$pthFile = Get-ChildItem $PythonDir -Filter "python*._pth" | Select-Object -First 1
if ($pthFile) {
    $content = Get-Content $pthFile.FullName
    # 取消 import site 注释
    $content = $content | ForEach-Object { if ($_ -match "^#\s*import site") { "import site" } else { $_ } }
    Set-Content $pthFile.FullName -Value $content
    Write-Host "[ok] 已启用 site-packages: $($pthFile.Name)"
}

# 安装 pip
$getPipUrl = "https://bootstrap.pypa.io/get-pip.py"
$getPipPath = Join-Path $env:TEMP "get-pip.py"
Invoke-WebRequest -Uri $getPipUrl -OutFile $getPipPath -UseBasicParsing
& "$PythonDir\python.exe" $getPipPath --quiet
Remove-Item $getPipPath -Force
Write-Host "[ok] pip 已安装"

# 3. uv
Write-Host "`n[3/3] uv $UvVersion" -ForegroundColor Yellow
$uvZip = Invoke-DownloadWithCache -Url $UvUrl -CachePath (Join-Path $CacheDir "uv-$UvVersion.zip")
Expand-ZipToDir -ZipPath $uvZip -DestDir $UvDir
Write-Host "[ok] uv -> $UvDir"

Write-Host "`n=== prepare-runtime 完成 ===" -ForegroundColor Green
Write-Host "产物目录: $RuntimeDir"
