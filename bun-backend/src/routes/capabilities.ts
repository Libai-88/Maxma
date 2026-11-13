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
 *   - automation / browser_tools：pi 既无调度器也无浏览器运行时，且不存在第二条
 *     实现路线 → 2026-11-12 复核后整体删除（能力项、路由、面板、DB 表一并清掉）。
 *   - sub_agents：pi **支持**，走 SDK 的进程内会话（kernel/subagent.ts），
 *     能力清单发 mechanism="pi-sdk-in-process"。
 *   - endpoints：Python 枚举 FastAPI routes；Bun 由 server.ts 注入挂载清单。
 */

import { Hono } from "hono";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

import { bundleDir, dataDir, getApiDataDir, getUserSkillsDir } from "../app-paths";
import { appVersion } from "../app-version";
import { getSettingValue } from "../settings-global";
import { agentDirDiagnostics, engineIdentity } from "../../../bun-sidecar/src/kernel/engine-info";
import { CORE_SETTING_PATHS } from "./settings";
import { currentToolList } from "./tools";
import { loadRaw as loadMcpRaw } from "./mcp";
import { redactSensitive } from "./mcp-validation";
import { loadProviders } from "./providers";
import { getPanel } from "./settings-panels";
import { memoryStats } from "./memory";
import { discoverMaxmaSkills } from "../../../bun-sidecar/src/kernel/skills";

export interface CapabilitiesDeps {
  /** 活跃 kernel 会话数（system.session_count）。 */
  sessionCount: () => number;
  /** 已挂载的 /api 路由路径清单（endpoints 字段，server.ts 注入）。 */
  endpoints: () => string[];
}

async function unzipSkillArchive(archive: Uint8Array, expectedEntries: number): Promise<Array<[string, Uint8Array]>> {
  const { Unzip, UnzipInflate, UnzipPassThrough } = await import("fflate");
  return new Promise((resolve, reject) => {
    const files: Array<[string, Uint8Array]> = [];
    let entryCount = 0;
    let completedCount = 0;
    let totalOutputBytes = 0;
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    };
    const unzip = new Unzip((file) => {
      if (settled) { void file.terminate(); return; }
      entryCount++;
      if (entryCount > 250 || entryCount > expectedEntries) { fail("Skill 文件数量无效或超过 250 个"); void file.terminate(); return; }
      const normalized = file.name.replace(/\\/g, "/");
      const isDirectory = normalized.endsWith("/");
      const parts = normalized.split("/").filter((part) => !(isDirectory && part === ""));
      if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || parts.some((part) => !part || part === "." || part === "..")) {
        fail("压缩包包含不安全的文件路径"); void file.terminate(); return;
      }
      const pieces: Uint8Array[] = [];
      let fileBytes = 0;
      file.ondata = (error, data, final) => {
        if (settled) { void file.terminate(); return; }
        if (error) { fail("Skill ZIP 解压失败: " + String(error)); void file.terminate(); return; }
        if (data?.length) {
          fileBytes += data.length;
          totalOutputBytes += data.length;
          if (totalOutputBytes > 20 * 1024 * 1024) { fail("解压后的 Skill 超过 20 MB"); void file.terminate(); return; }
          pieces.push(data);
        }
        if (final) {
          completedCount++;
          if (!isDirectory) {
            const contents = new Uint8Array(fileBytes);
            let offset = 0;
            for (const piece of pieces) { contents.set(piece, offset); offset += piece.length; }
            files.push([normalized, contents]);
          }
          if (entryCount === expectedEntries && completedCount === expectedEntries && !settled) {
            settled = true;
            resolve(files);
          }
        }
      };
      try { file.start(); } catch (error) { fail("Skill ZIP 解压失败: " + String(error)); }
    });
    unzip.register(UnzipInflate);
    unzip.register(UnzipPassThrough);
    try {
      unzip.push(archive, true);
      if (!settled && (entryCount !== expectedEntries || completedCount !== expectedEntries)) fail("Skill ZIP 文件条目不完整");
    } catch (error) {
      fail("Skill ZIP 解压失败: " + (error instanceof Error ? error.message : String(error)));
    }
  });
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

