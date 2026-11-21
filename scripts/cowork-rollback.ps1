param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$DataDir = "",
    [string]$BackupPath = "",
    [string]$Ref = "baseline-local-workbench-v2.7.0",
    [switch]$NoGit,
    [switch]$NoConfig,
    [switch]$Build,
    [switch]$BuildDesktop,
    [switch]$Smoke,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
if (-not $DataDir) { $DataDir = Join-Path $RepoRoot "api\data" }
$DataDir = (Resolve-Path -LiteralPath $DataDir).Path
$dbPath = Join-Path $DataDir "maxma.db"

if (-not $NoGit) {
    $dirty = (& git -C $RepoRoot status --porcelain 2>$null | Out-String).Trim()
    if ($dirty -and -not $Force) {
        throw "工作区有未提交改动，拒绝回滚以免覆盖它们。请先提交/暂存，或显式加 -Force。`n$dirty"
    }
}

if (-not $NoGit) {
    & git -C $RepoRoot rev-parse --verify "$Ref^{commit}" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "找不到回滚目标：$Ref" }
}

# 先给“回滚前”留一份快照，避免回滚本身把当前状态彻底丢掉。
$backupRoot = Join-Path $DataDir "backups"
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$preRollback = Join-Path $backupRoot "rollback-$timestamp"
New-Item -ItemType Directory -Force -Path $preRollback | Out-Null
if (Test-Path -LiteralPath $dbPath) {
    Get-ChildItem -LiteralPath $DataDir -File | Where-Object { $_.Name -in @("maxma.db", "maxma.db-wal", "maxma.db-shm") } |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $preRollback $_.Name) -Force }
}

& (Join-Path $PSScriptRoot "cowork-stop-app.ps1") -RepoRoot $RepoRoot | Out-Null

# 解析备份：目录（含 payload/maxma.db）或直接给 .db 文件。
$resolvedBackup = $null
if ($BackupPath) {
    $candidate = (Resolve-Path -LiteralPath $BackupPath).Path
    if (Test-Path -LiteralPath $candidate -PathType Container) {
        $inside = Join-Path $candidate "payload\maxma.db"
        if (-not (Test-Path -LiteralPath $inside)) { $inside = Join-Path $candidate "maxma.db" }
        if (Test-Path -LiteralPath $inside) { $resolvedBackup = $inside }
    } elseif (Test-Path -LiteralPath $candidate -PathType Leaf) {
        $resolvedBackup = $candidate
    }
} else {
    $dirs = Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "cowork-*" } |
        Sort-Object LastWriteTime -Descending
    foreach ($dir in $dirs) {
        $candidate = Join-Path $dir.FullName "payload\maxma.db"
        if (-not (Test-Path -LiteralPath $candidate)) { $candidate = Join-Path $dir.FullName "maxma.db" }
        if (Test-Path -LiteralPath $candidate) { $resolvedBackup = $candidate; break }
    }
}
if (-not $resolvedBackup) {
    throw "找不到可恢复的 maxma.db 备份。请用 -BackupPath 指定备份目录或文件。"
}
if (-not (Test-Path -LiteralPath $resolvedBackup)) { throw "备份文件不存在：$resolvedBackup" }

# 恢复数据库：先删当前 WAL/SHM，避免旧库配新 WAL 造成不一致。
if (Test-Path -LiteralPath "$dbPath-wal") { Remove-Item -LiteralPath "$dbPath-wal" -Force }
if (Test-Path -LiteralPath "$dbPath-shm") { Remove-Item -LiteralPath "$dbPath-shm" -Force }
Copy-Item -LiteralPath $resolvedBackup -Destination $dbPath -Force
$backupPayload = Split-Path -Parent $resolvedBackup
foreach ($suffix in @("-wal", "-shm")) {
    $side = Join-Path $backupPayload ("maxma.db" + $suffix)
    if (Test-Path -LiteralPath $side) {
        Copy-Item -LiteralPath $side -Destination ($dbPath + $suffix) -Force
    }
}

if (-not $NoConfig) {
    $configNames = @(
        "providers.yaml", "panel_configs.json", "mcp_servers.yaml",
        "path_whitelist.yaml", "settings_overrides.json", "news.yaml",
        "event_hooks.yaml", "maxma_blocker.yaml", "sticker_favorites.yaml",
        "sticker_preferences.yaml", "sticker_recent.yaml", "auth_token.yaml",
        "credential.key"
    )
    foreach ($name in $configNames) {
        $source = Join-Path $backupPayload $name
        if (Test-Path -LiteralPath $source) {
            Copy-Item -LiteralPath $source -Destination (Join-Path $DataDir $name) -Force
        }
    }
    $personaBackup = Join-Path $backupPayload "config\personas"
    if (Test-Path -LiteralPath $personaBackup) {
        $personaDest = Join-Path $RepoRoot "config\personas"
        New-Item -ItemType Directory -Force -Path $personaDest | Out-Null
        Copy-Item -Path (Join-Path $personaBackup "*") -Destination $personaDest -Recurse -Force
    }
}

$checkedOut = ""
if (-not $NoGit) {
    & git -C $RepoRoot switch --detach $Ref
    if ($LASTEXITCODE -ne 0) { throw "切换到 $Ref 失败。" }
    $checkedOut = (& git -C $RepoRoot rev-parse HEAD | Out-String).Trim()
}

if ($Build) {
    Write-Host "[cowork-rollback] rebuilding Web portable from checked-out source..."
    & (Join-Path $RepoRoot "build-portable.bat")
    if ($LASTEXITCODE -ne 0) { throw "便携包重建失败。" }
}
if ($BuildDesktop) {
    Write-Host "[cowork-rollback] rebuilding desktop portable from checked-out source..."
    & (Join-Path $RepoRoot "build-desktop-portable.ps1")
    if ($LASTEXITCODE -ne 0) { throw "桌面便携包重建失败。" }
}

$portableDir = Join-Path (Split-Path -Parent $RepoRoot) "MaxmaHere-Portable"
if ($Smoke) {
    if (-not (Test-Path -LiteralPath (Join-Path $portableDir "server.js"))) {
        throw "找不到可冒烟的便携包：$portableDir；请先加 -Build 或手工恢复旧包。"
    }
    & (Join-Path $RepoRoot "build\portable-smoke-test.ps1") -PortableDir $portableDir
    if ($LASTEXITCODE -ne 0) { throw "便携包冒烟失败。" }
}

$report = [ordered]@{
    schema_version = 1
    kind = "cowork-rollback"
    created_at = (Get-Date).ToString("o")
    restored_database = $resolvedBackup
    pre_rollback_snapshot = $preRollback
    git_ref = if ($NoGit) { "(not switched)" } else { $Ref }
    git_head = $checkedOut
    config_restored = -not $NoConfig
    build = [bool]$Build
    build_desktop = [bool]$BuildDesktop
    smoke = [bool]$Smoke
}
$reportPath = Join-Path $backupRoot "rollback-$timestamp.json"
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Host "[cowork-rollback] PASS"
Write-Host "  database:  $dbPath"
Write-Host "  backup:    $resolvedBackup"
Write-Host "  pre-snap:  $preRollback"
Write-Host "  git ref:   $($report.git_ref)"
Write-Host "  report:    $reportPath"
