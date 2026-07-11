# MaxmaHere 交接文档

> **写给完全没有上下文的新 Agent**：请通读本文档再动手。本文档是项目唯一权威的交接入口，覆盖项目全貌、已完成工作、生产级差距、下一步方向、必须避免的坑、必须遵守的命令规范。

---

## 一、Maxma 是什么

MaxmaHere（简称 Maxma）是一个**本地优先的 AI 工作站**——在用户桌面运行的、以 LangGraph ReAct Agent 为核心的智能助手应用。它不是 Web SaaS，而是**打包成 Tauri 桌面应用**分发的本地软件，后端是 Python sidecar，前端是 Vue 3 SPA。

### 技术栈

| 层 | 技术 | 版本 |
|---|---|---|
| Agent 核心 | LangChain + LangGraph | LC >= 0.3 / LG >= 0.2 |
| 后端 | FastAPI + uvicorn | >= 0.110 |
| 前端 | Vue 3 + Vite 5 + Pinia + TypeScript | Vue ^3.4 |
| 桌面壳 | Tauri 2 + Rust 2021 | v2.6.6 |
| 持久化 | AsyncSqliteSaver (WAL) + SQLite | langgraph-checkpoint-sqlite |
| 向量/RAG | ChromaDB + ONNX Runtime + transformers | paraphrase-multilingual-MiniLM-L12-v2 |
| 打包 | PyInstaller (后端) + Tauri NSIS (桌面) | — |
| Python | 3.13 (开发) / >= 3.11 (声明) | 隔离 .venv |
| 测试 | pytest + asyncio(auto) | ~120 文件 / ~1246 用例 |

### 顶层目录结构

```
D:\Maxma\MaxmaHere\
├── agent/              LangGraph Agent 核心（graph/planner/executor/coordinator/verifier/autonomy/stream_repair/lifecycle/persona/memory）
├── api/                FastAPI 后端（routes/middleware/providers/db/security/transcript/bootstrap）
├── memory/             记忆系统（narrative/episodic/semantic/ltm_outbox/rag/kb/pii_guard）
├── tools/              16 个工具子包（git/files/memory/network/todo/sub_agent/system/config...）
├── maxma_platform/    平台层（event_dedup/keep_alive）— 从 platform 重命名以避免标准库遮蔽
├── config/             人设(personas/) + 贴纸(stickers/)
├── web/                Vue 3 前端 SPA
├── desktop/            Tauri 桌面壳（src-tauri/）
├── build/              构建脚本（.bat/.ps1/.spec）
├── tests/              测试套件（13 个子目录）
├── docs/               架构文档（00-12 编号系列 + ROADMAP + superpowers/plans）
├── dev_docs/           开发约定（git-conventions.md 等）
├── anthropic_skills/   13 个内置 Skills
├── scripts/            辅助脚本
├── app_paths.py        路径常量集中点
├── main.py             Python 入口
├── version.py           版本号 (v2.6.6)
├── pyproject.toml      Python 项目配置 + 依赖声明
├── requirements-lock.txt  uv 锁定的完整依赖
└── pytest.bat          测试入口（固定走 .venv）
```

### 核心架构

1. **Agent 图**：`planner → executor → agent ↔ tools`，带 HITL 计划确认、循环检测、Provider 故障转移
2. **记忆系统**：4 层——工作记忆(Push 注入) / 情景记忆(session 隔离) / 语义记忆(事实三元组) / 长期记忆(LTM，经事务 outbox 写入 memory.yaml)
3. **人设系统**：三层结构（Identity/Yuan/Ishiki），yuan 模板输出 `<mood>` 内部状态标签（由 `_strip_mood_tags` 在 agent_node 返回前剥离）
4. **自治层**：可选的后台自诊断 + 自改进 Agent（默认关闭）
5. **桌面集成**：Tauri 管理后端 sidecar 生命周期（Job Object 继承 + 端口选择 + 健康检查）

---

## 二、已完成工作

### 2.1 Halo 启发增强（两轮，共 24 个 Task）

参考开源项目 Halo 2.1.12 的设计，完成了两轮增强：

