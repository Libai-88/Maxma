# Plan Round 1 — 修复 11 个主题文件的 CSS 变量问题

## 概述

修复 3 个问题，涉及 11 个主题文件 + 1 个设计系统文件（以及所有 `--accent-light` 消费者文件）。

---

## 问题 1：删除每个文件中第一个 `--hana-text` 声明

每个主题文件存在两处 `--hana-text`，第一处在"聊天专用"区块，第二处在"聊天专用语义色"区块。CSS 层叠规则下第二个覆盖第一个，故第一个是无效声明。

**操作**：删除每个文件中的第一个 `--hana-text` 行（及该行末尾的换行符）。

### 各文件待删除的精确字符串

| # | 文件 | 第一个 `--hana-text` 行 |
|---|------|--------------------------|
| 1 | warm-paper.css | `  --hana-text:      #2B3A4E;` |
| 2 | midnight.css | `  --hana-text:      #DCE6EC;` |
| 3 | midnight-contrast.css | `  --hana-text:      #E8EEF4;` |
| 4 | high-contrast.css | `  --hana-text:      #1A2A3A;` |
| 5 | coral.css | `  --hana-text:      #3A3530;` |
| 6 | dawn.css | `  --hana-text:      #4A5A60;` |
| 7 | grass-aroma.css | `  --hana-text:      #2D4A35;` |
| 8 | contemplation.css | `  --hana-text:      #3A4A5C;` |
| 9 | deep-think.css | `  --hana-text:      #2A2D4A;` |
| 10 | delve.css | `  --hana-text:      #202123;` |
| 11 | absolutely.css | `  --hana-text:      #3A332E;` |

---

## 问题 2：提升 `--user-bubble` 对比度

当前 `--user-bubble` 的背景透明度太低（浅色主题 0.08/0.06/0.05，暗色主题 0.10/0.08），在对应背景下几乎不可见。

**操作**：统一提升透明度值。

### 暗色主题（bg-primary 为深色）→ 0.18

| # | 文件 | 当前值 | 目标值 |
|---|------|--------|--------|
| 1 | midnight.css | `rgba(170, 121, 141, 0.10)` | `rgba(170, 121, 141, 0.18)` |
| 2 | midnight-contrast.css | `rgba(255, 255, 255, 0.08)` | `rgba(255, 255, 255, 0.18)` |

### 浅色主题（bg-primary 为浅色）→ 0.14

| # | 文件 | 当前值 | 目标值 |
|---|------|--------|--------|
| 1 | warm-paper.css | `rgba(83, 125, 150, 0.08)` | `rgba(83, 125, 150, 0.14)` |
| 2 | high-contrast.css | `rgba(0, 0, 0, 0.06)` | `rgba(0, 0, 0, 0.14)` |
| 3 | coral.css | `rgba(210, 95, 75, 0.08)` | `rgba(210, 95, 75, 0.14)` |
| 4 | dawn.css | `rgba(232, 130, 111, 0.08)` | `rgba(232, 130, 111, 0.14)` |
| 5 | grass-aroma.css | `rgba(122, 174, 127, 0.08)` | `rgba(122, 174, 127, 0.14)` |
| 6 | contemplation.css | `rgba(89, 120, 145, 0.08)` | `rgba(89, 120, 145, 0.14)` |
| 7 | deep-think.css | `rgba(81, 95, 220, 0.06)` | `rgba(81, 95, 220, 0.14)` |
| 8 | delve.css | `rgba(0, 0, 0, 0.05)` | `rgba(0, 0, 0, 0.14)` |
| 9 | absolutely.css | `rgba(165, 75, 55, 0.08)` | `rgba(165, 75, 55, 0.14)` |

---

## 问题 3：将 `--accent-light` 重命名为 `--accent-dark`

`--accent-light` 的实际值比 `--accent` 更深，语义错误。按照方案 1，将变量名改为 `--accent-dark`，并更新所有消费者引用。

### 3a. 在 11 个主题文件中重命名声明

每个文件有两处需要修改：

1. 注释 `/* 修复 --accent-light 语义冲突 */` → `/* --accent-dark: accent 的深色变体 */`
2. 变量声明 `--accent-light:` → `--accent-dark:`（值不变）

### 3b. 更新所有消费者文件中 `var(--accent-light)` 为 `var(--accent-dark)`

以下文件引用了 `--accent-light`：

| # | 文件 | 行号 | 使用方式 |
|---|------|------|----------|
| 1 | `assets/styles/design-system.css` | 107 | `border-color: var(--accent-light);` |
| 2 | `components/ChatInput.vue` | 1222 | `border-color: var(--accent-light);` |
| 3 | `components/ChatInput.vue` | 1338 | `border-color: var(--accent-light);` |
| 4 | `components/ChatWindow.vue` | 919 | `background: var(--accent-light);` |
| 5 | `components/HtmlSandbox.vue` | 57 | `'--accent', '--accent-light', '--border',` |
| 6 | `components/MemoryPanel.vue` | 330 | `border-color: var(--accent-light);` |
| 7 | `components/MomentCard.vue` | 178 | `border: 2px solid var(--accent-light);` |
| 8 | `components/ToolCallCard.vue` | 211 | `border-color: var(--accent-light);` |
| 9 | `components/tools/FileEditBubble.vue` | 629 | `border-color: var(--accent-light);` |
| 10 | `components/tools/FilesBubble.vue` | 580 | `border-color: var(--accent-light);` |
| 11 | `components/tools/MapBubble.vue` | 686 | `border-color: var(--accent-light);` |
| 12 | `components/tools/PythonBubble.vue` | 217 | `border-color: var(--accent-light);` |
| 13 | `components/tools/PythonBubble.vue` | 256 | `color: var(--accent-light);` |
| 14 | `components/tools/_shared/shared.css` | 13 | `border-color: var(--accent-light);` |
| 15 | `components/tools/_shared/shared.css` | 102 | `border-color: var(--accent-light);` |
| 16 | `components/ui/DsCard.vue` | 13 | `border-color: var(--accent-light);` |
| 17 | `views/HooksView.vue` | 422 | `border-color: var(--accent-light);` |
| 18 | `views/PlaygroundView.vue` | 1018 | `border-color: var(--accent-light);` |
| 19 | `views/SkillsView.vue` | 554 | `border-color: var(--accent-light);` |

**操作**：在上述所有文件中，将 `var(--accent-light)` 替换为 `var(--accent-dark)`。

---

## 执行顺序

1. 修改 11 个主题文件（每文件 4 次 Edit：删 hana-text、改 user-bubble、改注释、改变量名）
2. 修改 design-system.css（1 次 Edit）
3. 修改 16 个消费者文件（批量替换 `var(--accent-light)` → `var(--accent-dark)`）

---

## 验证

执行完毕后，运行搜索确认无残留 `--accent-light` 引用（主题文件中的注释行除外，如果没有其他引用则证明完成）。如果搜索仍有结果，继续清理。
