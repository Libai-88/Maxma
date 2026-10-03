import { Hono } from "hono";

import {
  evolutionStats,
  learnFromUserMessage,
  listEvolutionRules,
  recordEvolutionFeedback,
  setEvolutionRuleStatus,
  type EvolutionFeedback,
  type EvolutionRuleStatus,
} from "../evolution-ledger";

function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function createEvolutionRoutes(): Hono {
  const app = new Hono();

  app.get("/api/evolution/rules", (c) => {
    const rawStatus = c.req.query("status");
    const status = rawStatus === "candidate" || rawStatus === "active" || rawStatus === "paused" || rawStatus === "rejected"
      ? rawStatus as EvolutionRuleStatus
      : undefined;
    return c.json({ rules: listEvolutionRules(status) });
  });

  app.get("/api/evolution/stats", (c) => c.json(evolutionStats()));

  app.post("/api/evolution/learn", async (c) => {
    const body = bodyRecord(await c.req.json().catch(() => ({})));
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return c.json({ error: "text is required" }, 400);
    const rule = learnFromUserMessage(
      text,
      typeof body.session_id === "string" ? body.session_id : undefined,
      typeof body.turn_id === "string" ? body.turn_id : undefined,
      typeof body.scope === "string" ? body.scope : "global",
    );
    return c.json({ learned: !!rule, rule });
  });

  app.post("/api/evolution/rules/:id/status", async (c) => {
    const body = bodyRecord(await c.req.json().catch(() => ({})));
    const status = body.status;
    if (status !== "candidate" && status !== "active" && status !== "paused" && status !== "rejected") {
      return c.json({ error: "status must be candidate, active, paused, or rejected" }, 400);
    }
    const rule = setEvolutionRuleStatus(c.req.param("id"), status);
    return rule ? c.json({ rule }) : c.json({ error: "rule not found" }, 404);
  });

  app.post("/api/evolution/rules/:id/feedback", async (c) => {
    const body = bodyRecord(await c.req.json().catch(() => ({})));
    const feedback = body.feedback;
    if (feedback !== "positive" && feedback !== "negative" && feedback !== "correct") {
      return c.json({ error: "feedback must be positive, negative, or correct" }, 400);
    }
    const rule = recordEvolutionFeedback(
      c.req.param("id"),
      feedback as EvolutionFeedback,
      typeof body.correction === "string" ? body.correction : undefined,
      typeof body.session_id === "string" ? body.session_id : undefined,
      typeof body.turn_id === "string" ? body.turn_id : undefined,
    );
    return rule ? c.json({ rule }) : c.json({ error: "rule not found" }, 404);
  });

  return app;
}