**第一轮：架构层增强（13 Task，已全部合并）**
- Disposable 资源管理（`agent/lifecycle/disposable.py`）
- 启动分层（`api/bootstrap/idle_queue.py`，Tier 3 空闲任务队列）
- 事件去重缓存（`maxma_platform/event_dedup.py`，TTL + FIFO）
- 凭据掩码统一层（`api/security/credential_mask.py`）
- JSONL Transcript（`api/transcript/jsonl_writer.py`）
- 调度器指数退避（连续失败 5 次自动禁用，封顶 24h）

**第二轮：功能性增强（11 Task，已全部合并）**
- 流式修复管道（`agent/stream_repair/`）：空 turn 占位 + tool JSON 修复 + usage 回填
- report_to_user 完成信号（`agent/autonomy/completion_signal.py`）：后台 run 唯一权威完成信号 + 自动 continue 10 次
- Escalation run 边界（`agent/autonomy/escalation.py`）：headless 后台任务请求用户输入
- 工作记忆 Push 注入（`agent/memory/working_memory.py`）：双层 # now + # History
- Keep-alive TTL 安全网（`maxma_platform/keep_alive.py`）：24h 惰性剪枝孤儿 reason

### 2.2 工程评审修复（三轮）

- **安全基线**：`platform` → `maxma_platform` 重命名消除标准库遮蔽；`path_security` 修复 reparse point 逃逸；`rate_limit` 豁免收窄到 GET/HEAD；`runtime_context` 配置文字限长
- **Agent 闭环**：`delegation_context` 子 Agent 权限继承；`graph.py` Provider 故障转移续答；`episodic` session 隔离 + 失败轮次不投影
- **长期记忆事务**：`memory/ltm_outbox.py` outbox + 租约 + fencing token；YAML 原子替换 + 单写者

### 2.3 Bug 修复（截至 2026-07-10）

- **mood 标签泄漏**：`yuan_default.md` 人格模板输出的 `<mood>` 标签未剥离，泄漏到用户回复。修复：`agent/graph.py` 添加 `_strip_mood_tags()`
- **LTM 401 无限重试**：CRUD agent 遇 401 认证错误无限重试。修复：`memory/narrative.py` 添加 `_is_unrecoverable_error()` + `_MAX_LTM_RETRIES=5`

### 2.4 工作区整理

- 清理 13 个已完成计划文档 + 过时 CODE_REVIEW.md + 编译产物
- 完善 `.gitignore`：`dist-portable/`、`/resources/`、`*.exe`
- 全量回归测试：1246 passed / 0 failed / 9 skipped（零回归）

### 2.5 PLAN-1：跨项目设计吸收（已完成应用层实现）

`PLAN-1.md` 的阶段 0-6 已完成代码、测试和文档交付，新增能力默认通过 feature flag 保守关闭，避免改变既有用户路径。主要成果如下：

- **可靠性与诊断**：LTM 具有永久/暂时错误分类、全抖动指数退避、终态统计；Provider/LTM 健康诊断可向前端提供脱敏 reason code；Provider 凭据采用带版本的加密信封和幂等迁移；MCP 连接具备刷新、重连与状态生命周期。
- **执行与安全**：异步子 Agent 使用持久化 deferred-result/run store，支持取消、超时、重启恢复、权限/Provider 快照及父子流隔离；新增四档会话权限 `read_only / ask / operate / auto`，审批和审计是额外限制层，不能绕过工具、路径或沙盒硬边界。
- **记忆与会话**：实现保缓存前缀的会话压缩、可断点 memory ticker、FactStore 的 FTS5/CJK 混合检索，以及有上限的会话 UI 缓存。
- **交互与工作台**：实现工具结果折叠、流式分段、快捷键、Pulse 状态面板、受 schema 约束的确认/选择卡、Workflow journal、Canvas 多标签、渐进式首次引导。
- **有限自治与路由**：实现 ThinkPath、声明式 Provider/角色路由、Scout/Scheduler 治理。高风险能力仍默认关闭，并受预算、权限、审计和白名单约束。

