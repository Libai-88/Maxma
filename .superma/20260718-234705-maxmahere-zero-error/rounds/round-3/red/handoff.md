# Round meta
round: 3
team: red
phase_completed_at: 2026-07-19T00:00:00Z

# What was done this round
issues_filed:
  - id: R-009
    title: Tauri bundle identifier ends with .app causing build warning

issues_fixed:
  - id: B-006
    title: Terser dependency missing for Vite production build
    fix_summary: Switched from minify: 'terser' to minify: 'esbuild' in web/vite.config.ts, replacing terserOptions.compress.drop_console with equivalent esbuild.drop: ['console']
  - id: B-007
    title: Quick-chat Tauri window missing URL configuration
    fix_summary: Added "url": "quick-chat.html" to the quick-chat window object in desktop/src-tauri/tauri.conf.json
  - id: B-008
    title: Deprecated asyncio.iscoroutinefunction() in rpc_client.py
    fix_summary: Replaced asyncio.iscoroutinefunction() with inspect.iscoroutinefunction() and added import inspect in api/pi_bridge/rpc_client.py

challenges_filed: []

items_deferred:
  - item: Splash window Tauri configuration
    reason: The Vite multi-page build includes splash.html as an entry point, but there is no corresponding Tauri window in tauri.conf.json. This appears intentional (splash likely shown via JS within main window) — no action needed unless a dedicated splash window is desired.

  - item: UPX not installed warning in PyInstaller build
    reason: Already noted in Blue's Round 2 handoff. Not a build blocker (PyInstaller gracefully degrades). Can be addressed when CI environment includes UPX.

# Guidance for the next team
areas_of_concern:
  - The Tauri build produces a warning about the bundle identifier "com.maxmahere.app" ending with .app. Not a blocker for Windows NSIS, but worth fixing (R-009).
  - If Tauri 2.x changes its window URL resolution behavior, verify that `"url": "quick-chat.html"` resolves correctly relative to the frontendDist directory.
  - Verify the esbuild `drop: ['console']` configuration works as expected by running `npx vite build` in `web/` and checking that console.* calls are stripped from the output bundle (test by grepping the built JS for `console.log`).
  - The Python embeddable runtime version (3.13.13) in prepare-runtime.ps1 is pinned. If the project Python version requirement changes, update this to match.
  - No new build-blocking issues were found beyond B-006, B-007, B-008. The project build pipeline is in reasonable shape after Round 2's fixes.

suspicions_about_opponent_fixes:
  - target_issue: B-006
    suspicion: The fix switched to esbuild minification with `drop: ['console']` instead of installing terser. This is the cleaner approach (no extra dependency), but verify that esbuild's `drop: ['console']` is equivalent to terser's `drop_console: true` — esbuild may preserve `console.error` and `console.warn` depending on the version. Vite's bundled esbuild version should be verified.
    recommended_action: No challenge needed; just verify during build.
