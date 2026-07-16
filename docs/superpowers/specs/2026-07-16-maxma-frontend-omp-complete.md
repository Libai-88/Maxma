# Phase 4: 前端 OMP 功能全覆盖

> **目标：** 一次性补齐剩余 4 个 OMP 原生功能模块的前端支持。

---

## 一、范围

| 模块 | 当前状态 | 目标 | 优先级 |
|------|---------|------|--------|
| **工具面板** | 不存在 | 展示 OMP 全部可用工具（32 内置 + 自定义），支持查看详情、按分类浏览 | P0 |
| **MCP 自动发现** | McpView.vue (1017行) 手动管理 | 添加 OMP 自动发现的 MCP 服务器展示，区分手动/自动来源 | P0 |
| **记忆浏览器** | MemoryView.vue (17行) 空壳 | 对接 OMP recall/reflect/retain，浏览 AI 记忆、查看/编辑事实 | P1 |
| **Skills/宏 UI** | SkillsView.vue (680行) 基本完整 | 对接 TypeScript AgentTool，添加启用/禁用、创建/编辑操作 | P1 |

---

## 二、模块设计

### 2.1 工具面板

**位置：** 侧边栏或专门的工具视图，可通过设置进入

**功能：**
- 分页/分类展示 OMP 所有可用工具
- 每个工具显示：名称、描述、参数 schema
- 按类型分组：文件操作、代码执行、网络搜索、记忆、MCP 等
- 搜索/过滤

**数据来源：** 新增 REST API `GET /api/tools`，Python 薄层从 OMP 获取工具注册表信息。

**UI 示意：**
```
工具面板 ─────────────────
🔍 [搜索工具...]

📁 文件操作 (5)
  read       读取文件内容
  write      写入文件
  edit       编辑文件
  glob       文件搜索
  grep       文本搜索

💻 代码执行 (3)
  bash       执行命令
  eval       执行代码
  …

🌐 网络 (3)
  web_search 搜索网页
  fetch      获取 URL
  browser    浏览器自动化
```

**API 响应格式：**
```json
[
  {
    "name": "read",
    "label": "Read",
    "description": "读取文件内容",
    "category": "file",
    "builtin": true
  },
  {
    "name": "manage_skills",
    "label": "Manage Skills",
    "description": "管理 anthropic_skills/ 技能包",
    "category": "config",
    "builtin": false
  }
]
```

### 2.2 MCP 自动发现

**位置：** 现有 McpView.vue 添加一个分区

**新增功能：**
- "OMP 自动发现" 分区，展示由 OMP 原生 MCP 子系统自动发现的 MCP 服务器
- 每个服务器显示：名称、状态（在线/离线）、工具列表
- 区分手动配置 vs 自动发现

**数据来源：** `GET /api/mcp/discovered` — Python 薄层向 OMP 查询当前 MCP 连接状态。

### 2.3 记忆浏览器

**位置：** 现有 MemoryView.vue（目前只有 MemoryPanel 占位）

**功能：**
- 展示 OMP 记忆系统中的事实列表
- 按时间排序，支持搜索
- 每个事实显示：内容、置信度、更新时间
- 支持手动删除事实
- 展示 recall 检索结果（最近对话中的记忆引用）

**数据来源：** OMP 的 `memory_edit` 工具和 `recall` 事件。通过 WS 事件获取记忆更新，通过 REST API 查询记忆存储。

**暂不实现（复杂度太高）：**
- 记忆编辑（修改已有事实）
- 语义记忆图可视化

### 2.4 Skills/宏管理 UI

**位置：** 现有 SkillsView.vue，增强现有功能

**增强功能：**
- Skills 列表对接 TypeScript `manage_skills` AgentTool
- 添加"查看内容"弹窗（读取 SKILL.md 全文）
- 添加"启用/禁用"切换（rename SKILL.md ↔ SKILL.md.disabled）
- 宏添加"编辑"和"删除"操作，以及"新建"表单
- 所有操作调用 TypeScript AgentTool 而非旧 Python API

---

## 三、设计原则

1. **品牌一致** — 所有新 UI 遵循 DESIGN.md：黑白基底、纯黑 accent、6px 圆角
2. **复用现有组件** — 使用已有的 DsCard/DsButton/DsModal/DsBadge，不重复造轮子
3. **渐进式加载** — 大数据量列表支持分页/延迟加载
4. **实时反映 OMP 状态** — 数据直接从 OMP 获取，Python 只透传

---

## 四、实施步骤

### Task 1: 工具面板
- 创建 `web/src/components/ToolPanel.vue`
- 创建 `web/src/stores/tools.ts`
- 添加 `GET /api/tools` Python 端点
- 集成到侧边栏

### Task 2: MCP 自动发现
- 修改 `web/src/views/McpView.vue` 添加自动发现分区
- 添加 `GET /api/mcp/discovered` Python 端点

### Task 3: 记忆浏览器
- 重写 `web/src/views/MemoryView.vue`
- 添加 `GET /api/memory` Python 端点（从 OMP 获取）

### Task 4: Skills/宏增强
- 修改 `web/src/views/SkillsView.vue` 对接 TS AgentTool
- 添加查看/启用/禁用操作
- 添加宏的编辑/删除操作