PLAN-1 并不声称已完成 Windows 的系统级隔离：当前有应用层路径/能力/网络策略和 Job Object 清理，但**没有**受限令牌、ACL 或系统级网络隔离。不得将其描述为完整 Windows 沙盒。

### 2.6 2026-07-11 便携版构建状态（可测试）

PLAN-1 新增 Workflow 初始化后，`api/server.py` 的 `lifespan` 内部重复导入 `get_settings`，意外把已有的模块级导入变为函数局部名，并在较早调用处触发 `UnboundLocalError`。已移除该重复内部导入；11 个聚焦 API/启动回归测试通过。

已按 `build\\build-desktop.bat` 的既定四步流程完成新构建。新 PyInstaller sidecar 的 `build\\smoke-test-server.ps1` 已通过，验证了认证 token、`/api/health`、`/api/providers` 和 `/api/mcp/servers`。Tauri 构建与 NSIS 安装包也已完成；以下文件是当前可供用户测试的产物：

| 产物 | 大小 | 生成时间 |
|---|---:|---|
| `dist\\maxma-server.exe` | 211,561,107 bytes | 2026-07-11 14:48:12 |
| `desktop\\src-tauri\\binaries\\maxma-server-x86_64-pc-windows-msvc.exe` | 211,561,107 bytes | 2026-07-11 14:48:12 |
| `desktop\\src-tauri\\target\\release\\bundle\\nsis\\MaxmaHere_2.6.6_x64-setup.exe` | 889,891,506 bytes | 2026-07-11 15:20:01 |
| `dist-portable\\MaxmaHere.exe` | 26,508,800 bytes | 2026-07-11 15:20:01 |
| `dist-portable\\maxma-server.exe` | 211,561,107 bytes | 2026-07-11 14:48:12 |

`dist-portable\\` 已复制新桌面 exe 与新 sidecar，可作为当前 PLAN-1 测试包。仍需用户进行桌面层人工冒烟：启动 `dist-portable\\MaxmaHere.exe`，完成一次普通聊天和一次安全拒绝/确认操作，确认关闭应用后 sidecar 被清理。

---

## 三、距离生产级的差距

### 3.1 已达到生产级标准的部分

- ✅ Agent 核心图（planner/executor/agent/tools）稳定，经充分测试
- ✅ 记忆系统 4 层架构完整，事务 outbox 保证一致性
- ✅ Provider 故障转移 + 循环检测 + HITL 审批网关
- ✅ 桌面打包流程（PyInstaller + Tauri NSIS）可用
- ✅ 测试覆盖率高（~1246 用例，零回归）
- ✅ 路径安全 + 凭据掩码 + XSS 防护

### 3.2 仍有差距的部分

| 差距 | 严重度 | 说明 |
|---|---|---|
| Windows 系统级沙盒 | 中 | 当前只有应用层策略和 Job Object 清理；缺少受限令牌、网络隔离和 ACL 隔离 |
| Windows 全量记忆测试 | 中 | 全量 memory 测试在本机 Windows 环境可能超时或无输出挂起；维持按目录/按文件详细运行，不能把超时误报为产品回归 |
| Feature flag 的真实灰度 | 中 | PLAN-1 已覆盖开关语义与自动化测试，但 `coordinator_enabled`/`verifier_enabled`/`stream_repair_enabled` 等仍需在真实用户场景一次只开启一个地观察 |
| 打包体积 | 低 | maxma-server.exe 201MB + Playwright Chromium 688MB + ONNX 模型 448MB，总便携版 ~1.7GB |
| Node 版本未锁定 | 低 | web/ 无 .nvmrc 或 engines 字段 |
| Rust 版本未锁定 | 低 | 无 rust-toolchain.toml |

---

## 四、下一步方向

### 高优先级

1. **对新便携版进行人工冒烟**：启动 `dist-portable\\MaxmaHere.exe`，验证 token、health、providers、MCP、一次普通聊天和一次安全拒绝/确认操作，以及关闭后的 sidecar 清理；不得仅凭 exe 存在认定成功。
2. **Feature flag 逐步开启验证**：在可用便携版上按 `stream_repair_enabled` → `coordinator_enabled` → `verifier_enabled` 灰度，一次只开一个并收集延迟、错误、重复工具调用数据。

