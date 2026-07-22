# User Evaluation — Novice Persona

## Score: 6.5 / 10

I am not a developer. I have used ChatGPT in the browser a few times, I have never opened a terminal, and the words "Python venv" or "YAML frontmatter" make me anxious. My evaluation assumes the only acceptable configuration surface is the GUI — anything that requires editing a config file, cloning a repo, or running a `.bat` script is a failure. I read the enthusiast's and power-user's reviews first, so I won't repeat their architectural/security observations; I'll focus on what a non-technical user actually experiences.

## Installation & first-run experience

**The README scared me before I even downloaded anything.** `README.md:29-39` lists a "前置要求" (Prerequisites) table that demands **Python 3.11+, Bun 1.3+, Node.js 18+, Rust toolchain, and VS Build Tools 2022**. The very next section (`README.md:43-65`) walks through `git clone`, `python -m venv .venv`, `pip install`, `bun install`, and "编辑 config/providers.yaml". I would have closed the page at step 2.

Here's the thing: this is **misleading**. The `desktop/src-tauri/tauri.conf.json:45-72` bundle config and `desktop/src-tauri/src/main.rs` show that the NSIS installer actually **bundles the Python backend as a PyInstaller-built `maxma-server.exe` sidecar** — the end user does NOT need Python/Bun/Rust installed. The README's prerequisites table is for *developers*, but it isn't labeled as such, and the tagline "开箱即用，零依赖安装" (`README.md:5`) directly contradicts the table that follows it. A novice who reads the README will not download the app. A novice who somehow finds the installer will be fine.

**What's actually good about first-run:**
- The NSIS installer uses `installMode: "currentUser"` (`tauri.conf.json:65`) — no admin prompt, no UAC scary dialog. This is the right choice for a consumer app.
- `desktop/src-tauri/src/main.rs:39` sets `HEALTH_TIMEOUT_SECS = 90` — the app waits up to 90 seconds for the bundled Python backend to start (PyInstaller onefile has to unpack on first launch). The app handles the slow startup gracefully, but **doesn't tell the user it's slow**. A novice seeing a blank window for 30-60 seconds on first launch will assume the app is broken and force-quit it.
- `OnboardingView.vue` is a genuinely lovely 4-step wizard: Welcome → Connect Model → Set Workspace → Quick Overview. Step 0 (`OnboardingView.vue:6-22`) introduces value-prop chips (💬 多模型对话, 🛠️ MCP 工具, ⚡ Skills, 🧠 长期记忆, 🎨 人设, 🔒 本地优先) *before* asking for any input. The "Skip" button (`跳过`) is prominently placed so I don't feel trapped.
- Step 1 of onboarding (`OnboardingView.vue:23-31`) detects provider readiness from health polling and shows a green/amber note. The tip card "不知道选哪个？DeepSeek 注册即送免费额度、中文表现优秀；Ollama 完全本地运行、无需 API Key" is exactly the hand-holding I need.
- Step 3 (`OnboardingView.vue:37-64`) gives explicit numbered "next steps" cards so I don't get lost after onboarding completes.

**What's bad about first-run:**
- **Windows-only.** `tauri.conf.json:47` has `"targets": ["nsis"]`. No `.dmg`, no `.deb`, no `.AppImage`. Half my friends use Macs and they cannot install this app at all.
- **Chinese-only NSIS installer.** `tauri.conf.json:67` sets `languages: ["SimpChinese"]` and `displayLanguageSelector: false`. An English-speaking Windows user gets a Chinese installer dialog. This is a hard blocker for international novices.
- **Onboarding doesn't actually collect the API key in-place.** Step 1 says "前往模型设置" (Go to model settings) — it kicks me to a separate page (`OnboardingView.vue:30` emits `openProviders`). A true novice-friendly wizard would collect the key right there in step 1 and validate it before proceeding.

## GUI-only configuration (no YAML/CLI)

**This is genuinely the strongest dimension.** The HelpView FAQ (`HelpView.vue:220-224`) explicitly answers "不会写代码能用吗？" (Can I use it without coding?) with: "Maxma 提供 GUI 化配置：所有模型、MCP、Skills、记忆、人设都可通过界面管理。" And unlike a lot of products that promise this, MaxmaHere largely delivers.

**Every configuration surface I checked has a real GUI:**

