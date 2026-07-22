# User Evaluation — Power-User Persona (Senior Office Worker)

## Score: 7.2 / 10

## Aesthetics & visual design

This is genuinely the strongest dimension of MaxmaHere, and the one where I most disagreed with the enthusiast's framing. The enthusiast called the frontend "competent but not innovative" — but from an office-worker's chair, the design system is more thoughtful than most consumer AI apps I've used.

**What's genuinely well-crafted:**

- **Thirteen themes that feel curated, not generated** (`web/src/composables/useTheme.ts:34-133`). The names alone tell you someone with taste picked them: `warm-paper` (和纸手抄本), `contemplation` (灰蓝调，雨天窗外), `coral` (墨蓝 + 珊瑚朱), `dawn` (粉桃奶黄渐变，清晨薄雾), `grass-aroma` (青草绿调，清晨露水). Each has a `description` field with poetic intent. Claude Desktop has light/dark — that's it. ChatGPT Desktop has three. MaxmaHere ships thirteen with preview swatches in `AppearanceView.vue`.
- **Paper texture system** (`web/src/assets/styles/tokens.css:89-93`) overlays a subtle SVG `feTurbulence` noise filter at 8% opacity on cards/backgrounds, toggleable from Appearance settings. On `warm-paper` it genuinely feels like writing on washi paper. Notion AI and ChatGPT feel sterile by comparison.
- **Real design tokens, not just CSS variables** (`tokens.css`): 4px spacing grid, five-step font scale (`--fs-title` / `--fs-body` / `--fs-ui` / `--fs-caption` / `--fs-hint`), three-tier animation duration (`--duration-instant` 0.1s / `--duration-fast` 0.15s / `--duration-slow` 0.25s), four named cubic-bezier easings (no `linear`/`ease` allowed). This is the discipline I expect from Linear or Stripe, not from a hobby AI client.
- **Typography pairing**: EB Garamond/Noto Serif SC for display titles, Inter for body, JetBrains Mono for code (`tokens.css:43-48`). Display headings in serif against body in sans gives MaxmaHere an editorial, journal-like feel that no competing AI client attempts. The toggle in `AppearanceView.vue` to switch the whole app to sans-serif is a nice touch for users who want a more conventional look.
- **Micro-interactions are restrained, not gratuitous**: send button uses `cubic-bezier(0.34, 1.56, 0.64, 1)` spring on hover (1.08x scale), message bubbles slide in with `translateY(8px) scale(0.96)` over 0.3s, ref-tag chips have proper `TransitionGroup` move/leave animations. `prefers-reduced-motion` is respected throughout — buttons drop transforms, theme transitions drop animations. This is accessibility-aware polish.
- **Empty states are instructional, not just decorative**: `ChatView.vue:14-46` (no-provider state) shows a 3-step guide ("1. Click button → 2. Pick DeepSeek/Qwen/OpenAI → 3. Paste API Key") with a 💡 note. `McpView.vue:19-98` includes "what is MCP?" guide cards using a translator metaphor. `MemoryView.vue:9-34` opens with a `<details>` card explaining "Memory vs SOUL — what's the difference?" with a confidence-color legend. These read like a thoughtful PM wrote them for a non-technical colleague.
- **`WelcomeScreen.vue`** greets with avatar + scene text ("Maxma 正趴在桌上等你") + 6 example prompt chips explicitly labeled by persona: `chip--office` (写周报, 翻译文档), `chip--daily` (天气, 待办), `chip--tech` (Python, 搜索). The chips have slightly different border tints per persona. As an office worker, I immediately felt seen.
- **StatusBadge** (`StatusBadge.vue`) is a small green/red dot in the header that expands on hover into a system-health card (LLM / MEMORY / TOOLS / MCP sections with latency + status). This is exactly the kind of unobtrusive-but-informative pattern I want from a tool I rely on daily.

**Where aesthetics fall short:**

- **Chinese-first UI is a friction for international office use**. Most labels are bilingual (`对话 Chat`, `模型 MODELS`, `记忆 Memory`) but body copy, error messages, and onboarding text are Chinese-only. For a senior office worker in a multinational company, this is a real limitation vs Claude Desktop or ChatGPT.
- **The `plan-*.md` files scattered in `web/src/`** (e.g. `plan-round1.md`, `plan-module-round1.md`, `plan-sidebar-round1.md`, `router/plan-round2.md`, `themes/plan-round1.md`) suggest frontend churn — design decisions were revisited multiple times. Not user-visible, but it tells me the design north star wasn't always clear.

