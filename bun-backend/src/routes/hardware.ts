/** routes/hardware.ts — 本机硬件探针、模型路由建议与本地模型一键接入。 */
import { Hono } from "hono";

import { loadProviders, publicProvider, saveProviders, validateProviderBaseUrl, YamlCorruptedError } from "./providers";
import { isLocalProviderUrl, probeHardware, rankModelRoutes, type HardwareInfo } from "../services/hardware";
import { probeLocalProvider } from "../services/model-fallback";

const LOCAL_PRESETS: Record<string, { label: string; baseUrl: string }> = {
  ollama: { label: "本机 Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  lmstudio: { label: "本机 LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
};

let cache: { at: number; hardware: HardwareInfo } | null = null;
const TTL_MS = 30_000;

async function hardwareWithCache(force = false): Promise<HardwareInfo> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.hardware;
  const hardware = await probeHardware();
  cache = { at: Date.now(), hardware };
  return hardware;
}

export function createHardwareRoutes(): Hono {
  const app = new Hono();

  app.get("/api/system/hardware", async (c) => {
    const force = c.req.query("refresh") === "1";
    const hardware = await hardwareWithCache(force);
    return c.json(hardware);
  });

  app.get("/api/models/routing", async (c) => {
    const hardware = await hardwareWithCache(c.req.query("refresh") === "1");
    const candidates = rankModelRoutes(hardware, loadProviders());
    const recommended = candidates.find((candidate) => candidate.fit === "good")
      ?? candidates.find((candidate) => candidate.fit === "ok")
      ?? candidates.find((candidate) => candidate.fit === "tight")
      ?? candidates.find((candidate) => candidate.fit === "cloud")
      ?? null;
    return c.json({
      hardware,
      candidates,
      recommended,
      notes: [
        "模型内存按名称中的参数量与量化标记估算（默认 4-bit），不是实测 benchmark。",
        "本地云端判断只看 provider base_url 是否为 localhost/127.0.0.1 等本机地址。",
        "路由只给建议，不会自动切换模型或修改 provider 配置。",
      ],
    });
  });

  /**
   * POST /api/models/local-setup — 一键接入本机 Ollama / LM Studio。
   *
   * 只有探测到本机 `/models` 可达且返回模型列表时才写 providers.yaml；否则返回 409，
   * 不留下一个永远连不上的条目。已存在同 base_url 的 provider 时只补齐模型列表。
   */
  app.post("/api/models/local-setup", async (c) => {
    const body = await c.req.json().catch(() => null) as {
      preset?: unknown;
      base_url?: unknown;
      label?: unknown;
      model?: unknown;
    } | null;
    if (!body || typeof body !== "object") {
      return c.json({ error: "请求体必须是 JSON 对象" }, 400);
    }
    const preset = typeof body.preset === "string" ? body.preset : "ollama";
    const presetConfig = LOCAL_PRESETS[preset];
    const baseUrlRaw = typeof body.base_url === "string" && body.base_url.trim()
      ? body.base_url.trim()
      : presetConfig?.baseUrl;
    if (!baseUrlRaw) return c.json({ error: `未知预设：${preset}，请提供 base_url` }, 400);
    if (!isLocalProviderUrl(baseUrlRaw)) {
      return c.json({ error: "本地模型接入只接受 localhost / 127.0.0.1 / ::1 等本机地址" }, 400);
    }
    let baseUrl: string;
    try {
      baseUrl = validateProviderBaseUrl(baseUrlRaw);
    } catch {
      return c.json({ error: "base_url 不是合法的 HTTP(S) 地址" }, 422);
    }

    const probe = await probeLocalProvider(baseUrl);
    if (!probe.reachable) {
      return c.json({
        error: "未检测到本机模型服务",
        code: "LOCAL_MODEL_UNREACHABLE",
        base_url: baseUrl,
        detail: probe.detail,
        hint: preset === "lmstudio"
          ? "先在 LM Studio 打开 Local Server（默认端口 1234），再回来重试。"
          : "先启动 Ollama（默认端口 11434），确认 `ollama list` 有模型，再回来重试。",
      }, 409);
    }

    const requestedModel = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "";
    const models = probe.models.length > 0
      ? probe.models
      : requestedModel ? [requestedModel] : [];
    if (models.length === 0) {
      return c.json({
        error: "本机模型服务可达，但没有返回可用模型",
        code: "LOCAL_MODEL_EMPTY",
        base_url: baseUrl,
        detail: probe.detail,
        hint: "先在本地服务里拉取/加载一个模型，再回来重试。",
      }, 409);
    }

    const existing = loadProviders();
    const matched = existing.find((entry) => entry.base_url === baseUrl);
    const label = typeof body.label === "string" && body.label.trim()
      ? body.label.trim()
      : presetConfig?.label ?? "本机模型";
    let provider: Record<string, unknown>;
    let created = false;
    if (matched) {
      provider = {
        ...matched,
        label: typeof matched.label === "string" && matched.label ? matched.label : label,
        models,
        enabled: matched.enabled !== false,
      };
      const next = existing.map((entry) => (entry === matched ? provider : entry));
      try {
        saveProviders(next);
      } catch (error) {
        if (error instanceof YamlCorruptedError) return c.json({ error: "providers.yaml 已损坏，拒绝覆盖" }, 503);
        throw error;
      }
    } else {
      const usedIds = new Set(existing.map((entry) => String(entry.id ?? "")));
      let id = `local-${preset}`;
      let suffix = 2;
      while (usedIds.has(id)) id = `local-${preset}-${suffix++}`;
      provider = {
        id,
        label,
        provider_type: "openai",
        base_url: baseUrl,
        api_key: "",
        models,
        enabled: true,
      };
      try {
        saveProviders([...existing, provider]);
      } catch (error) {
        if (error instanceof YamlCorruptedError) return c.json({ error: "providers.yaml 已损坏，拒绝覆盖" }, 503);
        throw error;
      }
      created = true;
    }

    return c.json({
      created,
      provider: publicProvider(provider),
      models,
      probe: { reachable: probe.reachable, detail: probe.detail },
    });
  });

  return app;
}