### 中优先级

3. **Windows 系统级隔离设计**：在明确桌面身份与权限模型后，评估受限令牌、ACL 和网络隔离；在此之前保持现有应用层策略的准确表述。
4. **打包体积优化**：评估是否可以按需下载 Playwright/ONNX 模型，而非全量打包。
5. **Node/Rust 版本锁定**：添加 `.nvmrc` 和 `rust-toolchain.toml`。

### 低优先级

6. **自治层启用验证**：在 `autonomy_enabled=False` 前提下充分测试后，逐步开启自改进
7. **CRAG 检索分级**：`crag_enabled` 默认关闭，需评估检索准确率提升效果

---

## 五、绝对不能再踩的坑

### 5.1 环境与依赖

| 坑 | 后果 | 正确做法 |
|---|---|---|
| **用全局 Python 跑测试** | ImportError（缺依赖） | 用 `pytest.bat` 或 `.venv\Scripts\python.exe -m pytest` |
| **混合 Python 版本到全局 site-packages** | 扩展模块兼容性崩溃 | 用隔离的 `.venv`（Python 3.13） |
| **使用 Python 3.11 不支持的 f-string 语法** | CI 3.11 矩阵编译失败 | CI 覆盖 3.11 + 3.13，语法必须两者兼容 |
| **使用 `platform` 作为本地包名** | 遮蔽标准库，zstandard/httpx 崩溃 | 已迁移为 `maxma_platform`，不要改回 |
| **嵌入式 Python 未设置 PIP_TARGET / 未移除 PYTHONUSERBASE** | 外部包污染打包环境 | 按打包脚本中的环境变量设置执行 |
| **`tools/interaction/__init__.py` 为空** | PyInstaller 漏掉子模块 | 用 `collect_submodules("tools")` 或显式 hiddenimports |

### 5.2 网络与代理

| 坑 | 后果 | 正确做法 |
|---|---|---|
| **本地代理(Clash/V2Ray)拦截 127.0.0.1:8000 请求** | Tauri 健康检查假失败，app 闪退 | Tauri + Python sidecar 必须设 `NO_PROXY=127.0.0.1,localhost,::1`；健康检查用 `reqwest` 的 `.no_proxy()` |
| **ONNX 模型从 HuggingFace 下载** | WattToolkit 代理返回 401 | 必须用 ModelScope.cn 源 |
| **构建脚本输出中文** | GBK 控制台编码问题 | 构建脚本（bat/ps1）必须英文输出 |

### 5.3 测试

| 坑 | 后果 | 正确做法 |
|---|---|---|
| **Windows 上 `pytest -q` 全量无输出挂起** | 误判为测试失败 | 按目录分组执行：`pytest.bat tests/test_memory -v` |
| **Windows SQLite 连接不显式 close** | 文件锁残留，后续测试卡住 | 异常/提前返回路径必须显式 `close()` |
| **模块级 mock 用 sys.modules 注入不清理** | 永久状态污染 | 用 try/finally 保存并还原原始模块属性 |
| **测试参数钳制导致断言失败** | 如 `ttl_seconds=0.05` 被 `max(1.0, ...)` 钳制 | 实现代码不要无原则钳制参数，直接赋值 |

### 5.4 提交纪律

| 坑 | 后果 | 正确做法 |
|---|---|---|
| **`git add -A` / `git commit -a`** | 工作区长期脏（构建产物/用户改动），会污染提交边界 | 用 `git add <精确路径>` 或 `git commit --only <精确路径>` |
| **pnpm 类型检查后未复查 git status** | 误提交生成物 | 验证后复查 `git status` |
| **回滚非本任务的改动** | 丢失他人工作 | 先确认归属和用途 |

### 5.5 数据一致性

