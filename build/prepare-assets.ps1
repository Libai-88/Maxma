<#
.SYNOPSIS
    Download Playwright Chromium + ONNX embedding model to Tauri resources directory.
.DESCRIPTION
    Called during build, output goes to desktop/src-tauri/resources/assets/.
    Playwright Chromium via PLAYWRIGHT_BROWSERS_PATH env var.
    ONNX model downloaded from ModelScope.cn (huggingface.co may be blocked by
    corporate proxies like WattToolkit that return 401 for HF API endpoints).
.PARAMETER ResourcesDir
    Tauri resources directory path, defaults to two levels up from script location.
.PARAMETER VenvPython
    Path to project venv python.exe, used to call playwright and download script.
#>

param(
    [string]$ResourcesDir = "$PSScriptRoot\..\desktop\src-tauri\resources",
    [string]$VenvPython = "$PSScriptRoot\..\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"

$AssetsDir = Join-Path $ResourcesDir "assets"
$PlaywrightDir = Join-Path $AssetsDir "playwright"
$ModelsDir = Join-Path $AssetsDir "models"

# -- Main flow --

Write-Host "=== prepare-assets: downloading Playwright + ONNX model ===" -ForegroundColor Cyan

# 1. Playwright Chromium
Write-Host "`n[1/2] Playwright Chromium" -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $PlaywrightDir | Out-Null
$env:PLAYWRIGHT_BROWSERS_PATH = $PlaywrightDir
& $VenvPython -m playwright install chromium
if ($LASTEXITCODE -ne 0) {
    Write-Host "[error] Playwright Chromium download failed" -ForegroundColor Red
    exit 1
}
Write-Host "[ok] Chromium -> $PlaywrightDir"

# 2. ONNX embedding model
Write-Host "`n[2/2] ONNX model (paraphrase-multilingual-MiniLM-L12-v2)" -ForegroundColor Yellow
$ModelDir = Join-Path $ModelsDir "paraphrase-multilingual-MiniLM-L12-v2"
New-Item -ItemType Directory -Force -Path $ModelDir | Out-Null

# Download from ModelScope.cn (huggingface.co is blocked by WattToolkit proxy
# that returns 401 for /api/models/* endpoints). ModelScope hosts the same model
# at sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2.
& $VenvPython -c @"
import os
import sys
import json
from pathlib import Path

import requests

# ModelScope API endpoints
API_BASE = 'https://modelscope.cn/api/v1/models/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'
FILES_URL = API_BASE + '/repo/files?Revision=master'
FILE_URL_TEMPLATE = API_BASE + '/repo?Revision=master&FilePath={path}'

# Files needed by the ONNX embedding engine:
# - AutoTokenizer.from_pretrained() needs tokenizer files
# - ort.InferenceSession() needs onnx/model.onnx
# Only download model.onnx (full precision) — skip the O1/O2/O3/qint8 variants to save ~2GB
REQUIRED_FILES = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'sentence_bert_config.json',
    'config_sentence_transformers.json',
    'modules.json',
    'sentencepiece.bpe.model',
    'special_tokens_map.json',
    '1_Pooling/config.json',
    'onnx/model.onnx',
]

target_dir = Path(r'$ModelDir')
session = requests.Session()

print(f'[download] paraphrase-multilingual-MiniLM-L12-v2 -> {target_dir}')

for i, file_path in enumerate(REQUIRED_FILES, 1):
    target_file = target_dir / file_path
    target_file.parent.mkdir(parents=True, exist_ok=True)

    if target_file.exists() and target_file.stat().st_size > 0:
        print(f'  [{i}/{len(REQUIRED_FILES)}] skip (exists): {file_path}')
        continue

    url = FILE_URL_TEMPLATE.format(path=file_path)
    print(f'  [{i}/{len(REQUIRED_FILES)}] downloading: {file_path}')
    sys.stdout.flush()

    with session.get(url, stream=True, timeout=60, allow_redirects=True) as r:
        r.raise_for_status()
        total = int(r.headers.get('content-length', 0))
        downloaded = 0
        with open(target_file, 'wb') as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):  # 1MB chunks
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total > 0:
                        pct = downloaded * 100 // total
                        mb_done = downloaded / (1024 * 1024)
                        mb_total = total / (1024 * 1024)
                        print(f'    {pct:3d}% ({mb_done:.1f}/{mb_total:.1f} MB)', end='\r')
                        sys.stdout.flush()
        print(f'    done ({downloaded} bytes)' + ' ' * 30)

print('[ok] ONNX model download complete')
"@

if ($LASTEXITCODE -ne 0) {
    Write-Host "[error] ONNX model download failed" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== prepare-assets complete ===" -ForegroundColor Green
Write-Host "Output: $AssetsDir"
