/**
 * routes/settings-panels.ts — 四个配置面板持久化（api/routes/settings_panels.py
 * 的 Bun 直译，阶段二 2.2g）。
 *
 * 数据：API_DATA_DIR/panel_configs.json（顶层键 tts/sub_agents）。
 * 语义保留：默认值合并、None 字段不覆盖（PATCH 语义）、PANEL-CORRUPT-001 损坏拒绝写入。
 *
 * 已删除 `browser_tools`（无浏览器运行时）与 `hindsight`（记忆增强面板从来没有
 * 消费方：retention/importance/processing_mode/prompt_template 四个字段全仓零读取，
 * 记忆只由 remember_memory 工具与记忆页直接读写 memory.yaml）。留一个只会显示
 * 「已停用」的开关就是在卖假功能。
 */

import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import { getApiDataDir } from "../app-paths";
// getGlobalSettingsSingleton 的引用已移除：那两处 applyOverrides 是 no-op（见下方注释），
// 面板配置的唯一存储是 panel_configs.json。

function configPath(): string {
  return path.join(getApiDataDir(), "panel_configs.json");
}

// ── 默认配置（与 Python 版逐字段一致）──

const DEFAULT_TTS: Record<string, unknown> = {
  enabled: false,
  provider: "system",
  voice: "",
  speed: 1.0,
  pitch: 1.0,
  auto_read: false,
};

// 只有这三个字段被 kernel/subagent.ts 消费（开关 / 并行上限 / 单任务超时）。
// 旧的 auto_approve / model / show_progress 没有读者，已删除——面板上不显示的
// 键也不该留在文件里冒充可配置项。
const DEFAULT_SUB_AGENTS: Record<string, unknown> = {
  enabled: false,
  max_concurrent: 3,
  timeout_seconds: 120,
};

const DEFAULTS: Record<string, Record<string, unknown>> = {
  tts: DEFAULT_TTS,
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

  // 子代理
  app.get("/api/settings/sub-agents", (c) => c.json(getPanel("sub_agents")));
  app.put("/api/settings/sub-agents", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const invalid = validatePanel("sub_agents", body);
    if (invalid) return c.json({ detail: invalid }, 422);
    const result = putPanel("sub_agents", body);
    // 同上：`advisor.*` 是上一代引擎的键，pi 的 Settings 里没有，镜像写是 no-op。
    // 子代理配置的实际生效面是 capabilities.features.sub_agents（含引擎支持度）。
    return c.json(result);
  });

  return app;
}
