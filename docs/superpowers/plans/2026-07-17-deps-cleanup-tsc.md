# Dependencies Cleanup & TSC Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Clean up legacy LangGraph-era dependencies and fix bun-sidecar node_modules type errors.

**Architecture:** Part A: verify and remove unused deps. Part B: install @types/bun or enable skipLibCheck.

**Tech Stack:** Python 3.13, uv, Bun, TypeScript

---

## Context & Findings (调研结论)

### Part A 现状

`pyproject.toml` 的 `dependencies` 列表中**已经不包含**以下 11 个包（只剩 `langchain-core>=0.3.86`）：
- `chromadb`, `json-repair`, `langchain`, `langchain-mcp-adapters`, `langchain-openai`
- `moviepy`, `onnxruntime`, `playwright`, `tavily-python`, `transformers`, `zai-sdk`

但 `requirements-lock.txt` 和 `requirements.txt` 仍标记它们为 `# via maxmahere (pyproject.toml)`，说明这两个 lock 文件是基于**旧版 pyproject.toml** 生成的，已经过时。

#### 引用搜索结果（Grep 整个仓库，排除 .venv/node_modules）

| 包名 | Python import | 字符串/注释引用 | 结论 |
|------|--------------|----------------|------|
| `chromadb` | 无 | `app_paths.py:72` 注释 `# chromadb 向量数据库持久化目录`；`build/maxma-server.spec` 历史 excludes 注释 | 可安全移除 |
| `json-repair` | 无 | 仅 `docs/了解_Maxma_大迭代` 历史文档 | 可安全移除 |
| `langchain` | 无（`import langchain`/`from langchain import` 0 命中） | 无 | 可安全移除 |
| `langchain-mcp-adapters` | 无 | 仅历史文档 | 可安全移除 |
| `langchain-openai` | 无 | 仅历史文档 | 可安全移除 |
| `moviepy` | 无 | 无 | 可安全移除 |
| `onnxruntime` | 无 | `build/maxma-server.spec` 历史 excludes 注释 | 可安全移除 |
| `playwright` | 无 | `app_paths.py:150` 路径定义 `PLAYWRIGHT_BROWSERS_PATH`；`api/logging_config.py:139` `logging.getLogger("playwright")` — 均非 import | 可安全移除 |
| `tavily-python` | 无 | `api/pi_bridge/approval_adapter.py:28-29` 工具名字符串 `"tavily_search"`/`"tavily_extract"`（由 oh-my-pi sidecar 提供的工具，非 Python 包）；测试文件中的工具名 | 可安全移除 |
| `transformers` | 无 | `build/maxma-server.spec:104` excludes 列表中的 `sentence_transformers` | 可安全移除 |
| `zai-sdk` | 无 | 无 | 可安全移除 |

#### 动态 import 检查
- `importlib` / `__import__` 的使用全部在 `tests/` 测试文件中（用于测试时加载模块）
- **没有任何应用代码动态 import 这 11 个包**

#### 配置文件检查
- `config/personas/AGENTS.md` 提到 `tavily_search` 工具名（非 Python 包引用）
- `anthropic_skills/*/SKILL.md` 提到 `tavily_search`/`tavily_extract`/`playwright`/`chromadb` — 均为工具名或概念说明，非 Python import
- `build/maxma-server.spec` 的 `hiddenimports` 列表（line 60-83）**不包含**这 11 个包

#### `vector_store` / `get_vector_store` 检查
- Grep `vector_store|get_vector_store|VectorStore` 在 *.py 文件中：**0 命中**
- 说明 chromadb 相关的 RAG 代码已被完全移除

### Part A 根因
lock 文件过时。`pyproject.toml` 是 source of truth，已移除这些包，但 lock 文件未重新生成。

### Part A 方案
重新生成 lock 文件（最干净的做法，自动移除所有不需要的包及其传递依赖）：
```
uv pip compile pyproject.toml --extra dev -o requirements-lock.txt
uv pip sync requirements-lock.txt
```
这与 `update-lock.bat` 的命令一致。`requirements.txt`（runtime lock）不在本任务范围（见现有计划 `2026-07-17-deps-and-tsc-fixes.md` 的 Out of Scope）。

---

### Part B 现状
- `bun-sidecar/tsconfig.json` 当前配置：`strict: true`，**无** `skipLibCheck`，**无** `@types/bun`
- `bun-sidecar/package.json` 依赖：`@oh-my-pi/*` 系列 + `zod`，**无** `@types/bun`
- 前一轮 Agent 13 报告约 21 个 node_modules 错误（`bun:sqlite`/`bun` 模块缺失、ReadOnlyDict、CustomToolAdapter 类型问题）
- 前一轮 Agent 已修复 `src/` 下的真实错误（见 `2026-07-17-deps-and-tsc-fixes.md`）

