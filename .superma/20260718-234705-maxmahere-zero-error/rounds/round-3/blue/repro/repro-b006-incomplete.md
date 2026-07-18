# B-006 Fix Incomplete: `npm run build` still fails

## Reproduction script

1. Open a terminal at the project root or in `web/`

2. Run the actual build command:
   ```bash
   cd web
   npm run build
   ```

3. **Expected** (per the B-006 fix claim): Build succeeds, producing output in `web/dist/`.

4. **Actual**: The build fails immediately with 10 TypeScript errors from `vue-tsc --noEmit`:

```
src/components/ChatInput.vue(155,14): error TS2322
src/components/ChatInput.vue(165,14): error TS2322
src/components/ModelSelector.vue(10,8): error TS2322
src/components/tools/WeatherBubble.vue(147,46): error TS2345
src/components/ui/DsInput.vue(32,7): error TS6133
src/composables/useTheme.ts(136,7): error TS2352
src/composables/useTheme.ts(138,5): error TS2352
src/composables/useTheme.ts(144,5): error TS2352
src/stores/chat.ts(116,55): error TS2352
src/views/ProvidersView.vue(538,35): error TS2769
```

## Root cause

The `build` script in `web/package.json` is:
```json
"build": "vue-tsc --noEmit && vite build"
```

The B-006 fix only verified `npx vite build` (which bypasses `vue-tsc`), but the production build pipeline (`build-server.bat` line 78) runs `npm run build`, which includes `vue-tsc --noEmit`. The TypeScript errors are pre-existing but were hidden by the earlier terser build failure.

## Pipeline impact

`build-server.bat` line 77-78:
```
cd web
call npm run build 2>&1
if errorlevel 1 (
    echo [ERROR] 前端构建失败
    exit /b 1
)
```

Since `npm run build` fails (exit code 2), the build pipeline exits at step 1. PyInstaller packaging (step 2), smoke test (step 3), and Tauri deployment (step 4) never run.

## Detailed error breakdown

See `../review.md` for a full table of the 10 errors across 6 files.
