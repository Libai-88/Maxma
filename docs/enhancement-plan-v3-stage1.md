# MaxmaHere 阶段 1 实施计划：检索与记忆升级 + 可观测性闭环 + 工具注册现代化

> **版本**：v3-stage1
> **创建时间**：2026-07-04
> **目标**：补齐检索能力（RAG + 4 层记忆 + TTL 遗忘 + 通用知识库）、可观测性闭环（Metrics + Audit 前端面板 + SQLite 持久化）、工具注册去中心化
> **追踪方式**：每个任务含「相关文件」「改动类型」「预期改动点」「状态」四字段，开发时按文件路径定位即可

---

## 总览

| 子任务 | 名称 | 优先级 | 涉及文件数 | 新建文件数 |
|---|---|---|---|---|
| 1.1 | RAG 子系统新建（chromadb + ONNX Runtime） | P0 | 8 | 5 |
| 1.2 | 4 层记忆架构（短/长/情景/语义） | P0 | 23 | 8 |
| 1.3 | TTL 遗忘机制 | P0 | 9 | 2 |
| 1.4 | 通用知识库 v1 | P0 | 14 | 13 |
| 1.5 | MetricsView + AuditLogView 前端面板 | P0 | 11 | 6 |
| 1.6 | metrics SQLite 持久化 | P0 | 6 | 1 |
| 1.7 | 工具注册去中心化（目录扫描 + @register_tool） | P0 | ~52 | 2 |

---

## 子任务 1.1 — RAG 子系统新建

**目标**：引入 chromadb + ONNX Runtime 本地 CPU 模型，替换 memory_manager.py 中的字符 bigram Jaccard 相似度，让记忆检索质量从 60 分提到 90 分。

> **架构变更（v3-stage1 实施时调整）**：原计划用 sentence-transformers + torch，实施时发现 sentence-transformers 顶层 `import torch` 是硬依赖（无法通过延迟导入绕过），且 torch CPU 版体积达 ~468MB。为控制桌面安装包体积，改为 **ONNX Runtime 直推方案**：用 `transformers.AutoTokenizer` 做 tokenization，用 `onnxruntime.InferenceSession` 做 ONNX 推理，手动实现 mean pooling + L2 normalize。此方案不依赖 torch/sentence-transformers/scipy/scikit-learn，体积从 ~925MB 降至 ~178MB（节省 ~747MB）。