### Part B 方案（按优先级）
1. **方案 A**（首选）：安装 `@types/bun` — 提供 `bun:sqlite`/`bun` 内置模块的类型声明
2. **方案 B**（备选）：在 `tsconfig.json` 中设置 `"skipLibCheck": true` — 跳过 node_modules 类型检查，是 TypeScript 社区常见做法
3. **方案 C**（最后手段）：创建 `declare module "bun:sqlite"` 声明文件

优先尝试方案 A，如果仍有 node_modules 错误则叠加方案 B。

---

## Part A — 重新生成 requirements-lock.txt 移除遗留依赖 ✅ 已完成

### Task A1: 重新生成 requirements-lock.txt ✅
**命令**（与 `update-lock.bat` 一致）:
```
cd d:\Maxma\MaxmaHere
uv pip compile pyproject.toml --extra dev -o requirements-lock.txt
```
- 验证：新 `requirements-lock.txt` 中不再出现 `chromadb`、`json-repair`、`langchain`（主包，非 `langchain-core`）、`langchain-mcp-adapters`、`langchain-openai`、`moviepy`、`onnxruntime`、`playwright`、`tavily-python`、`transformers`、`zai-sdk` 及其专属传递依赖（如 `kubernetes`、`bcrypt`、`mmh3`、`pypika`、`imageio`、`proglog`、`safetensors`、`tokenizers`、`cachetools` 等）。
- `langchain-core` 应保留（在 pyproject.toml 的 dependencies 中）。

### Task A2: 同步 .venv 并验证 ✅
```
cd d:\Maxma\MaxmaHere
uv pip sync requirements-lock.txt
.venv\Scripts\python.exe -m pytest tests/ -q
```
- 若 `uv pip sync` 移除了 .venv 中的遗留包，pytest 应仍通过（因为代码不 import 它们）。
- 验证标准：pytest 全部通过（或与基线一致）。

### Task A3: 提交 ✅
- commit: `79d4df6`
- pytest: 1122 passed, 7 skipped
- 文件：`requirements-lock.txt`
- commit message: `chore(deps): regenerate lock file to drop 11 legacy LangGraph-era deps`

---

## Part B — 修复 bun-sidecar node_modules 类型错误

### 执行结果

#### 方案 A（安装 @types/bun）— 已尝试并放弃
- 执行 `bun add -d @types/bun` 后，node_modules 错误消失，但暴露出 ~80 个 src/ 错误
- 根因分析：`@oh-my-pi/pi-coding-agent` 的 `ToolDefinition<TParams extends TSchema>` 使用 `@sinclair/typebox` 的 `TSchema`，而 src/ 代码传入 Zod schema
- 进一步调查发现：这些 src/ 错误是由 `zod/v4` → `zod` 导入改动导致的，**不是预先存在的**
- 原始 `zod/v4` 导入与 `ToolDefinition` 类型兼容，无需修改
- 决定：移除 @types/bun，回退所有 src/ 改动，改用方案 B

#### 方案 B（启用 skipLibCheck）— ✅ 最终方案
- **文件**: `d:\Maxma\MaxmaHere\bun-sidecar\tsconfig.json`
- 在 `compilerOptions` 中添加 `"skipLibCheck": true`
- 这是 TypeScript 社区处理 node_modules 类型问题的标准做法
- 只跳过 `.d.ts` 文件检查，不影响 src/ 代码的类型安全

#### 验证结果
- `bunx tsc --noEmit`: **0 错误** (exit code 0)
- `bun test`: **12 pass, 0 fail**
- git diff: 仅 `tsconfig.json` 一行变更

### Task B4: 提交
- 文件：`bun-sidecar/tsconfig.json`
- commit message: `fix(sidecar): enable skipLibCheck to resolve node_modules tsc errors`

---

## Files In Scope (只允许修改的文件)
- `requirements-lock.txt`（Part A）
- `bun-sidecar/package.json` + `bun-sidecar/bun.lock` 或 `bun-sidecar/package-lock.json`（Part B，`bun add` 自动更新）
- `bun-sidecar/tsconfig.json`（Part B，仅在需要方案 B 时）

## Out of Scope
- `pyproject.toml`（已无这些包，不需要修改）
- `requirements.txt`（runtime lock，不在本任务范围）
- `node_modules/` 内的源码（上游包问题）
- `src/` 下的真实类型错误（前一轮 Agent 已修复）
- 其他 agent 的文件范围（`agent/`、`api/routes/`、`api/pi_bridge/`、`api/security/`、`api/db/`、`web/`、测试文件）