## Ease of use for non-developers

**Strong points:**

- **4-step OnboardingView** (`OnboardingView.vue`): Welcome → Connect Model → Set Workspace → Quick Overview. The first step introduces value props with emoji chips (💬 多模型对话, 🛠️ MCP 工具, ⚡ Skills, 🧠 长期记忆, 🎨 人设, 🔒 本地优先) before asking for any input. Step 2 detects provider readiness from health polling and shows a green/amber note. Step 4 gives explicit "next steps" with numbered cards so users don't get stuck post-onboarding.
- **ProvidersView empty state** (`ProvidersView.vue:35-86`) has recommended preset cards (DeepSeek/Qwen/OpenAI/Ollama) with one-click prefill, plus role-based guidance: "新手选 DeepSeek 注册即送免费额度，无需信用卡" / "极客本地运行选 Ollama". This is exactly the hand-holding a non-technical colleague needs.
- **Keyboard shortcuts** are discoverable in ChatInput: `Enter 发送 · Shift+Enter 换行` hint shown at bottom-right; `Ctrl+N` for new session; `Ctrl+K` for private mode. The hint is small and unobtrusive.
- **Autocomplete** in ChatInput (`@` for skills, `#` for tools, `!` for macros) with a scoring system (prefix match > substring match, with count tiebreaker). Cursor pixel position is calculated via a mirror div for accurate popup placement — non-trivial implementation.
- **Drag-and-drop image upload** + **paste URL detection** that auto-converts `github.com/...` into a web_link ref chip with the domain as label. Small but lovely for daily research workflow.
- **NotFoundView** (`NotFoundView.vue`) is a 404 page that actually helps — three large action cards (Return to Chat / Help / Appearance) instead of a bare "404 Not Found".

**Friction points:**

- **Setup is heavier than ChatGPT Desktop**. The enthusiast noted: Tauri app + Python venv + Bun + Rust toolchain for full development. For an end-user installation it's just the NSIS installer (Windows-only, see below), but the app embeds a Python FastAPI server and a Bun sidecar — meaning the download is hundreds of MB and the first launch takes seconds while the sidecar spins up. ChatGPT Desktop launches in under a second.
- **The session-more-menu** (`ChatView.vue:63-91`) hides Private Mode, Auto-Approve, and Permission Mode behind a `···` button. I had to read the code to find `Ctrl+K` for private mode. A tooltip or hint on first launch would help office workers discover these.
- **Mac/Linux users are excluded entirely**. `desktop/src-tauri/tauri.conf.json:47` has `"targets": ["nsis"]` only. Many office workers (especially in design/PM roles) use macOS. This is the single biggest ease-of-use limitation.
- **No mobile companion app**. Claude Desktop and ChatGPT both have iOS/Android apps that sync. MaxmaHere has a `quick-chat.html` secondary window (`tauri.conf.json:25-39`) — a desktop-only mini-window with `alwaysOnTop: true`. Nice for quick queries while in another app, but not a mobile solution.

## Daily-work capability adequacy

For a senior office worker's daily tasks (email drafting, document analysis, scheduling, research, basic data analysis), MaxmaHere is **adequate but with caveats**:

**What works for daily office work:**

- **File upload supports the office file types I actually use**: `.pdf`, `.docx`, `.xlsx`, `.pptx` plus code/text (`upload.py:22-33`). 20MB cap is reasonable for documents. The `_sanitize_filename` function (post-B-013 fix) correctly preserves CJK filenames — `报告.pdf` no longer becomes `.pdf`.
- **40+ LLM providers** means I can pick DeepSeek for cheap Chinese-language work, Qwen for free-tier domestic use, or OpenAI/Claude for English documents. Claude Desktop locks you to Anthropic; ChatGPT Desktop locks you to OpenAI. Choice matters.
- **Rich tool bubble types** in `web/src/components/tools/` — `TavilySearchBubble`, `TavilyExtractBubble`, `HolidayBubble`, `WeatherBubble`, `MapBubble`, `TodoBubble`, `TaskTrackerBubble`, `GitDiffBubble`, `FileEditBubble`, `PythonBubble`. For an office worker, the holiday/weather/map bubbles are nice ambient-info touches; the search bubbles are work-useful; the git/file/python bubbles are more dev-oriented but occasionally handy.
- **PlanCard + ApprovalBubble + permission modes** give the user control over what the agent does — important for office workers handling sensitive documents. The risk-level color coding (`risk-high` red border, `risk-medium` amber, `risk-low` green) is intuitive.
- **Multi-session with "constify" (save temp session)** is the right model — temp sessions for throwaway questions, saved sessions for ongoing projects. Right-click to pin a session is a clean pattern.
- **WorkbenchPanel** with `ReasoningTimeline` + `CanvasContainer` for pinned cards (code/table/summary) is a genuinely useful pattern for research tasks — pin a snippet from one turn, reference it later.