/**
 * 「引擎版本」——以前这里读 `bun-sidecar/package.json` 的 `maxma-sidecar`
 * 产品版本（0.1.0）并当作引擎版本展示，跟 pi 实际是哪个版本毫无关系。
 * 现在经 kernel 取 pi 根面导出的 VERSION（内联进 server.js 后依然可读）。
 */
function engineVersion(): string | null {
  try {
    return engineIdentity().version || null;
  } catch {
    return null;
  }
}

/**
 * 配置来源清单 —— **只列真的有读取方的位置**。
 *
 * 这张表原来是从 Python 后端 `_analyze_config_sources` 直译的 OMP 时代清单，
 * 12 行里有 8 行在 Maxma + pi 的真实运行链路上**没有任何读取方**：
 *
 *   `.omprc` / `.omprc.json`  —— OMP 自己的配置文件名，pi 与 Maxma 都不读
 *   `.claude` / `~/.claude`    —— pi 只把 `CLAUDE.md` 当**上下文文件**读，不读这个目录
 *   `.cursor` / `~/.cursor`    —— 同上，纯编辑器目录，与本产品无关
 *   `.github`                  —— CI 目录，运行期零读取
 *   `.mcp.json`                —— MCP 客户端通用名；Maxma 读的是
 *                                 `api/data/mcp_servers.yaml`，pi 读 `~/.pi/agent/mcp.json`
 *                                 / `.pi/mcp.json`（见 pi docs/configuration.md）
 *
 * 能力页把「存在」和「生效」画等号，用户看到 `~/.claude` 打勾会以为 Maxma 在用
 * 它——这是本仓最忌讳的「界面撒谎」。所以只留真实读取方，并按**真实优先级**排：
 * 应用层（Maxma 自己的文件）优先，其次是引擎层（pi 的 agent 目录与项目 `.pi`），
 * 最后是引擎的上下文文件发现规则。
 *
 * 判据可复核：每一条都能在代码里指到读取点，见各条 `reader` 字段。
 */