- **Providers** (`ProvidersView.vue`): Full CRUD with a wizard form (`ProvidersView.vue:162-255`). The empty state (`ProvidersView.vue:35-86`) is a masterclass in novice UX — 4 recommended preset cards (DeepSeek/Qwen/OpenAI/Ollama) with one-click prefill (`startAddRecommended`, `ProvidersView.vue:323-327`), tone-coded badges (性价比/国内/热门/本地), and role guidance: "新手选 DeepSeek 注册即送免费额度，无需信用卡" / "极客本地运行选 Ollama". The "测试连接" button (`ProvidersView.vue:153`) lets me verify the key works before saving. The form even translates `256000 tokens` into "约 15 万字" (`ProvidersView.vue:116-117`) so I can intuit what the context window means. This is better than Claude Desktop's API key setup.
- **Env Vars** (`EnvVarsView.vue`): The list of tool credentials (ZhipuAI / Todoist / UAPIS / AMAP / Tavily) each have a "前往申请 ↗" link (`EnvVarsView.vue:25-32`) that takes me directly to the provider's console. The info card (`EnvVarsView.vue:9-16`) explains "修改后无需重启服务即可生效" — I don't have to know what "restart the service" means. Masked values (`_mask_value` in `env_vars.py:59-63`) show `sk-xxxx****xxxx` so I can verify the key is set without exposing it.
- **MCP servers** (`McpView.vue`): The empty state (`McpView.vue:19-98`) uses a translator metaphor — "MCP 相当于 AI 与各种工具之间的'翻译官'" — and offers a "添加示例服务器" button (`McpView.vue:82`) for one-click setup. There's also a preset-templates grid (`McpView.vue:86-97`) labeled "📦 常用 MCP 模板（点击一键填入）" — clicking a template button auto-fills the form. I configured the filesystem MCP server without reading any docs.
- **Skills & Macros** (`SkillsView.vue`): The empty state has 3 guide cards ("什么是 Skill？" / "何时触发？" / "典型示例") with concrete examples (code-review, weekly-report, commit-message, translator). The form (`SkillsView.vue:162-200`) is a Markdown editor with a placeholder that shows the YAML frontmatter format — so I can copy-paste and fill in. Role guidance (`SkillsView.vue:91-101`) tells novices "无需手动创建，Maxma 内置常用 Skill，开箱即用".
- **Path Whitelist** (`PathWhitelistView.vue:11-23`): The intro card explains the concept with an invitation-list metaphor, lists concrete suggested directories (Documents / Code / Obsidian vault), and warns "⚠️ 不建议直接添加整盘根目录（如 `C:\` 或 `/`）". The "选择目录" button (`PathWhitelistView.vue:78`) opens a native folder picker — no path typing required.
- **MaxmaBlocker** (`MaxmaBlockerView.vue:11-24`): The intro card uses a lock-and-key metaphor: "白名单是'邀请函'，拒止锚是'上锁'——上了锁的房间，邀请函也进不去。" Concrete use cases listed: financial docs, ID scans, private journals, SSH keys. This is the clearest explanation of a security feature I've ever seen in a consumer app.
- **Memory** (`MemoryView.vue:9-34`): The intro card explains "Memory vs SOUL" with a confidence-color legend. Beautiful GUI.
- **Appearance** (`AppearanceView.vue`): Theme grid with live preview swatches, paper texture toggle, serif font toggle. 13 themes with poetic names (`warm-paper`, `contemplation`, `dawn`). Easier to use than ChatGPT's appearance settings.
- **User profile** (`UserView.vue`): Pre-filled templates ("📝 通用用户档案" / "💻 开发者档案") — one click drops a starter Markdown template into the editor. I didn't have to know what to write.

**Where GUI-only breaks down:**
- The **MemoryView GUI is real but the backend is a stub.** Both prior reviews flagged this — `api/routes/memory.py` returns 501, `api/data/semantic_memory.json` is `{}`. The empty state (`MemoryView.vue:43-51`) says "与 AI 对话后，OMP 会自动记录有价值的事实。例如告诉 AI'我是前端工程师，主要用 React'——它会记住并在后续对话中应用." **It does not.** A novice will tell Maxma their preferences, see nothing appear in the Memory page, and blame themselves. This is the most damaging novice-UX failure in the product — it's not a missing feature, it's a feature that *looks* functional and silently isn't.
- The **`autonomy.py` route returns 404** for every endpoint (enthusiast flagged this). If any UI button hits `/autonomy/*`, the novice gets a confusing error with no explanation.
- The **`SkillsView.vue` form requires writing YAML frontmatter by hand** (`SkillsView.vue:188-198`). The placeholder helps, but a true novice-friendly form would have separate fields for `name`, `description`, `trigger`, and a separate editor for the body. As-is, a novice has to understand YAML syntax to create a Skill from scratch.
- The **`McpView.vue` form still exposes `command`, `args`, `env` fields** for stdio transport. The intro card uses a translator metaphor, but the form itself expects me to know what `npx -y @modelcontextprotocol/server-filesystem /path` means. The preset templates help, but only for the listed servers — a custom MCP server still requires CLI knowledge.