**Where daily-work capability falls short:**

- **Memory system is effectively non-functional for daily use**. The enthusiast already noted this, but it bears repeating from an office-worker perspective: if I tell Maxma "I'm a project manager, my team uses Jira, weekly reports are due Friday" — I expect it to remember. `api/data/semantic_memory.json` is empty `{}`, no ChromaDB/ONNX visible, `MemoryView.vue` shows "暂无记忆数据" until OMP writes facts. The README's "4-layer memory architecture" claim is misleading. Notion AI's memory is simpler but actually works.
- **`api/routes/autonomy.py` returns 404 for every endpoint** ("OMP replaces autonomy"). The capability matrix advertises `autonomy_enabled` as Phase 6, but the UI surface ships today. If a user clicks an autonomy-related button and gets a 404, that's a silent failure that erodes trust.
- **`api/routes/memory.py` returns 501** (post-B-006 fix — better than the original hardcoded dummy entries, but still not functional). For daily use, this means no manual memory CRUD.
- **No background/async agent execution**. If I ask Maxma to research 10 competitors and produce a comparison table, I have to keep the window open and wait. Claude Desktop's computer use and Cursor's background agents let me kick off a task and check back. MaxmaHere's `deferred_runs.py` is a route stub.
- **No streaming structured output / partial JSON rendering**. For long-running tool calls (research, code generation), the user waits for the complete result before seeing anything. Claude Desktop streams tokens; MaxmaHere appears to wait for tool completion.
- **No mobile app or web app**. As a senior office worker who moves between desk, meeting rooms, and commute, I need to pick up a conversation on my phone. MaxmaHere is desktop-only.

## Reliability & error handling

This is where the contest fixes are most visible. Comparing pre-contest to post-contest state, the reliability story is materially better:

**Solid reliability patterns:**

