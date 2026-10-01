/**
 * routes/capabilities.ts — 能力全景聚合（api/routes/capabilities.py 的 Bun
 * 直译，阶段二 2.5c）。
 *
 * GET /api/capabilities：settings/tools/mcp_servers/providers/env/system/
 * memory/config_sources + Phase4 manifest（features/sidecar/endpoints/version）。
 * GET /api/skills/discovered：kernel 无对应 RPC → []（同 Python sidecar 不可用分支）。
 *
 * 架构适配：
 *   - settings：Python 经 sidecar RPC 且要求 client_running；Bun kernel
 *     in-process 直读全局 SettingsManager。
 *   - sidecar：kernel in-process 恒运行；version 读 bun-sidecar/package.json。
 *   - automation feature：Python 恒 True（调度器在 lifespan 启动）；Bun 侧
 *     automation 已确认随 Python 移除下线（§7 决策点 1）→ enabled:false，
 *     前端路由守卫（meta.feature='automation'）自动跳转"功能不可用"页。
 *   - endpoints：Python 枚举 FastAPI routes；Bun 由 server.ts 注入挂载清单。
 */

import { Hono } from "hono";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { bundleDir } from "../app-paths";
import { appVersion } from "../app-version";
import { getGlobalSettingsSingleton } from "../settings-global";
import { CORE_SETTING_PATHS, readDottedPath } from "./settings";
import { BUILTIN_TOOLS } from "./tools";
import { loadRaw as loadMcpRaw } from "./mcp";
import { redactSensitive } from "./mcp-validation";
import { loadProviders } from "./providers";
import { getPanel } from "./settings-panels";
import { memoryStats } from "./memory";

export interface CapabilitiesDeps {
  /** 活跃 kernel 会话数（system.session_count）。 */
  sessionCount: () => number;
  /** 已挂载的 /api 路由路径清单（endpoints 字段，server.ts 注入）。 */
  endpoints: () => string[];
}

/** 工具按类别分组。 */
function categorizeTools(tools: Array<Record<string, unknown>>): Record<string, Array<Record<string, unknown>>> {
  const categories: Record<string, Array<Record<string, unknown>>> = {};
  for (const t of tools) {
    const cat = String(t.category ?? "other");
    (categories[cat] ??= []).push(t);
  }
  return categories;
}

/** bun-sidecar/package.json 版本号。 */
function sidecarVersion(): string | null {
  try {
    const pkg = path.join(bundleDir(), "bun-sidecar", "package.json");
    if (fs.existsSync(pkg)) {
      const data = JSON.parse(fs.readFileSync(pkg, "utf8")) as Record<string, unknown>;
      return typeof data.version === "string" ? data.version : null;
    }
  } catch {
    // fallthrough
  }
  return null;
}

