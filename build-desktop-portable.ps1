param(
    [switch]$SkipDependencyInstall
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path $PSScriptRoot).Path
$DriveRoot = [System.IO.Path]::GetPathRoot($ProjectRoot)
if ($DriveRoot -ne "D:\") {
    throw "便携桌面构建仅允许在 D: 工作区运行，当前路径：$ProjectRoot"
}

$DistRoot = Join-Path $ProjectRoot "dist"
$CacheRoot = Join-Path $DistRoot "cache"
$BuildTemp = Join-Path $DistRoot "temp"
$ElectronPackage = Join-Path $ProjectRoot "desktop"
$RuntimeDir = Join-Path $DistRoot "electron-runtime"
$OutputDir = Join-Path $DistRoot "electron-portable"
$BunExe = Join-Path $ProjectRoot "bun-sidecar\bun.exe"

foreach ($path in @($DistRoot, $CacheRoot, $BuildTemp, $RuntimeDir, $OutputDir)) {
    $resolved = [System.IO.Path]::GetFullPath($path)
    if (-not $resolved.StartsWith($DistRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝写入 dist 目录以外的构建路径：$resolved"
    }
}
if (-not (Test-Path $BunExe)) {
    throw "D 盘缺少已准备好的 Bun 运行时，已停止构建以避免触发其他缓存路径：$BunExe"
}

New-Item -ItemType Directory -Force -Path $CacheRoot, $BuildTemp, $RuntimeDir, $OutputDir | Out-Null
$env:TEMP = $BuildTemp
$env:TMP = $BuildTemp
$env:npm_config_cache = Join-Path $CacheRoot "npm"
$env:ELECTRON_CACHE = Join-Path $CacheRoot "electron"
$env:ELECTRON_BUILDER_CACHE = Join-Path $CacheRoot "electron-builder"
$env:BUN_INSTALL_CACHE_DIR = Join-Path $CacheRoot "bun"
$env:MAXMA_ELECTRON_RUNTIME_DIR = $RuntimeDir
$env:MAXMA_ELECTRON_OUTPUT_DIR = $OutputDir

Write-Host "[1/5] 检查 D 盘构建缓存和桌面依赖..."
if (-not (Test-Path (Join-Path $ElectronPackage "package-lock.json"))) {
    throw "desktop/package-lock.json 不存在。请在 D:\Maxma\MaxmaHere\desktop 目录运行 npm install。"
}
if (-not (Test-Path (Join-Path $ElectronPackage "node_modules\electron\package.json"))) {
    if ($SkipDependencyInstall) {
        throw "Electron 依赖未安装，且指定了 SkipDependencyInstall。"
    }
    Push-Location $ElectronPackage
    try {
        npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "安装 Electron 依赖失败。" }
    } finally { Pop-Location }
}

Write-Host "[2/5] 构建 Vue 前端..."
if (-not (Test-Path (Join-Path $ProjectRoot "web\node_modules"))) {
    if ($SkipDependencyInstall) { throw "web/node_modules 不存在，已停止构建。" }
    Push-Location (Join-Path $ProjectRoot "web")
    try {
        npm ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "安装前端依赖失败。" }
    } finally { Pop-Location }
}
Push-Location (Join-Path $ProjectRoot "web")
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "前端构建失败。" }
} finally { Pop-Location }

Write-Host "[3/5] 用 Bun 直接构建后端（跳过会清理端口的便携脚本）..."
$BackendDir = Join-Path $ProjectRoot "bun-backend"
$SidecarDir = Join-Path $ProjectRoot "bun-sidecar"
Push-Location $BackendDir
try {
    & $BunExe install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "bun-backend 依赖检查失败。" }
} finally { Pop-Location }
Push-Location $SidecarDir
try {
    & $BunExe install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "bun-sidecar 依赖检查失败。" }
} finally { Pop-Location }
Push-Location $BackendDir
try {
    & $BunExe run build-server.mjs
    if ($LASTEXITCODE -ne 0) { throw "Bun 后端打包失败。" }
} finally {
    Pop-Location
}