| 坑 | 后果 | 正确做法 |
|---|---|---|
| **跨 SQLite + 文件系统直接写 YAML** | 崩溃窗口数据丢失 | 必须经 outbox + 幂等操作 + 重放语义 |
| **只有 lease 没有 fencing token** | 旧 owner 覆盖新 owner | 必须配合 fencing token |
| **`asyncio.CancelledError` 不被 `except Exception` 捕获** | 取消路径泄漏资源 | 显式处理 `CancelledError` |
| **Chromadb metadata 值为嵌套 dict** | upsert 失败，零索引块 | metadata 值必须是标量(str/int/float/bool/None) |
| **LTM CRUD agent 遇 401 无限重试** | 4 分钟 30 条相同错误日志 | 已修复：`_is_unrecoverable_error()` + `_MAX_LTM_RETRIES=5` |

---

## 六、必须遵守的命令规范

### 6.1 测试

```cmd
# 标准入口（内部固定走 .venv）
pytest.bat

# 按目录执行（推荐，避免全量挂起）
pytest.bat tests/test_memory -v
pytest.bat tests/test_agent -v

# 直接调用 venv
.venv\Scripts\python.exe -m pytest tests/test_memory -v

# 静态检查（CI 必跑）
.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7 agent api config maxma_platform memory tools tests

# 编译检查（CI 必跑）
.venv\Scripts\python.exe -m compileall -q agent api config maxma_platform memory tools
```

### 6.2 构建

```cmd
# 完整桌面打包（严格 4 步，不可跳步/乱序）
build\build-desktop.bat

# 仅后端 sidecar
build\build-server.bat

# PyInstaller 直接打包
.venv\Scripts\python.exe -m PyInstaller build\maxma-server.spec --clean --noconfirm

# 部署到 dist-portable
copy /y "dist\maxma-server.exe" "dist-portable\maxma-server.exe"
copy /y "dist\maxma-server.exe" "desktop\src-tauri\binaries\maxma-server-x86_64-pc-windows-msvc.exe"

# 前端构建
cd web && npm run build
```

**构建 4 步顺序**（`build-desktop.bat` 内部执行）：
1. `build-server.bat`（PyInstaller 打包 + 冒烟测试）
2. `prepare-runtime.ps1`（Node.js + Python embeddable + uv）
3. `prepare-assets.ps1`（Playwright Chromium + ONNX 模型，**模型源必须是 ModelScope.cn**）
4. `cargo tauri build`

### 6.3 运行

```cmd
# 一键启动（双服务）
start.bat

# 后端单独
.venv\Scripts\python.exe main.py web

# 前端单独
cd web && npm run dev
```

### 6.4 Git 提交

```cmd
# 提交前必查
git status
git diff --cached

# 精确路径提交（不要 git add -A）
git add <精确文件路径>
git commit -m "type: subject" -m "body"

# 推送
git push

# 创建 PR
gh pr create
gh pr merge --squash --delete-branch
```

**Conventional Commits 类型**：`feat/fix/hotfix/refactor/perf/docs/chore/test/exp/release`
**分支命名**：`<type>/<short-desc>`（如 `feature/openhanako-alignment`）
**详细规范**：`dev_docs/conventions/git-conventions.md`

### 6.5 依赖管理

```cmd
# 更新锁文件（需要 uv）
update-lock.bat

# 锁文件生成原理
uv pip compile pyproject.toml --extra dev -o requirements-lock.txt
```

---

## 七、Feature Flag 清单

所有 flag 定义在 `config/settings.py`。

### 默认关闭（需显式开启）

| Flag | 默认 | 含义 |
|---|---|---|
| `coordinator_enabled` | False | 编排层意图路由协调者 |
| `verifier_enabled` | False | 答案充分性验证 |
| `delegation_scope_enforced` | False | 子Agent委派范围强制 |
| `crag_enabled` | False | CRAG 检索分级 |
| `autonomy_enabled` | False | 自治层周期诊断 |
| `autonomy_self_improve_enabled` | False | 自治Agent创建/更新Skills |
| `stream_repair_enabled` | False | 流式响应修复管道 |
| `mcp_force_tls` | False | 生产模式强制HTTPS/WSS |

### 默认开启

