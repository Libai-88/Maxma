import * as fs from "node:fs";
import * as path from "node:path";

const STICKER_INSTRUCTIONS = [
  "## 表情贴纸",
  "根据当前活动人设和对话情绪，在自然合适的位置主动使用贴纸指令，格式必须为 [表情包:分类]。",
  "可用分类：开心、无语、委屈、悲伤、害羞、生气、惊讶、尴尬、撒娇、得意、爱心、日常。",
  "不要把指令放进代码块；不要每条回复机械添加。系统会将有效指令渲染为贴纸。",
].join("\n");

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

export function buildPersonaSystemPrompt(options: { dataDir: string; bundleDir?: string }): string {
  const bundleDir = options.bundleDir ?? options.dataDir;
  const soul = readText(activePersonaFile(options.dataDir, bundleDir));
  const user = readText(path.join(options.dataDir, "config", "personas", "USER.md"))
    || readText(path.join(bundleDir, "config", "personas", "USER.md"));
  let userName = "用户";
  try {
    const onboarding = JSON.parse(readText(path.join(options.dataDir, "config", "onboarding.json"))) as { preferences?: { displayName?: unknown } };
    if (typeof onboarding.preferences?.displayName === "string" && onboarding.preferences.displayName.trim()) {
      userName = onboarding.preferences.displayName.trim();
    }
  } catch {
    // Keep a neutral name when onboarding preferences are absent or invalid.
  }
  return [soul, user ? `## 用户档案\n${user}` : "", STICKER_INSTRUCTIONS]
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
