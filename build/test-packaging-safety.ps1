param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$TocPath = "",
    [string]$PortableDir = "",
    [switch]$SkipArtifact
)

$ErrorActionPreference = "Stop"

function Read-ProjectFile {
    param([string]$RelativePath)

    $path = Join-Path $ProjectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Missing packaging safety input: $RelativePath"
    }
    return Get-Content -LiteralPath $path -Raw
}

function Assert-Contains {
    param(
        [string]$Text,
        [string]$Needle,
        [string]$Message
    )

    if (-not $Text.Contains($Needle)) {
        throw $Message
    }
}

function Assert-NotContains {
    param(
        [string]$Text,
        [string]$Needle,
        [string]$Message
    )

    if ($Text.Contains($Needle)) {
        throw $Message
    }
}

function Assert-NotMatch {
    param(
        [string]$Text,
        [string]$Pattern,
        [string]$Message
    )

    if ($Text -match $Pattern) {
        throw $Message
    }
}

$spec = Read-ProjectFile "build\maxma-server.spec"
$portable = Read-ProjectFile "build-portable.bat"

# The PyInstaller manifest must never recurse over the live config tree.
Assert-NotContains $spec '(str(project_root / "config"), "config")' `
    "PyInstaller spec must not bundle the entire config directory"
Assert-NotMatch $spec '(?i)project_root\s*/\s*"config"\s*/\s*"personas"\s*/\s*"(?:memory\.yaml|SOUL\.md|USER\.md|active_persona\.yaml)"' `
    "PyInstaller spec names a live persona or memory file"
Assert-NotMatch $spec '(?i)project_root\s*/\s*"config"[^\r\n]*(?:\.lock|\.sqlite3)' `
    "PyInstaller spec names a lock or SQLite file under config"
Assert-Contains $spec 'config" / "personas" / "AGENTS.md' `
    "PyInstaller spec must include the built-in AGENTS template"
Assert-Contains $spec 'config" / "personas" / "SOUL.example.md' `
    "PyInstaller spec must include the built-in SOUL template"
Assert-Contains $spec 'config" / "personas" / "USER.example.md' `
    "PyInstaller spec must include the built-in USER template"
Assert-Contains $spec 'path.name != "custom"' `
    "PyInstaller spec must exclude user-uploaded custom stickers"

# Portable assembly may stage the application and static resources only.  It
# must not copy repository data into the portable output directory.
Assert-NotMatch $portable '(?im)%PORTABLE_DIR%[^\r\n]*(?:api\\data|config\\personas|credential\.key|providers\.yaml|mcp_servers\.yaml|maxma\.db)' `
    "portable build must not place user configuration or credentials in its output"
Assert-NotMatch $portable '(?im)xcopy[^\r\n]*%PROJECT_ROOT%[^\r\n]*config[^\r\n]*%PORTABLE_DIR%' `
    "portable build must not recursively copy repository config into its output"

$resolvedToc = if ($TocPath) {
    [IO.Path]::GetFullPath((Join-Path $ProjectRoot $TocPath))
} else {
    Join-Path $ProjectRoot "build\maxma-server\PKG-00.toc"
}

if (-not $SkipArtifact) {
    if (-not (Test-Path -LiteralPath $resolvedToc -PathType Leaf)) {
        throw "PyInstaller TOC not found: $resolvedToc"
    }

    $toc = Get-Content -LiteralPath $resolvedToc -Raw
    $forbiddenArtifactPatterns = @(
        '(?i)config[\\/]personas[\\/](?:memory(?:_[^\\/]+)?\.yaml|SOUL\.md|USER\.md|active_persona\.yaml)',
        '(?i)config[\\/]personas[\\/][^\r\n]*(?:\.lock|\.sqlite3(?:-[a-z]+)?)',
        '(?i)config[\\/]stickers[\\/]custom[\\/]',
        '(?i)[\\/]config[\\/]personas[\\/]SOUL\.[^./\\]+\.md'
    )
    foreach ($pattern in $forbiddenArtifactPatterns) {
        if ($toc -match $pattern) {
            throw "PyInstaller artifact contains forbidden user data matching: $pattern"
        }
    }

    Assert-Contains $toc "config\\personas\\AGENTS.md" `
        "PyInstaller artifact is missing the built-in AGENTS template"
    Assert-Contains $toc "config\\personas\\SOUL.example.md" `
        "PyInstaller artifact is missing the built-in SOUL template"
    Assert-Contains $toc "config\\personas\\USER.example.md" `
        "PyInstaller artifact is missing the built-in USER template"
    Assert-Contains $toc "config\\stickers\\" `
        "PyInstaller artifact is missing built-in sticker resources"
}

if (-not $PortableDir) {
    $PortableDir = Join-Path $ProjectRoot "..\MaxmaHere-Portable"
}
if (Test-Path -LiteralPath $PortableDir -PathType Container) {
    $portableFiles = Get-ChildItem -LiteralPath $PortableDir -Recurse -File
    $portableRoot = [IO.Path]::GetFullPath($PortableDir).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $forbiddenPortablePatterns = @(
        '(?i)(^|[\\/])config[\\/](?:personas|mcp_servers)',
        '(?i)(^|[\\/])api[\\/]data[\\/](?:providers|mcp_servers|credential|auth_token|maxma\.db)',
        '(?i)(^|[\\/])(?:memory(?:_[^\\/]+)?\.yaml|SOUL\.md|USER\.md|active_persona\.yaml|[^\\/]+\.lock|[^\\/]+\.sqlite3(?:-[a-z]+)?)$'
    )
    foreach ($file in $portableFiles) {
        $fullPath = [IO.Path]::GetFullPath($file.FullName)
        $relative = $fullPath.Substring($portableRoot.Length)
        foreach ($pattern in $forbiddenPortablePatterns) {
            if ($relative -match $pattern) {
                throw "Portable output contains forbidden user data: $relative"
            }
        }
    }
}

Write-Output "Packaging safety checks passed."
