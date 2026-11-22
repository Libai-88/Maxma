param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$DataDir = "",
    [string]$Label = "manual",
    [switch]$StopApp
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
if (-not $DataDir) { $DataDir = Join-Path $RepoRoot "api\data" }
$DataDir = (Resolve-Path -LiteralPath $DataDir).Path

if (-not (Test-Path -LiteralPath (Join-Path $DataDir "maxma.db"))) {
    throw "找不到数据库：$(Join-Path $DataDir 'maxma.db')"
}

if ($StopApp) {
    & (Join-Path $PSScriptRoot "cowork-stop-app.ps1") -RepoRoot $RepoRoot | Out-Null
}

$backupRoot = Join-Path $DataDir "backups"
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$safeLabel = ($Label -replace '[^A-Za-z0-9._-]', '-')
if (-not $safeLabel) { $safeLabel = "manual" }
$snapshot = Join-Path $backupRoot "cowork-$safeLabel-$timestamp"
New-Item -ItemType Directory -Force -Path $snapshot | Out-Null
$payload = Join-Path $snapshot "payload"
New-Item -ItemType Directory -Force -Path $payload | Out-Null

# SQLite 主库 + WAL/SHM 一起备份，避免只拷主库导致未落盘的页丢失。
$dbFiles = Get-ChildItem -LiteralPath $DataDir -File | Where-Object { $_.Name -in @("maxma.db", "maxma.db-wal", "maxma.db-shm") }
foreach ($file in $dbFiles) {
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $payload $file.Name) -Force
}

# 配置清单：只拷已知的本地配置文件，不把整个 data/ 里的凭据/插件缓存一起带走。
$configNames = @(
    "providers.yaml",
    "panel_configs.json",
    "mcp_servers.yaml",
    "path_whitelist.yaml",
    "settings_overrides.json",
    "news.yaml",
    "event_hooks.yaml",
    "maxma_blocker.yaml",
    "sticker_favorites.yaml",
    "sticker_preferences.yaml",
    "sticker_recent.yaml",
    "auth_token.yaml",
    "credential.key"
)
foreach ($name in $configNames) {
    $source = Join-Path $DataDir $name
    if (Test-Path -LiteralPath $source) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $payload $name) -Force
    }
}

# Cowork 任务的 staging 产物与 DB 记录必须成套备份：只恢复 DB 会让产物记录指向空文件。
$coworkDir = Join-Path $DataDir "cowork"
if (Test-Path -LiteralPath $coworkDir) {
    $coworkDest = Join-Path $payload "cowork"
    New-Item -ItemType Directory -Force -Path $coworkDest | Out-Null
    Copy-Item -Path (Join-Path $coworkDir "*") -Destination $coworkDest -Recurse -Force
}

# 人设/规则模板是仓库配置，不是 data/ 下的运行时凭据；备份到 payload/config。
$personas = Join-Path $RepoRoot "config\personas"
if (Test-Path -LiteralPath $personas) {
    $personaDest = Join-Path $payload "config\personas"
    New-Item -ItemType Directory -Force -Path $personaDest | Out-Null
    Copy-Item -Path (Join-Path $personas "*") -Destination $personaDest -Recurse -Force
}

$files = @()
Get-ChildItem -LiteralPath $payload -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($payload.Length).TrimStart('\', '/')
    $files += [ordered]@{
        path = $relative
        bytes = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

$gitBranch = ""
$gitHead = ""
try {
    $gitBranch = (& git -C $RepoRoot rev-parse --abbrev-ref HEAD 2>$null | Out-String).Trim()
    $gitHead = (& git -C $RepoRoot rev-parse HEAD 2>$null | Out-String).Trim()
} catch { }

$manifest = [ordered]@{
    schema_version = 1
    kind = "cowork-data-backup"
    created_at = (Get-Date).ToString("o")
    label = $safeLabel
    repo_root = $RepoRoot
    data_dir = $DataDir
    git_branch = $gitBranch
    git_head = $gitHead
    files = $files
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $snapshot "manifest.json") -Encoding UTF8

Write-Host "[cowork-backup] PASS"
Write-Host "  snapshot: $snapshot"
Write-Host "  database: $(Join-Path $payload 'maxma.db')"
Write-Host "  files:    $($files.Count)"
Write-Host "  restore:  scripts\cowork-rollback.ps1 -BackupPath '$snapshot' -NoGit"
