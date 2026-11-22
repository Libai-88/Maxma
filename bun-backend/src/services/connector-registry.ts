/**
 * connector-registry.ts — M3-D 连接器框架（只读状态注册表）。
 *
 * v1 不做原生 OAuth：本地文件夹、项目资产、Web、MCP 四个来源只汇报真实配置状态。
 * “已连接”必须有真实配置依据；没有配置就是未连接，不拿占位卡片冒充能力。
 */

import { loadRaw } from "../routes/mcp";
import { getMcpConfigPath } from "../app-paths";
import type { CoworkStore } from "./cowork-store";
import { listWorkspaceRoots } from "./workspace-store";

export interface ConnectorView {
  id: string;
  label: string;
  kind: "local" | "project" | "web" | "mcp";
  configured: boolean;
  status: "connected" | "unconfigured" | "error";
  read: boolean;
  /** 写入能力：false=不支持；"approval"=必须逐次审批。 */
  write: false | "approval";
  detail: string;
  tools: string[];
  recipe?: string;
}

export interface ConnectorRecipe {
  id: string;
  title: string;
  providers: string[];
  mode: "read-only";
  doc: string;
}

function countProjectAssets(store: CoworkStore): number {
  let total = 0;
  for (const project of store.listProjects()) {
    total += store.listProjectAssets(project.id).length;
  }
  return total;
}

export class ConnectorRegistry {
  constructor(private readonly deps: { store: () => CoworkStore }) {}

  list(): { connectors: ConnectorView[]; recipes: ConnectorRecipe[] } {
    const store = this.deps.store();
    const roots = listWorkspaceRoots();
    const projectCount = store.listProjects().length;
    const assetCount = countProjectAssets(store);
    let mcpCount = 0;
    let mcpError = "";
    try {
      mcpCount = loadRaw().filter((server) => server.enabled !== false).length;
    } catch (err) {
      mcpError = err instanceof Error ? err.message : String(err);
    }

    const connectors: ConnectorView[] = [
      {
        id: "local-folder",
        label: "本地文件夹",
        kind: "local",
        configured: roots.length > 0,
        status: roots.length > 0 ? "connected" : "unconfigured",
        read: true,
        write: false,
        detail: roots.length > 0
          ? `${roots.length} 个工作区根；Agent 读取仍受 PathPolicy 约束`
          : "尚未添加工作区根",
        tools: ["read_office_file", "doc_search", "doc_read", "code_search", "grep"],
      },
      {
        id: "project-assets",
        label: "项目资产",
        kind: "project",
        configured: projectCount > 0,
        status: projectCount > 0 ? "connected" : "unconfigured",
        read: true,
        write: false,
        detail: projectCount > 0
          ? `${projectCount} 个项目、${assetCount} 个资产引用`
          : "尚未创建 Cowork 项目",
        tools: ["doc_search", "doc_read"],
      },
      {
        id: "web",
        label: "Web 研究",
        kind: "web",
        configured: true,
        status: "connected",
        read: true,
        write: false,
        detail: "联网搜索与网页抓取；受网络 allowlist 与会话策略约束",
        tools: ["web_search", "web_fetch"],
      },
      {
        id: "mcp",
        label: "MCP 服务器",
        kind: "mcp",
        configured: mcpCount > 0,
        status: mcpError ? "error" : mcpCount > 0 ? "connected" : "unconfigured",
        read: true,
        write: "approval",
        detail: mcpError
          ? `MCP 配置无法读取：${mcpError}`
          : mcpCount > 0
            ? `${mcpCount} 个已启用服务器；写入工具仍需审批`
            : `尚未配置 MCP；配置文件 ${getMcpConfigPath()}`,
        tools: [],
        recipe: "docs/connectors/mcp-recipes/feishu.md",
      },
    ];

    return {
      connectors,
      recipes: [
        {
          id: "feishu-readonly",
          title: "飞书文档 / 消息（只读）",
          providers: ["Feishu", "Lark"],
          mode: "read-only",
          doc: "docs/connectors/mcp-recipes/feishu.md",
        },
        {
          id: "mail-readonly",
          title: "Gmail / Outlook 邮件（只读）",
          providers: ["Gmail", "Outlook"],
          mode: "read-only",
          doc: "docs/connectors/mcp-recipes/mail.md",
        },
        {
          id: "calendar-readonly",
          title: "Google / Outlook 日历（只读）",
          providers: ["Google Calendar", "Outlook Calendar"],
          mode: "read-only",
          doc: "docs/connectors/mcp-recipes/calendar.md",
        },
      ],
    };
  }
}