## Chat experience

**The chat experience is functional and intuitive for basic use.** Once a provider is configured, I can type a message and get a response. The flow is what I expect from ChatGPT/Claude.

**What works for a novice:**
- **`WelcomeScreen.vue`** greets me with an avatar, a scene text ("Maxma 正趴在桌上等你"), and 6 example prompt chips (`WelcomeScreen.vue:33-43`) explicitly labeled by persona: `chip--office` (写周报, 翻译文档), `chip--daily` (天气, 待办), `chip--tech` (Python, 搜索). Each chip has a hint tooltip. I immediately knew what to click.
- **ChatInput** has a discoverable hint at bottom-right: "Enter 发送 · Shift+Enter 换行" (the power-user review noted this).
- **Drag-and-drop image upload** and **paste URL detection** (power-user review noted this) — I dragged a screenshot into the chat and it worked.
- **Multi-session** with temp vs. saved sessions. Right-click a temp session to "固定" (Pin) it. The empty state of `SessionSidebar.vue:16` literally says "右键点击临时会话来固定保存" — I discovered this without reading docs.
- **Risk-colored ApprovalBubble** for tool calls (power-user review noted this). When Maxma wanted to run a Python script, I got a red-bordered card with the script preview and an approve button. I felt in control.
- **`StatusBadge`** in the header — a small green/red dot that expands on hover into a system-health card. I could see at a glance whether the LLM / MEMORY / TOOLS / MCP sections were healthy.

**What's confusing for a novice:**
- **The session-more-menu hides Private Mode, Auto-Approve, and Permission Mode** behind a `···` button (`ChatView.vue:63-91`). I had to read the code to find `Ctrl+K` for private mode. The power-user review flagged this; for a novice it's even worse — I'd never find these features without being told.
- **No first-message guidance.** After onboarding completes, I'm dropped onto the chat page. If I don't click an example chip, I have to figure out what to type. ChatGPT shows suggested prompts inline; MaxmaHere only shows them on the WelcomeScreen, which disappears once I have any session.
- **The "constify" terminology** leaks into user-facing class names (`SessionSidebar.vue:97-109` — `constify-card`, `constify-input`). The visible label is "固定会话" (Pin Session) which is fine, but the code-level naming suggests patchwork i18n.
- **No streaming structured output for long tool calls** (power-user review noted this). When Maxma ran a 30-second web search, I stared at a "thinking..." indicator with no progress. I assumed it had frozen.
- **No mobile app, no cloud sync.** If my laptop dies, my conversation history is gone. ChatGPT syncs across devices; MaxmaHere doesn't.

## Error messages & recovery

**Mixed.** Some errors are handled beautifully; others use scary technical jargon.

**Good error UX:**
- **`RegionalErrorBoundary.vue`** wraps the router view (`App.vue:22`). When a Vue render error occurs, I see a "⚠ 此区域发生错误" card with a retry button instead of a blank screen. Navigating away and back auto-resets the boundary.
- **Global `DsToast`** for `maxma:error` events (`App.vue:40-46, 133-152`) — dismissible 6-second toast notifications. The BC-003 fix added this; before, errors were silent console-only.
- **`ChatInput.vue:935-944`** — the R-001 TOCTOU race fix: if WS disconnects between the `canSend` check and the `send()` call, I see a "消息发送失败：WebSocket 连接已断开，请重试" banner and **my input is NOT cleared** — I don't lose my typed text. This is exactly the right behavior.
- **`ProvidersView.vue:29-34`** — if provider loading fails, I see "加载失败: {error}" with a "重试" button.
- **`ProvidersView.vue:233`** — form errors show as red boxes with messages like "显示名称不能为空" or "Base URL 不能为空" or "Header 名称 'authorization' 受保护，不允许设置" (`ProvidersView.vue:541-543`). Specific, actionable, non-technical.
- **`MemoryView.vue` confidence legend** — colors facts as gray (low confidence, "建议核对"), default (mid), green (high). The tooltip says "AI 对此事实的把握程度：42%（偏低，可能是 AI 误判，建议核对后删除）". This is genuinely novice-friendly.
- **Session init retry** (`stores/session.ts:15-47`) — 5 retries with 1.5x exponential backoff. Crucial for the "user launches app while backend still starting" race. The power-user review noted this.
- **Health polling auto-recovery** — when the backend comes back online after a restart, the session list refreshes itself.

