param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string[]]$ExtraPaths = @()
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path
$portableRoot = Join-Path (Split-Path -Parent $RepoRoot) "MaxmaHere-Portable"
$scopeRoots = @($RepoRoot, $portableRoot, (Join-Path $RepoRoot "dist")) + $ExtraPaths
$scopeRoots = $scopeRoots | Where-Object { $_ } | ForEach-Object {
    try { (Resolve-Path -LiteralPath $_).Path } catch { $null }
} | Where-Object { $_ }

$stopped = @()
try {
    $processes = Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        $eligible = $false
        if ($_.ExecutablePath -and $_.ProcessId -ne $PID -and $_.Name -match '^(MaxmaHere|bun|electron|MaxmaHereBackend).*') {
            $exe = $_.ExecutablePath
            foreach ($root in $scopeRoots) {
                if ($exe.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { $eligible = $true; break }
            }
        }
        $eligible
    }
    foreach ($proc in $processes) {
        try {
            Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
            $stopped += [pscustomobject]@{ pid = $proc.ProcessId; name = $proc.Name; path = $proc.ExecutablePath }
        } catch {
            Write-Warning "无法停止进程 $($proc.ProcessId) $($proc.Name): $($_.Exception.Message)"
        }
    }
} catch {
    Write-Warning "枚举进程失败（可能没有权限）：$($_.Exception.Message)"
}

if ($stopped.Count -eq 0) {
    Write-Host "[cowork-stop] 没有发现本次工作区内的 Maxma 进程。"
} else {
    $stopped | Format-Table -AutoSize | Out-String | Write-Host
}

[pscustomobject]@{ stopped = $stopped; count = $stopped.Count } | ConvertTo-Json -Depth 5
