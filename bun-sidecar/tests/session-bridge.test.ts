import { describe, test, expect } from "bun:test";
import { mapPiEventToMaxma } from "../src/session-bridge";

describe("module import smoke test", () => {
  test("mapPiEventToMaxma is exported and callable", () => {
    const out = mapPiEventToMaxma({ type: "agent_end" });
    expect(out).toEqual({ type: "done", payload: {} });
  });
});

describe("mapPiEventToMaxma done guard", () => {
  test("agent_end marks the guard as done", () => {
    const guard = { done: false };
    const out = mapPiEventToMaxma({ type: "agent_end" }, guard);
    expect(out).toEqual({ type: "done", payload: {} });
    expect(guard.done).toBe(true);
  });

  test("non-agent_end events do not touch the guard", () => {
    const guard = { done: false };
    const out = mapPiEventToMaxma({ type: "tool_execution_start", toolName: "x", args: {} }, guard);
    expect(out).toEqual({ type: "tool_start", payload: { tool_name: "x", input: "{}" } });
    expect(guard.done).toBe(false);
  });

  test("works without a guard (backward compatible)", () => {
    const out = mapPiEventToMaxma({ type: "agent_end" });
    expect(out).toEqual({ type: "done", payload: {} });
  });
});

