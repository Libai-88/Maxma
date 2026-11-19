import * as fs from "node:fs";
import * as path from "node:path";

import { MemesStore, scanPacks } from "../../../bun-shared/dsh-meme/memes";

function stickerPrompt(dataDir: string, bundleDir: string): string {
  let settings: {
    promptEnabled?: boolean;
    enabledPacks?: string[];
    sendGear?: string;
  } = {};
  try {
    settings = JSON.parse(fs.readFileSync(path.join(dataDir, "stickers", "settings.json"), "utf8")) as typeof settings;
  } catch {
    /* 首次启动还没写 settings：按默认开启、全部图库处理 */
  }
  if (settings.promptEnabled === false) return "";

  let packs: Array<{ id: string; name: string; path: string }> = [];
  try {
    packs = scanPacks(
      path.join(bundleDir, "config", "stickers"),
      path.join(dataDir, "stickers", "packs"),
    ).map((p) =>
      path.resolve(p.path) === path.resolve(path.join(bundleDir, "config", "stickers"))
        ? { ...p, id: "maxma_builtin" }
        : p,
    );
  } catch {
    /* 索引尚未生成时仍注入协议说明，避免模型完全不知道表情能力 */
  }
  const enabled = Array.isArray(settings.enabledPacks)
    ? settings.enabledPacks
    : packs.map((p) => p.id);
  const counts = new Map<string, number>();
  for (const pack of packs) {
    if (!enabled.includes(pack.id)) continue;
    try {
      const store = new MemesStore(pack.path);
      for (const row of store.rows) counts.set(row.tag, (counts.get(row.tag) ?? 0) + 1);
    } catch {
      /* 坏库跳过 */
    }
  }
  const tags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, count]) => `${tag}(${count})`)
    .join(" ");
  const gear = settings.sendGear || "auto";
  const gearLine =
    gear === "off"
      ? "主动发图档位：关闭。只有用户明确要求发表情/发图/斗图时才发。"
      : gear === "always"
        ? "主动发图档位：每轮都发。没有合适候选才允许纯文字。"
        : gear === "active"
          ? "主动发图档位：积极。气氛合适就发，但别每条机械加。"
          : "主动发图档位：自动。看气氛，正事/严肃话题克制。";
  return [
    "## 表情贴纸",
    "需要表情时先调用 send_meme 拿候选；候选里的 [表情: 描述] 必须原样抄，不要自己编描述。",
    "发图标记用半角冒号：[表情: 描述]；不要把图片路径贴进回复，也不要写 markdown 图片。",
    "用户只是发表情不算收藏请求；只有明确要求收藏/收录图片时才调用 learn_meme。",
    "可用分类（来自当前启用图库）：" + (tags || "happy angry sad shy confused daily"),
    gearLine,
  ].join("\n");
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * 开发模式下后端通常从 bun-backend 目录启动，process.cwd() 不等于项目根目录。
 * 人设文件与其他 Maxma 配置位于项目根的 config/personas，因此需要从当前
 * sidecar 源文件位置稳定回溯到项目根；打包/便携模式仍优先使用运行时环境变量。
 */
function defaultProjectRoot(): string {
  return path.resolve(import.meta.dir, "../../..");
}

function activePersonaFile(dataDir: string, bundleDir: string): string {
  const activePath = path.join(dataDir, "config", "personas", "active_persona.yaml");
  try {
    const parsed = Bun.YAML.parse(fs.readFileSync(activePath, "utf8")) as { file?: unknown } | null;
    if (typeof parsed?.file === "string" && path.basename(parsed.file) === parsed.file) {
      for (const base of [path.join(dataDir, "config", "personas"), path.join(bundleDir, "config", "personas")]) {
        const candidate = path.join(base, parsed.file);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch {
    // Fall back to the default persona when the active-persona marker is absent or invalid.
  }
  for (const base of [path.join(dataDir, "config", "personas"), path.join(bundleDir, "config", "personas")]) {
    const candidate = path.join(base, "SOUL.md");
    if (fs.existsSync(candidate)) return candidate;
  }
  return "";
}

/** 人设目录下的提示词组件：用户目录优先，随包模板兜底。 */
function readPersonaComponent(dataDir: string, bundleDir: string, name: string): string {
  return readText(path.join(dataDir, "config", "personas", name))
    || readText(path.join(bundleDir, "config", "personas", name));
}

/**
 * 组装追加系统提示词。
 *
 * 顺序对齐 Python 后端时代的 `agent/prompts.py`（稳定内容在前，利于 prompt cache）：
 *   Maxma 自述（MAXMA.md）→ 行为规则（AGENTS.md）→ 人设（SOUL）→ 用户档案 → 贴纸指引
 *
 * ⚠️ `AGENTS.md` 与 `MAXMA.md` 是**迁移回归修复**：两者在 Python 后端里真实注入过
 * （commit 37ab9b23 引入 MAXMA.md），`8d1d864f` 删 Python 源码时注入代码随之消失，
 * 但两个文件仍被两种打包脚本拷进产物。结果是随包分发一堆没人读的提示词，
 * 其中 AGENTS.md 还整篇写着上一代引擎的工具名。现在恢复注入，并按真实工具面重写。
 */
export function buildPersonaSystemPrompt(options: { dataDir: string; bundleDir?: string }): string {
  const bundleDir = options.bundleDir ?? options.dataDir;
  const soul = readText(activePersonaFile(options.dataDir, bundleDir));
  const maxmaIdentity = readPersonaComponent(options.dataDir, bundleDir, "MAXMA.md");
  const behaviorRules = readPersonaComponent(options.dataDir, bundleDir, "AGENTS.md");
  const user = readPersonaComponent(options.dataDir, bundleDir, "USER.md");
  let userName = "用户";
  try {
    const onboarding = JSON.parse(readText(path.join(options.dataDir, "config", "onboarding.json"))) as { preferences?: { displayName?: unknown } };
    if (typeof onboarding.preferences?.displayName === "string" && onboarding.preferences.displayName.trim()) {
      userName = onboarding.preferences.displayName.trim();
    }
  } catch {
    // Keep a neutral name when onboarding preferences are absent or invalid.
  }
  return [
    maxmaIdentity,
    behaviorRules,
    soul,
    user ? `## 用户档案\n${user}` : "",
    stickerPrompt(options.dataDir, bundleDir),
  ]
    .filter(Boolean)
    .join("\n\n")
    .replaceAll("{{USER_NAME}}", userName);
}

export function loadPersonaSystemPrompt(): string {
  const projectRoot = defaultProjectRoot();
  const dataDir = path.resolve(process.env.MAXMA_DATA_DIR ?? process.env.MAXMA_PROJECT_ROOT ?? projectRoot);
  const bundleDir = path.resolve(process.env.MAXMA_BUNDLE_DIR ?? projectRoot);
  return buildPersonaSystemPrompt({ dataDir, bundleDir });
}
