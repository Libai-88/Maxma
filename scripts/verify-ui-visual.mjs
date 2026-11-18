/**
 * scripts/verify-ui-visual.mjs — 六个关键页面截图存证（美学改动的"看得见"验收）。
 *
 * ## 为什么需要它
 *
 * 2026-11-18 的排版整理把 33 个视图的 125 处任意字号收进六档阶梯，并统一了
 * 动效时长与浮层层级。这类改动**不改变任何契约**：tsc 全绿、307 个后端测试全绿、
 * 六个 verify-ui 脚本全绿，界面依然可能"某处挤了、某处被截断"。
 *
 * 现有的六个 UI 脚本只断言文本与状态（全仓库 `capturePage` 0 命中），看不见"好看不好看"。
 * 这个脚本补上那一格：把 6 个关键页面按固定窗口尺寸截图落盘，并给出每张图的
 * 尺寸与平均亮度，供前后对照与未来的回看。
 *
 * ## 2026-11-18 补：chat-session 之前是**假绿**
 *
 * 早先只 `POST /api/sessions` 建了个空会话就截图，于是 chat-session 与 chat-empty
 * 是同一张图（连字节数都一样）——"有会话的对话页"这条存证实际上什么都没看。
 * 现在先注册一个本地假模型（OpenAI 兼容 SSE），再用 WS 真发三个回合，
 * 让这一页有真实的轮次、步骤与 Markdown 结构可看。
 *
 * ## 用法
 *
 *   bun scripts/verify-ui-visual.mjs                 # 写到 dev_docs/visual/<今天>/
 *   bun scripts/verify-ui-visual.mjs --update-baseline  # 覆盖 dev_docs/visual/baseline/
 *   VISUAL_SEED=0 bun scripts/verify-ui-visual.mjs   # 不灌会话（chat-session 会退回空态）
 *
 * 退出码 0 = 六个页面都截到了图，且没有高等级 console error。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";
import { requireBun } from "./_bun-bin.mjs";

const REPO = path.resolve(import.meta.dir, "..");
const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? 8133);
const STUB_PORT = Number(process.env.VISUAL_STUB_PORT ?? 8135);
const PROVIDER_ID = "visual-stub";
const MODEL_ID = "visual-stub-model";
const base = process.env.BASE ?? `http://127.0.0.1:${BACKEND_PORT}`;

/** 灌会话后给会话起的名字：页头标题应当**就是**它（以前只认 const_name，恒显示 id）。 */
const SEED_NAME = "排版与空态的收口";

/**
 * 截完图之后跑的一段交互（不影响基线图）：打开「更多会话操作」→ 在「会话名称」里
 * 输入新名字 → 点保存 → 读回页头标题。以前会话名的 PUT 路由存在、前端没有入口，
 * 光看截图看不出这条链路通不通，所以用一次真实的点按来验收。
 */
const RENAME_PROBE = `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = document.querySelector('[aria-label="更多会话操作"]');
if (!open) return { ok: false, why: 'no-more-button' };
open.click();
await sleep(600);
const input = document.querySelector('#session-name-input');
if (!input) return { ok: false, why: 'no-name-input' };
const before = (document.querySelector('header h1')?.textContent ?? '').trim();
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
setter.call(input, '重命名自检');
input.dispatchEvent(new Event('input', { bubbles: true }));
await sleep(300);
const save = Array.from(document.querySelectorAll('[role="menu"] button')).find((b) => (b.textContent ?? '').trim() === '保存');
if (!save) return { ok: false, why: 'no-save-button', before };
save.click();
await sleep(1500);
const after = (document.querySelector('header h1')?.textContent ?? '').trim();
return { ok: after === '重命名自检', before, after, draft: input.value };
`;

const updateBaseline = process.argv.includes("--update-baseline");
const stamp = new Date().toISOString().slice(0, 10);
const outDir = updateBaseline
  ? path.join(REPO, "dev_docs", "visual", "baseline")
  : path.join(REPO, "dev_docs", "visual", stamp);

