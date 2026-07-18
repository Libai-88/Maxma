param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$ExePath = "",
    [int]$Port = 8000,
    [int]$TimeoutSec = 120
)

$ErrorActionPreference = "Stop"

# 支持 MAXMA_API_PORT 环境变量覆盖默认端口
if ($env:MAXMA_API_PORT) {
    $Port = [int]::Parse($env:MAXMA_API_PORT)
}

function Get-ResolvedExePath {
    param(
        [string]$Root,
        [string]$Candidate
    )

    if ($Candidate) {
        return (Resolve-Path $Candidate).Path
    }

    return (Resolve-Path (Join-Path $Root "dist\maxma-server.exe")).Path
}

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

$resolvedRoot = (Resolve-Path $ProjectRoot).Path
$resolvedExe = Get-ResolvedExePath -Root $resolvedRoot -Candidate $ExePath

if (-not (Test-Path $resolvedExe)) {
    throw "Smoke test failed: executable not found: $resolvedExe"
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    throw "Smoke test failed: port $Port is already in use by PID $($listener.OwningProcess)"
}

$proc = $null
try {
    Write-Host "[smoke] starting $resolvedExe"
    $proc = Start-Process -FilePath $resolvedExe -WorkingDirectory $resolvedRoot -PassThru -WindowStyle Hidden

    $apiBase = "http://127.0.0.1:$Port/api"
    $auth = Wait-HttpJson -Url "$apiBase/auth/token" -TimeoutSeconds $TimeoutSec
    if (-not $auth.token) {
        throw "Smoke test failed: /api/auth/token returned no token"
    }

    $headers = @{ "X-Maxma-Token" = [string]$auth.token }
    $health = Wait-HttpJson -Url "$apiBase/health" -Headers $headers -TimeoutSeconds 10
    $providers = Wait-HttpJson -Url "$apiBase/providers" -Headers $headers -TimeoutSeconds 10
    $mcpServers = Wait-HttpJson -Url "$apiBase/mcp/servers" -Headers $headers -TimeoutSeconds 10

    Write-Host "[smoke] auth: ok"
    Write-Host "[smoke] health: $($health.status)"
    Write-Host "[smoke] providers: $($providers.providers.Count)"
    Write-Host "[smoke] mcp servers: $($mcpServers.servers.Count)"
    Write-Host "[smoke] bundle startup verification passed"
} finally {
    if ($proc -and -not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force
        Start-Sleep -Seconds 1
    }
}
