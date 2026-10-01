/**
 * routes/settings-panels.ts — 四个配置面板持久化（api/routes/settings_panels.py
 * 的 Bun 直译，阶段二 2.2g）。
 *
 * 数据：API_DATA_DIR/panel_configs.json（顶层键 hindsight/tts/browser_tools/
 * sub_agents）。语义保留：默认值合并、None 字段不覆盖（PATCH 语义）、
 * PANEL-CORRUPT-001 损坏拒绝写入、PANEL-WIRE-001 同步 OMP 运行时设置
 * （browser 与 advisor 配置项直调 kernel 全局 SettingsManager，sidecar 不可用的
 * 降级分支不再需要）。
 */

import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import { getApiDataDir } from "../app-paths";
import { getGlobalSettingsSingleton } from "../settings-global";

function configPath(): string {
  return path.join(getApiDataDir(), "panel_configs.json");
}

// ── 默认配置（与 Python 版逐字段一致）──

const DEFAULT_HINDSIGHT: Record<string, unknown> = {
  enabled: false,
  retention_days: 90,
  importance_threshold: 0.5,
  processing_mode: "auto",
  prompt_template: "",
};

const DEFAULT_TTS: Record<string, unknown> = {
  enabled: false,
  provider: "system",
  voice: "",
  speed: 1.0,
  pitch: 1.0,
  auto_read: false,
};

const DEFAULT_BROWSER_TOOLS: Record<string, unknown> = {
  enabled: false,
  chrome_path: "",
  headless: true,
  viewport_width: 1280,
  viewport_height: 800,
  block_tracking: true,
  allowed_domains: [],
};

const DEFAULT_SUB_AGENTS: Record<string, unknown> = {
  enabled: false,
  max_concurrent: 3,
  auto_approve: false,
  model: "inherit",
  timeout_seconds: 120,
  show_progress: true,
};

const DEFAULTS: Record<string, Record<string, unknown>> = {
  hindsight: DEFAULT_HINDSIGHT,
  tts: DEFAULT_TTS,
  browser_tools: DEFAULT_BROWSER_TOOLS,
  sub_agents: DEFAULT_SUB_AGENTS,
};

const LEGACY_TTS_PROVIDERS = new Set(["edge-tts", "openai-tts"]);

function loadAll(): Record<string, Record<string, unknown>> {
  try {
    const file = configPath();
    if (!fs.existsSync(file)) return {};
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      console.warn(`[panel_configs] invalid top-level document in ${file}`);
      return {};
    }
    return data as Record<string, Record<string, unknown>>;
  } catch (err) {
    console.warn(`[panel_configs] failed to read: ${String(err)}`);
    return {};
  }
}

