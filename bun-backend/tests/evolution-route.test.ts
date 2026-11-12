import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { makeTempDataDir, removeTempDataDir } from "./_helpers/tmp";

let dataDir = "";
let previousDataDir: string | undefined;

beforeEach(() => {
  dataDir = makeTempDataDir("maxma-evolution-route");
  previousDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
});

afterEach(async () => {
  const { resetDbInitForTest } = await import("../src/db/core");
  resetDbInitForTest();
  if (previousDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = previousDataDir;
  removeTempDataDir(dataDir);
});

describe("行为偏好 routes", () => {
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

  test("preview 逐字返回注入文本，且不改动 last_used_at", async () => {
    const { createEvolutionRoutes } = await import("../src/routes/evolution");
    const app = createEvolutionRoutes();
    await app.request("/api/evolution/learn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "以后写 Python 脚本时先给出最小可运行示例", scope: "编程" }),
    });

    const hit = await app.request(`/api/evolution/preview?q=${encodeURIComponent("帮我写一个 Python 脚本")}`);
    expect(hit.status).toBe(200);
    const hitBody = await hit.json() as { injection: string; matches: Array<{ matched_keywords: string[]; confidence: number }> };
    expect(hitBody.matches.length).toBe(1);
    expect(hitBody.matches[0]!.matched_keywords.length).toBeGreaterThan(0);
    expect(hitBody.injection).toContain("Maxma 行为偏好");
    // 规则文本会按句式规范化（"以后…" → "以后按用户偏好执行：…"），断言核心内容即可
    expect(hitBody.injection).toContain("写 Python 脚本时先给出最小可运行示例");

    // 预览必须只读：规则列表里 last_used_at 仍为空
    const listed = await app.request("/api/evolution/rules?status=active");
    const listBody = await listed.json() as { rules: Array<{ last_used_at: string | null }> };
    expect(listBody.rules[0]?.last_used_at).toBeNull();

    // 不命中时注入为空
    const miss = await app.request(`/api/evolution/preview?q=${encodeURIComponent("今天天气怎么样")}`);
    const missBody = await miss.json() as { injection: string; matches: unknown[] };
    expect(missBody.matches).toHaveLength(0);
    expect(missBody.injection).toBe("");
  });
});