/** OMP 配置来源分析（_analyze_config_sources 直译）。 */
function analyzeConfigSources(): Record<string, unknown> {
  const home = os.homedir();
  const cwd = process.cwd();
  const maxmaRoot = process.env.MAXMA_PROJECT_ROOT ?? cwd;

  const existsFile = (p: string) => fs.existsSync(p) && fs.statSync(p).isFile();
  const existsDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();

  const sources = [
    { name: "环境变量", path: "OMP_* / MAXMA_* env", priority: 1, exists: true, scope: "global", description: "运行时环境变量覆盖" },
    { name: "CLI 参数", path: "启动命令行", priority: 2, exists: true, scope: "session", description: "启动时传入的命令行参数" },
    { name: "项目 .omprc", path: path.join(cwd, ".omprc"), priority: 3, exists: existsFile(path.join(cwd, ".omprc")), scope: "project", description: "项目级 OMP 配置文件" },
    { name: "项目 .omprc.json", path: path.join(cwd, ".omprc.json"), priority: 4, exists: existsFile(path.join(cwd, ".omprc.json")), scope: "project", description: "项目级 OMP JSON 配置" },
    { name: "项目 .claude", path: path.join(cwd, ".claude"), priority: 5, exists: existsDir(path.join(cwd, ".claude")), scope: "project", description: "Claude Code 项目配置（skills/MCP 等）" },
    { name: "项目 .cursor", path: path.join(cwd, ".cursor"), priority: 6, exists: existsDir(path.join(cwd, ".cursor")), scope: "project", description: "Cursor 编辑器项目配置" },
    { name: "项目 .github", path: path.join(cwd, ".github"), priority: 7, exists: existsDir(path.join(cwd, ".github")), scope: "project", description: "GitHub 项目配置" },
    { name: "项目 .mcp.json", path: path.join(cwd, ".mcp.json"), priority: 8, exists: existsFile(path.join(cwd, ".mcp.json")), scope: "project", description: "MCP 服务器配置文件" },
    { name: "项目 agents.md", path: path.join(cwd, "AGENTS.md"), priority: 9, exists: existsFile(path.join(cwd, "AGENTS.md")), scope: "project", description: "项目上下文说明" },
    { name: "用户 ~/.omp", path: path.join(home, ".omp"), priority: 10, exists: existsDir(path.join(home, ".omp")), scope: "user", description: "OMP 全局用户配置" },
    { name: "用户 ~/.claude", path: path.join(home, ".claude"), priority: 11, exists: existsDir(path.join(home, ".claude")), scope: "user", description: "Claude Code 全局配置" },
    { name: "用户 ~/.cursor", path: path.join(home, ".cursor"), priority: 12, exists: existsDir(path.join(home, ".cursor")), scope: "user", description: "Cursor 编辑器全局配置" },
    { name: "Maxma 数据目录", path: path.join(maxmaRoot, "api", "data"), priority: 13, exists: existsDir(path.join(maxmaRoot, "api", "data")), scope: "app", description: "Maxma 应用数据目录" },
  ];

  const conflicts: Array<Record<string, unknown>> = [];
  const activeSources = sources.filter((s) => s.exists);
  if (activeSources.length > 1) {
    const scopeGroups: Record<string, string[]> = {};
    for (const s of activeSources) {
      (scopeGroups[s.scope] ??= []).push(s.name);
    }
    for (const [scope, names] of Object.entries(scopeGroups)) {
      if (names.length > 1) {
        conflicts.push({
          scope,
          sources: names,
          severity: "info",
          note: `同一作用域(${scope})存在多个配置源，高优先级覆盖低优先级`,
        });
      }
    }
  }

  return {
    sources,
    active_count: activeSources.length,
    total_count: sources.length,
    conflicts,
    resolution_order: sources.map((s) => s.name),
  };
}

/** Phase4 能力发现清单（_build_manifest 直译 + automation 下线决策）。 */
function buildManifest(deps: CapabilitiesDeps, gathered: Record<string, unknown>): Record<string, unknown> {
  const panels = {
    tts: getPanel("tts"),
    browser_tools: getPanel("browser_tools"),
    sub_agents: getPanel("sub_agents"),
    hindsight: getPanel("hindsight"),
  };
  const ttsCfg = panels.tts;
  const browserCfg = panels.browser_tools;
  const subagentCfg = panels.sub_agents;
  const hindsightCfg = panels.hindsight;

  const features: Record<string, unknown> = {};

  features.mcp = {
    enabled: true,
    oauth: true,
    registry: true,
    servers: ((gathered.mcp_servers as unknown[]) ?? []).length,
  };

  features.memory = {
    enabled: true,
    hindsight: Boolean(hindsightCfg.enabled ?? false),
    episodic: true,
  };

  const ttsEnabled = Boolean(ttsCfg.enabled ?? false);
  features.tts = {
    enabled: ttsEnabled,
    providers: ttsEnabled ? [String(ttsCfg.provider ?? "edge-tts")] : [],
  };

  features.browser_tools = { enabled: Boolean(browserCfg.enabled ?? false) };

  features.sub_agents = {
    enabled: Boolean(subagentCfg.enabled ?? false),
    max_concurrent: Number(subagentCfg.max_concurrent ?? 3) || 3,
  };

  // automation 随 Python 移除下线（§7 决策点 1）——前端路由守卫据此隐藏面板
  features.automation = { enabled: false, scheduler: false };

  features.collab = { enabled: true, persistence: "sqlite" };

  features.plugins = { enabled: true, marketplace: false };

  features.rules = { enabled: true, custom_rules: true };

  const tools = (gathered.tools as Array<Record<string, unknown>>) ?? [];
  const builtinCount = tools.filter((t) => t.builtin !== false).length;
  const customCount = tools.length - builtinCount;
  const categories = [...new Set(tools.map((t) => String(t.category ?? "other")))].sort();
  features.tools = {
    builtin_count: builtinCount,
    custom_count: customCount,
    categories,
  };

  const providers = (gathered.providers as Array<Record<string, unknown>>) ?? [];
  const providerNames = [...new Set(providers.map((p) => p.provider).filter((p): p is string => typeof p === "string" && p.length > 0))].sort();
  features.models = {
    providers: providerNames,
    total_models: providers.length,
  };

  return {
    version: appVersion(),
    features,
    sidecar: { status: "running", version: sidecarVersion() },
    endpoints: deps.endpoints(),
  };
}

