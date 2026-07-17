# CI Coverage Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add frontend Vitest, Bun sidecar tests, weekly build verification, and coverage reporting to CI.

**Architecture:** Create 3 new GitHub Actions workflow files (`frontend.yml`, `sidecar.yml`, `build-verify.yml`) + enhance existing `pytest.yml` with pytest-cov coverage and codecov upload. Each workflow targets a distinct verification surface and is committed independently.

**Tech Stack:** GitHub Actions, Python 3.13, Node.js 20, Bun, Vitest, pytest-cov, codecov-action, PyInstaller

---

## Context Findings (read before executing)

1. **Existing `pytest.yml`** installs from `requirements-lock.txt` then runs `python -m pytest -q` on `ubuntu-latest` with Python matrix `["3.11", "3.13"]`. **Critical:** `requirements-lock.txt` does NOT contain `pytest` or `pytest-cov` — the pytest step would fail unless pytest is installed. Task 5 fixes this by adding `pip install pytest pytest-cov`.

2. **`web/package.json`** has `build: "vue-tsc --noEmit && vite build"` and vitest `^2.1.9` as devDependency. No explicit `test` script — invoke via `npx vitest run`. `vite.config.ts` configures vitest: `environment: 'jsdom'`, `globals: true`, `setupFiles: ['tests/setup.ts']`. **14 spec files / 44 tests pass locally (5.94s).** `package-lock.json` exists so `npm ci` works.

3. **`bun-sidecar/package.json`** has NO `test` script, NO devDependencies, and NO test files in `bun-sidecar/src/`. `bun test` with no test files exits 0 (prints "No tests to run"). This is a placeholder until tests are added.

