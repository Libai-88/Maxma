param(
    [string]$PortableDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\MaxmaHere-Portable")).Path,
    [int]$Port = 8010,
    [int]$TimeoutSec = 120
)

$ErrorActionPreference = "Stop"

# Portable smoke test (stage 2.6, Web/Bun distribution):
#   1. Launch the portable bundle: bun.exe run server.js (portable mode —
#      data written beside the executable via MAXMA_DATA_DIR).
#   2. Verify the core chain end to end:
#      - /api/auth/token   authentication
#      - /api/health       version matches version.py (read dynamically)
#      - /api/news         >= 45 update-log entries
#      - /api/settings     core settings read (kernel in-process)
#      - /api/plugins      plugin stub returns [] (no 500)
#      - /api/providers    provider management
#      - /api/mcp/servers  MCP server management
#   3. Stop the process and clean the runtime data the test produced.

$bunExe = Join-Path $PortableDir "bun.exe"
$serverJs = Join-Path $PortableDir "server.js"
if (-not (Test-Path $bunExe)) { throw "Portable smoke test failed: bun.exe not found: $bunExe" }
if (-not (Test-Path $serverJs)) { throw "Portable smoke test failed: server.js not found: $serverJs" }

# portable.flag must exist, otherwise data would go to %APPDATA% and mislead the test.
$flag = Join-Path $PortableDir "portable.flag"
if (-not (Test-Path $flag)) { throw "Portable smoke test failed: portable.flag not found in $PortableDir" }

# Expected version is read from the shipped version.py (single source), not hardcoded.
$versionPy = Join-Path $PortableDir "version.py"
if (-not (Test-Path $versionPy)) { throw "Portable smoke test failed: version.py not found: $versionPy" }
$versionLine = (Get-Content $versionPy | Where-Object { $_ -match '__version__' } | Select-Object -First 1)
$expectedVersion = ($versionLine -split '=', 2)[1].Trim().Trim([char]34, [char]39)

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) { throw "Portable smoke test failed: port $Port is already in use by PID $($listener.OwningProcess)" }

