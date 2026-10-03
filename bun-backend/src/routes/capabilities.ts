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
import * as crypto from "node:crypto";
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
    transports: ["stdio", "streamable_http"],
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

  features.plugins = { enabled: false, marketplace: false };

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
    const installRoot = path.join(os.homedir(), ".agents", "skills");
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
