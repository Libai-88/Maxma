# scripts/verify-desktop-render.ps1 — Electron 桌面包「窗口/渲染层」验证
#
# ## 为什么单独需要它
#
# `build/portable-smoke-test.ps1` 验的是**包内 Bun 后端**能否起来（直接跑
# `bun.exe run server.js`），它绕过了 Electron 壳、也绕过了渲染进程。
# 而"双击图标能不能打开应用"这件事由另外三层决定：
#   ① Electron 壳启动；② 壳拉起后端；③ **渲染进程加载 Vue 应用**。
# 类型检查、单测、打包成功都证明不了这三层（打包产物在、但窗口白屏是完全可能的）。
#
# ## 判据（全部是"真的在跑"的直接后果，不是间接猜测）
#
#   - 后端被拉起：`data/logs/desktop-backend.log` 出现 `listening on ...`
#     （对应 `desktop/electron/main.cjs` 的 startBackend）。
#   - 渲染层真的加载了：同一日志里出现 **`[ws] connected session=<id>`**。
#     这条最硬——只有 Vue 应用跑起来并连上 `/ws/chat/{sid}` 才会产生。
#
# ## 为什么不用"请求了首页/静态资源"当判据（曾经的错误）
#
# `bun-backend/src/middleware/request-log.ts` 明确跳过 `/favicon.ico` 与 `/assets/`
# 前缀，首页 `/` 也不写日志。拿它们当判据会**永远 FAIL**——本仓真踩过：
# 一个"渲染层没渲染"的误报，实际应用完全正常。判据必须选**只有成功才会出现**的信号。
#
# ## 环境陷阱：ELECTRON_RUN_AS_NODE
#
# 某些终端/CI 环境会预设 `ELECTRON_RUN_AS_NODE=1`，Electron 随即退化为纯 Node、
# 不创建窗口直接退出。识别特征：`MaxmaHere.exe --version` 打印的是 **node 版本**
# （如 v24.21.0）而不是 Electron 版本。本脚本会先清掉该变量再启动。
# 这不是产物缺陷，是调用环境问题——但会让你误判成"桌面包坏了"。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-desktop-render.ps1
#   （可选参数 -PortableRoot 指向解包目录；默认取仓库 dist 下的构建产物）

param(
  [string]$PortableRoot = "",
  [int]$WaitSeconds = 45
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $PortableRoot) {
  $PortableRoot = Join-Path $repoRoot "dist\electron-portable\win-unpacked"
}

$exe = Join-Path $PortableRoot "MaxmaHere.exe"
$logDir = Join-Path $PortableRoot "data\logs"
$backendLog = Join-Path $logDir "desktop-backend.log"

if (-not (Test-Path $exe)) {
  throw "找不到桌面包可执行文件: $exe`n先运行 build-desktop-portable.ps1 生成产物。"
}

Remove-Item $backendLog -ErrorAction SilentlyContinue

# 清除继承环境里的 ELECTRON_RUN_AS_NODE（见文件头注释）
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:\ELECTRON_NO_ATTACH_CONSOLE -ErrorAction SilentlyContinue

Write-Host "[desktop-render] 启动 $exe"
$proc = Start-Process -FilePath $exe -PassThru
try {
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  $sawListening = $false
  $sawWs = $false
  $port = $null

  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 750
    if (-not (Test-Path $backendLog)) { continue }
    # 显式按 UTF-8 读 + FileShare.ReadWrite：后端进程正占着这个文件，
    # 且 Windows PowerShell 5.1 的 Get-Content 默认按 ANSI/GBK 解码（中文会乱码）。
    $stream = [System.IO.File]::Open($backendLog, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
      $text = $reader.ReadToEnd()
      $reader.Close()
    } finally { $stream.Dispose() }

    if (-not $sawListening -and $text -match "listening on http://127\.0\.0\.1:(\d+)") {
      $sawListening = $true
      $port = $Matches[1]
      Write-Host "[desktop-render] 后端已监听 :$port（由 Electron 壳拉起）"
    }
    if ($text -match "\[ws\] connected session=") { $sawWs = $true }
    if ($sawListening -and $sawWs) { break }
  }

  Write-Host ("[desktop-render] 后端被拉起 : " + $sawListening)
  Write-Host ("[desktop-render] 渲染层已连接 WS : " + $sawWs)
  Write-Host ("[desktop-render] 主进程存活 : " + (-not $proc.HasExited))

  $fail = @()
  if (-not $sawListening) { $fail += "Electron 壳没有拉起后端" }
  if (-not $sawWs) { $fail += "渲染进程没有建立 WS 连接（Vue 应用可能没加载成功）" }
  if ($proc.HasExited) { $fail += "主进程提前退出（code=$($proc.ExitCode)）" }

  if ($fail.Count) {
    foreach ($f in $fail) { Write-Host ("[desktop-render] FAIL: " + $f) }
    throw "桌面包渲染层验证未通过"
  }
  Write-Host "DESKTOP-RENDER-VERIFY: PASS"
} finally {
  try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
  Get-Process -Name MaxmaHere -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  $left = (Get-Process -Name MaxmaHere -ErrorAction SilentlyContinue | Measure-Object).Count
  Write-Host "[desktop-render] 已关闭（残留进程: $left）"
}