/**
 * 六个页面：空对话、有会话的对话、指标、设置、扩展、外观。
 *
 * `session` 决定驱动在截这一页前怎么处理 localStorage 的会话键：
 * - `true`  = 指向灌好消息的会话（DRIVE_SESSION_ID）；
 * - `"empty"` = 指向一个**刚建的空会话**。不能只删键——会话 store 在没有本地记录时
 *   会"默认续上最近一次对话"（`stores/session.ts` initIfNeeded），删键反而拿到有消息的那条，
 *   两张图就又是一样的。
 */
const PAGES = process.env.VISUAL_PAGES
  ? JSON.parse(process.env.VISUAL_PAGES)
  : [
    { name: "chat-empty", path: "/", session: "empty" },
    { name: "chat-session", path: "/", session: true, probeAfter: RENAME_PROBE },
    { name: "metrics", path: "/metrics" },
    { name: "settings", path: "/settings" },
    { name: "extensions", path: "/extensions" },
    { name: "appearance", path: "/appearance" },
  ];

/**
 * 截图用的三个回合：问题与回答都写成人话，并带 Markdown 结构（标题/列表/行内代码），
 * 这样"有会话的对话页"才真的看得出排版：气泡、执行步骤、回答卡与代码行。
 */
const SEED_ROUNDS = [
  {
    ask: "帮我看下指标页的空态，现在只有一行「无数据」，太光了",
    reply: [
      "「无数据」这三个字承担不了空态——它只说明**这里空**，没说**为什么空**、**能做什么**。",
      "",
      "拆成三句话就够：",
      "",
      "1. 说清对象：这片区域统计的是 `HTTP 请求`，还是 `工具调用`；",
      "2. 说清原因：还没开始跑、已经跑过但没有样本、或者采样窗口为空；",
      "3. 给出下一步：一个能点的动作，比如「刷新」或「发起一次对话」。",
      "",
      "```tsx",
      "<EmptyState title=\"还没有请求样本\" hint=\"发起一次对话后再回来看\" action={{ label: \"刷新\", onClick: reload }} />",
      "```",
    ].join("\n"),
  },
  {
    ask: "字号也顺手统一一下，我看有的地方 13px 有的 14px",
    reply: [
      "已经统一过了，现在全站只有六级：`caption 11` / `meta 12` / `ui 13` / `body 14` / `subtitle 16` / `display 22`。",
      "",
      "如果你还看到参差，多半是这三类：",
      "",
      "- **行内数字**用了 `tabular-nums` 但字号没跟 body；",
      "- 表格里的次级说明还在用 12.5px 这类半像素档；",
      "- 自绘卡片里写了 `text-[13px]` 这种任意值。",
      "",
      "跑一次 `node scripts/check-type-scale.mjs`，它会把这些逐条点名。",
    ].join("\n"),
  },
  {
    ask: "好，那就按这个来。先记一笔，别又改回去了",
    reply: [
      "记好了，落在三个地方，不靠人记：",
      "",
      "- `web/scripts/check-type-scale.mjs`：任意字号与缺时长的 `transition` 直接红；",
      "- `scripts/check-contrast.mjs`：次要文字的对比度按 WCAG 算比值，不靠目测；",
      "- `scripts/verify-ui-visual.mjs`：六页截图存证，观感回退能一眼看出来。",
      "",
      "守卫红的时候改 token，不要改守卫——这条也写进 `dev_docs/design-system.md` 了。",
    ].join("\n"),
  },
];

let backend = null;
let stub = null;
let dataDir = process.env.MAXMA_DATA_DIR ?? "";
const failures = [];

