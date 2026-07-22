/**
 * tools/todoist.ts — Todoist REST API v2 集成工具（10个工具）
 *
 * 使用环境变量 TODOIST_API_TOKEN 进行 Bearer Token 认证。
 * API 文档：https://developer.todoist.com/rest/v2/
 */

import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod/v4";

// ── 共享 fetch 封装 ──────────────────────────────────────────

const FETCH_TIMEOUT = 10_000;

const todoistFetch = async (path: string, options?: RequestInit) => {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) throw new Error("TODOIST_API_TOKEN 未配置");

  const res = await fetch(`https://api.todoist.com/rest/v2${path}`, {
    ...options,
    signal: options?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Todoist API error: ${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`,
    );
  }

  // 204 No Content 表示成功但无响应体（如 DELETE / close / reopen）
  if (res.status === 204) return null;

  return res.json();
};

// ── 1. todo_add ──────────────────────────────────────────────

const addParams = z.object({
  content: z.string().describe("任务内容"),
  project_id: z.string().optional().describe("项目 ID"),
  due_string: z
    .string()
    .optional()
    .describe("截止日期描述，如 'today'、'tomorrow'、'next Monday'"),
  priority: z.number().optional().describe("优先级，1-4"),
});

const todoAddTool: ToolDefinition<typeof addParams> = {
  name: "todo_add",
  label: "Add Todoist Task",
  description: "向 Todoist 添加新任务",
  parameters: addParams,
  execute: async (_toolCallId, params) => {
    try {
      const body: Record<string, unknown> = { content: params.content };
      if (params.project_id) body.project_id = params.project_id;
      if (params.due_string) body.due_string = params.due_string;
      if (params.priority !== undefined) body.priority = params.priority;

      const data = await todoistFetch("/tasks", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `添加任务失败: ${String(e)}` }] };
    }
  },
};

// ── 2. todo_list ─────────────────────────────────────────────

const listParams = z.object({
  project_id: z.string().optional().describe("项目 ID，仅列出该项目的任务"),
  filter: z
    .string()
    .optional()
    .describe("筛选条件，如 'today'、'p1'、'view all'"),
});

const todoListTool: ToolDefinition<typeof listParams> = {
  name: "todo_list",
  label: "List Todoist Tasks",
  description: "列出 Todoist 中的未完成任务，支持按项目和筛选条件过滤",
  parameters: listParams,
  execute: async (_toolCallId, params) => {
    try {
      const qs = new URLSearchParams();
      if (params.project_id) qs.set("project_id", params.project_id);
      if (params.filter) qs.set("filter", params.filter);

      const query = qs.toString();
      const data = await todoistFetch(`/tasks${query ? `?${query}` : ""}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `获取任务列表失败: ${String(e)}` }] };
    }
  },
};

// ── 3. todo_complete ─────────────────────────────────────────

const completeParams = z.object({
  id: z.string().describe("要完成的任务 ID"),
});

const todoCompleteTool: ToolDefinition<typeof completeParams> = {
  name: "todo_complete",
  label: "Complete Todoist Task",
  description: "将 Todoist 中指定任务标记为已完成",
  parameters: completeParams,
  execute: async (_toolCallId, params) => {
    try {
      await todoistFetch(`/tasks/${params.id}/close`, { method: "POST" });
      return { content: [{ type: "text", text: `任务 ${params.id} 已完成` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `完成任务失败: ${String(e)}` }] };
    }
  },
};

// ── 4. todo_uncomplete ───────────────────────────────────────

const uncompleteParams = z.object({
  id: z.string().describe("要重新打开的任务 ID"),
});

const todoUncompleteTool: ToolDefinition<typeof uncompleteParams> = {
  name: "todo_uncomplete",
  label: "Uncomplete Todoist Task",
  description: "将 Todoist 中已完成的任务重新打开",
  parameters: uncompleteParams,
  execute: async (_toolCallId, params) => {
    try {
      await todoistFetch(`/tasks/${params.id}/reopen`, { method: "POST" });
      return { content: [{ type: "text", text: `任务 ${params.id} 已重新打开` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `重新打开任务失败: ${String(e)}` }] };
    }
  },
};

// ── 5. todo_delete ───────────────────────────────────────────

const deleteParams = z.object({
  id: z.string().describe("要删除的任务 ID"),
});

