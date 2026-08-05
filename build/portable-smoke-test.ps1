param(
    [string]$PortableDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..\MaxmaHere-Portable")).Path,
    [int]$Port = 8010,
    [int]$TimeoutSec = 120
)

# 便携版冒烟测试：
# 1. 启动便携版 maxma-server.exe（portable 模式，数据写入 exe 旁 data/）
# 2. 验证本次修复的关键链路全部可用：
#    - /api/auth/token      认证
#    - /api/health          版本号必须为 v2.6.9
#    - /api/news            >= 45 条更新动态
#    - /api/settings        核心配置读取（sidecar RPC 链路）
#    - /api/plugins         sidecar 插件列表（无 500）
#    - /api/providers       provider 管理
#    - /api/mcp/servers     MCP 服务器管理
# 3. 全部通过后停止进程并退出，带清理退出码。

$ErrorActionPreference = "Stop"

$exe = Join-Path $PortableDir "maxma-server.exe"
if (-not (Test-Path $exe)) {
    throw "Portable smoke test failed: executable not found: $exe"
}

# 便携标记：portable.flag 必须存在，否则数据会写入 %APPDATA% 造成误判
$flag = Join-Path $PortableDir "portable.flag"
if (-not (Test-Path $flag)) {
    throw "Portable smoke test failed: portable.flag not found in $PortableDir"
}

# 端口占用检查
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    throw "Portable smoke test failed: port $Port is already in use by PID $($listener.OwningProcess)"
}

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

$env:MAXMA_API_PORT = [string]$Port
$proc = $null
$failed = $null

# 预置数据所在目录（唯一允许保留的运行时内容）
$dataDir = Join-Path $PortableDir "data"

try {
    Write-Host "[portable-smoke] starting $exe (port $Port, wd=$PortableDir)"
    $proc = Start-Process -FilePath $exe -WorkingDirectory $PortableDir -PassThru -WindowStyle Hidden

    $apiBase = "http://127.0.0.1:$Port/api"

    # 1. 认证
    $auth = Wait-HttpJson -Url "$apiBase/auth/token" -TimeoutSeconds $TimeoutSec
    if (-not $auth.token) {
        throw "/api/auth/token returned no token"
    }
    Write-Host "[portable-smoke] auth: ok"

    $headers = @{ "X-Maxma-Token" = [string]$auth.token }

    # 2. 健康 + 版本号（v2.6.9）
    $health = Wait-HttpJson -Url "$apiBase/health" -Headers $headers -TimeoutSeconds 15
    $ver = [string]$health.version
    Write-Host "[portable-smoke] health: status=$($health.status) version=$ver"
    if ($ver -notmatch "2\.6\.9") {
        throw "version mismatch: expected v2.6.9, got '$ver'"
    }

    # 3. 新闻（修复点：/api/news 200 且 >= 45 条）
    $news = Wait-HttpJson -Url "$apiBase/news" -Headers $headers -TimeoutSeconds 15
    $newsCount = @($news.news).Count
    Write-Host "[portable-smoke] news: $newsCount entries"
    if ($newsCount -lt 45) {
        throw "news count too low: expected >= 45, got $newsCount"
    }

    # 4. 设置（修复点：核心配置读取，走 sidecar RPC）
    $settings = Wait-HttpJson -Url "$apiBase/settings" -Headers $headers -TimeoutSeconds 30
    $settingsCount = @($settings.PSObject.Properties).Count
    Write-Host "[portable-smoke] settings: $settingsCount keys returned"
    if ($settingsCount -lt 5) {
        throw "settings returned too few keys: $settingsCount"
    }
    if (-not $settings.PSObject.Properties.Name.Contains("compaction.enabled")) {
        throw "settings missing core key 'compaction.enabled'"
    }

    # 5. 插件（修复点：无 500，sidecar 链路）
    # 注意：PS 5.1 的 Invoke-WebRequest 对非 HTML 的 200 响应（如 JSON）可能抛
    # NullReferenceException，故用 Invoke-RestMethod 并显式检查 HTTP 状态码；
    # 连接类错误重试，HTTP 错误（如 500）立即判失败。
    $pluginsStatus = 0
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $null = Invoke-RestMethod -Uri "$apiBase/plugins" -Headers $headers -TimeoutSec 10 -ErrorAction Stop
            $pluginsStatus = 200
            break
        } catch {
            if ($_.Exception.Response) {
                $pluginsStatus = [int]$_.Exception.Response.StatusCode
                break
            }
            Start-Sleep -Seconds 1
        }
    }
    Write-Host "[portable-smoke] plugins: HTTP $pluginsStatus"
    if ($pluginsStatus -ne 200) {
        throw "plugins endpoint returned HTTP $pluginsStatus"
    }

    # 6. providers / mcp/servers（既有链路）
    $providers = Wait-HttpJson -Url "$apiBase/providers" -Headers $headers -TimeoutSeconds 15
    $mcps = Wait-HttpJson -Url "$apiBase/mcp/servers" -Headers $headers -TimeoutSeconds 15
    Write-Host "[portable-smoke] providers: $($providers.providers.Count) mcp servers: $($mcps.servers.Count)"

    Write-Host "[portable-smoke] PASS: portable bundle startup + all fix verification points OK"
} catch {
    $failed = $_
    Write-Host "[portable-smoke] FAIL: $($_.Exception.Message)"
} finally {
    if ($proc -and -not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force
        Start-Sleep -Seconds 1
    }
    Remove-Item Env:\MAXMA_API_PORT -ErrorAction SilentlyContinue
}

if ($failed) {
    throw "Portable smoke test failed: $($failed.Exception.Message)"
}

# 清理冒烟测试产生的运行时数据（保持便携版首次分发干净）。
# 删除 data/ 中预置内容（mcp_servers.yaml、news.yaml 及其所在目录链）之外的
# 全部文件与目录，无论测试成败都执行，避免把凭据/数据库/日志带入分发。
$preservedFiles = @(
    (Join-Path $dataDir "api\data\mcp_servers.yaml")
    (Join-Path $dataDir "api\data\news.yaml")
)
Get-ChildItem $dataDir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notin $preservedFiles } |
    ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
# 自底向上删除空目录，但保留预置文件所在目录链（data/api/data）
Get-ChildItem $dataDir -Recurse -Directory -ErrorAction SilentlyContinue |
    Sort-Object { $_.FullName.Length } -Descending |
    Where-Object { $_.FullName -notlike "*\api\data" -and $_.FullName -ne $dataDir } |
    ForEach-Object {
        $hasFiles = Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue
        if (-not $hasFiles) { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
    }

Write-Host "[portable-smoke] data/ cleaned (runtime artifacts removed, preset mcp_servers.yaml + news.yaml kept)"