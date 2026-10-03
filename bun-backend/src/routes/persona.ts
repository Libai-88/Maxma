/**
 * routes/persona.ts — 人设文件读写 + 多人格管理（api/routes/persona.py +
 * agent/prompts.py persona 函数的 Bun 直译，阶段二 2.2d）。
 *
 * 安全/正确性要点原样保留：
 *   - 文件名白名单正则 ^SOUL.[\w\u4e00-\u9fff\-]+\.md$ + resolve 前缀校验
 *     （PERSONA-VARIANT 防穿越；尾部分隔符剥离容错）
 *   - B-011：memory isolated 归一为 persona；B-012：frontmatter 用 YAML dump
 *     而非字符串插值（防注入）
 *   - PERSONA-CREATE-001：check-then-act 与原子写在同一临界区
 *   - ACTIVE-FOLLOW-RENAME-001：rename 前记录活跃状态
 *   - 删除活跃人格自动回退 SOUL.md（UI"选择即切换"的死锁规避）
 *   - USER.md 称呼模板占位符防御（_is_template_placeholder）
 */

import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import { getPersonasDataDir, getPersonasDir } from "../app-paths";

const VALID_TYPES: Record<string, string> = { soul: "SOUL.md", user: "USER.md" };
const PERSONA_FILENAME_RE = /^SOUL\.[\w\u4e00-\u9fff-]+\.md$/;

function personasDir(): string {
  // 用户运行时活跃目录（PERSONAS_DATA_DIR）
  return getPersonasDataDir();
}
function personasTemplatesDir(): string {
  // 只读 bundle 模板目录（BUNDLE_DIR/config/personas）
  return getPersonasDir();
}
function activePersonaPath(): string {
  return path.join(getPersonasDataDir(), "active_persona.yaml");
}

// ── agent/prompts.py persona 函数直译 ──

/** 返回当前活跃人格文件名；声明文件不存在时回退 SOUL.md（防御）。 */
export function getActivePersonaFile(): string {
  const file = activePersonaPath();
  if (fs.existsSync(file)) {
    try {
      const data = Bun.YAML.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown> | null;
      if (data && typeof data.file === "string") {
        const candidate = data.file;
        for (const base of [personasDir(), personasTemplatesDir()]) {
          if (fs.existsSync(path.join(base, candidate))) return candidate;
        }
        console.warn(`[persona] active_persona.yaml 指向不存在的文件 ${JSON.stringify(candidate)}，回退到 SOUL.md`);
      }
    } catch {
      console.warn("[persona] active_persona.yaml 解析失败，回退到 SOUL.md");
    }
  }
  return "SOUL.md";
}

export function setActivePersona(filename: string): void {
  const file = activePersonaPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, Bun.YAML.stringify({ file: filename }), "utf8");
  fs.renameSync(tmp, file);
}

/** 扫描所有 SOUL*.md（用户目录优先，模板目录兜底；同名只记一次；跳过 example）。 */
export function listPersonas(): Array<{ id: string; file: string; name: string; description: string; active: boolean }> {
  const personas: Array<{ id: string; file: string; name: string; description: string; active: boolean }> = [];
  const activeFile = getActivePersonaFile();
  const seen = new Set<string>();

  for (const scanDir of [personasDir(), personasTemplatesDir()]) {
    if (!fs.existsSync(scanDir) || !fs.statSync(scanDir).isDirectory()) continue;
    const files = fs
      .readdirSync(scanDir)
      .filter((f) => f.startsWith("SOUL") && f.endsWith(".md"))
      .sort();
    for (const name of files) {
      if (seen.has(name) || name === "SOUL.example.md") continue;
      seen.add(name);
      const filePath = path.join(scanDir, name);
      let content = "";
      try {
        content = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      let displayName = name.replace(/\.md$/, "");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("# ")) {
          displayName = trimmed.slice(2).trim();
          break;
        }
      }
      let description = "";
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        description = trimmed;
        break;
      }
      if (description.length > 80) description = description.slice(0, 77) + "...";
      personas.push({
        id: name.replace(/\.md$/, ""),
        file: name,
        name: displayName,
        description,
        active: name === activeFile,
      });
    }
  }
  return personas;
}

