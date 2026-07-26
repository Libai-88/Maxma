<#
.SYNOPSIS
    Prepare Tauri resources directory (placeholder for future downloads).
.DESCRIPTION
    Called during build. Currently skips all downloads:
    - Playwright Chromium: oh-my-pi uses Puppeteer, browsers are downloaded on-demand by @puppeteer/browsers
    - ONNX models: knowledge base feature removed, embeddings not needed
.PARAMETER ResourcesDir
    Tauri resources directory path, defaults to two levels up from script location.
#>

param(
    [string]$ResourcesDir = "$PSScriptRoot\..\desktop\src-tauri\resources"
)

$ErrorActionPreference = "Stop"

$AssetsDir = Join-Path $ResourcesDir "assets"

# -- Main flow --

Write-Host "=== prepare-assets: resource preparation ===" -ForegroundColor Cyan

# 1. Playwright Chromium
# DISABLED: oh-my-pi 使用 Puppeteer（非 Playwright），浏览器由 @puppeteer/browsers 按需下载
# 用户首次使用浏览器工具时，Puppeteer 会自动下载到用户数据目录
Write-Host "`n[1/2] Playwright Chromium (SKIPPED - using Puppeteer on-demand)" -ForegroundColor Yellow
Write-Host "[ok] Skipped Playwright download (saves 690MB)"
Write-Host "[info] Puppeteer will auto-download browsers when first used"

# 2. ONNX embedding model
# DISABLED: 知识库功能已移除，chromadb + onnxruntime 依赖已从 requirements.txt 清除
Write-Host "`n[2/2] ONNX model (SKIPPED - knowledge base feature removed)" -ForegroundColor Yellow
Write-Host "[ok] Skipped ONNX model download (saves 463MB)"

Write-Host "`n=== prepare-assets complete ===" -ForegroundColor Green
Write-Host "Total saved: ~1.15GB (690MB Playwright + 463MB ONNX)"
Write-Host "Browsers will be downloaded on-demand by Puppeteer when first used"
