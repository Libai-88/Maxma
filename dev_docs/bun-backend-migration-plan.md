# 阶段二方案：后端统一迁移到 Bun 并彻底移除 Python

> 状态：**已确认实施中**（用户 2026-09-30 确认）。阶段 2.0 ✅ 已完成。
> 前置：阶段一已完成——pi 引擎全部能力位于 `bun-sidecar/src/kernel/*`（官方 API），Python 层现为纯"HTTP 壳"。
> 本文基于 2026-09-30 对代码库的实际盘点（api/ 共 86 个 .py 文件、17,889 行）。
> ⚠️ 本文件曾被意外覆盖（2026-09-30 15:01，仅剩"# 继续执行"17 字节），当前为重建版。

---

## 1. 现状梳理

### 1.1 当前后端架构与调用关系

```
前端 (Vue, web/dist)
   │  HTTP /api/**  +  WS /ws/**（X-Maxma-Token 鉴权）
   ▼
Python 层（api/，FastAPI，PyInstaller 打包为 maxma-server.exe）
   │  ① HTTP/WS 路由 + 中间件（auth/rate_limit/request_log）
   │  ② 业务逻辑（sessions/persona/memory/stickers/rules/workflows/automation...）
   │  ③ 持久化（SQLite: api/data/maxma.db、session_map.db；YAML: memory/personas/news）
   │  ④ pi_bridge：stdin/stdout JSON-RPC 驱动 sidecar（sidecar_manager/rpc_client/
   │     session_adapter/ws_event_mapper/approval_adapter 五件套，共 ~1300 行纯桥接）
   ▼
Bun sidecar（kernel/，pi 引擎，maxma-engine.exe）
   └─ @earendil-works/pi-coding-agent@0.99.0（官方 API）
```

### 1.2 Python 模块清单与职责（按功能分组）

**A. 进程入口与装配（~450 行）**
| 模块 | 行数 | 职责 |
| --- | --- | --- |
| main.py | ~200 | uvicorn 启动、嵌入式运行时路径注入、日志初始化 |
| api/server.py | 377 | FastAPI 装配：CORS/Auth/RateLimit/RequestLog 中间件、30+ 路由注册、静态托管（WEB-HOST-001） |
| app_paths.py | — | 路径解析（便携模式 portable.flag、BUNDLE_DIR/DATA_DIR/RUNTIME_DIR） |

**B. 中间件与横切（~1050 行）**
| 模块 | 行数 | 职责 | Bun 替代要点 |
| --- | --- | --- | --- |
| middleware/auth.py | 139 | Token 鉴权（header + WS subprotocol），白名单 /api/health、/api/auth/token、GET /api/mcp/oauth/callback、GET /api/stickers/* | Hono middleware 直译 ✅ |
| middleware/rate_limit.py | 437 | IP 令牌桶限流（429；容量 30/补充 2 每秒/回环豁免） | 直译 ✅ |
| middleware/request_log.py | 150 | 请求日志 + 指标采集 | 直译 ✅ |
| metrics.py | 328 | Metrics 内存单例 + /api/metrics | 直译（2.1） |
| errors.py / cors_config.py | 143 | 错误结构、CORS origins 构建 | 直译 |
| logging_config.py | 146 | 日志初始化 | Bun 原生日志 |

**C. 对话链路核心（~2900 行，迁移重点）**
| 模块 | 行数 | 职责 |
| --- | --- | --- |
| routes/chat.py | 1674 | WS /ws/chat/{sid}（hello 握手、事件转发、ask_user/user_response、活动记录、延迟消息）+ REST |
| session_manager.py | 358 | 会话注册表（SQLite session_map.db、持久会话恢复） |
| const_session_store.py | 113 | 常驻会话存储 |
| context_usage.py / interaction.py | 282 | 上下文用量计算、交互事件 |
| routes/chat_turns.py / chat_artifacts.py / session_compress.py | 200 | 轮次/工件/压缩 REST |
| activity_hub.py | 176 | 活动事件汇聚 + /api/activity/stream（SSE） |

**D. pi_bridge 桥接层（~1300 行，阶段二整体消失）**
sidecar_manager(481)/rpc_client(256)/session_adapter(389)/ws_event_mapper(138)/approval_adapter(68)——kernel in-process 引用后全部删除。

**E. 数据与凭据（~900 行）**
| 模块 | 行数 | 职责 | Bun 替代要点 |
| --- | --- | --- | --- |
| db/core.py + hooks + metrics + auth + providers | 570 | SQLite（api/data/maxma.db）：sessions/stickers_favorites/rules/audit_log/metrics/**auth_tokens**/providers 表 | `bun:sqlite`（同文件格式，零迁移）✅ auth_tokens 已对齐 |
| security/credential_envelope.py + credential_mask.py | 220 | **凭据信封：Fernet 加密**（cryptography），key 存 API_DATA_DIR/credential.key；脱敏展示 | ⚠️ 见 §4.1——Bun 需 Fernet 兼容实现 |
| yaml_store.py | 188 | YAML 读写（原子写） | Bun.YAML（kernel 已有同款原子写先例） |

