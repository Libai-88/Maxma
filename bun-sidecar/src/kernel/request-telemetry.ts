import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";

const MAX_CANONICAL_PREFIX_BYTES = 512 * 1024;
const MAX_SHAPE_NODES = 8_000;
const MAX_SHAPE_DEPTH = 20;
const PREFIX_KEYS = new Set([
  "system", "system_prompt", "systeminstruction", "instructions", "tools", "tool_choice",
  "toolchoice", "response_format", "responseformat", "generationconfig", "cachedcontent",
]);
const TRANSCRIPT_KEYS = new Set(["messages", "contents", "input"]);

export interface RequestTelemetry {
  requestShapeHash: string | null;
  prefixFingerprint: string | null;
  fingerprintEpoch: string;
}

export function createRequestFingerprintSecret(): Uint8Array {
  return randomBytes(32);
}

export function createRequestFingerprintEpoch(): string {
  return randomUUID();
}

function shapeOf(value: unknown, budget: { nodes: number }, depth = 0): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_SHAPE_NODES || depth >= MAX_SHAPE_DEPTH) return "truncated";
  if (value === null) return "null";
  if (typeof value === "string") return `string:${Math.floor(value.length / 128)}`;
  if (typeof value === "number") return Number.isFinite(value) ? "number" : "nonfinite-number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      items: value.slice(0, 128).map((item) => shapeOf(item, budget, depth + 1)),
    };
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return {
      type: "object",
      fields: Object.keys(record).sort().map((key) => [key, shapeOf(record[key], budget, depth + 1)]),
    };
  }
  return typeof value;
}

function canonicalize(value: unknown, depth = 0): unknown {
  if (depth > MAX_SHAPE_DEPTH) return "[depth-limit]";
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, depth + 1));
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key], depth + 1)]));
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return `[${typeof value}]`;
}

function isUserMessage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.role === "user" || record.type === "user";
}

function prefixProjection(payload: unknown): unknown | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const projection: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (PREFIX_KEYS.has(key.toLowerCase())) projection[key] = value;
  }
  const transcriptKey = Object.keys(record).find((key) => TRANSCRIPT_KEYS.has(key.toLowerCase()) && Array.isArray(record[key]));
  if (transcriptKey) {
    const transcript = record[transcriptKey] as unknown[];
    let lastUserIndex = -1;
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
      if (isUserMessage(transcript[index])) {
        lastUserIndex = index;
        break;
      }
    }
    projection[transcriptKey] = lastUserIndex >= 0 ? transcript.slice(0, lastUserIndex) : transcript;
  }
  return Object.keys(projection).length > 0 ? projection : null;
}

/** Produces content-free shape data and a session-keyed HMAC of the stable request prefix. */
export function fingerprintProviderRequest(
  payload: unknown,
  secret: Uint8Array,
  epoch: string,
): RequestTelemetry {
  const shape = shapeOf(payload, { nodes: 0 });
  const requestShapeHash = createHash("sha256").update(JSON.stringify(shape)).digest("hex");
  const projection = prefixProjection(payload);
  if (projection === null) return { requestShapeHash, prefixFingerprint: null, fingerprintEpoch: epoch };

  const canonical = JSON.stringify(canonicalize(projection));
  if (Buffer.byteLength(canonical, "utf8") > MAX_CANONICAL_PREFIX_BYTES) {
    return { requestShapeHash, prefixFingerprint: null, fingerprintEpoch: epoch };
  }
  const prefixFingerprint = createHmac("sha256", secret).update(canonical).digest("hex");
  return { requestShapeHash, prefixFingerprint, fingerprintEpoch: epoch };
}

export function createRequestTelemetryExtension(
  secret: Uint8Array,
  epoch: string,
  onTelemetry: (telemetry: RequestTelemetry) => void,
): InlineExtension {
  return (pi) => {
    pi.on("before_provider_request", (event) => {
      onTelemetry(fingerprintProviderRequest(event.payload, secret, epoch));
    });
  };
}