const todoDeleteTool: ToolDefinition<typeof deleteParams> = {
  name: "todo_delete",
  label: "Delete Todoist Task",
  description: "从 Todoist 删除指定任务",
  parameters: deleteParams,
  execute: async (_toolCallId, params) => {
    try {
      await todoistFetch(`/tasks/${params.id}`, { method: "DELETE" });
      return { content: [{ type: "text", text: `任务 ${params.id} 已删除` }] };
    } catch (e) {
      return { content: [{ type: "text", text: `删除任务失败: ${String(e)}` }] };
    }
  },
};

// ── 6. todo_update ───────────────────────────────────────────

const updateParams = z.object({
  id: z.string().describe("要更新的事务 ID"),
  content: z.string().optional().describe("新的任务内容"),
  due_string: z
    .string()
    .optional()
    .describe("新的截止日期描述，如 'today'、'tomorrow'"),
  priority: z.number().optional().describe("新的优先级，1-4"),
});

const todoUpdateTool: ToolDefinition<typeof updateParams> = {
  name: "todo_update",
  label: "Update Todoist Task",
  description: "更新 Todoist 中现有任务的内容、截止日期或优先级",
  parameters: updateParams,
  execute: async (_toolCallId, params) => {
    try {
      const body: Record<string, unknown> = {};
      if (params.content !== undefined) body.content = params.content;
      if (params.due_string !== undefined) body.due_string = params.due_string;
      if (params.priority !== undefined) body.priority = params.priority;

      const data = await todoistFetch(`/tasks/${params.id}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `更新任务失败: ${String(e)}` }] };
    }
  },
};

// ── 7. todo_query ────────────────────────────────────────────

const queryParams = z.object({
  query: z.string().describe("搜索关键词，按任务内容查找"),
});

const todoQueryTool: ToolDefinition<typeof queryParams> = {
  name: "todo_query",
  label: "Query Todoist Tasks",
  description: "根据关键词搜索 Todoist 中的任务（使用 filter search: 语法）",
  parameters: queryParams,
  execute: async (_toolCallId, params) => {
    try {
      const data = await todoistFetch(
        `/tasks?filter=${encodeURIComponent(`search: ${params.query}`)}`,
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `搜索任务失败: ${String(e)}` }] };
    }
  },
};

// ── 8. todo_list_projects ────────────────────────────────────

const listProjectsParams = z.object({});

const todoListProjectsTool: ToolDefinition<typeof listProjectsParams> = {
  name: "todo_list_projects",
  label: "List Todoist Projects",
  description: "列出 Todoist 中所有项目",
  parameters: listProjectsParams,
  execute: async () => {
    try {
      const data = await todoistFetch("/projects");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `获取项目列表失败: ${String(e)}` }] };
    }
  },
};

// ── 9. todo_list_sections ────────────────────────────────────

const listSectionsParams = z.object({
  project_id: z.string().describe("项目 ID，列出该项目下的分区"),
});

const todoListSectionsTool: ToolDefinition<typeof listSectionsParams> = {
  name: "todo_list_sections",
  label: "List Todoist Sections",
  description: "列出指定项目中的分区（section）",
  parameters: listSectionsParams,
  execute: async (_toolCallId, params) => {
    try {
      const data = await todoistFetch(
        `/sections?project_id=${params.project_id}`,
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `获取分区列表失败: ${String(e)}` }] };
    }
  },
};

// ── 10. todo_list_labels ─────────────────────────────────────

const listLabelsParams = z.object({});

const todoListLabelsTool: ToolDefinition<typeof listLabelsParams> = {
  name: "todo_list_labels",
  label: "List Todoist Labels",
  description: "列出 Todoist 中所有标签",
  parameters: listLabelsParams,
  execute: async () => {
    try {
      const data = await todoistFetch("/labels");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `获取标签列表失败: ${String(e)}` }] };
    }
  },
};

// ── Export ────────────────────────────────────────────────────

export const todoistTools: ToolDefinition[] = [
  todoAddTool,
  todoListTool,
  todoCompleteTool,
  todoUncompleteTool,
  todoDeleteTool,
  todoUpdateTool,
  todoQueryTool,
  todoListProjectsTool,
  todoListSectionsTool,
  todoListLabelsTool,
];