/** 假 OpenAI 兼容服务：按第几次请求回不同正文，让三个回合各不相同。 */
function startStub() {
  let hits = 0;
  return Bun.serve({
    port: STUB_PORT,
    async fetch(req) {
      const pathname = new URL(req.url).pathname;
      if (pathname.endsWith("/models")) {
        return Response.json({ object: "list", data: [{ id: MODEL_ID, object: "model" }] });
      }
      if (!pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 });
      const answer = SEED_ROUNDS[Math.min(hits, SEED_ROUNDS.length - 1)].reply;
      hits += 1;
      const usage = { prompt_tokens: 24, completion_tokens: [...answer].length, total_tokens: 0 };
      usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
      const chunk = (p) => `data: ${JSON.stringify(p)}\n\n`;
      const deltas = [...answer].map((t) =>
        chunk({ id: "c1", object: "chat.completion.chunk", model: MODEL_ID, choices: [{ index: 0, delta: { content: t } }] }),
      );
      const tail = chunk({
        id: "c1", object: "chat.completion.chunk", model: MODEL_ID,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage,
      });
      return new Response(new Blob([...deltas, tail, "data: [DONE]\n\n"]).stream(), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
}

/** 用 WS 真发一个回合，等 done / error；超时就当失败，不静默继续。 */
async function sendRound(sessionId, message, token) {
  const ws = new WebSocket(base.replace(/^http/, "ws") + `/ws/chat/${sessionId}`, [token]);
  const settled = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close(); } catch { /* 已关 */ } reject(new Error("回合超时")); }, 60_000);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "chat", payload: { message, provider_id: PROVIDER_ID, model_name: MODEL_ID } }));
    }, { once: true });
    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.type === "done" || msg.type === "error") {
        clearTimeout(timer);
        try { ws.close(); } catch { /* 已关 */ }
        resolve(msg.type);
      }
    });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("WS 连接失败")); }, { once: true });
  });
  return settled;
}

async function waitHealth(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + "/api/health");
      if (r.ok) return true;
    } catch { /* 未就绪 */ }
    await Bun.sleep(400);
  }
  return false;
}