### 1.1.1 现有文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [memory/memory_manager.py](file:///d:/Maxma/MaxmaHere/memory/memory_manager.py) | YAML 持久化记忆存储，L304-365 的 find_similar 用 bigram + Jaccard | 替换 find_similar 内部实现为 chromadb 向量检索；保留对外签名 `find_similar(description, theme, threshold) -> list[dict]` 不变；MemoryItem 增加向量 id 字段；add/update/delete 时同步写入 chromadb collection |
| [memory/narrative.py](file:///d:/Maxma/MaxmaHere/memory/narrative.py) | L237 调用 `_current_mm.find_similar(content, theme, threshold=0.65)` 做智能合并检测 | 调用点无需改动（依赖 find_similar 签名稳定），但需在 RAG 初始化完成后才能调用 |
| [tools/__init__.py](file:///d:/Maxma/MaxmaHere/tools/__init__.py) | L460-514 select_tools_for_query 用关键词匹配 KEYWORD_TO_CATEGORIES | 可选：用 RAG 向量检索替代关键词匹配；或保留现状仅升级记忆 RAG（建议保留现状，工具选择改动风险高） |
| [requirements.txt](file:///d:/Maxma/MaxmaHere/requirements.txt) | 现有依赖，无 chromadb/onnxruntime/transformers | 新增 `chromadb`、`onnxruntime`、`transformers`（不含 torch/sentence-transformers） |
| [requirements-lock.txt](file:///d:/Maxma/MaxmaHere/requirements-lock.txt) | 锁定依赖 | 同步锁定 chromadb / onnxruntime / transformers 及传递依赖 |
| [pyproject.toml](file:///d:/Maxma/MaxmaHere/pyproject.toml) | 项目依赖声明源 | 同步新增 chromadb / onnxruntime / transformers 依赖声明 |
| [app_paths.py](file:///d:/Maxma/MaxmaHere/app_paths.py) | DATA_DIR、UPLOADS_DIR 等数据目录常量 | 新增 `VECTOR_DB_DIR = DATA_DIR / "vector_db"` 常量；在 `ensure_data_dirs()` 中创建该目录 |
| [config/settings.py](file:///d:/Maxma/MaxmaHere/config/settings.py) | Pydantic BaseSettings | 新增配置项：`embedding_model_name`（默认 paraphrase-multilingual-MiniLM-L12-v2）、`chromadb_collection_name`、`rag_top_k`、`rag_similarity_threshold`、`embedding_model_local_path`（打包时预置） |

### 1.1.2 新建文件

| 文件路径 | 职责 |
|---|---|
| `memory/rag/__init__.py` | RAG 模块包入口，导出 EmbeddingEngine、VectorStore |
| `memory/rag/embedding.py` | ONNX Runtime 嵌入引擎（不依赖 torch/sentence-transformers），提供 `embed(texts: list[str]) -> list[list[float]]`；用 `transformers.AutoTokenizer` + `onnxruntime.InferenceSession` 直推，手动实现 mean pooling + L2 normalize；首次启动懒加载模型，后续缓存；HuggingFace 官方仓库已预置 `onnx/model.onnx`，无需在线导出 |
| `memory/rag/vector_store.py` | chromadb 封装，提供 `upsert/delete/query/purge_expired` 接口，支持多 collection（long_term_memory、episodic、semantic、knowledge_base） |
| `memory/rag/indexer.py` | 文档切块（chunking）与索引同步：MemoryManager CRUD 钩子 → embedding → vector_store.upsert |
| `tests/test_memory/test_rag.py` | RAG 单元测试：embedding 一致性、向量检索召回率、TTL 过期清理 |

### 1.1.3 关键风险

- **chromadb 与 PyInstaller 兼容性**：chromadb 依赖较多原生扩展，需在 `desktop/src-tauri/` 的 spec 文件中配置 hidden imports 和 datas
- **ONNX 模型首次下载体积大**：首次启动会从 HuggingFace 下载模型（~120MB，含 onnx/model.onnx），建议在 `config/settings.py` 中支持 `embedding_model_local_path`，打包时预置模型文件到 BUNDLE_DIR
- **app_paths.py 已区分 BUNDLE_DIR（只读）和 DATA_DIR（可写）**：vector_db 必须放在 DATA_DIR 下
- **ONNX Runtime 后端选型说明**：原计划用 sentence-transformers + torch，实施时发现 sentence-transformers 5.6 顶层 `import torch` 是硬依赖，且 torch CPU 版体积达 ~468MB。改为 ONNX Runtime 直推方案后，site-packages 体积从 ~925MB 降至 ~178MB（节省 ~747MB），且 `build/maxma-server.spec` 的 `excludes` 明确排除 torch/sentence_transformers/scipy/sklearn/sympy/networkx/kubernetes/opentelemetry，防止意外拉入

### 1.1.4 状态

- [x] 已完成
  - memory/rag/__init__.py — RAG 模块包入口
  - memory/rag/embedding.py — ONNX Runtime 嵌入引擎（transformers.AutoTokenizer + onnxruntime.InferenceSession，手动 mean pooling + L2 normalize）
  - memory/rag/vector_store.py — chromadb 封装（4 collection）
  - memory/rag/indexer.py — CRUD 钩子 + 批量索引
  - tests/test_memory/test_rag.py — 20 tests（优雅降级 + CRUD 钩子 + 向量检索 + 自动重建索引）
  - memory/memory_manager.py — find_similar 升级为向量检索 + bigram 回退
  - app_paths.py — VECTOR_DB_DIR 常量
  - config/settings.py — RAG 配置项
  - pyproject.toml — chromadb + onnxruntime + transformers（不含 torch）
  - build/maxma-server.spec — excludes 排除 torch 全家桶 + sentence_transformers + scipy + sklearn

---

## 子任务 1.2 — 4 层记忆架构

**目标**：在现有 2 层（短期 checkpointer + 长期 YAML）基础上，补齐情景记忆层（对话快照库）和语义记忆层（知识事实库），形成经典 4 层架构。

### 1.2.1 现有文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [memory/__init__.py](file:///d:/Maxma/MaxmaHere/memory/__init__.py) | 空文件 | 导出 4 层记忆管理器的统一入口 |
| [memory/memory_manager.py](file:///d:/Maxma/MaxmaHere/memory/memory_manager.py) | 当前仅承载长期记忆（YAML），含 MemoryItem 和 CRUD | 定位为「长期记忆层（LongTerm）」存储引擎；新增 TTL 字段（见 1.3）；可选让 MemoryManager 成为基类 |
| [memory/narrative.py](file:///d:/Maxma/MaxmaHere/memory/narrative.py) | LongTermMemoryInterface 异步管线 + CRUD 工具 + get_narrative 注入系统提示词 | 改造为多层协调器：除长期记忆 CRUD 外，新增情景记忆（每轮对话快照）、语义记忆（自动提取的知识三元组）的写入接口；get_narrative 改为聚合多层输出 |
| [memory/memory_callback.py](file:///d:/Maxma/MaxmaHere/memory/memory_callback.py) | MemoryToolCallback 将 CRUD 工具事件推送到 WebSocket | 不动（现有事件推送机制可复用，新增层级 CRUD 工具可沿用相同回调） |
| [memory/user_init.py](file:///d:/Maxma/MaxmaHere/memory/user_init.py) | 首次运行从 example 复制 USER.md / SOUL.md / .env | 新增：初始化 4 层记忆所需的数据目录（vector_db/episodic/semantic 等） |
| [agent/context_manager.py](file:///d:/Maxma/MaxmaHere/agent/context_manager.py) | 短期记忆/上下文管理：滑动窗口截断、LLM 摘要、实体提取 | 明确定位为「短期记忆层（ShortTerm）」；新增接口：`commit_to_episodic()` 把当前 checkpoint 摘要写入情景记忆；`retrieve_from_episodic(query)` 按向量检索历史情景 |
| [agent/graph.py](file:///d:/Maxma/MaxmaHere/agent/graph.py) | LangGraph 图构建，AgentState（L113-115）仅含 messages，使用 MemorySaver checkpointer | AgentState 扩展 `episodic_context` 字段（从情景记忆检索的相关历史）；build_agent 注入 episodic retriever 节点 |
| [agent/prompts.py](file:///d:/Maxma/MaxmaHere/agent/prompts.py) | L143 调用 get_narrative() 注入长期记忆到「## 我对用户的记忆」段落 | 改为调用多层聚合函数：get_shortterm_context() + get_longterm_narrative() + get_episodic_retrieval(query) + get_semantic_facts()，分别注入对应段落 |
| [tools/memory/tool_create_memory.py](file:///d:/Maxma/MaxmaHere/tools/memory/tool_create_memory.py) | 创建长期记忆条目，调用 mm.add | 新增 `layer` 参数（long/episodic/semantic），分发到对应层管理器 |
| [tools/memory/tool_update_memory.py](file:///d:/Maxma/MaxmaHere/tools/memory/tool_update_memory.py) | 更新长期记忆条目 | 同上，支持多层级更新 |
| [tools/memory/tool_delete_memory.py](file:///d:/Maxma/MaxmaHere/tools/memory/tool_delete_memory.py) | 删除长期记忆条目 | 同上，支持多层级删除 |
| [tools/memory/tool_merge_memories.py](file:///d:/Maxma/MaxmaHere/tools/memory/tool_merge_memories.py) | 合并两条长期记忆 | 仅长期记忆层支持合并，情景/语义层不暴露合并 |
| [tools/memory/tool_list_memories.py](file:///d:/Maxma/MaxmaHere/tools/memory/tool_list_memories.py) | 列出所有长期记忆（截断 200 字） | 增加 layer 过滤参数 |
| [tools/memory/tool_read_memories.py](file:///d:/Maxma/MaxmaHere/tools/memory/tool_read_memories.py) | 按 ID 读取单条记忆完整内容 | 支持跨层读取 |
| [tools/memory/tool_search_memories.py](file:///d:/Maxma/MaxmaHere/tools/memory/tool_search_memories.py) | 按关键词/分区/时间搜索长期记忆 | 升级为 RAG 向量检索（调用 chromadb），同时保留关键词过滤作为二次筛选 |
| [tools/system/tool_forget.py](file:///d:/Maxma/MaxmaHere/tools/system/tool_forget.py) | forget 工具：从当前 checkpoint 移除含关键词的消息（**有 bug：L86 引用未定义的 `kept` 变量**） | 修复 bug；可扩展为支持清除情景记忆层中的特定 episode |
| [docs/04-记忆系统.md](file:///d:/Maxma/MaxmaHere/docs/04-记忆系统.md) | 文档：当前两层记忆架构 | 更新为 4 层架构说明：短期（checkpoint）/长期（YAML）/情景（对话快照库）/语义（知识事实库） |
| [dev_docs/notes/memory-system.md](file:///d:/Maxma/MaxmaHere/dev_docs/notes/memory-system.md) | 开发笔记：MemoryManager + narrative.py 架构说明 | 同步更新为 4 层架构实现细节 |
| [api/routes/memory.py](file:///d:/Maxma/MaxmaHere/api/routes/memory.py) | REST API：GET /narrative、GET /memories、PUT /memories/{id}、GET /moment | 新增端点：GET /memories/episodic、GET /memories/semantic、POST /memories/search（向量检索） |
| [api/server.py](file:///d:/Maxma/MaxmaHere/api/server.py) | FastAPI 工厂，L47 导入 LongTermMemoryInterface 并在 lifespan 中启动 ltm consumer | 改为初始化 4 层记忆管理器并注入 app.state |
| [tests/test_memory/test_memory_manager.py](file:///d:/Maxma/MaxmaHere/tests/test_memory/test_memory_manager.py) | MemoryManager 单元测试 | 新增 RAG 检索、TTL 过期、多层级 CRUD 测试 |
| [tests/test_memory/test_narrative.py](file:///d:/Maxma/MaxmaHere/tests/test_memory/test_narrative.py) | narrative 模块测试 | 新增情景记忆写入、语义记忆提取的集成测试 |
| [tests/test_memory/test_narrative_integration.py](file:///d:/Maxma/MaxmaHere/tests/test_memory/test_narrative_integration.py) | narrative 集成测试 | 覆盖 4 层协同流程 |

### 1.2.2 新建文件

| 文件路径 | 职责 |
|---|---|
| `memory/episodic.py` | 情景记忆层：每轮对话结束生成 episode 快照（含 turn_id、timestamp、摘要、原始消息引用），写入 vector_store 的 episodic collection |
| `memory/semantic.py` | 语义记忆层：从对话/文档中抽取结构化事实三元组（subject-predicate-object），去重后写入 semantic collection |
| `memory/coordinator.py` | 4 层记忆协调器：统一对外接口 `retrieve(query, layers=["short","long","episodic","semantic"]) -> dict`，聚合各层检索结果 |
| `tools/memory/tool_search_episodic.py` | 情景记忆检索工具（供 Agent 主动回忆历史对话场景） |
| `tools/memory/tool_search_semantic.py` | 语义记忆检索工具（供 Agent 查询结构化事实） |
| `tests/test_memory/test_episodic.py` | 情景记忆层测试 |
| `tests/test_memory/test_semantic.py` | 语义记忆层测试 |
| `tests/test_memory/test_coordinator.py` | 4 层协调器集成测试 |

### 1.2.3 关键设计点

- **MemorySaver 是内存 checkpointer**：agent/graph.py L166 默认用 MemorySaver，进程重启即丢失短期记忆。如需 4 层架构中的短期记忆持久化，需替换为 `langgraph-checkpoint-sqlite` 或类似持久化 checkpointer
- **4 层边界**：
  - 短期（ShortTerm）：当前对话上下文，checkpointer 管理
  - 长期（LongTerm）：用户画像/偏好/重要事件，YAML + 向量检索
  - 情景（Episodic）：对话快照库，按 turn 存储，支持"上次我们聊到哪了"式回忆
  - 语义（Semantic）：结构化事实三元组，从对话/文档中抽取

### 1.2.4 状态

- [x] 已完成
  - memory/episodic.py — EpisodicMemoryManager（JSON + chromadb）
  - memory/semantic.py — SemanticMemoryManager（JSON + chromadb，去重）
  - memory/coordinator.py — 4 层协调器（跨层检索聚合）
  - agent/graph.py — episodic_retriever_node + AgentState.episodic_context
  - agent/prompts.py — _scan_semantic_facts() 注入 + 指纹缓存
  - agent/context_manager.py — commit_to_episodic() / retrieve_from_episodic()
  - tools/memory/tool_search_episodic.py — 情景记忆检索工具
  - tools/memory/tool_search_semantic.py — 语义记忆检索工具
  - tools/memory/tool_create_memory.py — 新增 layer 参数（long/episodic/semantic）
  - tools/memory/tool_update_memory.py — 按 ID 前缀跨层更新
  - tools/memory/tool_delete_memory.py — 按 ID 前缀跨层删除
  - tools/memory/tool_list_memories.py — 新增 layer 过滤参数
  - tools/memory/tool_read_memories.py — 按 ID 前缀跨层读取
  - tools/memory/tool_search_memories.py — 升级为 RAG 向量检索 + 关键词回退
  - tools/system/tool_forget.py — 修复 kept 未定义 bug
  - api/routes/memory.py — 语义记忆变更失效缓存
  - api/routes/chat.py + api/server.py + tools/sub_agent/* — 透传 episodic_mm
  - memory/ttl.py — TTL 清理时失效系统提示词缓存
  - docs/04-记忆系统.md — 更新为 4 层架构说明
  - tests/test_memory/test_episodic.py — 19 tests
  - tests/test_memory/test_semantic.py — 20 tests
  - tests/test_memory/test_coordinator.py — 21 tests

---

## 子任务 1.3 — TTL 遗忘机制

**目标**：解决 memory.yaml 只增不减的问题，引入 TTL 时间衰减机制，让"瞬间"和"时效待办"分区自动过期。

### 1.3.1 现有文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [memory/memory_manager.py](file:///d:/Maxma/MaxmaHere/memory/memory_manager.py) | MemoryItem（L24-79）含 description/theme/history/latest_update_time；无 TTL 字段 | MemoryItem 新增 `ttl: Optional[int]`（秒）、`expires_at: Optional[str]`（绝对时间）；add/update 时计算 expires_at；新增 `purge_expired()` 方法遍历删除过期项；show/search 过滤掉已过期项 |
| [memory/narrative.py](file:///d:/Maxma/MaxmaHere/memory/narrative.py) | L47-72 prompt 指导 LLM 何时调用 delete_memory，完全依赖 LLM 主动判断 | 更新 prompt：让 LLM 在 create_memory 时为"瞬间"/"时效待办"分区自动建议 ttl（如 86400 秒）；新增自动遗忘守护任务：在 _consumer 协程中周期性调用 mm.purge_expired() |
| [memory/narrative.py](file:///d:/Maxma/MaxmaHere/memory/narrative.py) | L215-247 create_memory @tool 函数，L245 `_current_mm.add(description=content, theme=section)` | 新增 `ttl: Optional[int] = None` 参数，透传给 mm.add |
| [tools/memory/tool_create_memory.py](file:///d:/Maxma/MaxmaHere/tools/memory/tool_create_memory.py) | L46 `mm.add(description=content, theme=section)` | CreateMemoryInput 新增 `ttl: Optional[int]`，透传给 mm.add |
| [tools/memory/tool_update_memory.py](file:///d:/Maxma/MaxmaHere/tools/memory/tool_update_memory.py) | L49 `mm.update(id, reason=reason, new_description=content)` | UpdateMemoryInput 新增 `ttl: Optional[int]`，支持更新时重置过期时间 |
| [api/routes/memory.py](file:///d:/Maxma/MaxmaHere/api/routes/memory.py) | L49 `mm.update(memory_id, reason="用户通过前端编辑", ...)` | UpdateMemoryBody 新增 `ttl: Optional[int]`；新增 GET /memories/expired 端点用于查看已过期未清理项 |
| [api/server.py](file:///d:/Maxma/MaxmaHere/api/server.py) | lifespan 中启动 ltm consumer | 新增后台任务：每 5 分钟调用一次 mm.purge_expired() 并 invalidate_narrative_cache |
| [config/settings.py](file:///d:/Maxma/MaxmaHere/config/settings.py) | 全局配置 | 新增 `ttl_purge_interval_seconds: int = 300`、`default_episodic_ttl: int = 604800`（7 天）等 |

### 1.3.2 新建文件

| 文件路径 | 职责 |
|---|---|
| `memory/ttl.py` | TTL 调度器：后台 asyncio task，周期性扫描所有 MemoryManager 实例与 vector_store collection，删除 expires_at < now() 的条目；提供 `schedule_purge(interval, mm_list)` 和 `stop_purge()` |
| `tests/test_memory/test_ttl.py` | TTL 过期机制测试（创建带 ttl 条目 → 等待过期 → 验证 purge_expired 删除） |

### 1.3.3 关键设计点

- **向后兼容**：新增 ttl 参数默认 None 表示永久，不影响现有调用
- **MemoryManager.add 调用点共 6 处**（narrative.py L245、tools/memory/tool_create_memory.py L46、api/routes/memory.py L49 间接通过 update、tests 多处），需保持签名兼容
- **TTL 与 4 层架构的配合**：
  - 短期：checkpointer 自带（会话结束即清）
  - 长期：默认永久，"瞬间"/"时效待办"分区带 TTL
  - 情景：默认 7 天 TTL
  - 语义：默认永久（知识事实不轻易遗忘）

### 1.3.4 状态

- [ ] 待启动

---

## 子任务 1.4 — 通用知识库 v1

**目标**：构建通用 agent 知识库，支持个人知识助手和项目代码库索引场景，让 Agent 能基于用户上传的文档回答问题。

### 1.4.1 现有文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [api/routes/files.py](file:///d:/Maxma/MaxmaHere/api/routes/files.py) | 仅提供 GET /select-file（系统文件选择对话框） | 新增知识库 CRUD 端点：POST /kb/documents、GET /kb/documents、DELETE /kb/documents/{id}、POST /kb/search、POST /kb/import-url |
| [api/routes/upload.py](file:///d:/Maxma/MaxmaHere/api/routes/upload.py) | 通用文件上传（20MB 限制，扩展名白名单），存入 UPLOADS_DIR | 上传完成后可选触发文档解析 → 切块 → embedding → 入 chromadb collection「knowledge_base」；.meta 中记录 kb_doc_id |
| [web/src/views/MemoryView.vue](file:///d:/Maxma/MaxmaHere/web/src/views/MemoryView.vue) | 记忆视图（仅渲染 MemoryPanel） | 可选：扩展为"记忆与知识库"复合视图，或保持独立新增 KbView |
| [web/src/router/index.ts](file:///d:/Maxma/MaxmaHere/web/src/router/index.ts) | 14 条路由，无 /kb 路由 | 新增 `{ path: '/kb', name: 'kb', component: () => import('@/views/KbView.vue') }` |
| [web/src/api/index.ts](file:///d:/Maxma/MaxmaHere/web/src/api/index.ts) | API 封装，含 getNarrative/getMemories/updateMemory/uploadImage 等 | 新增 KB API：listKbDocuments、uploadKbDocument、deleteKbDocument、searchKb、importUrlToKb |
| [web/src/components/MemoryPanel.vue](file:///d:/Maxma/MaxmaHere/web/src/components/MemoryPanel.vue) | 记忆面板：搜索/过滤/编辑，含 Vignette 瀑布流 + Markdown 回退 | 可选：在搜索栏旁新增"知识库"tab，或独立为 KbPanel |
| [web/src/App.vue](file:///d:/Maxma/MaxmaHere/web/src/App.vue) | 主布局：侧边栏导航（对话/记忆/动态NEWS + 设置 popup） | 在 sidebar-nav 中新增 `<router-link to="/kb">知识库</router-link>` 入口 |
| [tools/__init__.py](file:///d:/Maxma/MaxmaHere/tools/__init__.py) | 工具注册与分类 | 新增"kb"工具分类（kb_search、kb_add_document 等），加入 TOOL_CATEGORIES 和 KEYWORD_TO_CATEGORIES（关键词如"知识库""文档""检索"） |
| [requirements.txt](file:///d:/Maxma/MaxmaHere/requirements.txt) | 依赖 | 新增文档解析依赖：`pypdf`、`python-docx`（已有）、`unstructured`（可选） |
| [app_paths.py](file:///d:/Maxma/MaxmaHere/app_paths.py) | 数据目录常量 | 新增 `KB_DIR = DATA_DIR / "knowledge_base"`（存放原始文档副本）、`KB_VECTOR_DIR = DATA_DIR / "vector_db" / "kb"`（chromadb collection） |

### 1.4.2 不动的现有文件（可复用能力）

| 文件路径 | 当前职责 | 复用方式 |
|---|---|---|
| [tools/network/tavily/tool_search.py](file:///d:/Maxma/MaxmaHere/tools/network/tavily/tool_search.py) | Tavily Search API 网络搜索 | KB 检索的 fallback：KB 命中不足时自动调用 |
| [tools/network/tavily/tool_extract.py](file:///d:/Maxma/MaxmaHere/tools/network/tavily/tool_extract.py) | Tavily Extract 从 URL 提取 Markdown | 知识库导入 URL 时复用此工具提取内容 |
| [tools/files/tool_file_read.py](file:///d:/Maxma/MaxmaHere/tools/files/tool_file_read.py) | 读取本地文件内容（含白名单校验） | KB 文档解析时复用此工具读取上传文件 |
| [tools/files/tool_file_search.py](file:///d:/Maxma/MaxmaHere/tools/files/tool_file_search.py) | 列目录 / glob 搜索文件 | KB 批量导入目录下的文档 |

### 1.4.3 新建文件

| 文件路径 | 职责 |
|---|---|
| `memory/kb/__init__.py` | 知识库模块包入口 |
| `memory/kb/document_loader.py` | 文档加载器：支持 txt/md/pdf/docx/csv/json，输出统一 Document 对象（含 metadata） |
| `memory/kb/chunker.py` | 文档切块器：按 token 数（如 500）+ 重叠（如 50）切块，保留 source_doc_id 和 offset |
| `memory/kb/indexer.py` | KB 索引器：document_loader → chunker → embedding → vector_store.upsert（kb collection），维护 doc_id → chunk_ids 映射 |
| `memory/kb/retriever.py` | KB 检索器：query → embedding → vector_store.query → 返回 top_k chunks（含 source_doc、score、highlight） |
| `api/routes/kb.py` | 知识库 REST API：POST /kb/documents、GET /kb/documents、DELETE /kb/documents/{id}、POST /kb/search、POST /kb/import-url |
| `tools/kb/__init__.py` | KB 工具包入口 |
| `tools/kb/tool_kb_search.py` | KB 检索工具（供 Agent 主动查询知识库） |
| `tools/kb/tool_kb_add.py` | KB 添加工具（供 Agent 主动把对话中的 URL/文件加入知识库） |
| `web/src/views/KbView.vue` | 知识库管理页面（文档列表、上传、删除、检索测试） |
| `web/src/components/KbPanel.vue` | 知识库面板组件（嵌入 ChatView 侧边或独立页） |
| `web/src/components/KbSearchBubble.vue` | KB 检索结果气泡组件（在对话中展示 KB 命中片段） |
| `web/src/stores/kb.ts` | Pinia KB store（文档列表缓存、检索结果状态） |
| `tests/test_api/test_kb.py` | KB API 集成测试 |
| `tests/test_memory/test_kb_indexer.py` | KB 索引器测试 |
| `tests/test_memory/test_kb_retriever.py` | KB 检索器测试 |

### 1.4.4 状态

- [x] 已完成
  - memory/kb/__init__.py — 知识库模块包入口
  - memory/kb/document_loader.py — 文档加载器（txt/md/pdf/docx/csv/json）
  - memory/kb/chunker.py — 文档切块器（字符数 + 重叠 + 边界检测）
  - memory/kb/indexer.py — KB 索引器（加载→切块→embedding→chromadb）
  - memory/kb/retriever.py — KB 检索器（向量检索 + 阈值过滤）
  - api/routes/kb.py — KB REST API（CRUD + 检索 + URL 导入）
  - tools/kb/__init__.py — KB 工具包入口
  - tools/kb/tool_kb_search.py — KB 检索工具（@register_tool）
  - tools/kb/tool_kb_add.py — KB 添加工具（文件/URL/文本三选一）
  - tools/__init__.py — 新增 "kb" 工具分类 + 关键词映射
  - api/server.py — 注册 KB 路由
  - web/src/views/KbView.vue — 知识库管理页面
  - web/src/stores/kb.ts — Pinia KB store
  - web/src/types/index.ts — KbDocument/KbSearchResult 类型
  - web/src/api/index.ts — 7 个 KB API 方法
  - web/src/router/index.ts — /kb 路由
  - web/src/App.vue — 知识库导航入口
  - tests/test_memory/test_kb_indexer.py — 24 tests
  - tests/test_memory/test_kb_retriever.py — 11 tests
  - tests/test_api/test_kb.py — 14 tests

---

## 子任务 1.5 — MetricsView + AuditLogView 前端面板

**目标**：补齐可观测性前端面板，让后端已完备的 metrics + audit_log API 对普通用户可见。

### 1.5.1 后端（数据源，基本不动）

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [api/metrics.py](file:///d:/Maxma/MaxmaHere/api/metrics.py) | Metrics 单例 + _Histogram，纯内存存储，提供 get_snapshot() | 1.6 会改；1.5 仅消费其快照格式 |
| [api/routes/metrics.py](file:///d:/Maxma/MaxmaHere/api/routes/metrics.py) | 单端点 GET /metrics 返回快照 | 可选：新增 GET /metrics/history 从 SQLite 读历史序列（依赖 1.6） |
| [agent/audit_log.py](file:///d:/Maxma/MaxmaHere/agent/audit_log.py) | JSONL 审计日志，提供 read_log/get_stats/clear_log/trim_log | 不动（数据源已完备） |
| [api/routes/audit_log.py](file:///d:/Maxma/MaxmaHere/api/routes/audit_log.py) | 4 个端点：GET /audit-log、GET /audit-log/stats、POST /audit-log/clear、POST /audit-log/encrypt-keys | 不动（端点齐全） |

### 1.5.2 前端基础设施修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [web/src/router/index.ts](file:///d:/Maxma/MaxmaHere/web/src/router/index.ts) | 13 条路由 | 新增 `{ path: '/metrics', component: () => import('@/views/MetricsView.vue') }` 和 `{ path: '/audit-log', component: () => import('@/views/AuditLogView.vue') }` |
| [web/src/api/index.ts](file:///d:/Maxma/MaxmaHere/web/src/api/index.ts) | REST 封装；已封装 audit-log 4 方法，**未封装 metrics** | 新增 `getMetrics: () => request<MetricsSnapshot>('/metrics')`；可选 `getMetricsHistory` |
| [web/src/App.vue](file:///d:/Maxma/MaxmaHere/web/src/App.vue) | 主布局 + 侧边栏；settings-popup 内有 9 个 popup-item | 在 `.settings-popup` 中追加 `<router-link to="/metrics">` 和 `<router-link to="/audit-log">` 两个 popup-item |
| [web/src/types/index.ts](file:///d:/Maxma/MaxmaHere/web/src/types/index.ts) | 前端类型定义；已有 HealthResponse，无 Metrics/AuditLog 类型 | 新增 MetricsSnapshot（含 http/tools/llm/errors 子结构）、AuditLogRecord、AuditLogStats、AuditLogListResponse 类型 |
| [web/package.json](file:///d:/Maxma/MaxmaHere/web/package.json) | 前端依赖，**无图表库** | 可选：若决定引入轻量图表库可加 chart.js 或 apexcharts；推荐保持零依赖用 SVG 自绘 sparkline/bar |

### 1.5.3 前端 UI 组件库（直接复用，不动）

| 文件路径 | 用途 |
|---|---|
| [web/src/components/ui/DsBadge.vue](file:///d:/Maxma/MaxmaHere/web/src/components/ui/DsBadge.vue) | 状态码分布、错误计数徽章 |
| [web/src/components/ui/DsButton.vue](file:///d:/Maxma/MaxmaHere/web/src/components/ui/DsButton.vue) | 清空日志、加密密钥按钮 |
| [web/src/components/ui/DsCard.vue](file:///d:/Maxma/MaxmaHere/web/src/components/ui/DsCard.vue) | 各面板分区容器 |
| [web/src/components/ui/DsInput.vue](file:///d:/Maxma/MaxmaHere/web/src/components/ui/DsInput.vue) | AuditLogView 过滤/搜索输入 |
| [web/src/components/ui/DsModal.vue](file:///d:/Maxma/MaxmaHere/web/src/components/ui/DsModal.vue) | 清空日志确认弹窗 |

### 1.5.4 前端模式参考（不动）

| 文件路径 | 参考内容 |
|---|---|
| [web/src/stores/health.ts](file:///d:/Maxma/MaxmaHere/web/src/stores/health.ts) | 健康检查轮询 store（30s 间隔，前 3 次 3s 快速探测）作为新 store 模板 |
| [web/src/components/HealthPanel.vue](file:///d:/Maxma/MaxmaHere/web/src/components/HealthPanel.vue) | 紧凑状态面板风格参考 |
| [web/src/components/StatusBadge.vue](file:///d:/Maxma/MaxmaHere/web/src/components/StatusBadge.vue) | 徽章 + 弹出卡片模式参考 |
| [web/src/views/ProvidersView.vue](file:///d:/Maxma/MaxmaHere/web/src/views/ProvidersView.vue) | 列表+表单切换 View 模式参考 |
| [web/src/assets/styles/design-system.css](file:///d:/Maxma/MaxmaHere/web/src/assets/styles/design-system.css) | 设计令牌（如需图表/进度条样式可追加） |

### 1.5.5 新建文件

| 文件路径 | 职责 |
|---|---|
| `web/src/views/MetricsView.vue` | 指标面板：HTTP/Tools/LLM/Errors 四区，sparkline + 数字卡片 |
| `web/src/views/AuditLogView.vue` | 审计日志面板：过滤栏 + 列表 + 统计卡片 + 清空/加密操作 |
| `web/src/stores/metrics.ts` | metrics store：轮询 /metrics，缓存 snapshot（仿 health.ts） |
| `web/src/stores/auditLog.ts` | audit-log store：加载列表 + stats，支持过滤刷新 |
| `web/src/components/Sparkline.vue` | 轻量 SVG sparkline 组件（无外部依赖） |
| `web/src/components/BarChartMini.vue` | 轻量 SVG 柱状图组件（状态码分布/工具调用排行） |

### 1.5.6 状态

- [x] 已完成
  - web/src/types/index.ts — 新增 MetricsSnapshot / MetricsHistoryResponse / MetricsHistogram / AuditLogRecord / AuditLogStats / AuditLogListResponse 类型
  - web/src/api/index.ts — 新增 getMetrics、getMetricsHistory；audit-log 4 方法补齐泛型类型
  - web/src/stores/metrics.ts — metrics Pinia store（轮询 /metrics + history 缓存）
  - web/src/stores/auditLog.ts — auditLog Pinia store（loadRecords / loadStats / clearAll / encryptKeys）
  - web/src/components/Sparkline.vue — 轻量 SVG sparkline 组件（折线+填充+末端点，零依赖）
  - web/src/components/BarChartMini.vue — 轻量 SVG 柱状图组件（标签+条形+数值，零依赖）
  - web/src/views/MetricsView.vue — 指标面板：HTTP/Tools/LLM/Errors 四区数字卡片 + 状态码/路径/工具/模型柱状图 + 历史 sparkline 趋势
  - web/src/views/AuditLogView.vue — 审计日志面板：统计卡片 + 高频目标柱状图 + 类型/日期/条数过滤 + 日志列表 + 清空/加密操作
  - web/src/router/index.ts — 新增 /metrics 与 /audit-log 路由
  - web/src/App.vue — 设置弹窗新增「运行指标」「审计日志」入口
  - 前端构建通过：391 modules transformed, MetricsView 9.46kB / AuditLogView 5.97kB / BarChartMini 1.11kB

---

## 子任务 1.6 — metrics SQLite 持久化

**目标**：解决 api/metrics.py:9 自陈"重启后清零"问题，落 SQLite 持久化，保留快照 + 日聚合。

### 1.6.1 现有文件修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [api/metrics.py](file:///d:/Maxma/MaxmaHere/api/metrics.py) | _Histogram dataclass + Metrics 单例（线程锁 + 内存 dict）；record_request/tool_call/llm_call/error + get_snapshot() + reset() | 1) record_* 方法追加异步写入 SQLite（或缓冲批量写入）；2) 新增 get_history(window_seconds) 从 SQLite 读时序；3) 新增 persist_snapshot() 定时落盘；4) _init_state 中启动后台 flush 任务 |
| [api/db/core.py](file:///d:/Maxma/MaxmaHere/api/db/core.py) | SCHEMA_VERSION=1，7 张表，WAL 模式，自动迁移 | 1) SCHEMA_VERSION bump 到 2；2) SCHEMA_MIGRATIONS 追加 v2 SQL：创建 metrics_snapshots（id/timestamp/uptime/http_json/tools_json/llm_json/errors_json）和 metrics_events（id/timestamp/event_type/name/latency_ms/status/extra_json）表；3) 可选追加索引 |
| [api/server.py](file:///d:/Maxma/MaxmaHere/api/server.py) | FastAPI 工厂；lifespan 中 initialize_database() + 后台任务 | lifespan 中新增：1) 启动 Metrics 后台 flush 任务；2) 关闭时取消 flush 任务并最后落盘一次 |
| [api/routes/metrics.py](file:///d:/Maxma/MaxmaHere/api/routes/metrics.py) | 单端点 GET /metrics | 可选：新增 GET /metrics/history?window=3600 端点查询历史快照序列 |
| [tests/test_api/test_metrics.py](file:///d:/Maxma/MaxmaHere/tests/test_api/test_metrics.py) | 测试 Metrics 单例、record_*、snapshot、reset | 新增 SQLite 持久化测试：写入后读 history、flush 触发、reset 清库 |

### 1.6.2 不动的参考文件

| 文件路径 | 参考内容 |
|---|---|
| [api/db/hooks.py](file:///d:/Maxma/MaxmaHere/api/db/hooks.py) | HookDbStore 类（load_all/get/save/delete）作为 Store 类模式参考 |
| [api/db/providers.py](file:///d:/Maxma/MaxmaHere/api/db/providers.py) | ProviderDbStore 类 + migrate_from_yaml 作为带迁移的 Store 模式参考 |
| [api/middleware/request_log.py](file:///d:/Maxma/MaxmaHere/api/middleware/request_log.py) | 已调用 record_request，自动写入内存；1.6 落盘后自动持久化 |
| [app_paths.py](file:///d:/Maxma/MaxmaHere/app_paths.py) | DB 路径 `DB_PATH = DATA_DIR/api/data/maxma.db` 在 api/db/core.py 内定义，metrics 表落入既有 maxma.db |

### 1.6.3 新建文件

| 文件路径 | 职责 |
|---|---|
| `api/db/metrics.py` | MetricsDbStore 类：save_snapshot()/get_history()/save_event()/get_events()，仿 HookDbStore 模式 |

### 1.6.4 关键设计点

- **当前 DB schema_version=1**：新增 metrics 表需追加 v2 迁移并 bump SCHEMA_VERSION
- **Metrics 已有中间件集成**：record_tool_call/record_llm_call/record_error 尚未在任何业务代码中被调用（仅测试中使用），1.6 后需补齐调用点
- **存储策略**：快照 + 日聚合（不做细粒度时序），存储占用小

### 1.6.5 状态

- [ ] 待启动

---

## 子任务 1.7 — 工具注册去中心化（目录扫描 + @register_tool 装饰器）

**目标**：消除 tools/__init__.py:50-215 硬编码 62 个工具 import 的中心化注册，改为目录扫描 + 装饰器自动注册，让新增工具零配置。

### 1.7.1 核心改动文件

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [tools/__init__.py](file:///d:/Maxma/MaxmaHere/tools/__init__.py) | 中心化注册表：get_all_tools() 手动 import + 实例化 ~50 个工具；validate_tool_registry() 校验；TOOL_CATEGORIES/CORE_TOOLS/KEYWORD_TO_CATEGORIES 静态字典；select_tools_for_query() 关键词匹配 | 1) get_all_tools() 改为目录扫描 + 装饰器收集：遍历 tools/*/tool_*.py，导入模块让 @register_tool 执行并注册到全局 _REGISTRY；2) 保留 TOOL_CATEGORIES/CORE_TOOLS/KEYWORD_TO_CATEGORIES/select_tools_for_query/merge_tool_lists 不变（基于工具名而非导入路径）；3) validate_tool_registry 保留；4) 删除 ~50 行手动 import + 实例化 |
| [tools/tool_base.py](file:///d:/Maxma/MaxmaHere/tools/tool_base.py) | ToolBase(BaseTool) 基类：client 字段 + _load_doc() | 新增 @register_tool 装饰器（可放本文件或新建 tools/registry.py）；装饰器在类定义时把类追加到 tools._REGISTRY |
| [tools/base.py](file:///d:/Maxma/MaxmaHere/tools/base.py) | 向后兼容 re-export 门面 | 若 @register_tool 定义在 tools/registry.py，此处追加 `from tools.registry import register_tool` re-export |

### 1.7.2 工具文件修改（机械重复，~45 处）

每个文件类定义上加 `@register_tool` 装饰器：

| 文件路径 | 工具类 |
|---|---|
| [tools/files/tool_file_read.py](file:///d:/Maxma/MaxmaHere/tools/files/tool_file_read.py) | FileReadTool |
| [tools/files/tool_file_write.py](file:///d:/Maxma/MaxmaHere/tools/files/tool_file_write.py) | FileWriteTool |
| [tools/files/tool_file_manage.py](file:///d:/Maxma/MaxmaHere/tools/files/tool_file_manage.py) | FileManageTool |
| [tools/files/tool_file_search.py](file:///d:/Maxma/MaxmaHere/tools/files/tool_file_search.py) | FileSearchTool |
| [tools/files/tool_file_edit.py](file:///d:/Maxma/MaxmaHere/tools/files/tool_file_edit.py) | FileEditTool |
| [tools/git/tool_git_status.py](file:///d:/Maxma/MaxmaHere/tools/git/tool_git_status.py) | GitStatusTool |
| [tools/git/tool_git_diff.py](file:///d:/Maxma/MaxmaHere/tools/git/tool_git_diff.py) | GitDiffTool |
| [tools/git/tool_git_log.py](file:///d:/Maxma/MaxmaHere/tools/git/tool_git_log.py) | GitLogTool |
| [tools/git/tool_git_commit.py](file:///d:/Maxma/MaxmaHere/tools/git/tool_git_commit.py) | GitCommitTool |
| [tools/git/tool_git_branch.py](file:///d:/Maxma/MaxmaHere/tools/git/tool_git_branch.py) | GitBranchTool |
| [tools/git/tool_git_push.py](file:///d:/Maxma/MaxmaHere/tools/git/tool_git_push.py) | GitPushTool |
| [tools/git/tool_git_pr.py](file:///d:/Maxma/MaxmaHere/tools/git/tool_git_pr.py) | GitPrTool |
| [tools/memory/tool_create_memory.py](file:///d:/Maxma/MaxmaHere/tools/memory/tool_create_memory.py) | CreateMemoryTool |
| [tools/memory/tool_read_memories.py](file:///d:/Maxma/MaxmaHere/tools/memory/tool_read_memories.py) | ReadMemoriesTool |
| [tools/memory/tool_list_memories.py](file:///d:/Maxma/MaxmaHere/tools/memory/tool_list_memories.py) | ListMemoriesTool |
| [tools/memory/tool_update_memory.py](file:///d:/Maxma/MaxmaHere/tools/memory/tool_update_memory.py) | UpdateMemoryTool |
| [tools/memory/tool_delete_memory.py](file:///d:/Maxma/MaxmaHere/tools/memory/tool_delete_memory.py) | DeleteMemoryTool |
| [tools/memory/tool_merge_memories.py](file:///d:/Maxma/MaxmaHere/tools/memory/tool_merge_memories.py) | MergeMemoriesTool |
| [tools/memory/tool_search_memories.py](file:///d:/Maxma/MaxmaHere/tools/memory/tool_search_memories.py) | SearchMemoriesTool |
| [tools/config/tool_manage_skills.py](file:///d:/Maxma/MaxmaHere/tools/config/tool_manage_skills.py) | ManageSkillsTool |
| [tools/config/tool_manage_mcp.py](file:///d:/Maxma/MaxmaHere/tools/config/tool_manage_mcp.py) | ManageMcpTool |
| [tools/config/tool_manage_providers.py](file:///d:/Maxma/MaxmaHere/tools/config/tool_manage_providers.py) | ManageProvidersTool |
| [tools/config/tool_manage_macros.py](file:///d:/Maxma/MaxmaHere/tools/config/tool_manage_macros.py) | ManageMacrosTool |
| [tools/config/tool_manage_env_vars.py](file:///d:/Maxma/MaxmaHere/tools/config/tool_manage_env_vars.py) | ManageEnvVarsTool |
| [tools/config/tool_manage_whitelist.py](file:///d:/Maxma/MaxmaHere/tools/config/tool_manage_whitelist.py) | ManageWhitelistTool |
| [tools/system/tool_python.py](file:///d:/Maxma/MaxmaHere/tools/system/tool_python.py) | RunPythonTool |
| [tools/system/tool_project_info.py](file:///d:/Maxma/MaxmaHere/tools/system/tool_project_info.py) | ProjectInfoTool |
| [tools/system/tool_context_strategy.py](file:///d:/Maxma/MaxmaHere/tools/system/tool_context_strategy.py) | ContextStrategyTool |
| [tools/system/tool_forget.py](file:///d:/Maxma/MaxmaHere/tools/system/tool_forget.py) | ForgetTool |
| [tools/system/tool_create_persona.py](file:///d:/Maxma/MaxmaHere/tools/system/tool_create_persona.py) | CreatePersonaTool |
| [tools/todo/tool_add.py](file:///d:/Maxma/MaxmaHere/tools/todo/tool_add.py) | TodoAddTool |
| [tools/todo/tool_list.py](file:///d:/Maxma/MaxmaHere/tools/todo/tool_list.py) | TodoListTool |
| [tools/todo/tool_complete.py](file:///d:/Maxma/MaxmaHere/tools/todo/tool_complete.py) | TodoCompleteTool |
| [tools/todo/tool_uncomplete.py](file:///d:/Maxma/MaxmaHere/tools/todo/tool_uncomplete.py) | TodoUncompleteTool |
| [tools/todo/tool_delete.py](file:///d:/Maxma/MaxmaHere/tools/todo/tool_delete.py) | TodoDeleteTool |
| [tools/todo/tool_update.py](file:///d:/Maxma/MaxmaHere/tools/todo/tool_update.py) | TodoUpdateTool |
| [tools/todo/tool_query.py](file:///d:/Maxma/MaxmaHere/tools/todo/tool_query.py) | TodoQueryTool |
| [tools/todo/tool_list_labels.py](file:///d:/Maxma/MaxmaHere/tools/todo/tool_list_labels.py) | TodoListLabelsTool |
| [tools/todo/tool_list_projects.py](file:///d:/Maxma/MaxmaHere/tools/todo/tool_list_projects.py) | TodoListProjectsTool |
| [tools/todo/tool_list_sections.py](file:///d:/Maxma/MaxmaHere/tools/todo/tool_list_sections.py) | TodoListSectionsTool |
| [tools/map/tool_nearby.py](file:///d:/Maxma/MaxmaHere/tools/map/tool_nearby.py) | NearbySearchTool |
| [tools/map/tool_geocode.py](file:///d:/Maxma/MaxmaHere/tools/map/tool_geocode.py) | GeocodeAddressTool |
| [tools/map/tool_transit.py](file:///d:/Maxma/MaxmaHere/tools/map/tool_transit.py) | GetTransitRouteTool |
| [tools/map/tool_cycling.py](file:///d:/Maxma/MaxmaHere/tools/map/tool_cycling.py) | GetCyclingRouteTool |
| [tools/map/tool_fuzzy_addr.py](file:///d:/Maxma/MaxmaHere/tools/map/tool_fuzzy_addr.py) | FuzzyAddressSearchTool |
| [tools/network/tool_weather.py](file:///d:/Maxma/MaxmaHere/tools/network/tool_weather.py) | GetCurrentWeatherTool |
| [tools/network/tool_holiday.py](file:///d:/Maxma/MaxmaHere/tools/network/tool_holiday.py) | HolidayCalendarTool |
| [tools/network/tool_image_understand.py](file:///d:/Maxma/MaxmaHere/tools/network/tool_image_understand.py) | AnalyzeImageTool |
| [tools/network/tavily/tool_search.py](file:///d:/Maxma/MaxmaHere/tools/network/tavily/tool_search.py) | TavilySearchTool |
| [tools/network/tavily/tool_extract.py](file:///d:/Maxma/MaxmaHere/tools/network/tavily/tool_extract.py) | TavilyExtractTool |
| [tools/network/playwright_tools/tool_browse.py](file:///d:/Maxma/MaxmaHere/tools/network/playwright_tools/tool_browse.py) | BrowserBrowseTool |
| [tools/network/playwright_tools/tool_screenshot.py](file:///d:/Maxma/MaxmaHere/tools/network/playwright_tools/tool_screenshot.py) | BrowserScreenshotTool |
| [tools/network/playwright_tools/tool_extract.py](file:///d:/Maxma/MaxmaHere/tools/network/playwright_tools/tool_extract.py) | BrowserExtractTool |
| [tools/interaction/tool_ask_qa.py](file:///d:/Maxma/MaxmaHere/tools/interaction/tool_ask_qa.py) | AskUserQaTool |
| [tools/interaction/tool_ask_user.py](file:///d:/Maxma/MaxmaHere/tools/interaction/tool_ask_user.py) | AskUserForInfoTool |
| [tools/interaction/tool_single_choice.py](file:///d:/Maxma/MaxmaHere/tools/interaction/tool_single_choice.py) | AskUserSingleChoiceTool |
| [tools/interaction/tool_multi_choice.py](file:///d:/Maxma/MaxmaHere/tools/interaction/tool_multi_choice.py) | AskUserMultiChoiceTool |
| [tools/interaction/tool_ask_confirm.py](file:///d:/Maxma/MaxmaHere/tools/interaction/tool_ask_confirm.py) | AskUserConfirmTool |
| [tools/sub_agent/tool_call_sub_agent.py](file:///d:/Maxma/MaxmaHere/tools/sub_agent/tool_call_sub_agent.py) | CallSubAgentTool |
| [tools/sub_agent/tool_parallel.py](file:///d:/Maxma/MaxmaHere/tools/sub_agent/tool_parallel.py) | ParallelExecuteTool |
| [tools/task/tool_tracker.py](file:///d:/Maxma/MaxmaHere/tools/task/tool_tracker.py) | TaskTrackerTool |
| [tools/entertainment/tool_tarot.py](file:///d:/Maxma/MaxmaHere/tools/entertainment/tool_tarot.py) | TarotTool |
| [tools/quick_task/tool_quick_task.py](file:///d:/Maxma/MaxmaHere/tools/quick_task/tool_quick_task.py) | QuickTaskTool |

### 1.7.3 测试修改

| 文件路径 | 当前职责 | 改动点 |
|---|---|---|
| [tests/test_tools/test_tool_registry.py](file:///d:/Maxma/MaxmaHere/tests/test_tools/test_tool_registry.py) | 校验 validate_tool_registry | 新增测试：1) 目录扫描能发现所有带 @register_tool 的类；2) get_all_tools() 返回数 = 装饰器注册数；3) 装饰器重复注册同名工具抛错；4) 装饰器与 TOOL_CATEGORIES 声明一致 |

### 1.7.4 调用方（不动，仅回归验证）

| 文件路径 | 调用内容 |
|---|---|
| [api/dependencies.py](file:///d:/Maxma/MaxmaHere/api/dependencies.py) | get_tools() 调用 get_all_tools() 惰性单例 |
| [api/server.py](file:///d:/Maxma/MaxmaHere/api/server.py) | 导入 merge_tool_lists、select_tools_for_query；lifespan 中 app.state.native_tools = get_tools() |
| [api/routes/tool_stats.py](file:///d:/Maxma/MaxmaHere/api/routes/tool_stats.py) | 使用 get_tool_stats/get_all_tools/TOOL_CATEGORIES/CORE_TOOLS |

### 1.7.5 新建文件

| 文件路径 | 职责 |
|---|---|
| `tools/registry.py` | @register_tool 装饰器 + _REGISTRY 全局表 + discover_tools() 目录扫描函数 |
| `tests/test_tools/test_tool_discovery.py` | 目录扫描 + 装饰器注册的独立测试（也可合并进既有 test_tool_registry.py） |

### 1.7.6 关键设计点

- **公开符号保持不变**：`tools.base` 和 `tools.__init__` 的公开符号（ToolBase、format_success、format_error、check_path_access、get_all_tools、TOOL_CATEGORIES、CORE_TOOLS、KEYWORD_TO_CATEGORIES、select_tools_for_query、merge_tool_lists、validate_tool_registry）保持不变，则全代码库 99 个调用方文件均无需改动
- **备选方案**：把 @register_tool 直接定义在 tools/tool_base.py 内（利用 ToolBase.__init_subclass__ 自动注册），则无需新建 tools/registry.py。但独立文件更清晰、更易测试
- **目录扫描规则**：遍历 `tools/*/tool_*.py`，导入模块让装饰器执行；tools/__init__.py、tools/base.py、tools/tool_base.py、tools/registry.py 等基础设施文件不扫描

### 1.7.7 状态

- [ ] 待启动

---

## 实施顺序建议

```
1.7 工具注册去中心化（独立，无依赖，先做降低后续改动冲突）
    ↓
1.1 RAG 子系统新建（1.2/1.3/1.4 都依赖它）
    ↓
1.3 TTL 遗忘机制（基于 1.1 的 vector_store）
    ↓
1.2 4 层记忆架构（依赖 1.1 + 1.3）
    ↓
1.4 通用知识库 v1（依赖 1.1，可与 1.2 并行）
    ↓
1.6 metrics SQLite 持久化（独立）
    ↓
1.5 MetricsView + AuditLogView 前端面板（依赖 1.6 的 history API）
```

**并行机会**：
- 1.4 与 1.2 可并行（都依赖 1.1，但彼此独立）
- 1.6 与 1.1-1.4 完全独立，可全程并行
- 1.5 必须等 1.6 完成后再做 history 端点

---

## 验收标准

| 子任务 | 验收点 |
|---|---|
| 1.1 | find_similar 改为向量检索，召回率测试通过；chromadb 持久化到 DATA_DIR/vector_db；首次启动自动下载 ONNX embedding 模型；不依赖 torch（体积优化 ~750MB） |
| 1.2 | 4 层记忆各自独立存储，coordinator.retrieve() 能聚合多层结果；agent/prompts.py 注入 4 层内容；新增情景/语义层 CRUD 工具可调用 |
| 1.3 | MemoryItem 带 ttl/expires_at；purge_expired() 正确删除过期项；后台任务每 5 分钟执行；"瞬间"分区默认带 TTL |
| 1.4 | 上传 PDF/MD/TXT 文档自动切块入向量库；POST /kb/search 返回 top_k chunks；KbView 可视化管理；Agent 可调用 kb_search 工具 |
| 1.5 | /metrics 和 /audit-log 路由可访问；MetricsView 展示 4 维度指标；AuditLogView 支持过滤/清空/加密 |
| 1.6 | metrics 数据落 SQLite，重启后 /metrics/history 可查历史；SCHEMA_VERSION=2 迁移成功；后台 flush 任务启停正常 |
| 1.7 | get_all_tools() 返回工具数 = 装饰器注册数；新增工具只需放文件 + 加装饰器；validate_tool_registry 通过 |

---

## 风险与缓解

| 风险 | 缓解措施 |
|---|---|
| chromadb + PyInstaller 打包兼容性 | 在 desktop/src-tauri spec 文件配置 hidden imports；打包前手动验证 |
| ONNX 模型首次下载体积大 | 支持 embedding_model_local_path 预置；提供离线包下载说明 |
| torch 体积过大（~468MB） | 改用 ONNX Runtime 直推方案，spec excludes 明确排除 torch/sentence_transformers/scipy/sklearn；site-packages 从 ~925MB 降至 ~178MB |
| 4 层记忆架构改动面大 | 1.2 之前先做 1.1（RAG 基础）+ 1.3（TTL，改动小）；1.2 分阶段：先情景层，后语义层 |
| 工具注册改动影响 99 个调用方 | 保持 tools.base 和 tools.__init__ 公开符号不变；改动后跑全量测试 |
| metrics SQLite 迁移破坏现有数据 | SCHEMA_VERSION bump + 迁移脚本；提供回滚 SQL |