Write-Host "[4/5] 暂存桌面运行资源..."
$BackendBundle = Join-Path $DistRoot "bun-server"
$BackendNodeModules = Join-Path $BackendDir "node_modules"
$RuntimeNodeModules = Join-Path $BackendBundle "node_modules"
New-Item -ItemType Directory -Force -Path $RuntimeNodeModules | Out-Null
foreach ($module in @("sharp", "@img\sharp-win32-x64", "@img\colour", "detect-libc", "semver")) {
    $source = Join-Path $BackendNodeModules $module
    $destination = Join-Path $RuntimeNodeModules $module
    if (-not (Test-Path $destination) -and (Test-Path $source)) {
        New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
    }
}

foreach ($required in @(
    (Join-Path $BackendBundle "server.js"),
    (Join-Path $BackendBundle "node_modules\sharp"),
    (Join-Path $BackendBundle "node_modules\@img\sharp-win32-x64")
)) {
    if (-not (Test-Path $required)) { throw "后端运行资源缺失：$required" }
}
Copy-Item -Path (Join-Path $BackendBundle "*") -Destination $RuntimeDir -Recurse -Force

$PersonaDir = Join-Path $RuntimeDir "config\personas"
New-Item -ItemType Directory -Force -Path $PersonaDir | Out-Null
foreach ($name in @("AGENTS.md", "MAXMA.md", "SOUL.example.md", "USER.example.md")) {
    Copy-Item -LiteralPath (Join-Path $ProjectRoot "config\personas\$name") -Destination $PersonaDir -Force
}
# 内置人格是产品资源：两个正式人格必须始终随包提供。
$BuiltInPersonaNames = @("SOUL.md", "SOUL.饱饱.md")
$BuiltInPersonaSourceDir = Join-Path $ProjectRoot "config\personas"
foreach ($name in $BuiltInPersonaNames) {
    $source = Join-Path $BuiltInPersonaSourceDir $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "内置人格资源缺失，无法构建便携版：$source"
    }
    Copy-Item -LiteralPath $source -Destination $PersonaDir -Force
}
$BundledSkillNames = @(
    "coding-starter",
    "office-starter",
    "debugging-starter",
    "document-starter",
    "spreadsheet-starter",
    "mcp-starter",
    "execution-playbook",
    "cost-aware",
    "research-evidence",
    "document-quality",
    "security-review"
)
$StickersDir = Join-Path $RuntimeDir "config\stickers"
Copy-Item -Path (Join-Path $ProjectRoot "config\rules") -Destination (Join-Path $RuntimeDir "config") -Recurse -Force
Copy-Item -Path (Join-Path $ProjectRoot "config\stickers") -Destination (Join-Path $RuntimeDir "config") -Recurse -Force
$CustomStickerDir = Join-Path $StickersDir "custom"
if (Test-Path $CustomStickerDir) {
    $resolvedCustom = [System.IO.Path]::GetFullPath($CustomStickerDir)
    if (-not $resolvedCustom.StartsWith([System.IO.Path]::GetFullPath($StickersDir), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝清理目标资源目录之外的路径：$resolvedCustom"
    }
    Remove-Item -LiteralPath $resolvedCustom -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $ProjectRoot "version.py") -Destination $RuntimeDir -Force
New-Item -ItemType Directory -Force -Path (Join-Path $RuntimeDir "bun-sidecar") | Out-Null
Copy-Item -LiteralPath (Join-Path $ProjectRoot "bun-sidecar\package.json") -Destination (Join-Path $RuntimeDir "bun-sidecar\package.json") -Force
New-Item -ItemType Directory -Force -Path (Join-Path $RuntimeDir "macros") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $RuntimeDir ".omp\skills"), (Join-Path $RuntimeDir ".maxma\skills"), (Join-Path $RuntimeDir "web\dist") | Out-Null
Copy-Item -Path (Join-Path $ProjectRoot ".omp\skills\*") -Destination (Join-Path $RuntimeDir ".omp\skills") -Recurse -Force
Copy-Item -Path (Join-Path $ProjectRoot ".maxma\skills\*") -Destination (Join-Path $RuntimeDir ".maxma\skills") -Recurse -Force
$BundledSkillNames | ForEach-Object {
    $sourceSkill = Join-Path $ProjectRoot (Join-Path ".maxma\skills" (Join-Path $_ "SKILL.md"))
    $runtimeSkill = Join-Path $RuntimeDir (Join-Path ".maxma\skills" (Join-Path $_ "SKILL.md"))
    if (-not (Test-Path -LiteralPath $sourceSkill -PathType Leaf)) {
        throw "随包技能资源缺失：$sourceSkill"
    }
    if (-not (Test-Path -LiteralPath $runtimeSkill -PathType Leaf)) {
        throw "桌面运行目录缺少随包技能：$runtimeSkill"
    }
}
Copy-Item -Path (Join-Path $ProjectRoot "web\dist\*") -Destination (Join-Path $RuntimeDir "web\dist") -Recurse -Force
if (Test-Path (Join-Path $ProjectRoot "workflows")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $RuntimeDir "workflows") | Out-Null
    Copy-Item -Path (Join-Path $ProjectRoot "workflows\*") -Destination (Join-Path $RuntimeDir "workflows") -Recurse -Force -ErrorAction SilentlyContinue
}
$marker = Join-Path $RuntimeDir "portable.flag"
Set-Content -LiteralPath $marker -Value "MaxmaHere Portable Desktop Mode" -Encoding utf8