try {
  if (!process.env.BASE) {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-uivisual-"));
    backend = spawn(requireBun({ root: REPO, what: "界面截图存证" }), ["run", path.join(REPO, "bun-backend", "src", "server.ts")], {
      cwd: path.join(REPO, "bun-backend"),
      env: {
        ...process.env,
        MAXMA_DATA_DIR: dataDir,
        MAXMA_BUNDLE_DIR: REPO,
        MAXMA_EXE_DIR: REPO,
        MAXMA_BUN_PORT: String(BACKEND_PORT),
        MAXMA_API_PORT: String(BACKEND_PORT),
        MAXMA_BUN_HOST: "127.0.0.1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  if (!(await waitHealth())) throw new Error(`后端未就绪（${base}）`);
  console.log(`后端就绪：${base}`);

  const tokenProbe = await fetch(base + "/api/auth/token").catch(() => null);
  if (!tokenProbe?.ok) {
    throw new Error(`端口 ${BACKEND_PORT} 上已有别的进程在监听（很可能是上一轮残留的后端），请先结束它或换 BACKEND_PORT。`);
  }
  const token = (await (await fetch(base + "/api/auth/token")).json()).token;
  const H = { "x-maxma-token": token, "content-type": "application/json" };

  await fetch(base + "/api/onboarding/state", {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ completed: true, preferences: { displayName: "验证用", language: "zh-CN", workspace: "personal" } }),
  });

  const sessRes = await fetch(base + "/api/sessions", { method: "POST", headers: H });
  const sessBody = await sessRes.json().catch(() => ({}));
  const sessionId = sessBody.session_id ?? "";
  if (!sessionId) failures.push("建新会话失败：截图里的对话页会停在空态");

  // 空态页要一个**独立的新会话**：会话 store 在没有本地记录时会自动续上最近一次对话，
  // 所以"删掉 localStorage 键"并不能得到空态（这一版真踩过：两张图字节数完全相同）。
  let emptySessionId = "";
  const emptyRes = await fetch(base + "/api/sessions", { method: "POST", headers: H });
  const emptyBody = await emptyRes.json().catch(() => ({}));
  emptySessionId = emptyBody.session_id ?? "";

  // 灌会话：只对**本脚本自己起的**后端做（`BASE` 指向别人的实例时不动人家的数据）。
  // 没有这一步，"chat-session" 那张图和空态一模一样——存证等于没做。
  const seedEnabled = process.env.VISUAL_SEED !== "0" && !process.env.BASE && !!sessionId;
  if (seedEnabled) {
    try {
      stub = startStub();
      const reg = await fetch(base + "/api/providers", {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          id: PROVIDER_ID,
          label: "截图用本地假模型",
          base_url: `http://127.0.0.1:${STUB_PORT}/v1`,
          provider_type: "openai-completions",
          api_key: "stub-key",
          models: [MODEL_ID],
          enabled: true,
        }),
      });
      if (!reg.ok) throw new Error(`注册假模型渠道失败 HTTP ${reg.status}`);
      for (const round of SEED_ROUNDS) {
        const state = await sendRound(sessionId, round.ask, token);
        if (state !== "done") throw new Error(`回合未正常结束：${state}（${round.ask.slice(0, 12)}…）`);
      }
      // 回读一次，确认消息真的落进会话（否则截图只会拍到一个"正在输入"）。
      const msgs = await fetch(`${base}/api/sessions/${sessionId}/messages?limit=50`, { headers: H });
      const body = await msgs.json().catch(() => ({}));
      const count = Array.isArray(body.messages) ? body.messages.length : 0;
      if (count < SEED_ROUNDS.length * 2) {
        failures.push(`灌会话只落 ${count} 条消息（期望 ≥ ${SEED_ROUNDS.length * 2}）`);
      } else {
        console.log(`会话已灌入 ${count} 条消息（${SEED_ROUNDS.length} 个回合）`);
      }
      // 会话没有名字时标题会退化成「会话 <id 前 8 位>」，截图里不好看也不好认。
      await fetch(`${base}/api/sessions/${sessionId}/name`, {
        method: "PUT",
        headers: H,
        body: JSON.stringify({ name: SEED_NAME }),
      }).catch(() => null);
    } catch (err) {
      failures.push(`灌会话失败：${err?.message ?? err}`);
    }
  } else if (!process.env.BASE) {
    console.log("VISUAL_SEED=0：不灌会话，chat-session 会是空态");
  }

  const driverPath = path.join(REPO, "scripts", "_ui-visual-driver.cjs");
  if (!fs.existsSync(driverPath)) throw new Error(`缺少截图驱动脚本：${driverPath}`);

  const driverEnv = {
    ...process.env,
    DRIVE_BASE: base,
    DRIVE_OUT: outDir,
    DRIVE_SESSION_ID: sessionId,
    DRIVE_EMPTY_SESSION_ID: emptySessionId,
    DRIVE_PAGES: JSON.stringify(PAGES),
    DRIVE_THEME: process.env.VISUAL_THEME ?? "",
    DRIVE_DENSITY: process.env.VISUAL_DENSITY ?? "",
  };
  delete driverEnv.ELECTRON_RUN_AS_NODE;
  delete driverEnv.ELECTRON_NO_ATTACH_CONSOLE;

  const driver = spawn(path.join(REPO, "desktop", "node_modules", "electron", "dist", "electron.exe"), [driverPath], {
    env: driverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  driver.stdout.on("data", (c) => { out += String(c); });
  driver.stderr.on("data", (c) => { out += String(c); });

  const code = await new Promise((res) => {
    const timer = setTimeout(() => { try { driver.kill(); } catch { /* */ } res(-1); }, Number(process.env.UI_TIMEOUT_MS ?? 240_000));
    driver.on("exit", (c) => { clearTimeout(timer); res(c ?? -1); });
  });

  const line = out.split("\n").find((l) => l.includes("VISUAL_RESULT "));
  const result = line ? JSON.parse(line.slice(line.indexOf("VISUAL_RESULT ") + "VISUAL_RESULT ".length)) : null;

  if (!result) throw new Error(`驱动没有返回结果（exit ${code}）：\n${out.slice(-600)}`);
  if (result.stage !== "done") throw new Error(`截图失败：${result.error ?? "unknown"}`);

  console.log(`\n截图目录：${path.relative(REPO, outDir)}`);
  // 窗口尺寸是 DIP，截图是物理像素：Windows 150% 缩放时 1280×800 会变成 1920×1203。
  // 所以按「宽高比 + 一页渲染出文字」判定，而不是钉死像素。
  for (const r of result.results) {
    const ratio = r.width / r.height;
    console.log(`  ${r.name.padEnd(14)} ${r.width}x${r.height}  ${(r.bytes / 1024).toFixed(1)}KB  luma ${r.meanLuma}  轮次 ${r.turns ?? "-"}  页头 ${JSON.stringify(r.header ?? "")}  路由 ${r.landed}  文字 ${String(r.text ?? "").slice(0, 40)}`);
    if (r.landed !== r.path) failures.push(`${r.name} 没有落到 ${r.path}（实际 ${r.landed}）`);
    if (ratio < 1.5 || ratio > 1.65) failures.push(`${r.name} 宽高比异常：${r.width}x${r.height}（1280×800 经 DPI 缩放应约为 1.6）`);
    if (r.meanLuma < 4 || r.meanLuma > 250) failures.push(`${r.name} 平均亮度异常：${r.meanLuma}（页面可能是空白或全黑）`);
    if (!r.text || r.text.length < 12) failures.push(`${r.name} 页面上几乎没有文字：${r.text ?? ""}`);
    // 这两页都挂在 "/"，唯一的区别是有没有会话内容：只靠亮度和文字长度判不出来
    //（这一版真出过两张图字节数完全相同）。所以直接按轮次数断言，堵住"假绿"。
    // 注意 `article` 是**一个回合一个**（用户气泡 + 回答在同一块里），
    // 灌 3 个回合就该有 3 个轮次，不是 6。
    if (r.name === "chat-session" && !(r.turns >= SEED_ROUNDS.length)) {
      failures.push(`chat-session 只有 ${r.turns ?? 0} 个轮次（期望 ≥ ${SEED_ROUNDS.length}，多半是灌会话没生效）`);
    }
    if (r.name === "chat-empty" && r.turns !== 0) {
      failures.push(`chat-empty 出现了 ${r.turns} 个轮次（期望 0，空态页拿错会话了）`);
    }
    // 标题链路（name → 首条消息 → id）的端到端证据：页头必须等于灌会话时起的名字。
    // 以前这里恒为「会话 <id 前 8 位>」，因为后端没暴露 name、页头也不读它。
    if (seedEnabled && r.name === "chat-session" && r.header !== SEED_NAME) {
      failures.push(`chat-session 页头是「${r.header ?? ""}」，期望「${SEED_NAME}」（会话名没传到界面）`);
    }
    // 空会话不该顶着「会话 <id>」的标题：没有内容就叫「新会话」。
    if (seedEnabled && r.name === "chat-empty" && r.header !== "新会话") {
      failures.push(`chat-empty 页头是「${r.header ?? ""}」，期望「新会话」`);
    }
    // 重命名入口：截图之后再点一次真实的保存，读回页头。
    if (seedEnabled && r.name === "chat-session" && r.extra?.ok !== true) {
      failures.push(`重命名入口未生效：${JSON.stringify(r.extra)}`);
    }
  }

  // 截图过程中的 console error 是产品缺陷，不是脚本噪声：这类页面不该报错。
  const errors = (result.consoleErrors ?? []).filter((m) => !/favicon|Failed to fetch|WebSocket/i.test(m));
  if (errors.length) failures.push(`页面 console error ${errors.length} 条：${errors.slice(0, 3).join(" | ")}`);

  if (code !== 0) failures.push(`驱动退出码 ${code}`);

  if (failures.length) {
    console.error("\n失败：");
    for (const f of failures) console.error("  ✗ " + f);
    process.exit(1);
  }
  console.log(`\n✓ ${result.results.length} 个页面均已截图（尺寸/亮度正常，无高等级 console error）`);
  process.exit(0);
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
} finally {
  if (backend) {
    try { backend.kill(); } catch { /* */ }
  }
  // 临时数据目录不删：截图失败时它是最直接的现场。
}
