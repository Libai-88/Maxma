# Novice review

Evaluated as a complete novice — someone who has never opened a terminal and judges software by whether they can use it without Googling.

MaxmaHere is an ambitious project: a local-first AI desktop client supporting 40+ LLM providers, with custom tools (weather, todo, maps, tarot), a memory system, and a persona system. It wraps oh-my-pi as the agent engine, Python/FastAPI as the backend, Vue 3 as the frontend, and Tauri 2 as the desktop shell.

## First contact

I found the project folder on my desktop. Inside there is a `README.md` (in Chinese), a `setup.bat`, a `start.bat`, and a folder called `dist-portable` containing `MaxmaHere.exe` (26 MB) and `maxma-server.exe` (211 MB). I naturally tried double-clicking `MaxmaHere.exe` first. It ran but seemed to need the server — the window opened but nothing happened. The `maxma-server.exe` in the same folder is huge and I wasn't sure whether to launch it first, or if the smaller exe would start it automatically.

There are also three `maxma-error-report-*.txt` files sitting right next to the exe files, which immediately made me worry something was broken before I even started.

I then looked at `setup.bat`. Double-clicking it opened a command prompt (scary) that said it needed Python. I don't know what Python is or where to get it. The script told me to download it from python.org, but that's already a barrier.

The `README.md` has a screenshot that looks like a polished chat interface, which is promising. But everything under "Quick Start" is commands I would have to type, which I cannot do.

## Onboarding

The project makes a valiant effort with `setup.bat` / `setup.py` — this is a guided Chinese-language wizard that checks for prerequisites, sets up a Python virtual environment, installs dependencies, and even walks through configuring an LLM provider. This is genuinely good for a novice *if* they already have Python and Node.js installed. But the setup script does not install Python, Node.js, or Bun for you — it only checks if they exist and errors out if not. For a true novice, installing a programming language runtime is a blocker.

The `dist-portable/` folder contains pre-built binaries (`MaxmaHere.exe` + `maxma-server.exe`), which is the closest thing to "just run it." But there is no installer, no documentation saying "double-click this one first," and three error reports in the same folder raise immediate red flags. The Tauri NSIS installer is built from source — no pre-built installer is included in the repository.

The Chinese-language setup wizard is good for Chinese-speaking novices but locks out anyone who doesn't read Chinese.

## Functional coverage (what I'd try first)

1. **Have a conversation with the AI.** I would open the app and type a question. But to do this I need to configure an LLM provider with an API key. I may not have one, and even if I do, I need to know what a "Base URL" and "API key" are. The setup wizard tries to help, but the concept of API keys is not trivial for a novice.

2. **Check the weather or ask about holidays.** The README advertises weather and holiday tools. These sound useful. But they require additional API keys (UAPIS, AMAP) which I likely don't have.

3. **Customize the AI's personality.** The persona system (SOUL.md, USER.md) is interesting. But editing files in a text editor and knowing where to put them is not something a novice would do naturally. There is no in-app UI for this that I can see from the files.

Overall: the features sound great on paper, but most require either API keys or file editing, which a novice cannot do without guidance.

## Competitive pitch

"本地优先的多模型 AI 桌面客户端，一个应用切换所有大模型" — "A local-first multi-model AI desktop client, switch between all major LLMs from one app."

## Blockers

- **No pre-built installer.** The repository expects you to build from source. The `dist-portable/` binaries exist but there is no installer, no double-click-to-run documentation, and error reports in the same folder make them look broken.
- **Python, Node.js, and Bun must be installed manually.** The setup script checks for them but cannot install them. A novice will hit an error message in a command prompt and not know what to do.
- **LLM provider API key required to do anything useful.** Even if the app launches, you need to configure an LLM provider with a valid API key before you can send a single message. A novice may not have one or may not understand what an API key is.
- **Chinese-only documentation and UI.** The README, setup script output, and apparently the UI are all in Chinese. Non-Chinese-speaking users are completely blocked.
- **Error reports in the portable dist folder.** Three `maxma-error-report-*.txt` files sit alongside the exe files. A novice seeing these would assume the application is broken and not try to run it.
- **Command-line required for setup.** `setup.bat` opens a terminal, which is intimidating. The "Quick Start" section in README is entirely bash commands.

## Score breakdown

| Criterion | Score | Notes |
|-----------|-------|-------|
| Zero CLI required | 1/10 | Requires terminal for setup; no one-click installer |
| Clear onboarding path | 3/10 | setup.bat/setup.py is a good attempt but prerequisites are blockers |
| Works out of the box | 1/10 | API key needed; no pre-built installer; error reports present |
| Clear competitive pitch | 6/10 | The multi-provider pitch is strong but buried in technical details |
| Novice can do something useful | 2/10 | Not possible without API key and dependencies |

score: 2.2
verdict: MaxmaHere has an impressive feature set and a thoughtful setup wizard, but it is not usable by a true novice. The lack of a pre-built installer, the requirement to install programming language runtimes manually, the need for an LLM API key before any conversation, and Chinese-only documentation create multiple hard blockers. With a one-click NSIS installer, bundled runtimes, and a pre-configured demo provider, it could reach a 5-6. In its current state, it requires significant technical knowledge and effort to get running.

## Required fields (novice)

onboarding_notes: The project has a Chinese-language setup wizard (setup.bat -> setup.py) that walks through dependency checking, venv creation, and LLM provider configuration. This is a good effort but it cannot install Python, Node.js, or Bun for the user — it only checks for them and errors out. The README's "Quick Start" section is entirely terminal commands. A `dist-portable/` folder contains pre-built exe files (MaxmaHere.exe + maxma-server.exe), but there is no installer, no documentation explaining which to run first, and three error report files in the same folder that make the build look broken. A true novice would get stuck at the prerequisite installation step.

functional_notes:
  1. "Have a conversation with the AI" — Cannot, because an LLM provider API key must be configured first. The setup wizard asks for a Base URL and API key, but a novice may not have one or understand what these are. Even after setup, the concept of "providers" is not self-explanatory.
  2. "Check the weather or look up holidays" — The README advertises these tools, but they require additional third-party API keys (UAPIS for weather, AMAP for maps). Without those keys, the tools are non-functional. There is no way to discover this from within the app.
  3. "Customize the AI's personality" — The persona system sounds appealing but requires editing SOUL.md and USER.md files manually. There is no in-app settings UI for this visible from the project files. A novice would not know these files exist or where to find them.

competitive_pitch: "A local-first multi-model AI desktop client — switch between all major LLMs from one app, with built-in tools for weather, todos, maps, and more."

blockers:
  - No pre-built one-click installer (NSIS) available in the repository; requires building from source or running from dist-portable/ with no guidance.
  - Python 3.11+, Node.js 18+, and Bun 1.3+ must be installed manually by the user before setup.bat will proceed.
  - LLM provider API key is mandatory before any conversation is possible — a novice may not have one or know how to get one.
  - Three error report files (maxma-error-report-*.txt) in dist-portable/ make the application look broken before it is even launched.
  - All documentation and setup UI is in Chinese, blocking non-Chinese-speaking users entirely.
  - Even after launch, useful features (weather, holidays, maps) require additional third-party API keys that are not provided or documented downstream.