**F. Provider/MCP/凭据路由（~1800 行）**
routes/providers.py(854，Fernet 加密入库)/mcp.py(834)/mcp_test/mcp_validation/mcp_oauth(共 ~410)/services/opencode_zen.py(240，httpx)/routes/balance.py(129)

**G. 内容/业务功能（~3200 行）**
sessions(889)/persona(459)/memory+settings_panels(816)/stickers×3(677)/rules+maxma_blocker+news(662)/workflows(434)/automation(710，asyncio 自研调度)/collab+deferred_runs(425)/upload+files+transcripts(322)

**H. 诊断与杂项（~1300 行）**
diagnostics(514)/health(318)/runtime_status(119)/ws_protocol(105)/artifacts/schema(244)/bootstrap/idle_queue(85)/transcript/jsonl_writer(141)/capabilities(426)

### 1.3 依赖盘点（Python 第三方，全部有 Bun 等价）

| Python 包 | 用途 | Bun 替代 |
| --- | --- | --- |
| fastapi + starlette + uvicorn | Web 框架 | **Hono**（已装 hono@4.13.12）+ Bun.serve 原生 WS |
| pydantic | 请求/响应校验 | **TypeBox**（bun-sidecar 已装 typebox@1.3.27） |
| httpx | 外部 API 客户端 | 原生 `fetch` |
| pyyaml | YAML 存储 | `Bun.YAML`（内置） |
| cryptography (Fernet) | 凭据加密 | Node `crypto`（Fernet 规范实现，§4.1） |
| sqlite3（stdlib） | 持久化 | **`bun:sqlite`**（内置，同文件格式）✅ 已验证 |

### 1.4 数据资产（迁移不涉及格式转换）

| 资产 | 格式 | 兼容性 |
| --- | --- | --- |
| api/data/maxma.db | SQLite（含 auth_tokens 表） | `bun:sqlite` 直接打开 ✅ 已验证 |
| api/data/session_map.db | SQLite | 同上 |
| api/data/credential.key | Fernet key | 密钥文件原样保留 |
| mcp_servers.yaml / news.yaml / memory.yaml / personas | YAML | 双端解析器已共存 |
| audit_log.json / session JSONL | JSONL | JSON 通用 |

---

## 2. 迁移映射（Python → Bun）

### 2.1 目标架构

```
前端 (Vue)
   │  HTTP /api/** + WS /ws/**（同一套鉴权契约）
   ▼
Bun 后端（单进程 = API 服务器 + Agent 引擎）
   ├─ Hono app（路由 + 中间件直译）+ Bun.serve WS
   ├─ kernel/*（阶段一成果，in-process 直接引用，JSON-RPC 层删除）
   ├─ bun:sqlite（同 .db 文件）+ Bun.YAML（同 .yaml 文件）
   └─ 静态托管 web/dist
```

### 2.2 模块映射表

