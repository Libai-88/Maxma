/**
 * tools/index.ts — 注册所有 Maxma 自定义工具作为原生 oh-my-pi AgentTool
 *
 * 每个工具实现 ToolDefinition 接口，用于 createAgentSession({ customTools })。
 */

import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod/v4";
import { todoistTools } from "./todoist";
import manageSkillsTool from "./config/manage_skills";
import manageMacrosTool from "./config/manage_macros";
import manageProvidersTool from "./config/manage_providers";
import manageMCPTool from "./config/manage_mcp";
import manageEnvVarsTool from "./config/manage_env_vars";
import manageWhitelistTool from "./config/manage_whitelist";

// ── Weather Tool ────────────────────────────────────────

const weatherParams = z.object({
  city: z.string().describe("城市名称，如 '北京'、'上海'"),
});

/** 所有外部 API fetch 共用超时时间（毫秒） */
const FETCH_TIMEOUT = 10_000;

const weatherTool: ToolDefinition<typeof weatherParams> = {
  name: "get_current_weather",
  label: "Get Current Weather",
  description: "获取指定城市的实时天气信息，包括温度、湿度、风力、天气状况等",
  parameters: weatherParams,
  execute: async (toolCallId, params) => {
    const city = params.city;
    const apiKey = process.env.UAPIS_API_KEY;

    if (!apiKey) {
      // Fallback: use public wttr.in API
      try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=%C+%t+%h+%w&lang=zh`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        });
        const text = await res.text();
        return { content: [{ type: "text", text: `${city} 天气: ${text}` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `${city} 天气暂时无法获取` }] };
      }
    }

    try {
      const res = await fetch(`https://api.help.bj.cn/weather/?id=${encodeURIComponent(city)}&key=${apiKey}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
      const data = await res.json() as Record<string, unknown>;
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `获取天气失败: ${String(e)}` }] };
    }
  },
};

// ── Holiday Calendar Tool ───────────────────────────────

const holidayParams = z.object({
  year: z.string().optional().describe("年份，如 '2026'，默认当前年份"),
});

const holidayTool: ToolDefinition<typeof holidayParams> = {
  name: "holiday_calendar",
  label: "Holiday Calendar",
  description: "获取指定年份的中国法定节假日安排，包括调休信息",
  parameters: holidayParams,
  execute: async (toolCallId, params) => {
    const year = params.year || String(new Date().getFullYear());

    // Try uapis API first
    const apiKey = process.env.UAPIS_API_KEY;
    if (apiKey) {
      try {
        const res = await fetch(`https://api.help.bj.cn/apis/holiday/${year}?key=${apiKey}`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        });
        const data = await res.json() as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        // Fall through to public API
      }
    }

    // Public API fallback
    try {
      const res = await fetch(`https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${year}.json`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });
      const data = await res.json() as Record<string, unknown>;
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `获取 ${year} 年节假日信息失败: ${String(e)}` }] };
    }
  },
};

// ── Tarot Tool ──────────────────────────────────────────

const tarotParams = z.object({
  count: z.number().optional().describe("抽取张数，默认 1 张，最大 3 张"),
  question: z.string().optional().describe("占卜的问题或主题"),
});

const tarotTool: ToolDefinition<typeof tarotParams> = {
  name: "tarot",
  label: "Tarot",
  description: "抽取塔罗牌进行占卜，可指定张数和问题",
  parameters: tarotParams,
  execute: async (toolCallId, params) => {
    const count = Math.min(Math.max(params.count || 1, 1), 3);
    const question = params.question || "未指定问题";

    const cards = [
      { name: "愚者", meaning: "新的开始、冒险、天真、无限可能" },
      { name: "魔术师", meaning: "创造力、自信、技能、资源" },
      { name: "女祭司", meaning: "直觉、潜意识、内在智慧" },
      { name: "女皇", meaning: "丰饶、滋养、自然、母性" },
      { name: "皇帝", meaning: "权威、结构、稳定、父性" },
      { name: "教皇", meaning: "传统、信仰、精神指引" },
      { name: "恋人", meaning: "选择、爱情、关系、价值观" },
      { name: "战车", meaning: "胜利、决心、意志力、征服" },
      { name: "力量", meaning: "内在力量、勇气、耐心、慈悲" },
      { name: "隐士", meaning: "内省、寻求真理、独处" },
      { name: "命运之轮", meaning: "变化、循环、命运、转折点" },
      { name: "正义", meaning: "公正、平衡、真相、法律" },
      { name: "倒吊人", meaning: "牺牲、放下、新视角、暂停" },
      { name: "死神", meaning: "结束、转变、放下过去、新生" },
      { name: "节制", meaning: "平衡、适度、调和、耐心" },
      { name: "恶魔", meaning: "束缚、执着、物质主义、欲望" },
      { name: "高塔", meaning: "突然变化、颠覆、觉醒、重建" },
      { name: "星星", meaning: "希望、灵感、平静、重生" },
      { name: "月亮", meaning: "幻想、恐惧、潜意识、困惑" },
      { name: "太阳", meaning: "成功、喜悦、活力、成就" },
      { name: "审判", meaning: "觉醒、重生、内在召唤、评判" },
      { name: "世界", meaning: "完成、圆满、成就、旅程终点" },
    ];

    // Fisher-Yates shuffle (uniform distribution)
    const shuffled = [...cards];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const picked = shuffled.slice(0, count);

    const result = picked.map((card, i) => {
      const orientation = ["正位", "逆位"][Math.floor(Math.random() * 2)];
      const position = count > 1 ? `第 ${i + 1} 张 · ${orientation}` : orientation;
      return `${card.name}（${position}）: ${card.meaning}`;
    }).join("\n");

    const response = count > 1
      ? `🔮 塔罗牌占卜 — 问题：${question}\n\n${result}`
      : `🔮 塔罗牌占卜 — 问题：${question}\n\n抽到的牌：${result}`;

    return { content: [{ type: "text", text: response }] };
  },
};

// ── Register All ────────────────────────────────────────

export function registerCustomTools(): ToolDefinition[] {
  return [
    weatherTool,
    holidayTool,
    tarotTool,
    manageSkillsTool,
    manageMacrosTool,
    manageProvidersTool,
    manageMCPTool,
    manageEnvVarsTool,
    manageWhitelistTool,
    ...todoistTools,
  ];
}
