# Bun Sidecar 类型闸门
#
# 现状（2026-10-27 校正，此前注释描述的是三代之前的形态）：
#   - 引擎是 @earendil-works/*，内核以**库的形式被 bun-backend 直接 import**
#     （in-process）。没有独立的 sidecar 可执行文件，`src/session-bridge.ts`
#     这个 stdio 入口也已无运行时调用方（仅契约测试引用）——见 docs/00-当前架构.md §2.5。
#   - 因此本脚本真正做的事只有一件：`tsc --noEmit`。它是引擎边界的编译期断层面，
#     已纳入 CI（.github/workflows/sidecar.yml）。今天实测 0 error。
#
# 历史遗留、现在都不存在的东西（注释留着曾误导过调查，故只记不续）：
#   - Tauri 桌面壳与 src-tauri/binaries：阶段二已移除，桌面壳是 Electron（desktop/）。
#   - sidecar_manager.py / PyInstaller datas：Python 后端已整体移除。
#   - 「bun build --compile 因 oh-my-pi 的动态导入 omp-legacy-pi-modules 失败」：
#     该字符串在全仓 0 命中，且 --compile 路线已被 in-process 取代。
#     注意：新引擎自身仍有约 14 处 `await import(`（dist/bundle/chunks/*、
#     dist/utils/photon.js）——若将来重启单文件编译路线，坑还在，只是换了肇事者。
#
# 开发模式：bun run src/session-bridge.ts（stdio 入口，仅供契约/手工调试）
# 生产形态：bun.exe + 打包后的 server.js（bun-backend/build-server.mjs，pi 内联其中）

# 验证 sidecar 类型可编译（本脚本的唯一实际职责）
Write-Host "Testing sidecar typecheck..."
bunx tsc --noEmit 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[PASS] Sidecar TypeScript compiles"
} else {
    Write-Host "[FAIL] Sidecar typecheck failed"
    exit 1
}

# 不启用 --compile：见上方「现状」。
# bun build src/session-bridge.ts --compile --outfile ...
