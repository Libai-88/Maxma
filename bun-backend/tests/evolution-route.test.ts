import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

let dataDir = "";
let previousDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join("D:\\MaxmaTemp", "maxma-evolution-route-"));
  previousDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
});

afterEach(async () => {
  const { resetDbInitForTest } = await import("../src/db/core");
  resetDbInitForTest();
  if (previousDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("EvoCore routes", () => {
  test("learns, lists, and pauses a rule", async () => {
    const { createEvolutionRoutes } = await import("../src/routes/evolution");
    const app = createEvolutionRoutes();
    const learned = await app.request("/api/evolution/learn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "以后回答时先说结论", scope: "global" }),
    });
    expect(learned.status).toBe(200);
    const learnedBody = await learned.json() as { learned: boolean; rule: { id: string } };
    expect(learnedBody.learned).toBe(true);

    const listed = await app.request("/api/evolution/rules?status=active");
    const listBody = await listed.json() as { rules: Array<{ id: string; status: string }> };
    expect(listBody.rules).toHaveLength(1);
    expect(listBody.rules[0]?.status).toBe("active");

    const paused = await app.request(`/api/evolution/rules/${learnedBody.rule.id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "paused" }),
    });
    expect(paused.status).toBe(200);
    expect((await (await app.request("/api/evolution/rules")).json() as { rules: Array<{ status: string }> }).rules[0]?.status).toBe("paused");
  });
});
