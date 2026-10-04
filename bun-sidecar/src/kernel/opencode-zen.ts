import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { Model, SimpleStreamOptions, Tool, TranscriptContext } from "@earendil-works/pi-ai";
import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createHash, randomUUID } from "node:crypto";

const DEFAULT_BASE_URL = "https://opencode.ai/zen/v1";
const QUARTET = ["bash", "glob", "grep", "read"] as const;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const upstream = openAICompletionsApi();
const sessionIds = new Map<string, string>();

function base62From(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => BASE62[byte % BASE62.length]).join("");
}

function timestampPrefix(kind: "ses" | "msg"): string {
  const timestamp = BigInt(Date.now());
  const value = kind === "ses" ? ~(timestamp * 0x1000n + 1n) : timestamp * 0x1000n + 1n;
  let hex = "";
  for (let index = 0; index < 6; index += 1) {
    hex += Number((value >> BigInt(40 - 8 * index)) & 0xffn).toString(16).padStart(2, "0");
  }
  return hex;
}

function stableSessionId(seed: string): string {
  const existing = sessionIds.get(seed);
  if (existing) return existing;
  const id = opencodeZenGatewayId("ses", seed);
  sessionIds.set(seed, id);
  return id;
}

export function opencodeZenGatewayId(prefix: "ses" | "msg", value: string): string {
  const digest = createHash("sha256").update(`maxma-opencode-zen\0${value}`).digest();
  return `${prefix}_${timestampPrefix(prefix)}${base62From(digest.subarray(6, 20))}`;
}

function toolNames(messages: TranscriptContext["messages"]): Set<string> {
  const names = new Set<string>();
  for (const message of messages) {
    if (message.role !== "system") continue;
    for (const tool of message.toolsAdded ?? []) names.add(tool.name.toLowerCase());
  }
  return names;
}

function withFingerprint(context: TranscriptContext): TranscriptContext {
  const names = toolNames(context.messages);
  const additions: Tool[] = QUARTET.filter((name) => !names.has(name)).map((name) => ({
    name,
    description: "This tool is currently unavailable and must not be used.",
    parameters: { type: "object", properties: {} },
  }));
  if (additions.length === 0) return context;
  return {
    messages: [...context.messages, { role: "system", content: "", toolsAdded: additions }],
  } as TranscriptContext;
}

/** OpenCode Zen's free lane needs the same client identity and tool quartet as OpenCode. */
export function opencodeZenStreamSimple(
  model: Model<"openai-completions">,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const firstUser = context.messages.find((message) => message.role === "user");
  const sessionSeed = String((options as Record<string, unknown> | undefined)?.sessionId
    ?? JSON.stringify(firstUser ?? model.provider));
  const requestSeed = randomUUID();
  const headers = {
    ...(options?.headers ?? {}),
    "content-type": "application/json",
    accept: "text/event-stream",
    authorization: "Bearer public",
    "user-agent": "opencode/1.18.31",
    "x-opencode-client": "desktop",
    "x-opencode-session": stableSessionId(sessionSeed),
    "x-opencode-request": opencodeZenGatewayId("msg", requestSeed),
    "x-opencode-project": "global",
  };
  return upstream.streamSimple(model, withFingerprint(context), { ...options, headers });
}

export function registerOpencodeZenTransport(runtime: { registerProvider: (id: string, config: Record<string, unknown>) => void }, modelId: string, baseUrl = DEFAULT_BASE_URL): void {
  runtime.registerProvider("opencode-zen", {
    name: "Maxma 免费模型",
    baseUrl,
    api: "openai-completions",
    compat: {
      maxTokensField: "max_tokens",
      supportsReasoningEffort: false,
      supportsStore: false,
      supportsDeveloperRole: false,
    },
    streamSimple: opencodeZenStreamSimple,
    models: [{
      id: modelId,
      name: modelId,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      reasoning: true,
      contextWindow: 262144,
      maxTokens: 32768,
    }],
  });
}
