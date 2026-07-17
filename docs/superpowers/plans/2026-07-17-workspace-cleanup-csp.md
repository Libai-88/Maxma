# Workspace Cleanup & CSP Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Clean up scattered files in d:\Maxma root workspace and tighten Tauri CSP if safe.

**Architecture:** Archive temp files, delete unrelated build artifacts, evaluate CSP 'unsafe-inline' removal.

**Tech Stack:** Tauri 2, CSP, file system

---

## Part A: Workspace Cleanup (d:\Maxma root, NON-git)

> Scope: `d:\Maxma\` 根目录（非 Git 仓库）。Git 仓库 `d:\Maxma\MaxmaHere\` 不在此部分范围内。
> 保护项：`oh-my-pi-16.5.2\`（Maxma 依赖）、`.omx\`、`.claude\`、`.trae-cn\` 等隐藏配置目录、所有外部项目目录。

### Task A1: 创建归档目录

- 在 `d:\Maxma\_archive\` 下创建归档目录（如不存在）。
- 不创建任何子目录，所有归档文件平铺放入。

### Task A2: 归档散落临时文件（移动，不删除）

经内容确认，以下文件均为无关临时产物（构建日志 / 表情系统数据 / 聊天导出 / 审计快照），移动到 `d:\Maxma\_archive\`：

| 源文件 | 内容确认 | 操作 |
|--------|----------|------|
| `build.txt` | Vite 构建日志（"✓ built in 6.08s"） | 移动 |
| `exe-output.txt` | 服务端启动日志 + traceback | 移动 |
| `emoji_files.txt` | 表情文件哈希名列表 | 移动 |
| `emoji_labels.csv` | 表情标签数据（filename,tags,description） | 移动 |
| `write_labels.py` | 写表情标签到 CSV 的脚本 | 移动 |
| `skills-lock.json` | 外部 skills 锁文件（CopilotKit） | 移动 |
| `ui-audit-report.md` | UI 审计报告快照（2026-07-03） | 移动 |
| `审查表情系统潜在_bug_2026-07-02_01-35.md` | 聊天导出 | 移动 |
| `清空工作区_2026-07-01_19-33.md` | 聊天导出 | 移动 |
| `私聊_九曜山的小猪\` | 个人聊天记录目录 | 移动（整个目录） |

### Task A3: 删除无关文件

| 目标 | 确认依据 | 操作 |
|------|----------|------|
| `d:\Maxma\nul` | Windows 保留设备名误创建的空文件 | 删除 |
| `d:\Maxma\build\spec-check\` | 无关项目 spec-check 的 PyInstaller 构建产物（MaxmaHere 用的是 `maxma-server.spec`） | 删除整个目录 |
| `d:\Maxma\dist\spec-check.exe` | 无关项目 spec-check 的可执行产物 | 删除 |

### Task A4: 记录工作区结构（不移动外部项目）

- 不移动 `hello-halo-2.1.12\`、`openhanako-0.357.17\`、`oh-my-pi-16.5.2\`（避免破坏依赖路径）。
- 在 `d:\Maxma\` 创建 `WORKSPACE.md`，记录根目录结构说明：Git 仓库位置、外部项目用途、归档目录用途。
- 检查根目录是否已有 `README.md` / `CATALOG.md`（已存在 `CATALOG.md`，读取后决定是否更新或新建 `WORKSPACE.md`）。

---

## Part B: Tauri CSP Hardening (d:\Maxma\MaxmaHere, Git repo)

> 文件：`desktop/src-tauri/tauri.conf.json` 第 41 行 `app.security.csp`
> 当前 `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`

### Task B1: 前端内联样式依赖评估（已完成调研）

**调研结论：移除 `'unsafe-inline'` 风险极高，会导致前端样式大面积失效。**

证据：
1. **静态内联样式 `style="..."`**：54 处，分布于 36 个文件（含 App.vue、ChatInput、SessionSidebar、ThemePicker、McpView、TarotBubble 等）。
2. **动态内联样式 `:style=`**：36 处，分布于 26 个文件（Vue 运行时编译为内联 `style` 属性，如 NewsView 的时间线 `:style="{ top: node.top + 'px' }"`、App.vue 的弹窗定位 `:style="{ top: popupTop, left: popupLeft }"`）。
3. **非 scoped `<style>` 块**：4 处
   - `web/src/App.vue:327` `<style>`（全局）
   - `web/src/quick-chat/QuickChatApp.vue:132` `<style>`（全局）
   - `web/src/components/AutocompletePanel.vue:143` `<style>`（非 scoped）
   - `web/src/components/HtmlSandbox.vue:87` `<style>`（非 scoped）
   - 注：Vite/Vue SFC 编译器通常会把 `<style>` 块抽取成外部 CSS 文件，故非 scoped `<style>` 本身不必然要求 `'unsafe-inline'`；但内联 `style` 属性和 `:style` 绑定**必然**要求 `'unsafe-inline'`。
4. `index.html` 无内联 `<style>`（仅外部字体 link），这一项不影响判断。

**CSP 机制说明**：
- `style-src 'unsafe-inline'` 同时放行内联 `style="..."` 属性、`<style>` 块、Vue `:style` 运行时产物。
- 移除后，内联 `style` 属性被浏览器拦截 → 90+ 处样式失效（布局错乱、弹窗定位失效、时间线错位等）。
- 替代方案 `'unsafe-hashes'` + 逐条 hash 仅适用于**静态**内联样式，对 `:style="{ top: node.top + 'px' }"` 这类**动态值**无法生成稳定 hash。
- Nonce 方案仅适用于 `<style>` 元素和 `<script>`，**不适用于**内联 `style` 属性。

### Task B2: CSP 决策

**决策：不修改 CSP。** 保留现有 `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`。

理由：前端深度依赖内联 `style` 属性与 `:style` 动态绑定（90+ 处），移除 `'unsafe-inline'` 会造成大面积样式失效，属于高风险破坏性变更，超出"安全收紧"范畴。

### Task B3: 记录替代方案（在计划与本报告中）

推荐后续渐进式收紧路径（不在本次执行）：
1. **CSP Report-Only 先行**：Tauri 2 的 WebView 支持通过 meta 或响应头下发 `Content-Security-Policy-Report-Only`，先收集违规样本而不阻断渲染。可自定义上报端点（如 `http://127.0.0.1:8000/csp-report`）。
2. **内联样式迁移到 class**：将静态 `style="..."` 改写为 CSS class（scoped 或全局），逐步消除对 `'unsafe-inline'` 的依赖。
3. **动态样式改用 CSS 变量**：`:style="{ top: x + 'px' }"` 可改为 `:style="{ '--top': x + 'px' }"` + CSS `top: var(--top)`。注意：CSS 变量注入到内联 `style` 仍需 `'unsafe-inline'`，故此法不解决 CSP，仅规范化。
4. **真正的解法**：只有完全消除内联 `style` 属性后，才能安全移除 `'unsafe-inline'`。这是一次大型重构，应单独立项。

### Task B4: Git 提交

- 本计划文件位于 Git 仓库内（`MaxmaHere/docs/superpowers/plans/`），作为 Part B 的交付物。
- 提交信息：`docs(plan): workspace cleanup & CSP hardening analysis`。
- CSP 配置本身无改动，故仅提交计划文档。

---

## 执行顺序

1. 写本计划文件 ✅
2. Task A1 → A2 → A3 → A4（Part A，无 git commit）
3. Task B4（Part B，git commit 计划文件）

## 风险与约束

- Part A 操作在非 Git 目录，无版本控制兜底，故对"删除"操作采取保守策略（仅删除已确认的 `nul`、`spec-check` 产物）。
- 外部项目目录一律不移动，避免破坏 `oh-my-pi` 等依赖的相对路径。
- 隐藏配置目录（`.omx`、`.claude`、`.trae-cn`）一律不碰。
- Part B 不改 CSP，零运行时风险。
