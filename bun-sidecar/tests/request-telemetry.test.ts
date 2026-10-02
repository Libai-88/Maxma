import { describe, expect, test } from "bun:test";
import {
  createRequestFingerprintEpoch,
  createRequestFingerprintSecret,
  createRequestTelemetryExtension,
  fingerprintProviderRequest,
} from "../src/kernel/request-telemetry";

describe("request telemetry", () => {
  test("tracks request structure without retaining text and fingerprints only the stable prefix", () => {
    const secret = createRequestFingerprintSecret();
    const epoch = createRequestFingerprintEpoch();
    const base = {
      system: "Keep this instruction stable.",
      tools: [{ name: "read", description: "Read a file" }],
      messages: [
        { role: "developer", content: "Developer guidance" },
        { role: "user", content: "First request" },
      ],
    };
    const nextUserPrompt = {
      ...base,
      messages: [base.messages[0], { role: "user", content: "A different current request" }],
    };
    const changedPrefix = { ...base, system: "A changed instruction." };

    const first = fingerprintProviderRequest(base, secret, epoch);
    const repeatedPrefix = fingerprintProviderRequest(nextUserPrompt, secret, epoch);
    const changed = fingerprintProviderRequest(changedPrefix, secret, epoch);

    expect(first.requestShapeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.prefixFingerprint).toBe(repeatedPrefix.prefixFingerprint);
    expect(first.prefixFingerprint).not.toBe(changed.prefixFingerprint);
    expect(first.fingerprintEpoch).toBe(epoch);
    expect(JSON.stringify(first)).not.toContain("Keep this instruction");
    expect(fingerprintProviderRequest({ input: "unstructured prompt" }, secret, epoch).prefixFingerprint).toBeNull();
  });

  test("extension observes the provider payload without changing it", () => {
    let handler: ((event: { payload: unknown }) => void) | undefined;
    const telemetry: unknown[] = [];
    createRequestTelemetryExtension(createRequestFingerprintSecret(), createRequestFingerprintEpoch(), (value) => telemetry.push(value))({
      on: (_event, callback) => { handler = callback as typeof handler; return () => {}; },
    } as never);
    const payload = { messages: [{ role: "system", content: "stable" }, { role: "user", content: "hello" }] };
    handler?.({ payload });
    expect(telemetry).toHaveLength(1);
    expect(payload.messages[0]?.content).toBe("stable");
  });
});