function saveAll(data: Record<string, unknown>): void {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

/** 读取单个面板（与默认值合并）。损坏文件在 GET 侧降级为默认值。 */
export function getPanel(panel: string): Record<string, unknown> {
  const stored = loadAll()[panel] ?? {};
  const merged = { ...DEFAULTS[panel]! };
  if (stored && typeof stored === "object") Object.assign(merged, stored);
  return merged;
}

/** 合并写入单面板。损坏时拒绝覆盖（PANEL-CORRUPT-001）。 */
function putPanel(panel: string, patch: Record<string, unknown>): Record<string, unknown> {
  const file = configPath();
  if (fs.existsSync(file)) {
    try {
      JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      console.error(`[panel_configs] 已损坏，拒绝覆盖写入: ${String(err)}`);
      throw Object.assign(new Error("面板配置文件已损坏，为保护现有配置已拒绝写入，请检查 panel_configs.json"), {
        status: 503,
      });
    }
  }
  const all = loadAll();
  const current = all[panel] ?? {};
  const merged = { ...DEFAULTS[panel]!, ...(current as Record<string, unknown>), ...patch };
  all[panel] = merged;
  saveAll(all);
  return merged;
}

/** 应用面板 patch 的字段校验（Pydantic Field 约束直译）。 */
function validatePanel(
  panel: string,
  updates: Record<string, unknown>,
): string | null {
  if (panel === "hindsight" && updates.processing_mode !== undefined && updates.processing_mode !== null) {
    if (!["auto", "manual", "scheduled"].includes(String(updates.processing_mode))) {
      return "processing_mode must be auto/manual/scheduled";
    }
  }
  if (panel === "tts" && updates.provider !== undefined && updates.provider !== null) {
    const provider = String(updates.provider);
    if (provider !== "system" && provider !== "custom" && !LEGACY_TTS_PROVIDERS.has(provider)) {
      return "provider must be system/custom";
    }
  }
  if (panel === "tts") {
    for (const key of ["speed", "pitch"]) {
      const v = updates[key];
      if (typeof v === "number" && (v < 0.5 || v > 2.0)) return `${key} must be between 0.5 and 2.0`;
    }
  }
  if (panel === "hindsight") {
    const rd = updates.retention_days;
    if (typeof rd === "number" && (rd < 7 || rd > 365)) return "retention_days must be between 7 and 365";
    const it = updates.importance_threshold;
    if (typeof it === "number" && (it < 0.1 || it > 1.0)) return "importance_threshold must be between 0.1 and 1.0";
  }
  if (panel === "browser_tools") {
    const vw = updates.viewport_width;
    if (typeof vw === "number" && (vw < 1 || vw > 7680)) return "viewport_width must be between 1 and 7680";
    const vh = updates.viewport_height;
    if (typeof vh === "number" && (vh < 1 || vh > 4320)) return "viewport_height must be between 1 and 4320";
  }
  if (panel === "sub_agents") {
    const mc = updates.max_concurrent;
    if (typeof mc === "number" && (mc < 1 || mc > 10)) return "max_concurrent must be between 1 and 10";
    const ts = updates.timeout_seconds;
    if (typeof ts === "number" && (ts < 30 || ts > 600)) return "timeout_seconds must be between 30 and 600";
  }
  return null;
}

export function createSettingsPanelRoutes(): Hono {
  const app = new Hono();

  // Hindsight
  app.get("/api/memory/hindsight-config", (c) => c.json(getPanel("hindsight")));
  app.put("/api/memory/hindsight-config", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const invalid = validatePanel("hindsight", body);
    if (invalid) return c.json({ detail: invalid }, 422);
    return c.json(putPanel("hindsight", body));
  });

  // TTS
  app.get("/api/settings/tts", (c) => {
    const cfg = getPanel("tts");
    if (LEGACY_TTS_PROVIDERS.has(String(cfg.provider))) {
      return c.json({ ...cfg, provider: "system" }); // GAP-A2-001 历史值规范化
    }
    return c.json(cfg);
  });
  app.put("/api/settings/tts", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const invalid = validatePanel("tts", body);
    if (invalid) return c.json({ detail: invalid }, 422);
    const updates = { ...body };
    if (LEGACY_TTS_PROVIDERS.has(String(updates.provider))) updates.provider = "system";
    return c.json(putPanel("tts", updates));
  });

  // 浏览器工具
  app.get("/api/settings/browser-tools", (c) => c.json(getPanel("browser_tools")));
  app.put("/api/settings/browser-tools", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const invalid = validatePanel("browser_tools", body);
    if (invalid) return c.json({ detail: invalid }, 422);
    const updates = { ...body };
    if (updates.allowed_domains !== undefined && updates.allowed_domains !== null) {
      // 去空白、去重（保持顺序）、忽略空项
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const d of updates.allowed_domains as unknown[]) {
        if (typeof d !== "string") continue;
        const trimmed = d.trim();
        if (trimmed && !seen.has(trimmed)) {
          seen.add(trimmed);
          cleaned.push(trimmed);
        }
      }
      updates.allowed_domains = cleaned;
    }
    const result = putPanel("browser_tools", updates);
    // PANEL-WIRE-001：同步 OMP 运行时设置（kernel 全局单例直调）
    const settings = getGlobalSettingsSingleton();
    if ("enabled" in updates) {
      settings.applyOverrides({ browser: { enabled: Boolean(updates.enabled) } } as never);
    }
    if ("headless" in updates) {
      settings.applyOverrides({ browser: { headless: Boolean(updates.headless) } } as never);
    }
    return c.json(result);
  });

  // 子代理
  app.get("/api/settings/sub-agents", (c) => c.json(getPanel("sub_agents")));
  app.put("/api/settings/sub-agents", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const invalid = validatePanel("sub_agents", body);
    if (invalid) return c.json({ detail: invalid }, 422);
    const result = putPanel("sub_agents", body);
    const settings = getGlobalSettingsSingleton();
    if ("enabled" in body) {
      settings.applyOverrides({ advisor: { enabled: Boolean(body.enabled) } } as never);
    }
    if ("max_concurrent" in body) {
      settings.applyOverrides({ advisor: { maxConcurrent: Number(body.max_concurrent) } } as never);
    }
    return c.json(result);
  });

  return app;
}