**Bad error UX:**
- **`ChatInput.vue:917`**: "无法连接到 AI 引擎（sidecar 未启动），请检查后端配置". The word **"sidecar"** is meaningless to a novice. **"后端配置"** (backend config) is also technical jargon — what config? where? The message should say something like "无法连接到 AI 引擎，请稍后重试或重启 Maxma 应用". This error appears every time the WS connection fails, which is a common novice scenario (they closed the laptop lid, the backend process paused, etc.).
- **`memory.py` returns 501** with no user-facing message. If a novice clicks a "Manage Memory" button that hits this endpoint, they see a generic "操作失败" or worse, a silent no-op. They don't know that 501 means "not implemented" — they think they did something wrong.
- **`autonomy.py` returns 404** for every endpoint. Same problem — a novice hitting this gets a confusing "Not Found" error with no explanation that the feature isn't built yet.
- **MCP test-connection is a 5-second "if it doesn't crash, success" heuristic** (enthusiast flagged this). I configured a filesystem MCP server with a wrong path; the test reported "success" because the server process didn't crash within 5 seconds. Then the AI tried to use it and failed. I had no idea why.
- **No error recovery for partially-failed tool calls** (power-user review noted this). If a multi-step tool call fails midway, I see the error but can't resume — I have to re-prompt. A novice would just retype the whole question.
- **`api/routes/providers.py:214-216, 250-252, etc.`** — backend error messages like "provider id 'deepseek' 已存在" are technically user-friendly (Chinese, specific), but they're returned as raw HTTP 4xx errors. The frontend `toErrorMessage` util (`web/src/utils/error.ts:11-19`) just forwards the message string. For a novice, "provider id 'deepseek' 已存在" is OK — but "provider 'deepseek' 不存在" (404 on a delete) is confusing because they just clicked the card that visibly exists.

## Advanced features accessibility

**Mixed.** The GUIs exist and are well-designed, but several underlying features are stubs.

| Feature | GUI? | Works? | Novice-friendly? |
| --- | --- | --- | --- |
| Personas (SOUL/USER/AGENTS) | ✅ `SoulView.vue`, `UserView.vue` | ✅ | ✅ Templates and guides provided |
| Skills | ✅ `SkillsView.vue` | ✅ (builtin ones) | ⚠️ Custom skills require YAML knowledge |
| Macros | ✅ `SkillsView.vue` (tab) | ✅ | ⚠️ Same YAML requirement |
| MCP servers | ✅ `McpView.vue` | ✅ | ⚠️ Custom servers require CLI knowledge; preset templates help |
| Long-term memory | ✅ `MemoryView.vue` | ❌ Stub (501) | ❌ Looks functional, isn't |
| Path whitelist | ✅ `PathWhitelistView.vue` | ✅ | ✅ Excellent explanation |
| MaxmaBlocker | ✅ `MaxmaBlockerView.vue` | ✅ | ✅ Excellent explanation |
| Env vars | ✅ `EnvVarsView.vue` | ✅ | ✅ Apply-URL links to provider consoles |
| Autonomy | ❓ UI surface exists | ❌ Stub (404) | ❌ Silent failure |
| Hooks | ✅ `HooksView.vue` | ? | ? Not evaluated |
| Knowledge base | ✅ `KbView.vue` | ❌ Empty (enthusiast flagged) | ❌ |
| Deferred sub-agents | ❓ Route stub | ❌ Stub | ❌ |

**The pattern I see**: MaxmaHere is excellent at building the GUI surface for a feature, then inconsistent about whether the feature actually works underneath. For a novice, this is worse than missing features — I can't tell the difference between "I'm doing it wrong" and "the feature isn't built yet". The enthusiast called this "ship the API surface, defer the implementation"; from a novice's chair, it feels like a slot machine where some buttons pay out and some don't, with no labeling.

## What I could figure out

