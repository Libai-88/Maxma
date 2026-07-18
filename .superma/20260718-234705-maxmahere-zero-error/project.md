# Project under review — MaxmaHere

## Name
MaxmaHere

## Root path
`D:\Maxma\MaxmaHere`

## Language / framework
- **Backend**: Python 3.11+ / FastAPI + uvicorn
- **Frontend**: Vue 3 + Vite 5 + Pinia + TypeScript
- **Agent engine**: oh-my-pi v16.5.2 (Bun/TypeScript sidecar)
- **Desktop shell**: Tauri 2 + Rust
- **Build system**: PyInstaller (backend) + Tauri NSIS (desktop installer)

## Scope
Full project audit, with emphasis on:

### Development environment testing
- Python backend startup and hot-reload (`main.py --dev`)
- Frontend Vite dev server (`cd web && npm run dev`)
- Bun sidecar process lifecycle (`bun-sidecar/`)
- Test suite (`pytest -q`)
- Environment consistency (`.env`, `providers.yaml`, Python version)
- Dependency conflicts (requirements.txt vs constraints.txt)
- Pre-commit hooks, linting (ruff, mypy)

### Production portable build
- **build-server.bat**: PyInstaller packaging for `maxma-server.exe`
  - Spec: `build/maxma-server.spec`
  - Web dist build → PyInstaller → smoke test → Tauri binaries
- **build-desktop.bat**: Full Tauri NSIS installer
  - Server build → embedded runtime (Node.js + Python) → assets (Chromium + ONNX) → Tauri build
- **Portable dist** (`dist-portable/`):
  - `MaxmaHere.exe` (26 MB) — Tauri desktop binary
  - `maxma-server.exe` (211 MB) — PyInstaller backend package
  - Bundled resources (config, anthropic_skills, macros, bun-sidecar)
- Zero-error launch and operation of the portable build
- Sidecar process management (parent watchdog, orphan prevention)
- Error report logs in `dist-portable/`

## Build pipeline details

1. `npm run build` (web/dist)
2. `PyInstaller maxma-server.spec --clean --noconfirm`
3. `smoke-test-server.ps1` (smoke test)
4. Copy to `desktop/src-tauri/binaries/`
5. `prepare-runtime.ps1` (embedded Node.js + Python)
6. `prepare-assets.ps1` (Playwright Chromium + ONNX model)
7. `cargo tauri build` (NSIS installer)

## Seeded issues
- Legacy: `HANDOFF.md` mentions "打包构建需更新（Bun sidecar 纳入安装包）" as medium priority
- Legacy: `dist-portable/` contains 3 error reports (`maxma-error-report-*.txt`) from previous failed builds

## Known build artifacts
- `dist/maxma-server.exe` — 211 MB backend executable
- `dist-portable/MaxmaHere.exe` — 26 MB Tauri desktop binary
- `dist-portable/resources/` — bundled runtime assets