function analyzeConfigSources(): Record<string, unknown> {
  // ⚠️ 不能用 `process.cwd()`：后端通常从 `bun-backend/` 启动，而**会话的工作目录**
  // 是 `maxmaProjectRoot()`（`bridge-pi.ts` 的 `params.cwd ?? maxmaProjectRoot()`）。
  // 用 cwd 会让「人设与规则」「项目上下文文件」查错目录，页面显示「不存在」——
  // 一个把真实存在的东西报成缺失的谎。
  const sessionCwd = path.resolve(
    process.env.MAXMA_DATA_DIR ?? process.env.MAXMA_PROJECT_ROOT ?? bundleDir(),
  );
  const maxmaRoot = sessionCwd;
  const agentDir = process.env.PI_CODING_AGENT_DIR
    ? path.resolve(process.env.PI_CODING_AGENT_DIR)
    : path.join(os.homedir(), ".pi", "agent");

  const existsFile = (p: string) => fs.existsSync(p) && fs.statSync(p).isFile();
  const existsDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();

  const sources = [
    // ── 应用层：Maxma 自己读写 ──
    { name: "Maxma 环境变量", path: "MAXMA_* / PI_CODING_AGENT_DIR", priority: 1, exists: true, scope: "global", description: "数据根、打包目录、引擎配置目录", reader: "app-paths.ts" },
    { name: "Maxma 设置覆盖", path: path.join(getApiDataDir(), "settings_overrides.json"), priority: 2, exists: existsFile(path.join(getApiDataDir(), "settings_overrides.json")), scope: "app", description: "设置页显式改动的持久化（建会话时下发引擎）", reader: "settings-global.ts" },
    { name: "Maxma 面板配置", path: path.join(getApiDataDir(), "panel_configs.json"), priority: 3, exists: existsFile(path.join(getApiDataDir(), "panel_configs.json")), scope: "app", description: "TTS / 子 Agent 面板开关", reader: "routes/settings-panels.ts" },
    { name: "Maxma 模型渠道", path: path.join(getApiDataDir(), "providers.yaml"), priority: 4, exists: existsFile(path.join(getApiDataDir(), "providers.yaml")), scope: "app", description: "用户配置的模型提供商与凭据", reader: "routes/providers.ts" },
    { name: "Maxma MCP 清单", path: path.join(getApiDataDir(), "mcp_servers.yaml"), priority: 5, exists: existsFile(path.join(getApiDataDir(), "mcp_servers.yaml")), scope: "app", description: "MCP 服务器定义（建会话时装配进引擎）", reader: "routes/mcp.ts" },
    { name: "Maxma 人设与规则", path: path.join(maxmaRoot, "config", "personas"), priority: 6, exists: existsDir(path.join(maxmaRoot, "config", "personas")), scope: "app", description: "SOUL / USER / AGENTS / MAXMA 提示词组件", reader: "kernel/persona-prompt.ts" },

    // ── 引擎层：pi 自己读写（Maxma 只注入路径）──
    { name: "引擎配置目录", path: agentDir, priority: 7, exists: existsDir(agentDir), scope: "engine", description: "pi 的 settings/auth/models/mcp/sessions（PI_CODING_AGENT_DIR）", reader: "pi getAgentDir()" },
    { name: "项目 .pi 目录", path: path.join(sessionCwd, ".pi"), priority: 8, exists: existsDir(path.join(sessionCwd, ".pi")), scope: "project", description: "pi 的项目级设置与资源（需项目信任）", reader: "pi DefaultResourceLoader" },
    { name: "项目上下文文件", path: path.join(sessionCwd, "AGENTS.md"), priority: 9, exists: existsFile(path.join(sessionCwd, "AGENTS.md")) || existsFile(path.join(sessionCwd, "CLAUDE.md")), scope: "project", description: "AGENTS.md / CLAUDE.md：pi 按目录层级自动注入（免信任）", reader: "pi resource-loader contextFiles" },
    { name: "技能目录", path: path.join(os.homedir(), ".agents", "skills"), priority: 10, exists: existsDir(path.join(os.homedir(), ".agents", "skills")), scope: "user", description: "用户级与项目级技能（.agents/skills + 随包 .maxma/skills）", reader: "kernel/skills.ts" },
  ];

  /**
   * 覆盖关系 —— 只报**代码里真的会互相覆盖**的那几对。
   *
   * 旧实现按「同 scope 有多个来源」推断覆盖（OMP 的优先级模型），但这份清单里
   * 应用层各文件职责互不重叠（设置/面板/渠道/MCP/人设各管各的），同 scope 同时
   * 存在只是正常状态，报成「冲突」等于制造噪音。
   *
   * 真实存在的覆盖只有两条，都能在代码里指到：
   *   1. MCP：`pi-session.ts` 用 `createMcpExtension({loadConfig})` **整体替换**了
   *      pi 自己的 `mcp.json` 发现——用户在 `~/.pi/agent/mcp.json` 或 `.pi/mcp.json`
   *      里写的服务器不会生效，只有 Maxma 的 `mcp_servers.yaml` 算数。
   *   2. 系统提示词：Maxma 以 `appendSystemPrompt` 追加人设，而 pi 仍会按目录层级
   *      注入 `AGENTS.md` / `CLAUDE.md`——两者都进系统提示，谁也不是"覆盖"谁。
   */
  const conflicts: Array<Record<string, unknown>> = [];
  const activeSources = sources.filter((s) => s.exists);

  const mcpYaml = path.join(getApiDataDir(), "mcp_servers.yaml");
  const piMcpFiles = [
    path.join(agentDir, "mcp.json"),
    path.join(sessionCwd, ".pi", "mcp.json"),
  ].filter(existsFile);
  if (existsFile(mcpYaml) && piMcpFiles.length > 0) {
    conflicts.push({
      scope: "mcp",
      sources: ["Maxma MCP 清单", ...piMcpFiles.map((p) => path.basename(path.dirname(p)) + "/mcp.json")],
      severity: "warning",
      note: "Maxma 用 loadConfig 整体替换了 pi 的 mcp.json 发现：这里的服务器不会生效，只有 Maxma MCP 清单算数。",
    });
  }

  const contextFiles = ["AGENTS.md", "CLAUDE.md", "AGENTS.override.md"]
    .map((n) => path.join(sessionCwd, n))
    .filter(existsFile);
  if (contextFiles.length > 0) {
    conflicts.push({
      scope: "system_prompt",
      sources: ["Maxma 人设 (appendSystemPrompt)", ...contextFiles.map((p) => path.basename(p))],
      severity: "info",
      note: "两段内容都会进系统提示词，是叠加而非覆盖；项目上下文文件免项目信任即加载。",
    });
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
    sub_agents: getPanel("sub_agents"),
  };
  const ttsCfg = panels.tts;
  const subagentCfg = panels.sub_agents;

  const features: Record<string, unknown> = {};

  features.mcp = {
    enabled: true,
    oauth: true,
    registry: true,
    transports: ["stdio", "streamable_http"],
    servers: ((gathered.mcp_servers as unknown[]) ?? []).length,
  };

  // 记忆只有一条真实链路：remember_memory / search_memories 工具 + 记忆页
  // 直接读写 memory.yaml。旧的 `hindsight`（增强管线）与 `episodic`（情景库）
  // 从来没有任何读者，字段一并删除——能力清单不许声明不存在的子系统。
  features.memory = { enabled: true };

  const ttsEnabled = Boolean(ttsCfg.enabled ?? false);
  features.tts = {
    enabled: ttsEnabled,
    providers: ttsEnabled ? [String(ttsCfg.provider ?? "edge-tts")] : [],
  };

  // 子 Agent：pi **支持**，方式是 SDK 的进程内会话（docs/sdk.md 的
  // createAgentSession + SessionManager.inMemory；官方示例 examples/extensions/subagent
  // 用子进程做同一件事，Maxma 因便携包只带 bun、pi CLI 在 bun 下起不来而选 SDK）。
  // 装配见 kernel/subagent.ts，开关/并发/超时来自本面板。
  features.sub_agents = {
    enabled: Boolean(subagentCfg.enabled ?? false),
    engine_supported: true,
    mechanism: "pi-sdk-in-process",
    reason: null,
    max_concurrent: Number(subagentCfg.max_concurrent ?? 4) || 4,
    timeout_seconds: Number(subagentCfg.timeout_seconds ?? 300) || 300,
  };

  features.collab = { enabled: true, persistence: "sqlite" };

  // PLUGIN-001：插件子系统已落地（真实注册表 + 管理页）。marketplace 仍为 false ——
  // 尚不支持从网络安装第三方插件（需先过安全评审）。
  features.plugins = { enabled: true, marketplace: false };

  features.extensions = {
    enabled: true,
    bundled: ["maxma-approval", "maxma-blocker", "request-telemetry"],
  };

  features.rules = { enabled: true, custom_rules: true };

  const tools = (gathered.tools as Array<Record<string, unknown>>) ?? [];
  const builtinCount = tools.filter((t) => t.source !== "custom").length;
  const customCount = tools.filter((t) => t.source === "custom").length;
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
    // sidecar 已是 in-process，不再是独立进程；version 字段现在如实报引擎版本。
    // 新前端请优先读 engine（name + version）。
    sidecar: { status: "running", version: engineVersion() },
    // 引擎身份 + 配置目录落点。agent_dir_inside_expected=false 意味着便携/桌面壳
    // 注入的 env 没生效，pi 正在往用户主目录写数据（见 kernel/engine-info.ts）。
    engine: { ...engineIdentity(), ...agentDirDiagnostics(dataDir()) },
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

    // 1. Settings——经 settings-global 读取（显式覆盖优先，其次引擎默认值）。
    //    旧实现直接读那个 in-memory 单例，重启后面板改动就消失了，这里跟着丢。
    try {
      const gathered: Record<string, unknown> = {};
      for (const p of CORE_SETTING_PATHS) {
        const value = getSettingValue(p);
        if (value !== undefined) gathered[p] = value;
      }
      result.settings = gathered;
    } catch (err) {
      result.settings_error = String(err);
    }

    // 2. 工具列表
    try {
      const toolList = currentToolList();
      result.tools = toolList;
      result.tool_categories = categorizeTools(toolList);
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
        // 会话的工作目录，不是后端进程的 cwd（后者通常是 `bun-backend/`，
        // 页面标成「工作目录」会让用户以为 Agent 在子目录里干活）。
        cwd: path.resolve(
          process.env.MAXMA_DATA_DIR ?? process.env.MAXMA_PROJECT_ROOT ?? bundleDir(),
        ),
        process_cwd: process.cwd(),
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

  // Skills 自动发现：使用 pi 官方 loader，和实际会话使用同一套默认目录。
  app.get("/api/skills/discovered", (c) => {
    try {
      const result = discoverMaxmaSkills();
      const skills = result.skills;
      if (c.req.query("details") === "1") {
        return c.json({ skills, diagnostics: result.diagnostics });
      }
      return c.json(skills);
    } catch (err) {
      console.warn(`[skills] discovery failed: ${String(err)}`);
      return c.json(c.req.query("details") === "1" ? { skills: [], diagnostics: [{ message: String(err) }] } : []);
    }
  });


  app.get("/api/skills/market", async (c) => {
    const keyword = (c.req.query("q") ?? "").trim().slice(0, 160);
    const page = Math.max(1, Math.min(5000, Number(c.req.query("page") ?? 1) || 1));
    const pageSize = Math.max(1, Math.min(50, Number(c.req.query("page_size") ?? 20) || 20));
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sortBy: "downloads", order: "desc" });
    if (keyword) query.set("keyword", keyword);
    try {
      const response = await fetch("https://api.skillhub.cn/api/skills?" + query.toString(), { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return c.json({ detail: "SkillHub 暂不可用（HTTP " + response.status + "）" }, 502);
      const payload = await response.json() as { code?: number; message?: string; data?: { total?: number; skills?: unknown[] } };
      if (payload.code !== 0 || !payload.data) return c.json({ detail: payload.message ?? "SkillHub 响应异常" }, 502);
      return c.json({ total: payload.data.total ?? 0, skills: payload.data.skills ?? [], page, page_size: pageSize });
    } catch (error) {
      return c.json({ detail: "SkillHub 连接失败: " + (error instanceof Error ? error.message : String(error)) }, 502);
    }
  });

  app.post("/api/skills/market/install", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const slug = typeof body.slug === "string" ? body.slug.trim() : "";
    if (!/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(slug)) return c.json({ detail: "无效的 Skill 标识" }, 400);
    const installRoot = getUserSkillsDir();
    const target = path.join(installRoot, slug);
    if (fs.existsSync(target)) return c.json({ detail: "Skill 已安装: " + slug }, 409);
    const temporary = target + ".install-" + crypto.randomUUID();
    try {
      const response = await fetch("https://api.skillhub.cn/api/v1/download?slug=" + encodeURIComponent(slug), { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) return c.json({ detail: "SkillHub 下载失败（HTTP " + response.status + "）" }, 502);
      if (!response.body) return c.json({ detail: "SkillHub 下载内容为空" }, 502);
      const reader = response.body.getReader();
      const archiveChunks: Uint8Array[] = [];
      let archiveBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          archiveBytes += value.length;
          if (archiveBytes > 25 * 1024 * 1024) {
            await reader.cancel();
            return c.json({ detail: "Skill 压缩包超过 25 MB" }, 413);
          }
          archiveChunks.push(value);
        }
      } finally { reader.releaseLock(); }
      if (archiveBytes < 22) return c.json({ detail: "Skill 压缩包大小无效" }, 413);
      const archive = new Uint8Array(archiveBytes);
      let archiveOffset = 0;
      for (const chunk of archiveChunks) { archive.set(chunk, archiveOffset); archiveOffset += chunk.length; }
      const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
      const eocdStart = Math.max(0, archive.length - 65_557);
      let eocd = -1;
      for (let offset = archive.length - 22; offset >= eocdStart; offset--) {
        if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
      }
      if (eocd < 0 || view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0 || view.getUint16(eocd + 8, true) !== view.getUint16(eocd + 10, true) || eocd + 22 + view.getUint16(eocd + 20, true) !== archive.length) throw new Error("Skill ZIP 目录无效或不支持分卷压缩包");
      const entryCount = view.getUint16(eocd + 10, true);
      const centralSize = view.getUint32(eocd + 12, true);
      const centralOffset = view.getUint32(eocd + 16, true);
      if (entryCount < 1 || entryCount > 250 || entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || centralOffset + centralSize > eocd) throw new Error("Skill ZIP 文件数量或目录无效");
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const declaredSizes = new Map<string, number>();
      let totalDeclaredBytes = 0;
      let cursor = centralOffset;
      for (let index = 0; index < entryCount; index++) {
        if (cursor + 46 > centralOffset + centralSize || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Skill ZIP 中央目录损坏");
        const flags = view.getUint16(cursor + 8, true);
        const compression = view.getUint16(cursor + 10, true);
        const compressedSize = view.getUint32(cursor + 20, true);
        const uncompressedSize = view.getUint32(cursor + 24, true);
        const nameLength = view.getUint16(cursor + 28, true);
        const extraLength = view.getUint16(cursor + 30, true);
        const commentLength = view.getUint16(cursor + 32, true);
        const externalAttributes = view.getUint32(cursor + 38, true);
        const recordEnd = cursor + 46 + nameLength + extraLength + commentLength;
        if (recordEnd > centralOffset + centralSize || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || (flags & 1) !== 0 || (compression !== 0 && compression !== 8)) throw new Error("Skill ZIP 包含不支持或无效的文件条目");
        const archivePath = decoder.decode(archive.subarray(cursor + 46, cursor + 46 + nameLength)).replace(/\\/g, "/");
        const isDirectory = archivePath.endsWith("/");
        const normalizedParts = archivePath.split("/").filter((part) => isDirectory && part === "" ? false : true);
        if (!archivePath || archivePath.startsWith("/") || /^[a-z]:/i.test(archivePath) || normalizedParts.some((part) => !part || part === "." || part === "..") || ((externalAttributes >>> 16) & 0xf000) === 0xa000) throw new Error("压缩包包含不安全的文件路径");
        if (isDirectory && (compressedSize !== 0 || uncompressedSize !== 0)) throw new Error("Skill ZIP 目录条目包含意外数据");
        if (!isDirectory) {
          totalDeclaredBytes += uncompressedSize;
          if (totalDeclaredBytes > 20 * 1024 * 1024) throw new Error("解压后的 Skill 超过 20 MB");
          declaredSizes.set(archivePath, uncompressedSize);
        }
        cursor = recordEnd;
      }
      if (cursor !== centralOffset + centralSize) throw new Error("Skill ZIP 中央目录长度不匹配");
      const entries = await unzipSkillArchive(archive, entryCount);
      if (entries.length !== declaredSizes.size || entries.some(([name, contents]) => declaredSizes.get(name) !== contents.length)) throw new Error("Skill ZIP 实际内容与目录声明不一致");
      if (entries.length === 0 || entries.length > 250) return c.json({ detail: "Skill 文件数量无效或超过 250 个" }, 413);
      const safeEntries: Array<[string, Uint8Array]> = [];
      let totalBytes = 0;
      for (const [archivePath, contents] of entries) {
        const normalized = archivePath.replace(/\\/g, "/");
        if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("压缩包包含不安全的文件路径");
        totalBytes += contents.length;
        if (totalBytes > 20 * 1024 * 1024) throw new Error("解压后的 Skill 超过 20 MB");
        safeEntries.push([normalized, contents]);
      }
      const skillFile = safeEntries.find(([name]) => name === "SKILL.md" || name.endsWith("/SKILL.md"));
      if (!skillFile) throw new Error("压缩包中没有 SKILL.md");
      const rootPrefix = skillFile[0].endsWith("/SKILL.md") ? skillFile[0].slice(0, -"SKILL.md".length) : "";
      fs.mkdirSync(temporary, { recursive: true });
      for (const [archivePath, contents] of safeEntries) {
        const relative = rootPrefix && archivePath.startsWith(rootPrefix) ? archivePath.slice(rootPrefix.length) : archivePath;
        if (!relative) continue;
        const destination = path.resolve(temporary, relative);
        if (!destination.startsWith(path.resolve(temporary) + path.sep)) throw new Error("Skill 文件路径越界");
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, contents, { flag: "wx" });
      }
      fs.mkdirSync(installRoot, { recursive: true });
      fs.renameSync(temporary, target);
      return c.json({ status: "installed", slug, path: target });
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      return c.json({ detail: "Skill 安装失败: " + (error instanceof Error ? error.message : String(error)) }, 502);
    }
  });

  return app;
}
