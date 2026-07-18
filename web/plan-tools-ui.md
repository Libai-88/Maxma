# Plan: Enhance Tool Management UI

## Current State Analysis

### Management UI (`McpView.vue`)
- Server card shows: server_id, transport badge, toggle, description, command/URL, `tool_count`
- `tool_count` is just a number — no actual tool names visible on cards
- OMP auto-discovered section renders tool names as plain `<span class="tool-tag">` tags
- allowlist/blocklist editor shows tool names as chips, but without descriptions or parameter info
- `availableTools` comes from `listMcpServerTools` API which returns `string[]` only (no descriptions/schemas)

### Types (`mcp.ts`)
- `MCPServerInfo` has `tool_count: number` but no tool definitions
- `MCPServerToolsResponse` returns `tools: string[]` (names only)
- No type for tool definitions (name + description + parameters)

### Execution Rendering (`ToolBubbleRouter.vue` → `registry.ts`)
- 18 specialized bubbles registered for ~40 tool names
- OMP built-in tools (bash, read, write, edit, search, grep, glob, lsp, debug, browser, eval, task, todo, etc.) are **NOT** registered
- They fall back to `ToolCallCard` — functional but missing:
  - Chinese display names
  - Specialized rendering for code output, terminal output, search results

### displayNames.ts
- Has ~70 display name entries
- Missing entries for OMP built-in tools (bash, read, write, edit, search, grep, glob, lsp, debug, browser, eval, task, todo, etc.)

---

## Proposed Enhancements

### 1. Management UI — Server Card Tool Names
**File:** `McpView.vue`

In the server card, after the `card-tools` line showing `tool_count`, add a collapsible tool name list so users can see what tools a server provides. Use `toolDisplayName()` for friendly names.

- Add a `v-if="s.tool_count > 0` expandable section showing tool names (from `availableTools` loaded on card click, or from a new lightweight endpoint)
- Since `availableTools` is currently only loaded when editing, we should load tool names on card mount or on hover

**Simpler approach:** Add a "+N tools" expand link in the card-tools area that loads and displays the tool names inline (lazy load).

### 2. Management UI — OMP Auto-Discover Enhancement
**File:** `McpView.vue`

- Group discovered tools by category (code tools, file tools, search tools, etc.) using a local mapping
- Show tool descriptions via `toolDisplayName()` with a small description hint
- Add a "load all tool details" toggle

### 3. Execution Rendering — Add Display Names for OMP Built-in Tools
**File:** `displayNames.ts`

Add Chinese display names for:
- `bash` → 终端执行
- `read` → 读取文件
- `write` → 写入文件
- `edit` → 编辑文件
- `search` → 搜索文件
- `grep` → 文本搜索
- `glob` → 文件查找
- `lsp` → 语言服务
- `debug` → 调试工具
- `browser` → 浏览器工具
- `eval` → 代码评估
- `task` → 任务管理
- `todo` → 待办管理

### 4. Execution Rendering — Generic Terminal/Code Output Bubble
**File:** `CodeToolBubble.vue` (new)

Create a bubble component for OMP code tools that lack specialized bubbles:
- `bash`: terminal-style output with green-on-black look
- `search`/`grep`/`glob`: search results with file path + line number display
- `lsp`/`debug`: structured diagnostic output

This bubble should:
- Show input (the command/code) in a code block
- Show output in appropriate format (terminal for bash, results list for search)
- Support copying output

### 5. Execution Rendering — Register OMP Tools
**File:** `registry.ts`

Register OMP built-in tools:
- `bash` → CodeToolBubble
- `read` → FilesBubble (reuse existing)
- `write` → FilesBubble (reuse existing)
- `edit` → FileEditBubble (reuse existing)
- `search` → CodeToolBubble
- `grep` → CodeToolBubble
- `glob` → CodeToolBubble
- `lsp` → CodeToolBubble
- `debug` → CodeToolBubble
- `browser` → CodeToolBubble (or create a dedicated one)
- `eval` → CodeToolBubble
- `task` → TaskTrackerBubble (reuse existing)
- `todo` → TodoBubble (reuse existing)
- `plan` → CodeToolBubble
- `ask` → AskUserBubble (reuse existing)
- `memory` → MemoryBubble (reuse existing)

---

## Implementation Order

1. Add OMP tool display names to `displayNames.ts`
2. Create `CodeToolBubble.vue` for generic code/terminal/search tool output
3. Register OMP tools in `registry.ts`
4. Enhance `McpView.vue` card to show expandable tool names
5. Enhance `McpView.vue` OMP section with categorized tool display

---

## Verification

Run `npx vue-tsc --noEmit` to verify TypeScript correctness after all changes.
