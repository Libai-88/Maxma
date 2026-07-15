# 工具重写计划 — 原生 oh-my-pi AgentTool

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除所有旧 Python BaseTool 和桥接层，将 Maxma 独有的工具重写为原生 oh-my-pi TypeScript AgentTool，直接在 sidecar 中注册。

**Architecture:** 每个工具是一个单独的 TypeScript 文件，导出一个 `AgentTool` 对象或数组。`bun-sidecar/src/tools/index.ts` 聚合所有工具。`session-bridge.ts` 的 `create_session` 调用 `registerCustomTools()` 获取工具列表并注册到 `createAgentSession`。

**Tech Stack:** oh-my-pi AgentTool 类型 (TypeScript), Bun 运行时

**参考:** https://github.com/earendil-works/pi — 官方 Pi AgentTool 类型定义

---

## 工具筛选

经对比，oh-my-pi 自带的 32 个内置工具已覆盖以下 Maxma 工具，**这些直接删除 Python 版**：

| Maxma 工具 | oh-my-pi 替代 |
|---|---|
| file_read, file_write, file_manage, file_search, file_edit | read, write, edit, glob, grep |
| run_python | bash, eval |
| git_* (7个) | gh |
| tavily_search, tavily_extract | web_search |
| browser_* | browser |
| call_sub_agent, parallel_execute, quick_task | task |
| ask_user_qa, ask_user_confirm, etc. | ask |
| memory_*, list_memories, search_episodic, etc. | recall, reflect, retain, memory_edit |
| kb_search, kb_add_document | (由文件工具覆盖) |
| manage_mcp, manage_skills, manage_macros, etc. | manage_skill, MCP 自动发现 |
| context_strategy, forget, create_persona, etc. | oh-my-pi 原生机制 |

**需要重写为 AgentTool（oh-my-pi 没有等价物）：**

| 工具 | API 依赖 | 重写难度 |
|---|---|---|
| get_current_weather | uapis API (免费) | 低 (~30 行) |
| holiday_calendar | uapis API | 低 (~20 行) |
| nearby_search, geocode_address, get_transit_route, get_cycling_route, fuzzy_address_search | 高德地图 API `AMAP_API_KEY` | 中 (~50 行/工具) |
| todo_add, todo_list, todo_complete, todo_delete, todo_update, todo_query, todo_list_projects, todo_list_sections, todo_list_labels, todo_uncomplete | Todoist API `TODOIST_API_TOKEN` | 中 (~30 行/工具) |
| tarot | 无（纯随机） | 低 (~20 行) |

---

## 文件结构

```
bun-sidecar/src/
  tools/
    index.ts              ← 注册所有自定义工具
    weather.ts            ← get_current_weather
    holiday.ts            ← holiday_calendar
    amap.ts               ← 高德地图 5 个工具
    todoist.ts            ← Todoist 10 个工具
    tarot.ts              ← tarot
  session-bridge.ts       ← 修改：注册自定义工具
  rpc-types.ts            ← 可能更新类型

# 删除：
tools/                    ← 整个旧 Python 工具目录
api/pi_bridge/tool_mcp_server.py
bun-sidecar/.mcp.json
tools/pi_adapter.py
scripts/migrate_providers.py
config/providers.yaml (if exists)
```

---

## Phase 1: 理解 AgentTool 接口 + 搭建工具框架

### Task 1.1: 确认 AgentTool 类型定义

从 Pi 官方仓库确认 `AgentTool` 接口：

```typescript
// Pi 官方 AgentTool 类型 (agent_core/types.py 的 TS 等价)
// 参考: https://github.com/earendil-works/pi/blob/main/packages/agent/src/types.ts

export interface AgentTool<TResult = any> {
  name: string;
  label?: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text" | "image"; text?: string; data?: string; mime_type?: string }>;
    details?: TResult;
  }>;
}
```

- [ ] **Step 1: 查看 oh-my-pi 的 AgentTool 类型**

```bash
cat "D:/Maxma/oh-my-pi-16.5.2/packages/agent/src/types.ts" | head -100
```

- [ ] **Step 2: 创建 `bun-sidecar/src/tools/index.ts`**

```typescript
// bun-sidecar/src/tools/index.ts
// 注册所有 Maxma 自定义工具到 oh-my-pi agent

import type { AgentTool } from "../session-bridge";

export function registerCustomTools(): AgentTool[] {
  const tools: AgentTool[] = [];
  
  // 各工具模块向 tools 数组添加
  // import { getCurrentWeatherTool } from "./weather";
  // tools.push(getCurrentWeatherTool);
  
  return tools;
}
```