function Wait-HttpJson {
    param(
        [string]$Url,
        [hashtable]$Headers = @{},
        [int]$TimeoutSeconds = 30
    )
    for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
        try {
            return Invoke-RestMethod -Uri $Url -Headers $Headers -TimeoutSec 5 -ErrorAction Stop
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    throw "Portable smoke test failed: timed out waiting for $Url"
}

# Launcher-equivalent environment: explicit paths so the flattened server.js
# resolves bundleDir()/dataDir() to the portable layout.
$env:MAXMA_BUNDLE_DIR = $PortableDir
$env:MAXMA_EXE_DIR = $PortableDir
$env:MAXMA_DATA_DIR = Join-Path $PortableDir "data"
$env:PI_CODING_AGENT_DIR = Join-Path $PortableDir "data\pi"
$env:MAXMA_SERVE_WEB = "1"
$env:MAXMA_ENV = "production"
$env:MAXMA_BUN_PORT = [string]$Port

$proc = $null
$failed = $null
$dataDir = Join-Path $PortableDir "data"

try {
    Write-Host "[portable-smoke] starting $bunExe run server.js (port $Port, wd=$PortableDir)"
    $proc = Start-Process -FilePath $bunExe -ArgumentList "run", $serverJs -WorkingDirectory $PortableDir -PassThru -WindowStyle Hidden

    $apiBase = "http://127.0.0.1:$Port/api"

    # 1. auth
    $auth = Wait-HttpJson -Url "$apiBase/auth/token" -TimeoutSeconds $TimeoutSec
    if (-not $auth.token) { throw "/api/auth/token returned no token" }
    Write-Host "[portable-smoke] auth: ok"

    $headers = @{ "X-Maxma-Token" = [string]$auth.token }

    # 2. health + version (dynamic)
    $health = Wait-HttpJson -Url "$apiBase/health" -Headers $headers -TimeoutSeconds 15
    $ver = [string]$health.version
    Write-Host "[portable-smoke] health: status=$($health.status) version=$ver"
    if ($ver -ne $expectedVersion) {
        throw "version mismatch: expected $expectedVersion, got '$ver'"
    }

    # 3. news (>= 45 entries)
    $news = Wait-HttpJson -Url "$apiBase/news" -Headers $headers -TimeoutSeconds 15
    $newsCount = @($news.news).Count
    Write-Host "[portable-smoke] news: $newsCount entries"
    if ($newsCount -lt 45) { throw "news count too low: expected >= 45, got $newsCount" }

    # 4. settings (core keys, kernel in-process)
    $settings = Wait-HttpJson -Url "$apiBase/settings" -Headers $headers -TimeoutSeconds 30
    $settingsCount = @($settings.PSObject.Properties).Count
    Write-Host "[portable-smoke] settings: $settingsCount keys returned"

    # 5. plugins: the registry must list the built-in plugin, AND the plugin must
    #    actually LOAD. Checking only "HTTP 200" is not enough — that passes even
    #    when the plugin stack is missing from node_modules, because /api/plugins
    #    reads the registry (a JSON file) and never touches the plugin runtime.
    #    The real signal is the provider routes, which require the plugin to load.
    $plugins = Wait-HttpJson -Url "$apiBase/plugins" -Headers $headers -TimeoutSeconds 30
    Write-Host "[portable-smoke] plugins: $(@($plugins).Count) registered"
    $codearts = @($plugins) | Where-Object { $_.name -eq "codearts-auth" } | Select-Object -First 1
    if (-not $codearts) { throw "built-in plugin 'codearts-auth' is not registered" }
    if (-not $codearts.enabled) { throw "built-in plugin 'codearts-auth' is registered but disabled" }

    # 5b. Plugin runtime actually loaded -> its provider routes are visible.
    #     This is what catches "externals missing from the portable bundle".
    $pluginProviders = Wait-HttpJson -Url "$apiBase/plugins/codearts-auth/providers" -Headers $headers -TimeoutSeconds 60
    $routeCount = @($pluginProviders.providers).Count
    Write-Host "[portable-smoke] plugin provider routes: $routeCount"
    if ($routeCount -lt 15) {
        throw ("plugin runtime did not load: expected >= 15 provider routes, got $routeCount" +
            $(if ($pluginProviders.detail) { " (detail: $($pluginProviders.detail))" } else { "" }))
    }

    # 5c. The plugin stack must be resolvable next to server.js. This is the
    #     packaging contract: these packages are deliberately kept OUT of the
    #     bundle (see bun-backend/build-server.mjs), so a missing copy only
    #     shows up at runtime.
    $externalsPath = Join-Path $PortableDir "externals.json"
    if (Test-Path $externalsPath) {
        $externals = (Get-Content -Raw $externalsPath | ConvertFrom-Json).packages
        $missing = @()
        foreach ($pkg in $externals) {
            if (-not (Test-Path (Join-Path $PortableDir "node_modules/$pkg/package.json"))) { $missing += $pkg }
        }
        Write-Host "[portable-smoke] externals: $(@($externals).Count) declared, $($missing.Count) missing"
        if ($missing.Count -gt 0) { throw "portable bundle is missing runtime packages: $($missing -join ', ')" }
    } else {
        Write-Host "[portable-smoke] WARN: externals.json not found; skipping package manifest check"
    }

    # 6. providers / mcp/servers
    $providers = Wait-HttpJson -Url "$apiBase/providers" -Headers $headers -TimeoutSeconds 15
    $mcps = Wait-HttpJson -Url "$apiBase/mcp/servers" -Headers $headers -TimeoutSeconds 15
    Write-Host "[portable-smoke] providers: $($providers.providers.Count) mcp servers: $($mcps.servers.Count)"
    $freeProvider = @($providers.providers) | Where-Object { $_.id -eq "opencode-zen" } | Select-Object -First 1
    if (-not $freeProvider) { throw "built-in free model provider is missing" }
    $freeModels = @($freeProvider.models | ForEach-Object { [string]$_ })
    foreach ($requiredModel in @("mimo-v2.6-flash-free", "space-bunny-free")) {
        if ($freeModels -notcontains $requiredModel) { throw "built-in free model is missing: $requiredModel" }
    }
    Write-Host "[portable-smoke] built-in free models: $($freeModels -join ', ')"

    Write-Host "[portable-smoke] PASS: portable bundle startup + all verification points OK"
} catch {
    $failed = $_
    Write-Host "[portable-smoke] FAIL: $($_.Exception.Message)"
} finally {
    if ($proc -and -not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force
        Start-Sleep -Seconds 1
    }
    Remove-Item Env:\MAXMA_BUN_PORT -ErrorAction SilentlyContinue
    Remove-Item Env:\MAXMA_BUNDLE_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:\MAXMA_EXE_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:\MAXMA_DATA_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:\PI_CODING_AGENT_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:\MAXMA_SERVE_WEB -ErrorAction SilentlyContinue
    Remove-Item Env:\MAXMA_ENV -ErrorAction SilentlyContinue
}

if ($failed) { throw "Portable smoke test failed: $($failed.Exception.Message)" }

# Clean runtime artifacts the test produced, keeping the preset config files so
# the shipped portable folder stays clean (no credentials/db/logs leak into a
# distribution).
$preservedFiles = @(
    (Join-Path $dataDir "api\data\mcp_servers.yaml")
    (Join-Path $dataDir "api\data\news.yaml")
)
Get-ChildItem $dataDir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notin $preservedFiles } |
    ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
Get-ChildItem $dataDir -Recurse -Directory -ErrorAction SilentlyContinue |
    Sort-Object { $_.FullName.Length } -Descending |
    Where-Object { $_.FullName -notlike "*\api\data" -and $_.FullName -ne $dataDir } |
    ForEach-Object {
        $hasFiles = Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue
        if (-not $hasFiles) { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
    }

Write-Host "[portable-smoke] data/ cleaned (runtime artifacts removed, preset configs kept)"
