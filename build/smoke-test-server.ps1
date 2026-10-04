param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [int]$Port = 8000,
    [int]$TimeoutSec = 120
)

$ErrorActionPreference = "Stop"

# Smoke test for the Bun backend bundle (stage 2.6): runs
# dist\bun-server\bun.exe run server.js and verifies the core endpoints
# (auth/health/providers/mcp). Replaces the PyInstaller exe smoke test.

# MAXMA_BUN_PORT drives server.ts's listen port (env override of the 8000 default).
$env:MAXMA_BUN_PORT = [string]$Port
if ($env:MAXMA_API_PORT) { $Port = [int]::Parse($env:MAXMA_API_PORT) }

$resolvedRoot = (Resolve-Path $ProjectRoot).Path
$serverDir = Join-Path $resolvedRoot "dist\bun-server"
$bunExe = Join-Path $serverDir "bun.exe"
$serverJs = Join-Path $serverDir "server.js"
$smokeDataDir = Join-Path $serverDir "smoke-data"

if (-not (Test-Path $bunExe)) { throw "Smoke test failed: bun.exe not found: $bunExe" }
if (-not (Test-Path $serverJs)) { throw "Smoke test failed: server.js not found: $serverJs" }

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) { throw "Smoke test failed: port $Port is already in use by PID $($listener.OwningProcess)" }

function Wait-HttpJson {
    param(
        [string]$Url,
        [hashtable]$Headers = @{},
        [int]$TimeoutSeconds = 30
    )
    for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
        try {
            return Invoke-RestMethod -Uri $Url -Headers $Headers -TimeoutSec 2 -ErrorAction Stop
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    throw "Timed out waiting for $Url"
}

$proc = $null
try {
    $env:MAXMA_BUNDLE_DIR = $serverDir
    $env:MAXMA_EXE_DIR = $serverDir
    $env:MAXMA_DATA_DIR = $smokeDataDir
    $env:PI_CODING_AGENT_DIR = Join-Path $smokeDataDir "pi"
    Write-Host "[smoke] starting $bunExe run server.js"
    $proc = Start-Process -FilePath $bunExe -ArgumentList "run", $serverJs -WorkingDirectory $serverDir -PassThru -WindowStyle Hidden

    $apiBase = "http://127.0.0.1:$Port/api"
    $auth = Wait-HttpJson -Url "$apiBase/auth/token" -TimeoutSeconds $TimeoutSec
    if (-not $auth.token) { throw "Smoke test failed: /api/auth/token returned no token" }

    $headers = @{ "X-Maxma-Token" = [string]$auth.token }
    $health = Wait-HttpJson -Url "$apiBase/health" -Headers $headers -TimeoutSeconds 10
    $providers = Wait-HttpJson -Url "$apiBase/providers" -Headers $headers -TimeoutSeconds 10
    $mcpServers = Wait-HttpJson -Url "$apiBase/mcp/servers" -Headers $headers -TimeoutSeconds 10

    Write-Host "[smoke] auth: ok"
    Write-Host "[smoke] health: $($health.status) (version $($health.version))"
    Write-Host "[smoke] providers: $($providers.providers.Count)"
    Write-Host "[smoke] mcp servers: $($mcpServers.servers.Count)"
    Write-Host "[smoke] bundle startup verification passed"
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
    if (Test-Path $smokeDataDir) { Remove-Item $smokeDataDir -Recurse -Force -ErrorAction SilentlyContinue }
}