4. **`build/build-server.bat`** CANNOT run in CI: it calls `setup-dev-env.bat` → `dev-tools.ps1 -EmitCmdEnv`, which hardcodes local paths (`D:\Rust\cargo\bin`, `D:\VSBuildTools\VC\Auxiliary\Build\vcvars64.bat`, `C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64`) for the Tauri/Rust/MSVC toolchain. These paths do not exist on `windows-latest` runners. **Deviation from task brief:** instead of running the bat, Task 4 replicates only the PyInstaller-relevant steps (the bat's steps 5–7: build frontend → `pyinstaller build/maxma-server.spec --clean --noconfirm` → verify `dist/maxma-server.exe`). This aligns with the brief's note "先只验证 Python sidecar 打包".

5. **`.gitignore`** ignores `/dist/` and `*.exe` — build artifacts won't be committed (correct).

6. **`maxma-server.spec`** requires `web/dist` (frontend build output), `config/`, `anthropic_skills/`, `macros/`, `bun-sidecar/src/` as datas, and bundles from `.venv/Lib/site-packages`. In CI we install deps into the system Python (no `.venv`), so the spec's `collect_local_extension_modules()` reads `project_root/.venv/Lib/site-packages` — this path won't exist in CI. The spec guards missing datas via `Path(src).exists()` filter, and `collect_local_extension_modules()` iterates a non-existent `.venv/Lib/site-packages` which will raise `FileNotFoundError`. **Resolution:** create a `.venv` virtualenv in CI (Task 4 step) so the spec resolves correctly, OR note that the build may need the spec adjusted. We will create a `.venv` and install into it to match the spec's expectations.

---

## File Structure

- **Create:** `.github/workflows/frontend.yml` — Frontend Vitest + build verification (push/PR)
- **Create:** `.github/workflows/sidecar.yml` — Bun sidecar test placeholder (push/PR)
- **Create:** `.github/workflows/build-verify.yml` — Weekly Windows PyInstaller build verification (cron + manual)
- **Modify:** `.github/workflows/pytest.yml` — Add pytest-cov + codecov upload + install pytest/pytest-cov
- **Create:** `docs/superpowers/plans/2026-07-17-ci-coverage-expansion.md` — This plan

---

## Task 1: Write and commit this plan

**Files:**
- Create: `docs/superpowers/plans/2026-07-17-ci-coverage-expansion.md`

- [ ] **Step 1: Write the plan document** (this file)

- [ ] **Step 2: Commit the plan**

```bash
git add docs/superpowers/plans/2026-07-17-ci-coverage-expansion.md
git commit -m "docs: add CI coverage expansion plan"
```

---

## Task 2: Create frontend.yml — frontend Vitest + build

**Files:**
- Create: `.github/workflows/frontend.yml`

**Design:**
- Trigger: `on: [push, pull_request]`
- Runner: `ubuntu-latest`
- Node 20 with `cache: 'npm'` and `cache-dependency-path: web/package-lock.json`
- Steps: checkout → setup-node → `cd web && npm ci` → `npm run build` (vue-tsc --noEmit && vite build, fails CI on type/build error) → `npx vitest run`
- Working directory: `web` (set via `working-directory` or `cd` in run steps). Use `working-directory: web` on each step for cleanliness.

- [ ] **Step 1: Create `.github/workflows/frontend.yml`**

```yaml
name: Frontend

on: [push, pull_request]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
          cache-dependency-path: web/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Build (vue-tsc + vite build)
        run: npm run build

      - name: Run Vitest
        run: npx vitest run
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/frontend.yml
git commit -m "ci: add frontend vitest and build workflow"
```

---

## Task 3: Create sidecar.yml — Bun sidecar tests

**Files:**
- Create: `.github/workflows/sidecar.yml`

**Design:**
- Trigger: `on: [push, pull_request]`
- Runner: `ubuntu-latest`
- `oven-sh/setup-bun@v1`
- `cd bun-sidecar && bun install` → `bun test`
- Currently no test files exist; `bun test` exits 0 with "No tests to run". This is a placeholder until tests are added.

- [ ] **Step 1: Create `.github/workflows/sidecar.yml`**

```yaml
name: Sidecar (Bun)

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: bun-sidecar

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Bun
        uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Run Bun tests
        run: bun test
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/sidecar.yml
git commit -m "ci: add bun sidecar test workflow"
```

---

## Task 4: Create build-verify.yml — weekly Windows PyInstaller verification

**Files:**
- Create: `.github/workflows/build-verify.yml`

**Design:**
- Trigger: `schedule: cron "0 3 * * 1"` (every Monday 03:00 UTC) + `workflow_dispatch`
- Runner: `windows-latest` (desktop app, spec uses Windows paths)
- Steps: checkout → setup Python 3.13 → setup Node 20 → install npm deps + build frontend → create `.venv` + install Python deps (so `maxma-server.spec`'s `collect_local_extension_modules()` finds `.venv/Lib/site-packages`) → install PyInstaller → `pyinstaller build/maxma-server.spec --clean --noconfirm` → verify `dist/maxma-server.exe` exists
- **Deviation note:** does NOT call `build/build-server.bat` because it depends on `dev-tools.ps1` with hardcoded local `D:\Rust`/`D:\VSBuildTools` paths (Tauri/Rust/MSVC toolchain) that don't exist on CI runners. Replicates only the PyInstaller-relevant subset per the brief's "先只验证 Python sidecar 打包" guidance.

- [ ] **Step 1: Create `.github/workflows/build-verify.yml`**

```yaml
name: Build Verify

on:
  schedule:
    - cron: "0 3 * * 1"
  workflow_dispatch:

jobs:
  pyinstaller-build:
    runs-on: windows-latest

    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Python 3.13
        uses: actions/setup-python@v5
        with:
          python-version: "3.13"

      - name: Set up Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
          cache-dependency-path: web/package-lock.json

      - name: Build frontend
        run: |
          cd web
          npm ci
          npm run build

      - name: Create virtualenv and install dependencies
        run: |
          python -m venv .venv
          .venv\Scripts\python.exe -m pip install --upgrade pip
          .venv\Scripts\python.exe -m pip install -r requirements-lock.txt
          .venv\Scripts\python.exe -m pip install pyinstaller

      - name: Package server with PyInstaller
        run: .venv\Scripts\python.exe -m PyInstaller build\maxma-server.spec --clean --noconfirm

      - name: Verify build artifact
        run: |
          if (-not (Test-Path "dist\maxma-server.exe")) {
            Write-Error "Build artifact dist\maxma-server.exe not found"
            exit 1
          }
          Write-Host "Build artifact verified: dist\maxma-server.exe"
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/build-verify.yml
git commit -m "ci: add weekly windows pyinstaller build verification"
```

---

## Task 5: Modify pytest.yml — add coverage + codecov

**Files:**
- Modify: `.github/workflows/pytest.yml`

**Design:**
- Current install step only runs `pip install -r requirements-lock.txt`. Add `pip install pytest pytest-cov` because neither is in the lock file (latent gap — without this the pytest step cannot run with coverage, and arguably cannot run at all).
- Change `python -m pytest -q` → `python -m pytest -q --cov=api --cov=agent --cov-report=xml --cov-fail-under=50`
- Add codecov upload step `codecov/codecov-action@v4` with `files: ./coverage.xml` and `fail_ci_if_error: false` (so upload failures don't block PRs; the `--cov-fail-under=50` gate on the pytest step is the real enforcement).
- Add `token: ${{ secrets.CODECOV_TOKEN }}` (works tokenlessly for public repos if secret unset).

- [ ] **Step 1: Read current pytest.yml** (already done — contents captured in Context)

- [ ] **Step 2: Edit install step** — append `pip install pytest pytest-cov`

Change:
```yaml
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          python -m pip install -r requirements-lock.txt
```
To:
```yaml
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          python -m pip install -r requirements-lock.txt
          python -m pip install pytest pytest-cov
```

- [ ] **Step 3: Edit pytest step** — add coverage flags

Change:
```yaml
      - name: Run backend tests
        run: python -m pytest -q
```
To:
```yaml
      - name: Run backend tests with coverage
        run: python -m pytest -q --cov=api --cov=agent --cov-report=xml --cov-fail-under=50
```

- [ ] **Step 4: Add codecov upload step** after the pytest step

```yaml
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage.xml
          token: ${{ secrets.CODECOV_TOKEN }}
          fail_ci_if_error: false
```

- [ ] **Step 5: Verify the full file** reads correctly end-to-end

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/pytest.yml
git commit -m "ci: add pytest coverage and codecov upload to pytest workflow"
```

---

## Task 6: Final verification

- [ ] **Step 1: Confirm all 4 workflow files are valid YAML** — read each back

- [ ] **Step 2: Confirm local frontend tests still pass** — already verified (14 files, 44 tests, 5.94s)

- [ ] **Step 3: Confirm git log shows the commits**

```bash
git log --oneline -6
```

---

## Notes & Deviations

1. **`build-server.bat` not used directly** — it depends on `dev-tools.ps1` which hardcodes `D:\Rust\cargo\bin`, `D:\VSBuildTools\VC\Auxiliary\Build\vcvars64.bat`, and a specific Windows SDK path. These are the developer's local Tauri/Rust/MSVC toolchain and don't exist on `windows-latest`. Build-verify.yml replicates the PyInstaller-relevant steps only. This matches the brief's note "先只验证 Python sidecar 打包".

2. **`pytest` / `pytest-cov` installed explicitly** — `requirements-lock.txt` contains neither (confirmed via grep). Adding `pip install pytest pytest-cov` to the install step closes this gap so the coverage command works.

3. **`bun test` is a placeholder** — `bun-sidecar/` has no test files. `bun test` exits 0 with "No tests to run". The workflow is scaffolded so tests are picked up automatically once added.

4. **`--cov-fail-under=50` may initially fail** — if current coverage is below 50%, the pytest step will fail. This is the intended gate per the brief. If it blocks development, the threshold can be lowered, but it should not be removed.

5. **Codecov token** — `codecov/codecov-action@v4` works tokenlessly for public repos. For private repos, `CODECOV_TOKEN` secret must be configured. `fail_ci_if_error: false` prevents upload errors from blocking PRs.
