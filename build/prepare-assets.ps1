<#
.SYNOPSIS
    下载 Playwright Chromium + ONNX 嵌入模型到 Tauri resources 目录。
.DESCRIPTION
    构建时调用，产物释放到 desktop/src-tauri/resources/assets/。
    Playwright Chromium 通过 PLAYWRIGHT_BROWSERS_PATH 环境变量指定下载目录。
    ONNX 模型通过 huggingface_hub.snapshot_download 下载。
.PARAMETER ResourcesDir
    Tauri resources 目录路径，默认为脚本所在目录上两级的 desktop/src-tauri/resources。
.PARAMETER VenvPython
    项目 venv 的 python.exe 路径，用于调用 playwright 和 huggingface_hub。
#>

param(
    [string]$ResourcesDir = "$PSScriptRoot\..\desktop\src-tauri\resources",
    [string]$VenvPython = "$PSScriptRoot\..\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"

$AssetsDir = Join-Path $ResourcesDir "assets"
$PlaywrightDir = Join-Path $AssetsDir "playwright"
$ModelsDir = Join-Path $AssetsDir "models"

# ── 主流程 ──

Write-Host "=== prepare-assets: 下载 Playwright + ONNX 模型 ===" -ForegroundColor Cyan

# 1. Playwright Chromium
Write-Host "`n[1/2] Playwright Chromium" -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $PlaywrightDir | Out-Null
$env:PLAYWRIGHT_BROWSERS_PATH = $PlaywrightDir
& $VenvPython -m playwright install chromium
if ($LASTEXITCODE -ne 0) {
    Write-Host "[error] Playwright Chromium 下载失败" -ForegroundColor Red
    exit 1
}
Write-Host "[ok] Chromium -> $PlaywrightDir"

# 2. ONNX 嵌入模型
Write-Host "`n[2/2] ONNX 模型 (paraphrase-multilingual-MiniLM-L12-v2)" -ForegroundColor Yellow
$ModelDir = Join-Path $ModelsDir "paraphrase-multilingual-MiniLM-L12-v2"
New-Item -ItemType Directory -Force -Path $ModelDir | Out-Null

& $VenvPython -c @"
import sys
from pathlib import Path
from huggingface_hub import snapshot_download

model_name = 'paraphrase-multilingual-MiniLM-L12-v2'
target_dir = Path(r'$ModelDir')

print(f'[download] {model_name} -> {target_dir}')
snapshot_download(
    repo_id=model_name,
    local_dir=str(target_dir),
    allow_patterns=['config.json', 'tokenizer.json', 'tokenizer_config.json', 'vocab.txt', 'onnx/*'],
)
print('[ok] ONNX 模型下载完成')
"@

if ($LASTEXITCODE -ne 0) {
    Write-Host "[error] ONNX 模型下载失败" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== prepare-assets 完成 ===" -ForegroundColor Green
Write-Host "产物目录: $AssetsDir"
