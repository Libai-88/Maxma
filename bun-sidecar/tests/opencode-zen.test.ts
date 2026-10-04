import { describe, expect, test } from "bun:test";
import { opencodeZenGatewayId } from "../src/kernel/opencode-zen";

describe("OpenCode Zen gateway identity", () => {
  test("uses the gateway session/request identifier shape", () => {
    expect(opencodeZenGatewayId("ses", "session-seed")).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(opencodeZenGatewayId("msg", "request-seed")).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  });
});