/** prompt 缓存失效——Bun 版无缓存，保留调用点语义（空操作）。 */
function invalidatePromptCache(): void {}

// ── helpers ──

function isTemplatePlaceholder(text: string): boolean {
  if (!text) return true;
  const stripped = text.trim();
  if (stripped.startsWith("（") && stripped.endsWith("）")) return true;
  if (stripped.startsWith("(") && stripped.endsWith(")")) return true;
  if (stripped.toLowerCase().includes("agent")) return true;
  return false;
}

function personaReadPath(filename: string): string | null {
  const userPath = path.join(personasDir(), filename);
  if (fs.existsSync(userPath)) return userPath;
  const templatePath = path.join(personasTemplatesDir(), filename);
  if (fs.existsSync(templatePath)) return templatePath;
  return null;
}

function personaWritePath(filename: string): string {
  return path.join(personasDir(), filename);
}

function getPersonaVariantPath(variant: string): string {
  const cleaned = variant.replace(/[\\/ \t\r\n]+$/, "");
  if (cleaned && PERSONA_FILENAME_RE.test(cleaned)) variant = cleaned;
  if (!PERSONA_FILENAME_RE.test(variant)) {
    throw Object.assign(new Error("无效的人格文件名"), { status: 400 });
  }
  const full = path.join(personasDir(), variant);
  if (!path.resolve(full).startsWith(path.resolve(personasDir()) + path.sep)) {
    throw Object.assign(new Error("非法路径"), { status: 400 });
  }
  return full;
}