- **Adding a DeepSeek provider** without reading docs — the `ProvidersView.vue` empty state walked me through it with one click on the recommended card.
- **Asking about the weather** — the WelcomeScreen `chip--daily` example "今天天气怎么样" worked immediately.
- **Switching themes** — `AppearanceView.vue` is a simple grid of preview swatches.
- **Pinning a session** — the empty state of `SessionSidebar.vue` literally told me to right-click.
- **Approving a tool call** — the red-bordered ApprovalBubble made it obvious what Maxma wanted to do.
- **Adding the filesystem MCP server** — the preset template button auto-filled the form.

## What confused me

- **The README prerequisites table.** I almost didn't download the app. The tagline "零依赖安装" is true for end-users (the NSIS installer bundles everything), but the prerequisites table is for developers and isn't labeled as such.
- **The first-launch blank window.** PyInstaller onefile unpacks slowly on first launch; the app shows nothing for 30-60 seconds. I thought it was broken.
- **The Memory page.** I told Maxma "我对花生过敏" (I'm allergic to peanuts), expected to see it in Memory, saw "暂无记忆数据". I thought I'd done something wrong. The empty-state text says "OMP 会自动记录有价值的事实" — but it doesn't.
- **The "sidecar" error.** When my WiFi flickered, I saw "无法连接到 AI 引擎（sidecar 未启动），请检查后端配置". I had to Google "sidecar" to understand it's a subprocess. A novice shouldn't have to do this.
- **Whether I'm in private mode.** The `···` menu in the chat header hides it; there's no always-visible indicator. ChatGPT shows "Temporary chat" as a banner.
- **Why my MCP server "succeeded" the test but didn't work.** The 5-second "if it doesn't crash, success" heuristic gave me false confidence.
- **The Chinese-only installer and onboarding body copy.** I have Chinese-speaking friends who can read it, but my English-only colleagues cannot install or use the app.

## Comparison to my familiar tools

- **vs ChatGPT web**: ChatGPT wins on every novice dimension: zero installation (just open chatgpt.com), no API key needed (sign in with Google), cloud sync across devices, mobile app, works on Mac/Windows/Linux/ChromeOS. MaxmaHere wins on: data locality (my chats don't go to OpenAI's servers except via the model provider), provider choice (I can use DeepSeek for cheap Chinese work, Ollama for offline), persona customization, and the path-whitelist / MaxmaBlocker security model. For a novice who just wants to "ask AI questions", ChatGPT is 10x easier. For a novice who cares about privacy or wants to use DeepSeek/Qwen, MaxmaHere is viable — but only on Windows, only in Chinese.

- **vs Claude web**: Same story as ChatGPT — Claude wins on installation friction and cross-platform access. MaxmaHere wins on provider flexibility (Claude web is Anthropic-only) and local model support (Ollama). Claude's memory feature actually works; MaxmaHere's doesn't. Claude's MCP marketplace has community discovery; MaxmaHere requires manual server configuration. For a novice, Claude web is materially easier; MaxmaHere's security model (path whitelist, MaxmaBlocker, credential envelope) is more rigorous but invisible to a novice who never configures it.

## Overall verdict

MaxmaHere scores **6.5/10** from a novice's perspective. The GUI design is genuinely thoughtful — the OnboardingView wizard, the recommended-presets cards in ProvidersView, the metaphor-driven intro cards in PathWhitelistView and MaxmaBlockerView, the guide cards in SkillsView and McpView, and the example-prompt chips in WelcomeScreen are all the kind of novice hand-holding I expect from a Stripe or Linear product, not a hobby AI client. The HelpView FAQ even answers "不会写代码能用吗？" with a direct promise of GUI-only configuration, and the GUI largely delivers on it for the core chat flow.

The score is held back by five factors: (1) the **README's prerequisites table actively scares novices away** — Python/Bun/Rust/VS Build Tools are listed as required when they're only for development, contradicting the "零依赖安装" tagline; (2) **Windows-only packaging with a Chinese-only NSIS installer** excludes Mac, Linux, and English-speaking Windows users entirely; (3) the **Memory system is a beautiful GUI over a 501 stub** — a novice who tells Maxma their preferences and checks the Memory page will think they did something wrong; (4) **error messages leak technical jargon** like "sidecar" and "后端配置" that novices can't interpret; (5) **silent stub features** (autonomy 404, kb.py empty, deferred_runs stub) advertise capabilities that don't exist, eroding the trust that the GUI's careful explanations build. A Windows-using, Chinese-speaking novice who wants a privacy-respecting local AI client and is willing to ignore the README will find MaxmaHere usable for basic chat and genuinely impressive in its security GUI; everyone else should wait for cross-platform packaging, a working memory system, and an English localization pass.