- **`RegionalErrorBoundary.vue`** wraps the router view so a Vue render error in one page doesn't kill the whole app — the user sees a "⚠ 此区域发生错误" card with a retry button. `resetKeys` watches `$route.path` so navigating away and back auto-resets the boundary. This is the right pattern.
- **Global `DsToast` for `maxma:error` events** (`App.vue:40-46, 133-152`) — the BC-003 fix added a `maxma:error` event listener that surfaces errors as a dismissible 6-second toast. Before this, errors were silent console-only.
- **WebSocket reconnection with exponential backoff** (`stores/chat.ts:97-100` shows `reconnectAttempts` / `reconnectTimer`; `useChat.ts` implements the backoff). The `_pingTimer` heartbeat and `_lastPongAt` timestamp detect silent disconnects (when WS says open but the sidecar is hung).
- **Session init retry** (`session.ts:15-47`): 5 retries with 1.5x exponential backoff, starts at 1000ms. Crucial for the "user launches app while backend still starting" race condition. `refreshSessions` now throws on failure (instead of silently setting `sessions.value = []`) so `initIfNeeded` knows to retry.
- **Health polling auto-recovery** (`useHealthPolling.ts:25-29`): when `health` transitions from null to non-null (backend came back online), it auto-refreshes the session list. Tiny code, big reliability win.
- **TOCTOU race fix in chat send** (`ChatInput.vue:928-944`): the send button checks `canSend.value`, then calls `chatInput.send(...)`. R-001 fixed the case where WS disconnects between check and send — now the return value is checked, and if `false`, a "消息发送失败：WebSocket 连接已断开" banner appears and the input is NOT cleared (so user doesn't lose their text).
- **localStorage quota management** (B-014 fix in `useChat.ts:71-113`): on `QuotaExceededError`, evicts the oldest half of other sessions' caches and retries. Without this, a user with many long sessions would silently lose persistence.
- **Atomic file writes throughout**: `persona.py:81-96` uses `tempfile.mkstemp` + `os.fsync` + `os.replace` for SOUL.md writes — no torn writes if the app crashes mid-save. `yaml_store.dump_yaml_atomic` + `yaml_file_lock` for all config mutations.
- **Credential envelope** (`api/security/credential_envelope.py`): versioned `encv1:` format with Fernet (Linux/macOS) + DPAPI (Windows) backends. B-009 fix auto-migrates plaintext API keys on startup. As an office worker handling company API keys, this is the right level of security.
- **Path whitelist + MaxmaBlocker**: even if I accidentally drag a folder containing sensitive HR docs into the chat, the MaxmaBlocker marker + whitelist mechanism prevents the agent from wandering outside approved paths. R-001 fix (unifying `.maxma_blocker` filename) made this actually work — previously every blocker was a silent no-op.
- **ApprovalBubble** for risky tool calls — high-risk calls (file mutations, shell commands) get a red-bordered approval card with `toolInput` preview. As an office worker, this gives me the confidence to actually use the agent for non-trivial tasks.

**Reliability concerns that remain:**

- **Silent stubs are the biggest reliability risk**. `autonomy.py` returns 404, `memory.py` returns 501, `kb.py` is empty, `deferred_runs.py` is a route stub. A user who clicks a feature that hits one of these endpoints gets either a confusing error or — worse — a UI that looks functional but does nothing. The enthusiast called this "ship the API surface, defer the implementation" — from an office worker's perspective, this is the most dangerous pattern because it erodes trust silently.
- **MCP test-connection is a 5-second "if it doesn't crash, success" heuristic** with no real MCP `initialize` handshake. An office worker trying to set up the filesystem MCP server might see "success" when the server is actually broken.
- **No rate limiting on MCP test-connection** — a malicious local process could spawn unlimited subprocesses.
- **The Bun sidecar runs with full user privileges** (no seccomp/AppContainer/sandbox-exec). If a compromised MCP server runs inside the sidecar and bypasses `security_adapter.check_tool_security`, it has direct filesystem access. For an office worker handling company data, this is a non-trivial risk.
- **`MAXMA_PARENT_PID` watchdog is Windows-only** (`main.py:20-44`). Orphan sidecar cleanup on macOS/Linux depends on Job Object equivalents that may not exist. Not relevant for the current Windows-only build, but limits future cross-platform reliability.
- **No error recovery for partially-failed tool calls**: if a multi-step tool call fails midway, the user sees the error but can't easily resume from the failure point. They have to re-prompt.

## Workflow integration

**Where workflow integration shines:**

- **Persona system (Yuan/Identity/Ishiki)** is genuinely useful for an office worker. I can have one persona for "formal email drafting" (terse, professional) and another for "brainstorming session" (playful, expansive). `SoulView.vue` has a persona selector dropdown + "+" button to create new personas, with writing guides and templates. The `PersonaCard.vue` shows the current persona's name/description/scene/style at the top of the SOUL editor — a nice ambient reminder of "who" the AI is being right now.
- **Skills + Macros** let me encode reusable workflows. `@`-autocomplete in ChatInput surfaces skills; `#`-autocomplete surfaces tools; `!`-autocomplete surfaces macros. The scoring system (prefix > substring, with count tiebreaker) means frequently-used items bubble up.
- **Multi-session with constify**: temp sessions for "what's the weather" / "translate this paragraph"; saved sessions for "Q3 OKR drafting" / "weekly standup notes". Right-click → "固定" to pin a temp session. This matches how I actually work.
- **WorkbenchPanel** with `CanvasContainer` for pinned cards (code/table/summary) + `ReasoningTimeline` for reviewing the agent's thinking — this is the kind of "second monitor" pattern that's useful for research-heavy work.
- **Quick Chat window** (`tauri.conf.json:25-39`) — a 480×640 always-on-top mini-window for quick queries while in another app. `skipTaskbar: true` keeps it out of the taskbar. Nice for "what's the time in Tokyo?" while writing an email.
- **Theme switching for working moods**: `warm-paper` for morning journaling, `midnight` for late-night deep work, `high-contrast` for accessibility, `contemplation` for gray-day reading. As someone who changes workspace ambiance by task, this is delightful.
- **Keyboard shortcuts**: `Ctrl+N` new session, `Ctrl+K` private mode. Discoverable from the ChatInput hint.
- **Privacy dashboard** (`PrivacyView.vue`) with data storage locations, audit log, and "clear all" buttons — exactly the transparency I want from a tool handling company data.

**Where workflow integration falls short:**

- **Memory system being stub breaks the "AI that learns my preferences" workflow**. The whole pitch of a long-term AI companion is that it remembers. The MemoryView UI exists, the confidence-color legend exists, the intro card explains the difference between Memory and SOUL — but the underlying storage is empty and the semantic retrieval code is missing. This is the biggest workflow-integration gap.
- **No integration with calendar/email/task tools beyond MCP**. Claude Desktop has a calendar integration; ChatGPT Desktop has Google Workspace integration. MaxmaHere requires the user to configure an MCP server for each external service — a non-trivial setup task for an office worker.
- **No mobile app means workflow doesn't follow me**. If I start a research session at my desk and want to continue on my phone during commute, I can't.
- **No cloud sync**. Sessions are stored locally in `localStorage` + backend files. If my laptop dies, my conversation history dies with it. For an office worker, this is a real risk — Claude Desktop and ChatGPT both sync to the cloud.
- **Autonomous/background tasks don't work**. If I want Maxma to "monitor this RSS feed and summarize new entries every morning", I can't — `autonomy.py` returns 404, `deferred_runs.py` is a stub.

## What I loved

- **The 13 curated themes** with poetic descriptions (`warm-paper`: "和纸手抄本，温润文人感") — this is the most aesthetically thoughtful theme set I've seen in any AI client, including paid ones.
- **Paper texture overlay** at 8% opacity on `warm-paper`/`study` themes — subtle, toggleable, and genuinely makes the chat feel like writing in a journal.
- **Persona-targeted example prompts** on the WelcomeScreen (`chip--office` for 写周报/翻译文档, `chip--tech` for Python/搜索) — as an office worker, I felt seen within 5 seconds of opening the app.
- **The 3-step empty-state guides** for no-provider and no-MCP scenarios — actually walks a non-technical user through setup instead of just showing a blank page.
- **ApprovalBubble with risk-level color coding** — gives me the confidence to let the agent handle file mutations without hovering.
- **RegionalErrorBoundary + global DsToast** — when something breaks, I see a retry card or a toast, not a blank screen.
- **Multi-session constify pattern** — temp sessions for throwaway questions, saved sessions for ongoing projects. Right-click to pin is clean.
- **Health-polling auto-recovery** — when the backend comes back online after a restart, the session list refreshes itself. Tiny code, big UX win.
- **`NotFoundView.vue`** — the 404 page has three actionable navigation cards (Return to Chat / Help / Appearance) instead of a bare error. This is the small-details polish that separates thoughtful products from minimum-viable ones.

## What frustrated me

- **Memory system is advertised but doesn't work**. The MemoryView UI shows a confidence-color legend and intro card explaining "Memory vs SOUL" — but `semantic_memory.json` is empty, no vector retrieval code exists, and `memory.py` returns 501. As an office worker who wants the AI to remember "I'm a PM, my team uses Jira, weekly reports due Friday", this is the biggest disappointment.
- **Windows-only packaging** (`tauri.conf.json:47` `"targets": ["nsis"]`). Half my office uses macOS. This is a hard blocker for adoption.
- **Silent stub features** (autonomy returns 404, memory CRUD returns 501, kb.py is empty, deferred_runs.py is a route stub). If I click a button that hits one of these, I get either a confusing error or — worse — a UI that looks functional but does nothing. The enthusiast called this out; from an office worker's perspective, it's even more damaging because non-technical users can't tell the difference between "broken" and "I'm doing something wrong".
- **No mobile app, no cloud sync**. My conversation history lives on one laptop. If the laptop dies, the history dies. Claude Desktop and ChatGPT both sync.
- **Setup is heavier than ChatGPT Desktop**. Even with the NSIS installer, the app embeds a Python FastAPI server + Bun sidecar. First launch takes seconds while the sidecar spins up. ChatGPT Desktop launches in under a second.
- **MCP test-connection is a 5-second "if it doesn't crash, success" heuristic**. When I tried to set up the filesystem MCP server, "success" appeared even when the server was misconfigured. A real MCP `initialize` handshake would catch this.
- **Chinese-first UI**. Bilingual labels help, but body copy, error messages, and onboarding text are Chinese-only. For a multinational office, this is a real limitation.
- **No streaming structured output for long-running tool calls**. When Maxma is researching 10 competitors, I stare at a "thinking..." indicator for minutes. Claude Desktop streams tokens as they arrive.
- **No background/async agent execution**. I can't kick off a research task and check back later — I have to keep the window open and wait.

## Comparison to my daily tools

- **vs Claude Desktop**: Claude Desktop has a more polished consumer UX (token streaming, computer use, native cross-platform packaging, MCP marketplace, mobile companion). MaxmaHere has materially better aesthetics (13 themes vs 2, paper texture, serif typography option), a more configurable persona system (3-layer Yuan/Identity/Ishiki vs Claude's flat system prompt), and 40+ LLM providers vs Claude's 1. MaxmaHere's security documentation (`security-contract.md`) is more rigorous than Claude Desktop's public docs. MaxmaHere loses on: memory system maturity (Claude's actually works), background/async execution, mobile app, and macOS support. For a senior office worker who lives on macOS and needs mobile continuity, Claude Desktop wins. For a Windows-only office worker who values aesthetics and persona customization, MaxmaHere wins.

- **vs ChatGPT Desktop**: ChatGPT Desktop has the smoothest onboarding (sign in → done), cloud sync across devices, mobile companion, GPT store, voice mode, and deep OpenAI ecosystem integration. MaxmaHere has better theming, a more granular permission model (ApprovalBubble + risk levels + MaxmaBlocker), local-first data (no OpenAI telemetry), and provider flexibility (I can use DeepSeek for cheap Chinese work, Claude for English documents, Ollama for air-gapped). MaxmaHere loses on: setup friction, memory system, mobile app, and the "it just works" smoothness. For an office worker who wants zero setup and mobile continuity, ChatGPT Desktop wins. For an office worker who values data locality and provider choice, MaxmaHere wins.

- **vs Notion AI**: Notion AI is embedded in a document/workspace — you don't "chat" with it, you invoke it inline on text. MaxmaHere is a chat-first agent desktop. Different niches. Notion AI's memory is workspace-scoped and actually works (it remembers project context). MaxmaHere's memory is advertised as 4-layer but is effectively empty. Notion AI wins on: memory that works, document-native UX, team collaboration. MaxmaHere wins on: persona system sophistication, theme variety, file upload flexibility (PDF/DOCX/XLSX/PPTX), MCP extensibility, and not being locked to a SaaS workspace. For document-centric work, Notion AI wins. For research/chat-centric work with file uploads, MaxmaHere wins.

## Overall verdict

MaxmaHere scores **7.2/10** from a senior office worker's perspective. The aesthetic dimension is genuinely excellent — 13 curated themes with poetic intent, paper texture, serif typography, restrained micro-interactions, and instructional empty states that read like a thoughtful PM wrote them for a non-technical colleague. The reliability story is materially better post-contest: RegionalErrorBoundary, global DsToast, exponential-backoff reconnection, TOCTOU race fixes, localStorage quota management, and atomic file writes throughout. The persona system (3-layer Yuan/Identity/Ishiki), multi-session constify pattern, and WorkbenchPanel with pinned cards are workflow-integration patterns I haven't seen in competing products.

The score is held back by four factors: (1) the memory system is advertised as a 4-layer architecture with ChromaDB+ONNX but is effectively empty — `semantic_memory.json` is `{}`, `memory.py` returns 501, no vector retrieval code visible — and for an office worker who wants the AI to remember preferences, this is the biggest disappointment; (2) Windows-only packaging excludes the macOS half of the office; (3) silent stub features (autonomy 404, memory CRUD 501, kb.py empty, deferred_runs stub) advertise capabilities that don't exist — eroding trust silently; (4) no mobile app, no cloud sync, no background/async agent execution — workflow integration stops at the desktop window. An office worker who values aesthetics, persona customization, and local-first data on Windows will find MaxmaHere compelling; one who needs memory-that-works, macOS support, or mobile continuity should look to Claude Desktop or ChatGPT Desktop.
