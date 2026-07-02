param(
    [string]$PortsStr = "8000,5173"
)

$ErrorActionPreference = "Stop"
$cleaned = 0

$Ports = ($PortsStr -split '[, ]' | Where-Object { $_ -ne '' } | ForEach-Object { [int]$_ })

# Kill by process name only when cleaning up from scratch (step 0)
# Skip process-name killing when called before Tauri launch (step 3)
# to avoid killing the Vite dev server that was just started.
$doKillByName = $Ports -contains 5173
$extraPids = @()
if ($doKillByName) {
    $targetNames = @("maxma-here", "maxma-server", "node")
    foreach ($name in $targetNames) {
        $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
        foreach ($p in $procs) {
            $extraPids += $p.Id
            Write-Host "[port-guard] Found stale process: $($p.ProcessName) (PID $($p.Id))"
        }
    }
}

# Kill by port
$Ports = ($PortsStr -split '[, ]' | Where-Object { $_ -ne '' } | ForEach-Object { [int]$_ })
$portPids = @()
foreach ($port in $Ports) {
    $conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" }
    foreach ($c in $conn) {
        $portPids += $c.OwningProcess
    }
}

# Combine and dedup all PIDs to kill
$allPids = ($extraPids + $portPids) | Select-Object -Unique
foreach ($procId in $allPids) {
    try {
        $proc = Get-Process -Id $procId -ErrorAction Stop
        Write-Host "[port-guard] Killing PID $procId ($($proc.ProcessName))..."
        Stop-Process -Id $procId -Force
        $cleaned++
    } catch {
        Write-Host "[port-guard] PID $procId already gone, skipping"
    }
}

if ($cleaned -eq 0) {
    Write-Host "[port-guard] Ports $($Ports -join ', ') are all free, no stale processes"
} else {
    Write-Host "[port-guard] Cleaned $cleaned stale process(es), waiting for port release..."
    Start-Sleep -Seconds 2
}