export function createCapabilitiesRoutes(deps: CapabilitiesDeps): Hono {
  const app = new Hono();

  app.get("/api/capabilities", (c) => {
    const result: Record<string, unknown> = {
      settings: {},
      tools: [],
      mcp_servers: [],
      providers: [],
      env: {},
      system: {},
    };

    // 1. Settings——kernel in-process 直读（Python：sidecar client_running 才取）
    try {
      const settings = getGlobalSettingsSingleton().getSettings();
      const gathered: Record<string, unknown> = {};
      for (const p of CORE_SETTING_PATHS) {
        const value = readDottedPath(settings, p);
        if (value !== undefined) gathered[p] = value;
      }
      result.settings = gathered;
    } catch (err) {
      result.settings_error = String(err);
    }

    // 2. 工具列表
    try {
      result.tools = BUILTIN_TOOLS;
      result.tool_categories = categorizeTools(BUILTIN_TOOLS);
    } catch {
      /* noop */
    }

    // 3. MCP 服务器（脱敏，同 GET /api/mcp/servers）
    try {
      result.mcp_servers = loadMcpRaw().map((e) => redactSensitive(e));
    } catch {
      /* noop */
    }

    // 4. MCP 自动发现——kernel 无对应 RPC → []（同 Python sidecar 不可用分支）
    result.discovered_mcp = [];

    // 5. Provider 列表（providers.yaml → 前端展示字段映射）
    try {
      const providers = loadProviders();
      result.providers = providers.map((p) => ({
        id: p.id ?? null,
        name: p.label ?? p.name ?? null,
        provider: p.provider_type ?? p.provider ?? null,
        model: Array.isArray(p.models) && p.models.length > 0 ? p.models[0] : null,
        enabled: p.enabled ?? true,
      }));
    } catch {
      /* noop */
    }

    // 5.5 系统环境
    try {
      result.env = {
        cwd: process.cwd(),
        platform: process.platform,
        project_root: process.env.MAXMA_PROJECT_ROOT ?? "",
      };
      result.system = {
        sidecar_available: true,
        session_count: deps.sessionCount(),
      };
    } catch {
      /* noop */
    }

    // 6. 记忆统计
    try {
      result.memory = memoryStats();
    } catch {
      /* noop */
    }

    // 7. 配置来源分析
    try {
      result.config_sources = analyzeConfigSources();
    } catch {
      /* noop */
    }

    // 8. Phase4 能力清单
    try {
      Object.assign(result, buildManifest(deps, result));
    } catch {
      /* noop */
    }

    return c.json(result);
  });

  // Skills 自动发现——kernel 无 get_discovered_skills RPC → []（桩）
  app.get("/api/skills/discovered", (c) => c.json([]));

  return app;
}