| Flag | 默认 | 含义 |
|---|---|---|
| `executor_enable_by_default` | True | plan-and-execute 默认启用 |
| `sandbox_network_isolation` | True | Python 沙箱网络隔离 |
| `approval_gateway_enabled` | True | LLM 审批网关 |
| `mcp_rate_limit_enabled` | True | MCP 调用速率限制 |
| `persistence_enabled` | True | SQLite 持久化 checkpointer |
| `loop_detection_enabled` | True | 死循环检测（阈值 3 次） |

### 自治层工具白名单

即使 `autonomy_self_improve_enabled=True`，自治 Agent 仅允许：
- `manage_skills`（创建/更新 Skills）
- 只读工具：`system_diagnose` / `rag_diagnose` / `file_read` / `project_info` / `list_memories`

---

## 八、关键工程约定

1. **路径安全**：文件工具必须用绝对路径，经 `check_path_access()` 校验（先 MaxmaBlocker、后白名单）
2. **并发安全**：WebSocket registry/session 管理用 thread/async 锁；全局 async 状态用 `asyncio.Lock`；健康监控用 `threading.Lock`
3. **数据库**：初始化必须含版本控制保证幂等；会话持久化用 `AsyncSqliteSaver` + WAL，不可用时回退 `MemorySaver`
4. **YAML 写入**：必须用原子临时文件替换（`yaml_store.py` 的 `dump_yaml_atomic`），并发下配合单写者
5. **Vue 渲染**：必须用模板渲染，禁用 `v-html` 处理动态内容（防 XSS）
6. **Tauri capabilities**：不得包含未识别权限
7. **健康状态词汇**：统一 `ok` / `degraded` / `error`
8. **Scheduler**：必须用 `asyncio.get_running_loop()`，不得用 `asyncio.get_event_loop()`
9. **PyInstaller spec**：必须显式 `hiddenimports` 函数体内导入的模块 + `collect_submodules("tools")`
10. **路径常量**：集中在 `app_paths.py`，不要散落

---

## 九、当前状态快照

| 项 | 值 |
|---|---|
| 分支 | `feature/openhanako-alignment` |
| 远程 | `https://github.com/Libai-88/Maxma` |
| 最新 commit | `b291175` docs: add FIND.md cross-project exploration report |
| 版本 | v2.6.6 |
| PLAN-1 | 阶段 0-6 应用层功能完成；Windows 系统级沙盒明确未完成 |
| 验证 | API `295 passed`；Agent `350 passed`；记忆/工具/沙盒/路径/委派 `137 passed, 9 skipped`；前端 `44 passed`；生产前端构建、Python 编译、静态检查和差异格式检查通过 |
| 便携版 | **已构建，可测试**：`dist-portable\\MaxmaHere.exe`（26,508,800 bytes，2026-07-11 15:20:01）+ `dist-portable\\maxma-server.exe`（211,561,107 bytes，2026-07-11 14:48:12）；sidecar smoke 的 auth/health/providers/MCP 均通过，NSIS 包已生成 |
| 工作区 | **脏，且绝大多数为 PLAN-1 尚未提交变更**。保留全部改动；只精确暂存自己确认过的路径，绝不 `git add -A` / `git commit -a` |

### 下一位 Agent 的最短接手顺序

1. 先运行 `git status --short`，确认并保留当前大量 PLAN-1 未提交文件；不要尝试清理或回滚它们。
2. 先以 `dist-portable\\MaxmaHere.exe` 完成桌面人工冒烟；失败时保留 `logs/`、错误报告和版本/时间戳，避免覆盖当前验收证据。
3. 维持 Windows 测试分目录详细运行。全量 memory 测试可能超时或无输出挂起，不能以此单一现象判断产品回归；不要将系统级沙盒限制标记为已解决。
4. 后续源码改动影响 sidecar、前端或 Tauri 时，重新执行 `build\\build-desktop.bat`，并同时核验 `desktop\\src-tauri\\binaries\\`、NSIS 输出和 `dist-portable\\` 的时间戳。

---

*最后更新：2026-07-11*