- [ ] **Step 3: 在 `session-bridge.ts` 中集成自定义工具**

在 `create_session` handler 中，注册自定义工具：

```typescript
// 在 create_session handler 中，传给 createAgentSession 之前
const createOptions: Record<string, unknown> = {
  model,
  cwd,
};
if (systemPrompt !== undefined) {
  createOptions.systemPrompt = systemPrompt;
}
if (tools !== undefined && Array.isArray(tools) && tools.length > 0) {
  createOptions.toolNames = tools;
}
// 注册自定义工具
const { registerCustomTools } = await import("./tools/index");
const customTools = registerCustomTools();
if (customTools.length > 0) {
  createOptions.customTools = customTools;
}
```

---

## Phase 2: 逐个工具重写

### Task 2.1: get_current_weather

**Files:**
- Create: `bun-sidecar/src/tools/weather.ts`

```typescript
// bun-sidecar/src/tools/weather.ts
// 获取指定城市的当前天气

import type { AgentTool } from "../session-bridge";

interface WeatherParams {
  city: string;
}

export const getCurrentWeatherTool: AgentTool = {
  name: "get_current_weather",
  label: "Get Current Weather",
  description: "获取指定城市的实时天气信息，包括温度、湿度、风力、天气状况等",
  parameters: {
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "城市名称，如 '北京'、'上海'、'Tokyo'、'London'",
      },
    },
    required: ["city"],
  },
  execute: async (params: Record<string, unknown>) => {
    const { city } = params as unknown as WeatherParams;
    if (!city) {
      return {
        content: [{ type: "text" as const, text: "请提供城市名称" }],
        details: { isError: true },
      };
    }
    
    // 通过 uapis API 获取天气
    // API 文档: https://api.help.bj.cn/weather/
    const apiKey = process.env.UAPIS_API_KEY;
    if (!apiKey) {
      // 降级：使用公开 API
      try {
        const res = await fetch(
          `https://wttr.in/${encodeURIComponent(city)}?format=%C+%t+%h+%w`
        );
        const text = await res.text();
        return {
          content: [{ type: "text" as const, text: `${city} 天气: ${text}` }],
        };
      } catch {
        return {
          content: [{ type: "text" as const, text: `${city} 的天气信息暂时无法获取` }],
          details: { isError: true },
        };
      }
    }
    
    try {
      const res = await fetch(
        `https://api.help.bj.cn/weather/?id=${encodeURIComponent(city)}&key=${apiKey}`
      );
      const data = await res.json();
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    } catch (e) {
      return {
        content: [{ type: "text" as const, text: `获取天气失败: ${e}` }],
        details: { isError: true },
      };
    }
  },
};
```

- [ ] **Step 1: 理解 `get_current_weather` 的 Python 实现**

```bash
head -50 "D:/Maxma/MaxmaHere/tools/network/tool_get_current_weather.py"
```

- [ ] **Step 2: 创建 `bun-sidecar/src/tools/weather.ts`**

- [ ] **Step 3: 在 `bun-sidecar/src/tools/index.ts` 中注册**

```typescript
import { getCurrentWeatherTool } from "./weather";

export function registerCustomTools(): AgentTool[] {
  return [
    getCurrentWeatherTool,
  ];
}
```

- [ ] **Step 4: 验证工具在 sidecar 中可用**

```bash
cd "D:/Maxma/MaxmaHere/bun-sidecar" && bun build src/tools/weather.ts --no-bundle 2>&1 | head -5
```

---

### Task 2.2: holiday_calendar

**Files:**
- Create: `bun-sidecar/src/tools/holiday.ts`

类似 weather 工具，通过 uapis API 获取节假日信息。

```typescript
export const holidayCalendarTool: AgentTool = {
  name: "holiday_calendar",
  // ...
};
```

---

### Task 2.3: 高德地图工具 (5 个)

**Files:**
- Create: `bun-sidecar/src/tools/amap.ts`

高德地图工具是一组 5 个相关工具，放在一个文件中：

```typescript
// bun-sidecar/src/tools/amap.ts
// 高德地图 API 工具 — 周边搜索、地址编码、路线规划

import type { AgentTool } from "../session-bridge";

const AMAP_KEY = () => process.env.AMAP_API_KEY || "";
const AMAP_BASE = "https://restapi.amap.com/v3";

// 1. 周边搜索
export const nearbySearchTool: AgentTool = { /* ... */ };

// 2. 地址编码
export const geocodeAddressTool: AgentTool = { /* ... */ };

// 3. 公交路线
export const getTransitRouteTool: AgentTool = { /* ... */ };

