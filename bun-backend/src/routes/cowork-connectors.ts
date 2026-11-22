/**
 * routes/cowork-connectors.ts — M3-D 连接器状态（只读）。
 */

import { Hono } from "hono";

import type { ConnectorRegistry } from "../services/connector-registry";

export function createCoworkConnectorRoutes(deps: {
  registry: () => ConnectorRegistry;
  enabled: () => boolean;
}): Hono {
  const app = new Hono();
  app.get("/api/cowork/connectors", (c) => {
    if (!deps.enabled()) return c.json({ detail: "Cowork 任务层未启用" }, 503);
    return c.json(deps.registry().list());
  });
  return app;
}
