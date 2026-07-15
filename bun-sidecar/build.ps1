# Bun Sidecar 构建脚本
# 
# 当前状态：bun build --compile 因 oh-my-pi 的动态导入（omp-legacy-pi-modules）
# 无法静态解析而失败。需要等 oh-my-pi 修复或提供 bundle-friendly 的入口点。
#
# 临时方案：直接运行 TypeScript（开发模式），或捆绑 Bun 运行时（生产模式）。
#
# 开发模式：
#   bun run src/session-bridge.ts
#
# 生产模式（推荐）：
#   1. 将 bun.exe 复制到 desktop/src-tauri/binaries/bun.exe
#   2. sidecar_manager.py 检测生产环境时使用捆绑的 bun.exe
#   3. session-bridge.ts 及其依赖打包进 PyInstaller 的 datas 中

# 验证 sidecar 可以正常启动（开发模式）
Write-Host "Testing sidecar startup..."
bun run src/session-bridge.ts --help 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[PASS] Sidecar TypeScript compiles and runs"
} else {
    Write-Host "[FAIL] Sidecar failed to start"
    exit 1
}

# TODO: 当 oh-my-pi 支持 bundle 时，启用以下编译：
# bun build src/session-bridge.ts --compile --outfile ../desktop/src-tauri/binaries/pi-sidecar-x86_64-pc-windows-msvc.exe