// 4. 骑行路线
export const getCyclingRouteTool: AgentTool = { /* ... */ };

// 5. 模糊地址搜索
export const fuzzyAddressSearchTool: AgentTool = { /* ... */ };
```

每个工具都调用高德地图 API，传入 `AMAP_API_KEY` 环境变量。

---

### Task 2.4: Todoist 工具 (10 个)

**Files:**
- Create: `bun-sidecar/src/tools/todoist.ts`

Todoist REST API: https://developer.todoist.com/rest/v2/

```typescript
const TODOIST_TOKEN = () => process.env.TODOIST_API_TOKEN || "";
const TODOIST_BASE = "https://api.todoist.com/rest/v2";

async function todoistFetch(path: string, options?: RequestInit) {
  const token = TODOIST_TOKEN();
  if (!token) throw new Error("TODOIST_API_TOKEN 未配置");
  const res = await fetch(`${TODOIST_BASE}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  return res.json();
}
```

注册全部 10 个工具到 `index.ts`。

---

### Task 2.5: tarot

**Files:**
- Create: `bun-sidecar/src/tools/tarot.ts`

纯随机逻辑，无需 API：

```typescript
export const tarotTool: AgentTool = {
  name: "tarot",
  label: "Tarot",
  description: "抽取塔罗牌进行占卜",
  execute: async () => {
    const cards = [
      { name: "愚者", meaning: "新的开始、冒险" },
      { name: "魔术师", meaning: "创造力、自信" },
      // ... 21 张大牌
    ];
    const picked = cards[Math.floor(Math.random() * cards.length)];
    return {
      content: [{ type: "text" as const, text: `你抽到了「${picked.name}」— ${picked.meaning}` }],
    };
  },
};
```

---

## Phase 3: 清除旧代码

### Task 3.1: 删除旧 Python 工具目录

```bash
cd "D:/Maxma/MaxmaHere"
rm -rf tools/                         # 整个旧工具目录
rm -f api/pi_bridge/tool_mcp_server.py  # MCP 桥接
rm -f bun-sidecar/.mcp.json             # MCP 配置
rm -f tools/pi_adapter.py               # 适配器
rm -f scripts/migrate_providers.py      # 迁移脚本
```

### Task 3.2: 更新 pyproject.toml — 移除旧工具依赖

```bash
cd "D:/Maxma/MaxmaHere"
# 移除不再需要的依赖
pip uninstall todoist-api-python uapi-sdk-python amap-sdk-python -y
```

在 `pyproject.toml` 中删除：
- `todoist-api-python`
- `uapi-sdk-python`
- 任何高德地图 SDK

保留：
- `langchain-core` (仍被 `chat.py` 的 `AIMessage`、`ToolMessage` 使用)
- `langchain-openai` (可能仍被 provider 系统使用)
- `langchain-mcp-adapters` (可能仍被其他用到)

### Task 3.3: 更新 `session-bridge.ts` — 默认加载自定义工具

```typescript
// 在 create_session handler 中，始终加载自定义工具
const customTools = registerCustomTools();
if (customTools.length > 0) {
  // 混入自定义工具到 toolNames 或直接注入
  createOptions.customTools = customTools;
}
```

---

## 验收标准

- [ ] `tools/` 旧 Python 目录已删除
- [ ] `api/pi_bridge/tool_mcp_server.py` 已删除
- [ ] `bun-sidecar/.mcp.json` 已删除
- [ ] `tools/pi_adapter.py` 已删除
- [ ] `scripts/migrate_providers.py` 已删除
- [ ] `bun-sidecar/src/tools/weather.ts` 存在且编译通过
- [ ] `bun-sidecar/src/tools/amap.ts` 存在且编译通过
- [ ] `bun-sidecar/src/tools/todoist.ts` 存在且编译通过
- [ ] `bun-sidecar/src/tools/tarot.ts` 存在且编译通过
- [ ] `bun-sidecar/src/tools/index.ts` 注册了所有工具
- [ ] `session-bridge.ts` 的 `create_session` 中调用了 `registerCustomTools()`
- [ ] 集成测试通过：对话 + 工具调用正常工作

---

## 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 高德地图 API 在 TS 端的行为与 Python 不同 | 低 | 阅读原 Python 工具的 API 调用逻辑，逐字段对应 |
| Todoist API 的认证方式在 Bun/fetch 中需要适配 | 低 | Todoist 使用 Bearer token，Bun 的 fetch 原生支持 |
| 环境变量传递：API keys 需要从 Python 后端传到 sidecar | 低 | 进程环境变量自动继承，或在 `create_session` RPC 中传递 |