| Python 模块 | Bun 替代 | 实现方式 | 状态 |
| --- | --- | --- | --- |
| main.py + api/server.py | `bun-backend/src/server.ts` | Bun.serve + Hono（监听收在 import.meta.main 守卫内） | ✅ 2.0 |
| middleware/auth.py | `src/middleware/auth.ts` | Hono middleware；WS subprotocol 经 server.upgrade | ✅ 2.0 |
| middleware/rate_limit.py | `src/middleware/rate-limit.ts` | 令牌桶直译（30/2.0 每秒，回环豁免） | ✅ 2.0 |
| middleware/request_log.py | `src/middleware/request-log.ts` | 直译（环形缓冲 + 慢请求打点） | ✅ 2.0 |
| api/db/auth.py | `src/auth.ts` | **bun:sqlite auth_tokens 表**（64 hex token，rotate=追加行） | ✅ 2.0 |
| app_paths.py | `src/app-paths.ts` | 直译（MAXMA_BUNDLE_DIR/MAXMA_DATA_DIR/MAXMA_EXE_DIR 注入） | ✅ 2.0 |
| api/health.py（完整版） | `src/routes/health.ts` | 2.0 为基础版；完整四部件探测在 2.1 对齐 | 🔜 2.1 |
| routes/**（30+ 文件） | `src/routes/**`（一一对应） | Pydantic → TypeBox 校验 | 🔜 2.1-2.5 |
| db/*（5 文件） | `src/db/*.ts` | bun:sqlite，SQL 原样保留 | 🔜 2.2 |
| security/credential_envelope.py | `src/security/credential-envelope.ts` | Fernet 兼容（Node crypto） | 🔜 2.4 |
| yaml_store.py | `src/yaml-store.ts` | Bun.YAML + 原子写 | 🔜 2.2 |
| session_manager.py + const_session_store.py | `src/session-manager.ts` | 直译（bun:sqlite） | 🔜 2.2 |
| routes/chat.py（WS 核心） | `src/routes/chat-ws.ts` | Bun WS + kernel 事件直接订阅（mapPiAgentEventToMaxma 复用） | 🔜 2.3 |
| pi_bridge 五件套（1300 行） | **删除** | kernel in-process | 🔜 2.3 |
| services/opencode_zen.py + balance.py | `src/services/opencode-zen.ts` | fetch 直译 | 🔜 2.4 |
| routes/automation.py | 下线（§7 决策点 1） | — | 待确认 |
| diagnostics/health 完整版/artifacts/transcript | `src/*` | 直译 | 🔜 2.5 |

### 2.3 明确不迁移（随下线决策处理）

| 项 | 处置 |
| --- | --- |
| automation 功能整体（routes/automation.py + headless_prompt） | 阶段一已判定半成品低频 → 随 Python 移除下线（前端 automation 面板经 capabilities flag 隐藏）；如需恢复基于 Bun 重写为独立小工作项 |
| deferred_runs / collab | **保留直译**——2026-09-30 复核：前端有实际消费面（stores/collab.ts、router 路由、Dock 入口、api/index.ts 封装），按标准直译迁移（阶段 2.3） |

---

## 3. 分阶段迁移步骤（迁移期间服务可用）

> 灰度机制：Bun 后端 8001 与 Python 8000 并存；前端经 MAXMA_API_BASE 指向任一后端；**每批路由切换 = 该批写权转移**（SQLite 单写者原则）。全程 git tag，随时可回 Python。

### 阶段 2.0 脚手架与契约基线（1 个工作日）——✅ 已完成（2026-09-30）
- 已交付：`bun-backend/` 独立工程（Hono@4.13.12 + Bun.serve，监听 8001）；`server.ts`（装配 + WS 升级钩子 + 静态托管/SPA fallback 平移，监听收在 `import.meta.main` 守卫内）；auth/rate-limit(30 桶/2 每秒/回环豁免)/request-log 中间件直译；`/api/health` + `/api/auth/token` + rotate；`app-paths.ts`（MAXMA_BUNDLE_DIR/MAXMA_DATA_DIR/MAXMA_EXE_DIR 注入）。
- **真机对照发现并修正的关键兼容点**：Python 生产 token 存 **SQLite `auth_tokens` 表**（api/db/auth.py，`token_hex(32)` 64 字符 hex），YAML 版（api/auth.py）是遗留实现——Bun 侧 `auth.ts` 对齐为 `bun:sqlite` 读写同一 maxma.db。实测：**Python 签发 token 在 Bun 后端互认**（BUN +token → 404=过鉴权路由未注册、noauth → 401、health → 200）。
- 测试：`bun-backend/tests/server-smoke.test.ts` 4/4（白名单/401 形状/OPTIONS/静态托管+SPA fallback/目录穿越/Token 入库格式与互认）。
- 验收：✅ 8001 health/token 可用；✅ auth 拦截行为与 Python 一致（真机对照）；✅ 零 Python 改动。

### 阶段 2.1 只读与低风险路由（1 天）——✅ 核心完成（2026-09-30）
- 已交付：news（脏数据容错/pr_number 空串→null/日期降序）、onboarding（白名单过滤/枚举归一/原子写）、metrics（完整单例：histogram/snapshot 形状对齐/maxma.db metrics_snapshots 持久化/60s 后台 flush/本地 ISO 时间戳无 Z 后缀）+ /api/metrics/history 路由；request-log 中间件接入完整 Metrics 采集。
- **app-paths 惰性化重构**：全部路径导出改为 getter（每次调用读 env）——修复模块加载时固化路径导致测试隔离失效的问题。
- **双跑对照结果**（Python 8000 vs Bun 8001，动态字段掩码）：`/api/news` ✅ SAME、`/api/onboarding/state` ✅ SAME、`/api/metrics/history` ✅ SAME；`/api/metrics` 结构同形（top_paths 计数为各自进程运行时数据，非契约差异）。
- 调整：**health 完整四部件探测移至 2.3 后**（依赖 sidecar 状态源，kernel in-process 接入后才能对齐 probe_remote 语义）；capabilities（聚合路由，依赖 tools/mcp/providers）移至 2.5；balance（依赖 opencode_zen）随 2.4。
- 测试：routes-2.1 5/5 + server-smoke 4/4 = bun-backend 9/9。
- 验收：✅ 快照 diff 为空（news/onboarding/history）；✅ bun:test 全绿。

### 阶段 2.2 数据存储批（2 天）——🔄 进行中（2026-09-30 起）
- 已交付：`src/db/core.ts`（**bun:sqlite 迁移引擎**：v1-v7 SQL 原样保留 + v3/v6 幂等列检查直译 + WAL/busy_timeout/foreign_keys + withTransaction）；`src/routes/rules.ts`（6 端点直译：内置规则共享 JSON + 内嵌兜底 17 条原样、user_rules.json 原子写、rule_toggles.json 覆盖（RULES-TOGGLE-001）、内置保护 403、source/editable 附加）；`src/routes/maxma-blocker.ts`（标记文件/旧版清理/check-path-blocked fail-closed 含 NUL 防注入）；`src/routes/settings.ts`（**官方 SettingsManager 全局单例**——修正阶段一遗留的语义缺口：前端设置面板是全局语义而非 per-session）；`src/routes/transcripts.ts`（类别白名单/穿越防护/JSONL 读取容错）；`src/yaml-store.ts`（原子写辅助）。
- 依赖：bun-backend 补装 pi 三包@0.99.0（settings 的 SettingsManager + 2.3 kernel in-process 前置）。
- 测试：bun-backend 全量 **21/21**（smoke 4 + routes-2.1 5 + rules 4 + routes-2.2b 8）。
- **双跑对照**：`/api/rules` 三端点 **SAME**（真实项目 17 条内置规则全量一致）。
- 已知行为对齐记录：pi Settings 可选键默认 undefined → GET 未设键静默跳过（测试用 set→get 往返断言）；pi settings 树与旧内核键名不同（无 compaction.thresholdPercent 等），设置面板键对齐为独立后续任务。
- files.py `/select-file`（tkinter 桌面对话框）**不迁移**——随 Tauri 壳消失。
- 剩余：const_session_store/workflows/deferred_runs/collab；sessions ✅ persona ✅ stickers×3 ✅ settings_panels ✅（2.2e/2.2d/2.2f/2.2g）
- 2.2g 已交付：`src/routes/settings-panels.ts`（四面板 GET/PUT：默认值合并、None 不覆盖、Pydantic 约束直译 422、GAP-A2-001 legacy TTS 规范化、allowed_domains 清洗、PANEL-CORRUPT-001 损坏拒绝写入、PANEL-WIRE-001 同步 kernel 全局 SettingsManager）+ `src/settings-global.ts` 共享单例。
- **PANEL-ORDER-001**：挂载顺序 bug——memory.ts 的 `:memoryId` 参数路由抢先匹配 `/api/memory/hindsight-config`（404），修复：settings-panels 先于 memory 挂载。
- 测试：panels-2.2g 4/4——bun-backend 全量 **44/44**。
- 2.2f 已交付：stickers 三模块——`src/routes/stickers.ts`（随机/文件服务+immutable 缓存头/分类列表，安全校验原样）、`src/routes/sticker-favorites.ts`（收藏/取消/recent 去重/recommendations 时间段推荐（情感检测 stub 同语义）/index 双目录，STICKER-ATOMIC-001 原子写）、`src/routes/sticker-upload.ts`（**PIL→sharp**：PNG/JPG 缩放 256 转 WebP、GIF 动画帧转动画 WebP、md5 内容哈希幂等）；sharp 新依赖（二进制 ~30MB，2.6 产物体积核算项）。
- 测试：stickers-2.2f 6/6（服务/收藏全链路/推荐+index/上传真实转换+幂等/格式校验/穿越 %2e%2e）——bun-backend 全量 **40/40**。
- 测试教训：URL 客户端会规范化 `..`——穿越测试用 `%2e%2e` 编码（服务端 decode 后校验才有效）。
- 2.2e 已交付：`src/routes/sessions.ts`（会话 REST 门面 15 端点：创建/列表/详情/permission-mode 4 档 GET+PUT/messages（role 映射 human/ai + source:"sidecar" + limit 1-500）/undo（UNDO-BUSY-001 运行中 409）/recap/compact（pi 摘要式，契约字段保持）/context-usage（字符粗估 256k）/clear（kernel 新增 clear_messages RPC=官方 resetLeaf）/delete/batch-delete/clear-temp）——**架构转变点：Bun 后端 in-process 直调 kernel（跨目录 import bridge-pi），无 JSON-RPC 管道、无 SessionMap 映射层**（pi JSONL 持久化取代 SessionMap 角色）。kernel 补 `set_permission_mode`（4 档）与 `clear_messages`（resetLeaf）两个 RPC。审计写入共享 audit_log.json（AUDIT-WIRE-001）。
- 测试：sessions-2.2e 4/4（创建/列表/详情/消息/limit 校验/权限模式 4 档+422/context-usage/清空/删除 404/batch best-effort）——bun-backend 全量 **34/34**。
- 2.2d 已交付：`src/routes/persona.ts`（9 端点：SOUL/USER 读写、变体文件名防穿越+尾分隔符容错、多人格 CRUD（B-011 memory 归一/B-012 frontmatter YAML dump 防注入/PERSONA-CREATE-001 原子写/删除活跃回退 SOUL.md/ACTIVE-FOLLOW-RENAME-001 rename 前记录活跃）、profile 解析+占位符防御；agent/prompts.py 的 4 个 persona 函数同文件直译）。
- **Bun.YAML.stringify 风格差异记录**：输出 flow 风格（pyyaml 为 block），SOUL.X.md frontmatter 格式不同但均为合法 YAML、round-trip 一致；注入防御语义等价（换行转义进值）。前端/解析器无感。
- 测试：persona-2.2d 5/5（读写/防穿越/创建注入防御/切换/删除回退/重命名三跟随/profile 占位符）——bun-backend 全量 **30/30**。
- 2.2c 已交付：`src/routes/memory.ts`（投影契约 description/theme/latest_update_time→content/category/updatedAt、过期剔除、`_` 前缀键跳过、q/category/min_confidence 过滤、stats、PUT/DELETE 404 语义、原子写）；`src/routes/audit-log.ts`（JSON 数组原子写、limit/event_type/since 过滤、倒序、stats top_targets、append 本地时区 %z 时间戳、clear）；session_manager.py 判定**归 2.3**（OMP 会话桥接的一部分：in-memory TTL + session_map.db 恢复——kernel in-process 后由会话表替代，非直译项）。
- 测试：routes-2.2c 4/4（投影契约/过滤/stats、PUT/DELETE 落盘验证、audit 全链路）——bun-backend 全量 **25/25**。

### 阶段 2.3 核心对话链路（2~3 天，最重）
- 范围：chat WS（hello/事件流/ask_user/user_response/取消/静默回顾）、chat_turns/chat_artifacts/session_compress/deferred_runs/activity_hub(SSE)/collab
- 顺序：WS 层先行（Bun WS + kernel 订阅直连，事件快照对照）→ REST 辅助 → SSE
- 验收：**25 个 WS 事件契约快照全绿**（kernel 层已有）+ WS 会话全流程手测（对话/审批/计划/目标/checkpoint/取消）；SSE 活动流手测

### 阶段 2.4 Provider/MCP/凭据（1~2 天）
- 范围：providers（**Fernet 兼容**）/mcp×4/opencode_zen
- 顺序：Fernet 兼容实现 → **向量测试**（Python 生成固定 envelope 固化到测试）→ providers CRUD → MCP 系列
- 验收：旧凭据可解密可用（真实凭据验证）；provider CRUD 手测；MCP 连通性测试手测

### 阶段 2.5 长尾与默认切换（1 天）
- 范围：剩余路由收尾；默认后端改 bun；旧 Python 进程保留一个版本周期
- 验收：全量契约快照 + 全量 bun:test + Python 回归（确认 Python 不再被依赖后进入 2.6）

### 阶段 2.6 Python 移除（0.5 天）
- 范围：删除 api/、main.py、PyInstaller 打包链；desktop/src-tauri 残留清理；`bun build --compile` 产物合并（单可执行）
- 验收：全仓零 api/ 引用；bun test 全绿；**便携包重建**（体积对比：预期 -300MB 级 Python 运行时）；判据 4 复核

---

## 4. 风险与兼容性评估

### 4.1 Fernet 凭据（最高风险）
- 现状：providers.py 用 `cryptography.fernet`（AES-128-CBC + HMAC-SHA256，key=credential.key）。用户已存的 API key 全在这个信封里。
- 方案：Bun 侧实现 Fernet 规范（版本字节 0x80 + timestamp + IV + ciphertext + HMAC）——只做格式兼容，不引入 Python；加密沿用同格式（key 不变）。向量测试锁定互操作。
- 残余风险：实现 bug 导致凭据不可解 → 缓解：向量测试 + 上线前真实凭据人工验证 + credential.key 原样保留可随时回滚。

### 4.2 SQLite 双写（灰度期风险）
- 灰度期 Python(8000) 与 Bun(8001) 共存，同库双写有锁冲突/丢写风险。
- 缓解：**按路由批切换写权**（2.2 起切换批的写入只走 Bun）；灰度期不同时开双后端做写操作；关键表切换前后行数/校验和比对。

### 4.3 功能语义漂移
- Pydantic 校验（422 细节）与 TypeBox 错误结构不同 → 前端错误提示路径需对齐（错误结构单测锁定）。
- httpx 超时/重试语义 vs fetch：opencode_zen 直译时保持参数等价。
- automation 下线影响：automation 路由 + headless_prompt + 前端面板（flag 隐藏）——已在 §7 决策点确认项。

### 4.4 性能
- 预期全面改善：少一层跨进程 JSON-RPC 往返；bun:sqlite 同步 API 快于 Python 线程池模式。
- 关注点：Bun.serve WS 并发稳定性——灰度期以 Python 为对照观察；单进程内存预算 <500MB。

### 4.5 回滚策略
- **代码**：每阶段独立 commit + tag（stage-2.0...stage-2.6）；Python 代码直到 2.6 才删除，2.5 前任何时刻可切回 Python。
- **数据**：SQLite/YAML 双端同格式零迁移；凭据信封格式不变；credential.key 不动。
- **前端**：MAXMA_API_BASE 指向 8000 或 8001，一行切换。
- **触发条件**：任何阶段验收不过 → 前端指回 Python → 修复后重试该批。

---

## 5. 测试与验证计划

| 层 | 内容 | 工具 |
| --- | --- | --- |
| 单元 | 各路由 handler、中间件（auth/rate-limit）、Fernet 兼容（**Python 生成向量**固化）、yaml-store 原子写、db 层 | bun:test |
| 契约快照 | HTTP 请求→响应 JSON 快照（每路由，随机字段掩码——沿用 entry-smoke 模式）；WS 事件 25 快照沿用 | bun:test toMatchSnapshot |
| 双跑对照 | 灰度期同一请求打 8000/8001 diff（动态字段掩码），批切换前必须零差异 | 对照脚本 |
| 数据完整性 | 批切换前后 SQLite 表行数/校验和；凭据解密验证 | 对照脚本 |
| E2E 手测清单 | 对话（流式/取消/审批/计划/目标/checkpoint）、MCP 工具、provider 凭据 CRUD、表情包上传、记忆/规则页、诊断/日志导出、Web 形态启动器 | 人工 |
| 回滚演练 | 阶段 2.3 完成后演练一次切回 Python 全流程 | 人工 |

---

## 6. 工作量与排期估算

| 阶段 | 估时 | 累计 |
| --- | --- | --- |
| 2.0 脚手架 | 1d | 1d ✅ |
| 2.1 只读批 | 1d | 2d |
| 2.2 存储批 | 2d | 4d |
| 2.3 对话链路 | 2~3d | 6~7d |
| 2.4 凭据/MCP | 1~2d | 7~9d |
| 2.5 切默认 | 1d | 8~10d |
| 2.6 删 Python | 0.5d | **8.5~10.5 个工作日** |

---

## 7. 决策点（审核确认记录）

1. ~~automation 功能~~：**用户已确认方案整体，automation 随 Python 移除下线**（前端面板 flag 隐藏）；如需恢复基于 Bun 重写为独立工作项。
2. ~~deferred_runs / collab~~：已复核有前端消费面，**保留直译**（阶段 2.3）。
3. **桌面壳**：Web 形态为当前分发形态；Electron 后议。
4. ~~灰度周期~~：每阶段验收即切，问题回滚（方案默认）。