Write-Host "[5/5] 生成 Windows x64 桌面便携 ZIP..."
$desktopPackage = Get-Content -LiteralPath (Join-Path $ElectronPackage "package.json") -Raw | ConvertFrom-Json
$versionText = Get-Content -LiteralPath (Join-Path $ProjectRoot "version.py") -Raw
$versionMatch = [regex]::Match($versionText, '__version__\s*=\s*["'']([^"'']+)["'']')
if (-not $versionMatch.Success) {
    throw "无法从 version.py 读取应用版本。"
}
$canonicalVersion = $versionMatch.Groups[1].Value.TrimStart('v')
if ([string]$desktopPackage.version -ne $canonicalVersion) {
    throw "版本不一致：desktop/package.json=$($desktopPackage.version)，version.py=$canonicalVersion。"
}
$webPackage = Get-Content -LiteralPath (Join-Path $ProjectRoot "web\package.json") -Raw | ConvertFrom-Json
if ([string]$webPackage.version -ne $canonicalVersion) {
    throw "版本不一致：web/package.json=$($webPackage.version)，version.py=$canonicalVersion。"
}
$staleDataDir = Join-Path $OutputDir "win-unpacked\data"
if (Test-Path -LiteralPath $staleDataDir) {
    $resolvedStaleData = [System.IO.Path]::GetFullPath($staleDataDir)
    if (-not $resolvedStaleData.StartsWith([System.IO.Path]::GetFullPath($OutputDir), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝清理输出目录之外的运行数据：$resolvedStaleData"
    }
    Remove-Item -LiteralPath $resolvedStaleData -Recurse -Force
}
Push-Location $ElectronPackage
try {
    npm run pack:portable
    if ($LASTEXITCODE -ne 0) { throw "Electron 便携桌面打包失败。" }
} finally { Pop-Location }

$unpackedDir = Join-Path $OutputDir "win-unpacked"
if (-not (Test-Path (Join-Path $unpackedDir "MaxmaHere.exe")) -or -not (Test-Path (Join-Path $unpackedDir "resources\maxma\server.js"))) {
    throw "桌面运行目录缺少程序或后端资源。"
}
$dataSeedDir = Join-Path $unpackedDir "data\api\data"
New-Item -ItemType Directory -Force -Path $dataSeedDir | Out-Null
foreach ($seed in @(
    @{ Source = (Join-Path $ProjectRoot "api\data\news.yaml"); Name = "news.yaml" },
    @{ Source = (Join-Path $ProjectRoot "resources\default-config\mcp_servers.yaml"); Name = "mcp_servers.yaml" }
)) {
    if (-not (Test-Path -LiteralPath $seed.Source -PathType Leaf)) {
        throw "桌面默认配置资源缺失：$($seed.Source)"
    }
    Copy-Item -LiteralPath $seed.Source -Destination (Join-Path $dataSeedDir $seed.Name) -Force
}
foreach ($forbidden in @("maxma.db", "credential.key", "providers.yaml", "onboarding.json")) {
    $forbiddenPath = Join-Path $unpackedDir ("data\api\data\{0}" -f $forbidden)
    if (Test-Path -LiteralPath $forbiddenPath) {
        throw "桌面便携包运行数据中禁止出现用户文件：$forbiddenPath"
    }
}
$BuiltInPersonaNames | ForEach-Object {
    $bundledPersona = Join-Path $unpackedDir "resources\maxma\config\personas\$_"
    if (-not (Test-Path -LiteralPath $bundledPersona -PathType Leaf)) {
        throw "桌面运行目录缺少内置人格：$_"
    }
}
$BundledSkillNames | ForEach-Object {
    $bundledSkill = Join-Path $unpackedDir (Join-Path "resources\maxma\.maxma\skills" (Join-Path $_ "SKILL.md"))
    if (-not (Test-Path -LiteralPath $bundledSkill -PathType Leaf)) {
        throw "桌面运行目录缺少随包技能：$_"
    }
}
$artifactPath = Join-Path $OutputDir ("MaxmaHere-{0}-portable-x64.zip" -f $desktopPackage.version)
if (Test-Path -LiteralPath $artifactPath) {
    $resolvedArtifact = [System.IO.Path]::GetFullPath($artifactPath)
    if (-not $resolvedArtifact.StartsWith([System.IO.Path]::GetFullPath($OutputDir), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝覆盖输出目录之外的文件：$resolvedArtifact"
    }
    Remove-Item -LiteralPath $resolvedArtifact -Force
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($unpackedDir, $artifactPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
$artifact = Get-Item -LiteralPath $artifactPath
$checksumPath = "$artifactPath.sha256"
if (Test-Path -LiteralPath $checksumPath) {
    $resolvedChecksum = [System.IO.Path]::GetFullPath($checksumPath)
    if (-not $resolvedChecksum.StartsWith([System.IO.Path]::GetFullPath($OutputDir), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝覆盖输出目录之外的校验文件：$resolvedChecksum"
    }
    Remove-Item -LiteralPath $resolvedChecksum -Force
}
$hash = (Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath $checksumPath -Value "$hash  $($artifact.Name)" -Encoding ascii
$zip = [System.IO.Compression.ZipFile]::OpenRead($artifact.FullName)
try {
    $zipEntryNames = @($zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    $exeEntry = $zipEntryNames | Where-Object { $_ -match "MaxmaHere\.exe$" } | Select-Object -First 1
    $runtimeEntry = $zipEntryNames | Where-Object { $_ -match "resources/maxma/server\.js$" } | Select-Object -First 1
    $personaEntries = @($BuiltInPersonaNames | ForEach-Object {
        $entryName = "resources/maxma/config/personas/$_"
        $zipEntryNames | Where-Object { $_ -eq $entryName } | Select-Object -First 1
    })
    $skillEntries = @($BundledSkillNames | ForEach-Object {
        $entryName = "resources/maxma/.maxma/skills/$_/SKILL.md"
        $zipEntryNames | Where-Object { $_ -eq $entryName } | Select-Object -First 1
    })
    if (-not $exeEntry -or -not $runtimeEntry) { throw "便携 ZIP 缺少桌面程序或 Maxma 后端资源。" }
    if ($personaEntries.Count -ne $BuiltInPersonaNames.Count -or $personaEntries -contains $null) {
        throw "便携 ZIP 缺少内置人格文件。"
    }
    if ($skillEntries.Count -ne $BundledSkillNames.Count -or $skillEntries -contains $null) {
        throw "便携 ZIP 缺少随包技能文件。"
    }
} finally {
    $zip.Dispose()
}
Write-Host "[完成] $($artifact.FullName) ($([math]::Round($artifact.Length / 1MB, 1)) MB)"
Write-Host "[校验] $checksumPath (SHA-256: $hash)"
Write-Host "[数据] 启动后用户数据和 Chromium 缓存保存在程序旁的 data\ 目录。"
