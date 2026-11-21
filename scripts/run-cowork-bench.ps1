param(
    [ValidateSet("validate", "dry-run", "record")]
    [string]$Mode = "validate",
    [string]$TaskId = "",
    [ValidateSet("unsupported", "completed", "failed")]
    [string]$Status = "completed",
    [double]$DurationSeconds = -1,
    [double]$ManualEditMinutes = -1,
    [ValidateSet("yes", "no", "unknown")]
    [string]$FileUsable = "unknown",
    [string]$Notes = ""
)

$ErrorActionPreference = "Stop"
$BenchRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\benchmarks\cowork")).Path
$TasksPath = Join-Path $BenchRoot "tasks.json"
$ResultsPath = Join-Path $BenchRoot "results-v2.7.0.json"

if (-not (Test-Path -LiteralPath $TasksPath)) { throw "缺少任务定义：$TasksPath" }
$doc = Get-Content -LiteralPath $TasksPath -Raw | ConvertFrom-Json
$tasks = @($doc.tasks)
if ($tasks.Count -lt 1) { throw "tasks.json 没有任务" }

$ids = @{}
foreach ($task in $tasks) {
    if (-not $task.id -or -not $task.title -or -not $task.fixture) { throw "任务缺少 id/title/fixture：$($task | ConvertTo-Json -Compress)" }
    if ($ids.ContainsKey($task.id)) { throw "任务 id 重复：$($task.id)" }
    $ids[$task.id] = $true
    $fixture = Join-Path $BenchRoot $task.fixture
    if (-not (Test-Path -LiteralPath $fixture)) { throw "任务 $($task.id) 的 fixture 不存在：$fixture" }
    if (-not $task.expected_outputs -or @($task.expected_outputs).Count -lt 1) { throw "任务 $($task.id) 缺少 expected_outputs" }
    if (-not $task.acceptance -or @($task.acceptance).Count -lt 1) { throw "任务 $($task.id) 缺少 acceptance" }
}

switch ($Mode) {
    "validate" {
        Write-Host "[cowork-bench] PASS: $($tasks.Count) tasks, fixtures present, schema fields complete."
    }
    "dry-run" {
        Write-Host "[cowork-bench] M0 只打印任务，不执行；执行入口在 M1。"
        foreach ($task in $tasks) {
            Write-Host ("  - {0} | {1} | outputs: {2} | fixture: {3}" -f $task.id, $task.title, (@($task.expected_outputs) -join ","), $task.fixture)
        }
    }
    "record" {
        if (-not $TaskId) { throw "record 模式必须提供 -TaskId" }
        if (-not $ids.ContainsKey($TaskId)) { throw "未知任务：$TaskId" }
        if (-not (Test-Path -LiteralPath $ResultsPath)) {
            $results = [pscustomobject]@{
                schema_version = 1
                suite = $doc.suite
                baseline_commit = $doc.baseline_commit
                baseline_version = $doc.baseline_version
                generated_at = (Get-Date).ToString("o")
                method = "由 scripts/run-cowork-bench.ps1 record 录入"
                tasks = @()
            }
        } else {
            $results = Get-Content -LiteralPath $ResultsPath -Raw | ConvertFrom-Json
        }
        $entry = @($results.tasks) | Where-Object { $_.id -eq $TaskId } | Select-Object -First 1
        if (-not $entry) {
            $entry = [pscustomobject]@{ id = $TaskId }
            $results.tasks = @($results.tasks) + $entry
        }
        $entry.status = $Status
        $entry.duration_seconds = if ($DurationSeconds -ge 0) { $DurationSeconds } else { $null }
        $entry.manual_edit_minutes = if ($ManualEditMinutes -ge 0) { $ManualEditMinutes } else { $null }
        $entry.file_usable = if ($FileUsable -eq "unknown") { $null } else { $FileUsable }
        $entry.notes = $Notes
        $results.updated_at = (Get-Date).ToString("o")
        $results | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ResultsPath -Encoding UTF8
        Write-Host "[cowork-bench] recorded $TaskId -> $Status"
    }
}