function writeTextAtomically(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

/** 统一处理直译自 HTTPException 的错误（带 status 的 Error）。 */
function errorResponse(err: unknown): { status: number; message: string } {
  const e = err as { status?: number; message?: string };
  return { status: e.status ?? 500, message: e.message ?? String(err) };
}

export function createPersonaRoutes(): Hono {
  const app = new Hono();

  app.get("/api/persona", (c) => {
    const type = (c.req.query("type") ?? "").toLowerCase();
    const variant = c.req.query("variant");
    if (!(type in VALID_TYPES)) {
      return c.json({ detail: `无效 type: ${type}，仅支持 soul/user` }, 400);
    }
    try {
      if (type === "soul" && variant) {
        getPersonaVariantPath(variant);
        const file = personaReadPath(variant);
        if (!file) return c.json({ detail: `人格文件不存在: ${variant}` }, 404);
        return c.json({ content: fs.readFileSync(file, "utf8"), type });
      }
      const file = personaReadPath(VALID_TYPES[type]!);
      const content = file ? fs.readFileSync(file, "utf8") : "";
      return c.json({ content, type });
    } catch (err) {
      const e = errorResponse(err);
      return c.json({ detail: e.message }, e.status);
    }
  });

  app.put("/api/persona", async (c) => {
    const type = (c.req.query("type") ?? "").toLowerCase();
    const variant = c.req.query("variant");
    const body = (await c.req.json().catch(() => null)) as { content?: string } | null;
    if (body === null) return c.json({ detail: "请求体不能为空" }, 400);
    if (!(type in VALID_TYPES)) {
      return c.json({ detail: `无效 type: ${type}，仅支持 soul/user` }, 400);
    }
    try {
      const file =
        type === "soul" && variant ? personaWritePath(variant) : personaWritePath(VALID_TYPES[type]!);
      try {
        writeTextAtomically(file, body.content ?? "");
      } catch (err) {
        console.error(`[persona] 保存 ${path.basename(file)} 失败`, err);
        return c.json({ detail: "保存失败，请检查磁盘空间和目录权限" }, 500);
      }
      invalidatePromptCache();
      return c.json({ content: body.content ?? "", type });
    } catch (err) {
      const e = errorResponse(err);
      return c.json({ detail: e.message }, e.status);
    }
  });

  app.get("/api/personas", (c) => {
    return c.json({ personas: listPersonas(), active_file: getActivePersonaFile() });
  });

  app.put("/api/personas/active", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { file?: string };
    const file = body.file ?? "";
    try {
      const target = file === "SOUL.md" ? path.join(personasDir(), file) : getPersonaVariantPath(file);
      if (!fs.existsSync(target)) return c.json({ detail: `人格文件不存在: ${file}` }, 404);
      setActivePersona(file);
      return c.json({ status: "ok", active_file: file });
    } catch (err) {
      const e = errorResponse(err);
      return c.json({ detail: e.message }, e.status);
    }
  });

  app.post("/api/personas", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      tools?: string;
      memory?: string;
    };
    const name = (body.name ?? "").trim();
    if (!name) return c.json({ detail: "名称不能为空" }, 400);
    if (!/^[\w\u4e00-\u9fff-]+$/.test(name)) {
      return c.json({ detail: "名称只能包含字母、数字、中文、下划线和连字符" }, 400);
    }
    const safeName = name.replace(/ /g, "_");
    const filename = `SOUL.${safeName}.md`;
    const filepath = path.join(personasDir(), filename);

    // PERSONA-CREATE-001：同一临界区（单线程同步 I/O 天然满足）+ 原子写
    if (fs.existsSync(filepath)) return c.json({ detail: `人格文件已存在: ${filename}` }, 409);

    // B-011：isolated 归一为 persona
    const effectiveMemory = body.memory === "isolated" ? "persona" : body.memory ?? "shared";
    // B-012：frontmatter 用 YAML dump 防注入
    const fmDict: Record<string, string> = {};
    if (body.description) fmDict.description = body.description;
    if (body.tools) fmDict.tools = body.tools;
    if (effectiveMemory !== "shared") fmDict.memory = effectiveMemory;
    const fmYaml = Object.keys(fmDict).length
      ? Bun.YAML.stringify(fmDict).trim()
      : "";
    const fmBlock = `---\n${fmYaml}\n---\n\n`;

    const contentLines = [
      `# ${name}`,
      "",
      "## 角色定义",
      `你是 **${name}**。${body.description || "一个独特的 Agent 人格。"}`,
      "",
      "## 性格特征",
      "（请在此处描述人格的性格特征、说话风格、行为模式等）",
      "",
      "## 说话风格",
      "（请在此处描述人格的语言风格、常用词汇、语气特点等）",
      "",
    ];
    const fullContent = fmBlock + contentLines.join("\n");
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    writeTextAtomically(filepath, fullContent);

    if (effectiveMemory === "persona") {
      const personaId = path.basename(filepath, ".md");
      const memoryPath = path.join(personasDir(), `memory_${personaId}.yaml`);
      if (!fs.existsSync(memoryPath)) writeTextAtomically(memoryPath, "{}\n");
    }

    invalidatePromptCache();
    return c.json(
      {
        status: "created",
        file: filename,
        memory_mode: effectiveMemory,
        tools: body.tools || "(全部)",
      },
      201,
    );
  });

  app.delete("/api/personas/:file", (c) => {
    const file = c.req.param("file");
    if (!file || file === "SOUL.md") {
      return c.json({ detail: "内置默认人格不可删除" }, 400);
    }
    if (!PERSONA_FILENAME_RE.test(file)) {
      return c.json({ detail: "非法的人格文件名" }, 400);
    }
    try {
      const filePath = file === "SOUL.md" ? path.join(personasDir(), file) : getPersonaVariantPath(file);
      if (!fs.existsSync(filePath)) return c.json({ detail: `人格文件不存在: ${file}` }, 404);

      const wasActive = getActivePersonaFile() === file;
      fs.unlinkSync(filePath);
      // 清理独立记忆文件
      const personaId = path.basename(filePath, ".md");
      const memoryPath = path.join(personasDir(), `memory_${personaId}.yaml`);
      if (fs.existsSync(memoryPath)) fs.unlinkSync(memoryPath);

      if (wasActive) setActivePersona("SOUL.md");
      invalidatePromptCache();
      return c.json({ status: "deleted", file });
    } catch (err) {
      const e = errorResponse(err);
      if (e.status && e.status !== 500) return c.json({ detail: e.message }, e.status);
      console.error(`[persona] 删除人格 ${file} 失败`, err);
      return c.json({ detail: "删除失败，请检查文件权限" }, 500);
    }
  });

  app.put("/api/personas/:file/rename", async (c) => {
    const file = c.req.param("file");
    const body = (await c.req.json().catch(() => ({}))) as { new_name?: string };
    if (!file || file === "SOUL.md") {
      return c.json({ detail: "内置默认人格不可重命名" }, 400);
    }
    if (!PERSONA_FILENAME_RE.test(file)) {
      return c.json({ detail: "非法的人格文件名" }, 400);
    }
    let newName = (body.new_name ?? "").trim();
    if (!newName) return c.json({ detail: "名称不能为空" }, 400);
    if (!/^[\w\u4e00-\u9fff-]+$/.test(newName)) {
      return c.json({ detail: "名称只能包含字母、数字、中文、下划线和连字符" }, 400);
    }
    newName = newName.replace(/ /g, "_");

    try {
      const src = getPersonaVariantPath(file);
      if (!fs.existsSync(src)) return c.json({ detail: `人格文件不存在: ${file}` }, 404);

      const newFilename = `SOUL.${newName}.md`;
      const dst = path.join(personasDir(), newFilename);
      if (fs.existsSync(dst)) return c.json({ detail: `人格文件已存在: ${newFilename}` }, 409);

      // ACTIVE-FOLLOW-RENAME-001：rename 前记录活跃状态
      const wasActive = getActivePersonaFile() === file;

      // 文件内标题同步更新（# Name）
      const text = fs.readFileSync(src, "utf8");
      const updated = text.replace(/^#\s+.+$/m, `# ${newName}`);
      fs.writeFileSync(src, updated, "utf8");
      fs.renameSync(src, dst);

      // 独立记忆文件跟随重命名
      const oldMemory = path.join(personasDir(), `memory_${path.basename(src, ".md")}.yaml`);
      const newMemory = path.join(personasDir(), `memory_${path.basename(dst, ".md")}.yaml`);
      if (fs.existsSync(oldMemory) && !fs.existsSync(newMemory)) {
        try {
          fs.renameSync(oldMemory, newMemory);
        } catch (err) {
          console.warn(`[persona] 重命名人格记忆文件失败（忽略）: ${String(err)}`);
        }
      }

      if (wasActive) setActivePersona(newFilename);
      invalidatePromptCache();
      return c.json({ status: "renamed", file: newFilename });
    } catch (err) {
      const e = errorResponse(err);
      if (e.status && e.status !== 500) return c.json({ detail: e.message }, e.status);
      console.error(`[persona] 重命名人格 ${file} 失败`, err);
      return c.json({ detail: "重命名失败，请检查文件权限" }, 500);
    }
  });

  app.get("/api/persona/profile", (c) => {
    const soulPath = personaReadPath("SOUL.md");
    const userPath = personaReadPath("USER.md");

    let name = "Maxma";
    let description = "温暖体贴又有点调皮的大姐姐";
    let scene = "吵闹的小公寓，窗外有一条马路";
    let style = "playful · 直接 · 温暖";
    let nickname = "你";

    if (fs.existsSync(soulPath)) {
      const text = fs.readFileSync(soulPath, "utf8");
      const nameMatch = text.match(/^#\s+(.+)$/m);
      if (nameMatch) name = nameMatch[1]!.trim();
      const parts = text.split(/\n#+\s+/);
      if (parts.length > 0) {
        const lines = parts[0]!
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"));
        if (lines.length > 0) description = lines[0]!.slice(0, 50);
      }
      const sceneMatch = text.match(/默认居住在一个(.+?)(?:\n|$)/);
      if (sceneMatch) scene = sceneMatch[1]!.trim();
      const styleHints: string[] = [];
      for (const kw of ["playful", "直接", "温暖", "调皮", "可爱"]) {
        if (text.toLowerCase().includes(kw.toLowerCase())) styleHints.push(kw);
      }
      if (styleHints.length > 0) style = styleHints.slice(0, 3).join(" · ");
    }

    if (fs.existsSync(userPath)) {
      const userText = fs.readFileSync(userPath, "utf8");
      const nn = userText.match(/\*\*称呼\*\*\s*[：:]\s*(.+)/);
      if (nn) {
        const raw = nn[1]!.trim();
        nickname = isTemplatePlaceholder(raw) ? "你" : raw;
      }
    }

    return c.json({
      name,
      description,
      nickname,
      scene,
      style,
      greeting: `${nickname}，你来啦。`,
      avatar: "✦",
    });
  });

  return app;
}
