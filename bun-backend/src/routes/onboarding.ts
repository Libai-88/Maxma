/**
 * routes/onboarding.ts — 首次引导状态（api/routes/onboarding.py 的 Bun 直译）。
 *
 * ONBOARDING-PORTABLE-001：状态存后端（DATA_DIR/config/onboarding.json），
 * 随数据目录走；字段白名单过滤防前端传任意键；原子写。
 */

import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import { getOnboardingStatePath } from "../app-paths";

export function onboardingStatePath(): string {
  return getOnboardingStatePath();
}

const DEFAULT_PREFERENCES = { displayName: "", language: "zh-CN", workspace: "personal" };

interface OnboardingState {
  completed: boolean;
  preferences: { displayName: string; language: string; workspace: string };
}

function loadState(): OnboardingState {
  try {
    const file = onboardingStatePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      if (data && typeof data === "object") return data as OnboardingState;
    }
  } catch {
    console.warn("[onboarding] 读取引导状态失败，按新用户处理");
  }
  return { completed: false, preferences: { ...DEFAULT_PREFERENCES } };
}

function saveState(state: OnboardingState): void {
  const file = onboardingStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function createOnboardingRoutes(): Hono {
  const app = new Hono();

  app.get("/api/onboarding/state", (c) => c.json(loadState()));

  app.put("/api/onboarding/state", async (c) => {
    const payload = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const prefs = (payload.preferences ?? {}) as Record<string, unknown>;
    // 字段白名单过滤（与 Python 版同语义：类型收敛 + 枚举归一）
    const preferences = {
      displayName: String(prefs.displayName ?? "").slice(0, 80),
      language: prefs.language === "en" ? "en" : "zh-CN",
      workspace: prefs.workspace === "project" ? "project" : "personal",
    };
    const state: OnboardingState = {
      completed: Boolean(payload.completed),
      preferences,
    };
    saveState(state);
    return c.json(state);
  });

  return app;
}
