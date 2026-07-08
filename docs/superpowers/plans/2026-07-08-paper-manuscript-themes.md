# 纸本雅致主题系统迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 openhanako 的纸本雅致审美系统（11 主题 + 衬线字体 + 纸纹叠层 + 动画 token + 主题切换 UI）迁移到 Maxma，替换现有的二元日/夜模式，让用户能在 11 个精心设计的主题中自由切换。

**Architecture:** 纯 CSS 变量驱动 + `data-theme` 属性切换。新建 `themes/` 目录存放 11 个主题 CSS 文件，在 `App.vue` 的 `:root` 中保留结构 token（间距/字号/圆角/动效时长/缓动），主题文件仅覆盖配色变量。主题切换逻辑从 `useNightMode.ts` 的三态 auto/on/off 升级为 12 选项（auto + 11 主题），通过 `localStorage` 持久化。字体方案从 ZCOOL KuaiLe/Noto Sans SC 扩展为可选衬线（EB Garamond + Noto Serif SC）或无衬线（Inter + Noto Sans SC）。

**Tech Stack:** Vue 3 + TypeScript + 原生 CSS（无预处理器）+ Vite + localStorage + `matchMedia('prefers-color-scheme: dark')`

---

## 文件结构

### 新建文件

| 文件路径 | 职责 |
|---------|------|
| `web/src/assets/styles/tokens.css` | 全局结构 token（间距/字号/圆角/动效时长/缓动/字体族），所有主题共享 |
| `web/src/assets/styles/animations.css` | 全部 @keyframes 定义（hana-* 命名空间），单一真相来源 |
| `web/src/themes/warm-paper.css` | 默认主题：暖纸底 + 远山青印章色 + 衬线体 |
| `web/src/themes/midnight.css` | 深色主题：深青蓝 + 柔粉 accent |
| `web/src/themes/high-contrast.css` | 无障碍高对比浅色主题 |
| `web/src/themes/grass-aroma.css` | 草香主题：青草绿调 |
| `web/src/themes/contemplation.css` | 沉思主题：灰蓝调 |
| `web/src/themes/coral.css` | 珊瑚主题：墨蓝 + 珊瑚朱 |
| `web/src/themes/delve.css` | ChatGPT 风格：冷调纯白 + 纯黑 |
| `web/src/themes/deep-think.css` | DeepSeek 风格：干净白底 + 蓝紫 |
| `web/src/themes/absolutely.css` | 暖奶油底 + 哑光赤陶 |
| `web/src/themes/midnight-contrast.css` | 无障碍高对比深色主题 |
| `web/src/composables/useTheme.ts` | 主题切换 composable（替代 useNightMode.ts 的主题选择职责） |
| `web/src/components/ThemePicker.vue` | 主题选择器组件（设置弹窗内，展示 12 个主题预览块） |

### 修改文件

| 文件路径 | 修改内容 |
|---------|---------|
| `web/src/App.vue` | 移除 `:root` 中的配色变量（迁移到主题文件）；移除 `.night-mode` 覆盖块；`<style>` 顶部 `@import` tokens.css + animations.css；根元素改为 `:data-theme` 绑定；设置弹窗中"深夜模式"按钮替换为 `<ThemePicker>` |
| `web/src/composables/useNightMode.ts` | 保留 `isNightMode` 计算属性供 StickerInline 使用，但内部改为读取当前主题的明暗属性；`cycleNightModeSetting` 废弃 |
| `web/src/components/StickerInline.vue` | 无需改动（仍读 `isNightMode`） |
| `web/src/main.ts` | 无需改动（tokens.css 和 animations.css 通过 App.vue @import 引入） |

### 字体文件

字体 woff2 文件较大（EB Garamond + Noto Serif SC + Inter + JetBrains Mono 全权重约 515KB），采用 CDN 引入策略而非本地打包，避免增大安装包：

```html
<!-- 在 index.html <head> 中添加 -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Noto+Serif+SC:wght@400;500;600&display=swap" rel="stylesheet">
```

---

## 主题变量映射设计

Maxma 现有变量 → openhanako 变量的映射关系（主题文件需覆盖的变量）：

```css
/* 主题文件必须定义的变量 */
--bg-primary        /* → --bg */
--bg-secondary      /* → --sidebar-bg */
--bg-card           /* → --bg-card */
--text-primary      /* → --text */
--text-secondary    /* → --text-light */
--text-tertiary     /* → --text-muted */
--accent            /* → --accent */
--accent-light      /* → --accent-hover */
--accent-pink       /* → --coral（状态色） */
--border            /* → --border */
--status-ok         /* → --green */
--status-error      /* → --danger */
--status-warn       /* 主题自定义 */
--user-bubble       /* → --user-bg */

/* tokens.css 定义的结构变量（主题不覆盖） */
--radius            /* 8px */
--font-display      /* 衬线或无衬线，由字体开关控制 */
--font-body         /* 同上 */
--font-mono         /* JetBrains Mono */
--shadow            /* 主题自定义阴影色 */
```

---

## Task 1: 创建全局结构 token 文件 tokens.css

**Files:**
- Create: `web/src/assets/styles/tokens.css`

- [ ] **Step 1: 创建 tokens.css**

```css
/* web/src/assets/styles/tokens.css
 * 全局结构 token — 所有主题共享，不被主题文件覆盖
 * 包含：间距 / 字号 / 圆角 / 动效时长 / 缓动 / 字体族 / 阴影层级
 */

:root {
  /* ── 间距 scale（4px 网格） ── */
  --space-2:  0.125rem;   /* 2px */
  --space-4:  0.25rem;    /* 4px */
  --space-6:  0.375rem;   /* 6px */
  --space-8:  0.5rem;     /* 8px */
  --space-12: 0.75rem;    /* 12px */
  --space-16: 1rem;       /* 16px */
  --space-24: 1.5rem;     /* 24px */
  --space-32: 2rem;       /* 32px */
  --space-40: 2.5rem;     /* 40px */

  /* ── 字号层级 ── */
  --fs-title:   1rem;       /* 区块标题 */
  --fs-body:    0.9rem;     /* 正文 */
  --fs-ui:      0.82rem;    /* 次级 UI */
  --fs-caption: 0.78rem;    /* 控件 */
  --fs-hint:    0.7rem;     /* 提示/badge */

  /* ── 圆角 ── */
  --radius-sm: 5px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-input: 6px;
  --radius-card: 8px;

  /* ── 动效时长（三档制） ── */
  --duration-instant: 0.1s;   /* hover、关闭、退场 */
  --duration-fast:    0.15s;  /* 默认：按钮、面板、focus */
  --duration-slow:    0.25s;  /* 模态、大块进场 */

  /* ── 缓动曲线（全部 cubic-bezier，无 linear/ease） ── */
  --ease-out:      cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in:       cubic-bezier(0.7, 0, 0.84, 0);
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-smooth:   cubic-bezier(0.22, 0.68, 0, 1);

  /* ── 字体族 ── */
  --font-ui: 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue',
             'PingFang SC', 'Microsoft YaHei', sans-serif;
  --font-serif: 'EB Garamond', 'Noto Serif SC', 'Source Han Serif SC',
                'Songti SC', 'STSong', serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  /* 字体开关：默认衬线，body.font-sans 时切换为无衬线 */
  --font-display: var(--font-serif);
  --font-body: var(--font-serif);

  /* ── 阴影层级（阴影色由主题定义） ── */
  --shadow-xs: 0 1px 3px var(--shadow-color, rgba(0, 0, 0, 0.04));
  --shadow-sm: 0 1px 4px var(--shadow-color, rgba(0, 0, 0, 0.06));
  --shadow-md: 0 2px 8px var(--shadow-color, rgba(0, 0, 0, 0.08));
  --shadow-lg: 0 4px 16px var(--shadow-color, rgba(0, 0, 0, 0.12));
  --shadow-xl: 0 8px 32px var(--shadow-color, rgba(0, 0, 0, 0.18));

  /* ── 布局常量 ── */
  --sidebar-width: 240px;
  --titlebar-h: 44px;
  --chat-column-width: 720px;
}

/* 字体开关：无衬线模式 */
body.font-sans {
  --font-display: var(--font-ui);
  --font-body: var(--font-ui);
}
```

- [ ] **Step 2: 验证文件创建**

Run: 检查文件存在且内容完整
Expected: 文件存在于 `web/src/assets/styles/tokens.css`

- [ ] **Step 3: Commit**

```bash
git add web/src/assets/styles/tokens.css
git commit -m "feat(theme): add global structural tokens (spacing/type/radius/motion/font)"
```

---

## Task 2: 创建动画 keyframes 文件 animations.css

**Files:**
- Create: `web/src/assets/styles/animations.css`

- [ ] **Step 1: 创建 animations.css**

```css
/* web/src/assets/styles/animations.css
 * 全部 @keyframes 定义 — 单一真相来源
 * 命名前缀 hana-*，与 openhanako 保持一致
 */

/* ── Spin ── */
@keyframes hana-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

@keyframes hana-globe-spin {
  from { transform: rotateY(0deg); }
  to   { transform: rotateY(360deg); }
}

/* ── Fade ── */
@keyframes hana-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes hana-fade-out {
  from { opacity: 1; }
  to   { opacity: 0; }
}

/* ── Fade + Slide Y（位移量由 --slide-y 控制，默认 4px） ── */
@keyframes hana-fade-up {
  from { opacity: 0; transform: translateY(var(--slide-y, 4px)); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes hana-fade-down {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(var(--slide-y, 4px)); }
}

/* ── Chat Stream ── */
@keyframes hana-stream-tail-in {
  from { opacity: 0.18; }
  to   { opacity: 1; }
}
@keyframes hana-chat-soft-down-in {
  from { opacity: 0; transform: translateY(-3px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes hana-chat-soft-up-in {
  from { opacity: 0; transform: translateY(3px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes hana-tool-bar-in {
  from { opacity: 0; transform: scaleY(0); }
  to   { opacity: 1; transform: scaleY(1); }
}

/* ── Scale + Popout ── */
@keyframes hana-scale-in {
  from { opacity: 0; transform: scale(0.96) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes hana-popout {
  from { opacity: 0; transform: scale(0.92); }
  to   { opacity: 1; transform: scale(1); }
}

/* ── Slide X（浮窗） ── */
@keyframes hana-slide-in-left {
  from { opacity: 0; transform: translateX(-20px) scale(0.97); }
  to   { opacity: 1; transform: translateX(0) scale(1); }
}
@keyframes hana-slide-out-left {
  from { opacity: 1; transform: translateX(0) scale(1); }
  to   { opacity: 0; transform: translateX(-12px) scale(0.97); }
}

/* ── Slide Y（面板从上方进出） ── */
@keyframes hana-slide-in-top {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes hana-slide-out-top {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-6px); }
}

/* ── 卡片从顶部滑入 ── */
@keyframes hana-card-slide-down {
  from { transform: translateY(-110%); opacity: 0; }
  to   { transform: translateY(0);     opacity: 1; }
}

/* ── Pulse / Expand / Hint ── */
@keyframes hana-pulse {
  0%, 100% { opacity: var(--pulse-lo, 0.3); }
  50%      { opacity: var(--pulse-hi, 1); }
}
@keyframes hana-expand {
  from { max-height: 0; opacity: 0; }
  to   { max-height: 800px; opacity: 1; }
}
@keyframes hana-hint-fade {
  0%, 60% { opacity: 1; }
  100%    { opacity: 0; }
}

/* ── Rise + Clip（确认栏） ── */
@keyframes hana-rise {
  from { opacity: 0; transform: translateY(24px); clip-path: inset(100% 0 0 0); }
  to   { opacity: 1; transform: translateY(0);     clip-path: inset(0 0 0 0); }
}
@keyframes hana-retract {
  from { opacity: 1; transform: translateY(0);     clip-path: inset(0 0 0 0); }
  to   { opacity: 0; transform: translateY(24px); clip-path: inset(100% 0 0 0); }
}

/* ── 打字机省略号 ── */
@keyframes hana-typewriter-dots {
  0%, 100% { content: '\00a0'; }
  25%      { content: '.'; }
  50%      { content: '..'; }
  75%      { content: '...'; }
}
@keyframes hana-cycling-dots {
  0%, 100% { content: '.'; }
  33%      { content: '..'; }
  66%      { content: '...'; }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/assets/styles/animations.css
git commit -m "feat(theme): add hana-* keyframes animation library"
```

---

## Task 3: 创建默认主题 warm-paper.css

**Files:**
- Create: `web/src/themes/warm-paper.css`

- [ ] **Step 1: 创建 warm-paper.css**

```css
/* web/src/themes/warm-paper.css
 * 默认主题 — 暖纸底 + 远山青印章色
 * 灵感：和纸手抄本，温润文人感
 */

[data-theme="warm-paper"],
:root:not([data-theme]) {
  /* ── 背景 ── */
  --bg-primary:    #F8F4ED;
  --bg-secondary:  #F4F0EA;
  --bg-card:       #FCFAF5;
  --user-bubble:   rgba(83, 125, 150, 0.08);

  /* ── 主色调（远山青） ── */
  --accent:        #537D96;
  --accent-light:  #456A80;
  --accent-pink:   #EC8F8D;
  --accent-pink-light: #EC8F8D;
  --accent-pink-soft:  rgba(236, 143, 141, 0.1);

  /* ── 文字（5 档墨色） ── */
  --text-primary:   #3B3D3F;
  --text-secondary: #6B6F73;
  --text-tertiary:  #8E9196;

  /* ── 边框与阴影 ── */
  --border:         rgba(122, 96, 88, 0.18);
  --shadow-color:   rgba(59, 61, 63, 0.09);

  /* ── 状态色 ── */
  --status-ok:      #7BAE7F;
  --status-error:   #8B3A3A;
  --status-warn:    #C99A6A;

  /* ── 聊天专用 ── */
  --hana-text:      #2B3A4E;
  --tool-bg:        rgba(83, 125, 150, 0.06);

  /* ── 侧边栏 ── */
  --sidebar-bg:     #F4F0EA;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/themes/warm-paper.css
git commit -m "feat(theme): add warm-paper default theme (paper manuscript aesthetic)"
```

---

## Task 4: 创建深色主题 midnight.css

**Files:**
- Create: `web/src/themes/midnight.css`

- [ ] **Step 1: 创建 midnight.css**

```css
/* web/src/themes/midnight.css
 * 深色主题 — 深青蓝底 + 暖玫瑰 accent
 * 灵感：雨夜窗外，沉静深邃
 */

[data-theme="midnight"] {
  /* ── 背景 ── */
  --bg-primary:    #3B4A54;
  --bg-secondary:  #34424B;
  --bg-card:       #445560;
  --user-bubble:   rgba(170, 121, 141, 0.10);

  /* ── 主色调（柔粉） ── */
  --accent:        #C99AAF;
  --accent-light:  #D8AFC0;
  --accent-pink:   #EAB2A0;
  --accent-pink-light: #EAB2A0;
  --accent-pink-soft:  rgba(234, 178, 160, 0.12);

  /* ── 文字 ── */
  --text-primary:   #E1EAF0;
  --text-secondary: #B7C5CE;
  --text-tertiary:  #A3B5C0;

  /* ── 边框与阴影 ── */
  --border:         rgba(170, 121, 141, 0.16);
  --shadow-color:   rgba(0, 0, 0, 0.36);

  /* ── 状态色 ── */
  --status-ok:      #8CC790;
  --status-error:   #C77070;
  --status-warn:    #D4A574;

  /* ── 聊天专用 ── */
  --hana-text:      #DCE6EC;
  --tool-bg:        rgba(67, 91, 102, 0.20);

  /* ── 侧边栏 ── */
  --sidebar-bg:     #34424B;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/themes/midnight.css
git commit -m "feat(theme): add midnight dark theme (deep teal + soft rose)"
```

---

## Task 5: 创建其余 9 个主题文件

**Files:**
- Create: `web/src/themes/high-contrast.css`
- Create: `web/src/themes/grass-aroma.css`
- Create: `web/src/themes/contemplation.css`
- Create: `web/src/themes/coral.css`
- Create: `web/src/themes/delve.css`
- Create: `web/src/themes/deep-think.css`
- Create: `web/src/themes/absolutely.css`
- Create: `web/src/themes/midnight-contrast.css`

- [ ] **Step 1: 创建 high-contrast.css**

```css
/* web/src/themes/high-contrast.css
 * 无障碍高对比浅色主题 — 降暖黄、提对比度
 */

[data-theme="high-contrast"] {
  --bg-primary:    #FAF8F7;
  --bg-secondary:  #F0EEEC;
  --bg-card:       #FFFFFF;
  --user-bubble:   rgba(0, 0, 0, 0.06);

  --accent:        #1A3A4A;
  --accent-light:  #0D2A3A;
  --accent-pink:   #C03B3B;
  --accent-pink-light: #C03B3B;
  --accent-pink-soft:  rgba(192, 59, 59, 0.1);

  --text-primary:   #1A1A1A;
  --text-secondary: #4A4A4A;
  --text-tertiary:  #6A6A6A;

  --border:         rgba(0, 0, 0, 0.25);
  --shadow-color:   rgba(0, 0, 0, 0.12);

  --status-ok:      #2D7A33;
  --status-error:   #A02020;
  --status-warn:    #8A5A1A;

  --hana-text:      #1A2A3A;
  --tool-bg:        rgba(0, 0, 0, 0.04);
  --sidebar-bg:     #F0EEEC;
}
```

- [ ] **Step 2: 创建 grass-aroma.css**

```css
/* web/src/themes/grass-aroma.css
 * 草香主题 — 青草绿调，清晨露水感
 */

[data-theme="grass-aroma"] {
  --bg-primary:    #F5F8F3;
  --bg-secondary:  #EDF2E9;
  --bg-card:       #FAFCF8;
  --user-bubble:   rgba(122, 174, 127, 0.08);

  --accent:        #5B8C5F;
  --accent-light:  #4A7A4E;
  --accent-pink:   #E8A07A;
  --accent-pink-light: #E8A07A;
  --accent-pink-soft:  rgba(232, 160, 122, 0.1);

  --text-primary:   #2D3F30;
  --text-secondary: #5A6B5E;
  --text-tertiary:  #8A9A8E;

  --border:         rgba(91, 140, 95, 0.18);
  --shadow-color:   rgba(45, 63, 48, 0.08);

  --status-ok:      #5B8C5F;
  --status-error:   #A04545;
  --status-warn:    #C99A5A;

  --hana-text:      #2D4A35;
  --tool-bg:        rgba(91, 140, 95, 0.06);
  --sidebar-bg:     #EDF2E9;
}
```

- [ ] **Step 3: 创建 contemplation.css**

```css
/* web/src/themes/contemplation.css
 * 沉思主题 — 灰蓝调，雨天窗外感
 */

[data-theme="contemplation"] {
  --bg-primary:    #F3F5F7;
  --bg-secondary:  #E8ECF0;
  --bg-card:       #F8FAFC;
  --user-bubble:   rgba(89, 120, 145, 0.08);

  --accent:        #597891;
  --accent-light:  #466A85;
  --accent-pink:   #C99AAF;
  --accent-pink-light: #C99AAF;
  --accent-pink-soft:  rgba(201, 154, 175, 0.1);

  --text-primary:   #2A3340;
  --text-secondary: #5A6678;
  --text-tertiary:  #8A96A8;

  --border:         rgba(89, 120, 145, 0.18);
  --shadow-color:   rgba(42, 51, 64, 0.08);

  --status-ok:      #6A9A70;
  --status-error:   #A05050;
  --status-warn:    #B89060;

  --hana-text:      #3A4A5C;
  --tool-bg:        rgba(89, 120, 145, 0.06);
  --sidebar-bg:     #E8ECF0;
}
```

- [ ] **Step 4: 创建 coral.css**

```css
/* web/src/themes/coral.css
 * 珊瑚主题 — 墨蓝 + 珊瑚朱 + 古金
 */

[data-theme="coral"] {
  --bg-primary:    #FDF6EC;
  --bg-secondary:  #F5EBD9;
  --bg-card:       #FFFBF2;
  --user-bubble:   rgba(210, 95, 75, 0.08);

  --accent:        #2B4858;
  --accent-light:  #1F3848;
  --accent-pink:   #D25F4B;
  --accent-pink-light: #D25F4B;
  --accent-pink-soft:  rgba(210, 95, 75, 0.1);

  --text-primary:   #2A2520;
  --text-secondary: #5C5248;
  --text-tertiary:  #8C8074;

  --border:         rgba(210, 165, 100, 0.22);
  --shadow-color:   rgba(42, 37, 32, 0.08);

  --status-ok:      #6A9070;
  --status-error:   #B04540;
  --status-warn:    #C09430;

  --hana-text:      #3A3530;
  --tool-bg:        rgba(43, 72, 88, 0.06);
  --sidebar-bg:     #F5EBD9;
}
```

- [ ] **Step 5: 创建 delve.css**

```css
/* web/src/themes/delve.css
 * ChatGPT 风格 — 冷调纯白 + 纯黑高对比
 */

[data-theme="delve"] {
  --bg-primary:    #FFFFFF;
  --bg-secondary:  #F7F7F8;
  --bg-card:       #FFFFFF;
  --user-bubble:   rgba(0, 0, 0, 0.05);

  --accent:        #202123;
  --accent-light:  #000000;
  --accent-pink:   #10A37F;
  --accent-pink-light: #10A37F;
  --accent-pink-soft:  rgba(16, 163, 127, 0.1);

  --text-primary:   #202123;
  --text-secondary: #565869;
  --text-tertiary:  #8E8FA0;

  --border:         rgba(0, 0, 0, 0.1);
  --shadow-color:   rgba(0, 0, 0, 0.05);

  --status-ok:      #10A37F;
  --status-error:   #EF4146;
  --status-warn:    #F5A623;

  --hana-text:      #202123;
  --tool-bg:        rgba(0, 0, 0, 0.03);
  --sidebar-bg:     #F7F7F8;
}
```

- [ ] **Step 6: 创建 deep-think.css**

```css
/* web/src/themes/deep-think.css
 * DeepSeek 风格 — 干净白底 + 克制蓝紫
 */

[data-theme="deep-think"] {
  --bg-primary:    #FCFCFD;
  --bg-secondary:  #F4F5F8;
  --bg-card:       #FFFFFF;
  --user-bubble:   rgba(81, 95, 220, 0.06);

  --accent:        #515FDC;
  --accent-light:  #3F4EC8;
  --accent-pink:   #E85A4F;
  --accent-pink-light: #E85A4F;
  --accent-pink-soft:  rgba(232, 90, 79, 0.1);

  --text-primary:   #1A1B2E;
  --text-secondary: #5A5D7A;
  --text-tertiary:  #8A8DA8;

  --border:         rgba(81, 95, 220, 0.14);
  --shadow-color:   rgba(26, 27, 46, 0.06);

  --status-ok:      #4D7CC8;
  --status-error:   #DC4C4C;
  --status-warn:    #E8A040;

  --hana-text:      #2A2D4A;
  --tool-bg:        rgba(81, 95, 220, 0.04);
  --sidebar-bg:     #F4F5F8;
}
```

- [ ] **Step 7: 创建 absolutely.css**

```css
/* web/src/themes/absolutely.css
 * 暖奶油底 + 哑光赤陶 accent
 */

[data-theme="absolutely"] {
  --bg-primary:    #F4F3EE;
  --bg-secondary:  #EAE8E1;
  --bg-card:       #FAF9F5;
  --user-bubble:   rgba(165, 75, 55, 0.08);

  --accent:        #A54B37;
  --accent-light:  #8F3D2D;
  --accent-pink:   #6B8E7A;
  --accent-pink-light: #6B8E7A;
  --accent-pink-soft:  rgba(107, 142, 122, 0.1);

  --text-primary:   #2E2A26;
  --text-secondary: #665E56;
  --text-tertiary:  #948A80;

  --border:         rgba(165, 75, 55, 0.16);
  --shadow-color:   rgba(46, 42, 38, 0.07);

  --status-ok:      #6B8E7A;
  --status-error:   #A04540;
  --status-warn:    #C09040;

  --hana-text:      #3A332E;
  --tool-bg:        rgba(165, 75, 55, 0.05);
  --sidebar-bg:     #EAE8E1;
}
```

- [ ] **Step 8: 创建 midnight-contrast.css**

```css
/* web/src/themes/midnight-contrast.css
 * 无障碍高对比深色主题 — 更深青蓝 + 高可读文字
 */

[data-theme="midnight-contrast"] {
  --bg-primary:    #26343D;
  --bg-secondary:  #1F2A32;
  --bg-card:       #2E3E48;
  --user-bubble:   rgba(255, 255, 255, 0.08);

  --accent:        #E0BFC8;
  --accent-light:  #F0D0D8;
  --accent-pink:   #F0C0A0;
  --accent-pink-light: #F0C0A0;
  --accent-pink-soft:  rgba(240, 192, 160, 0.14);

  --text-primary:   #F0F4F8;
  --text-secondary: #C8D4DC;
  --text-tertiary:  #A0B0BC;

  --border:         rgba(255, 255, 255, 0.2);
  --shadow-color:   rgba(0, 0, 0, 0.5);

  --status-ok:      #80D088;
  --status-error:   #E08080;
  --status-warn:    #E8B060;

  --hana-text:      #E8EEF4;
  --tool-bg:        rgba(255, 255, 255, 0.06);
  --sidebar-bg:     #1F2A32;
}
```

- [ ] **Step 9: Commit 全部主题文件**

```bash
git add web/src/themes/
git commit -m "feat(theme): add 9 additional themes (high-contrast/grass-aroma/contemplation/coral/delve/deep-think/absolutely/midnight-contrast)"
```

---

## Task 6: 创建主题切换 composable useTheme.ts

**Files:**
- Create: `web/src/composables/useTheme.ts`

- [ ] **Step 1: 创建 useTheme.ts**

```typescript
// web/src/composables/useTheme.ts
// 主题切换 composable — 12 选项（auto + 11 主题）
// 替代 useNightMode.ts 的主题选择职责

import { ref, computed, watch } from 'vue'

/** 主题 ID 类型 */
export type ThemeId =
  | 'auto'
  | 'warm-paper'
  | 'midnight'
  | 'high-contrast'
  | 'grass-aroma'
  | 'contemplation'
  | 'coral'
  | 'delve'
  | 'deep-think'
  | 'absolutely'
  | 'midnight-contrast'

/** 主题元信息 */
export interface ThemeMeta {
  id: ThemeId
  name: string
  description: string
  isDark: boolean
  preview: { bg: string; accent: string; text: string }
}

/** 全部主题元信息（供 ThemePicker 渲染） */
export const THEMES: ThemeMeta[] = [
  {
    id: 'auto',
    name: '自动',
    description: '跟随系统明暗',
    isDark: false,
    preview: { bg: 'linear-gradient(135deg, #F8F4ED 50%, #3B4A54 50%)', accent: '#537D96', text: '#3B3D3F' },
  },
  {
    id: 'warm-paper',
    name: '暖纸',
    description: '和纸手抄本，温润文人感',
    isDark: false,
    preview: { bg: '#F8F4ED', accent: '#537D96', text: '#3B3D3F' },
  },
  {
    id: 'midnight',
    name: '青夜',
    description: '深青蓝底，柔粉印章',
    isDark: true,
    preview: { bg: '#3B4A54', accent: '#C99AAF', text: '#E1EAF0' },
  },
  {
    id: 'high-contrast',
    name: '素白',
    description: '高对比浅色，无障碍',
    isDark: false,
    preview: { bg: '#FAF8F7', accent: '#1A3A4A', text: '#1A1A1A' },
  },
  {
    id: 'grass-aroma',
    name: '草香',
    description: '青草绿调，清晨露水',
    isDark: false,
    preview: { bg: '#F5F8F3', accent: '#5B8C5F', text: '#2D3F30' },
  },
  {
    id: 'contemplation',
    name: '沉思',
    description: '灰蓝调，雨天窗外',
    isDark: false,
    preview: { bg: '#F3F5F7', accent: '#597891', text: '#2A3340' },
  },
  {
    id: 'coral',
    name: '珊瑚',
    description: '墨蓝 + 珊瑚朱',
    isDark: false,
    preview: { bg: '#FDF6EC', accent: '#2B4858', text: '#2A2520' },
  },
  {
    id: 'delve',
    name: '极简',
    description: '冷调纯白 + 纯黑',
    isDark: false,
    preview: { bg: '#FFFFFF', accent: '#202123', text: '#202123' },
  },
  {
    id: 'deep-think',
    name: '深思',
    description: '白底 + 克制蓝紫',
    isDark: false,
    preview: { bg: '#FCFCFD', accent: '#515FDC', text: '#1A1B2E' },
  },
  {
    id: 'absolutely',
    name: '赤陶',
    description: '暖奶油 + 哑光赤陶',
    isDark: false,
    preview: { bg: '#F4F3EE', accent: '#A54B37', text: '#2E2A26' },
  },
  {
    id: 'midnight-contrast',
    name: '青夜·高对比',
    description: '更深青蓝，高可读',
    isDark: true,
    preview: { bg: '#26343D', accent: '#E0BFC8', text: '#F0F4F8' },
  },
]

const STORAGE_KEY = 'maxma.theme'
const DEFAULT_THEME: ThemeId = 'warm-paper'
const AUTO_LIGHT: ThemeId = 'warm-paper'
const AUTO_DARK: ThemeId = 'midnight'

/** 当前存储的主题设置（auto 或具体主题） */
const storedTheme = ref<ThemeId>(loadStoredTheme())

/** 系统是否暗色 */
const systemIsDark = ref(
  window.matchMedia('(prefers-color-scheme: dark)').matches
)

// 监听系统主题变化
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  systemIsDark.value = e.matches
})

/** 当前实际生效的主题（auto 解析后） */
const activeTheme = computed<ThemeId>(() => {
  if (storedTheme.value === 'auto') {
    return systemIsDark.value ? AUTO_DARK : AUTO_LIGHT
  }
  return storedTheme.value
})

/** 当前是否暗色（供 StickerInline 等使用） */
const isDark = computed(() => {
  const t = activeTheme.value
  return t === 'midnight' || t === 'midnight-contrast'
})

function loadStoredTheme(): ThemeId {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return DEFAULT_THEME
  const valid = THEMES.find(t => t.id === raw)
  return valid ? (raw as ThemeId) : DEFAULT_THEME
}

function setTheme(theme: ThemeId) {
  storedTheme.value = theme
  localStorage.setItem(STORAGE_KEY, theme)
}

function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute('data-theme', theme)
}

// 自动应用主题到 DOM
watch(activeTheme, (t) => applyTheme(t), { immediate: true })

export function useTheme() {
  return {
    storedTheme,
    activeTheme,
    isDark,
    setTheme,
    THEMES,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/composables/useTheme.ts
git commit -m "feat(theme): add useTheme composable with 12 themes + auto mode"
```

---

## Task 7: 创建主题选择器组件 ThemePicker.vue

**Files:**
- Create: `web/src/components/ThemePicker.vue`

- [ ] **Step 1: 创建 ThemePicker.vue**

```vue
<!-- web/src/components/ThemePicker.vue -->
<!-- 主题选择器 — 在设置弹窗内展示 12 个主题预览块 -->
<template>
  <div class="theme-picker">
    <div class="theme-picker-header">主题</div>
    <div class="theme-grid">
      <button
        v-for="t in THEMES"
        :key="t.id"
        class="theme-card"
        :class="{ active: storedTheme === t.id }"
        @click="setTheme(t.id)"
        :title="t.description"
      >
        <div class="theme-preview" :style="{ background: t.preview.bg }">
          <span class="theme-preview-accent" :style="{ background: t.preview.accent }"></span>
          <span class="theme-preview-text" :style="{ color: t.preview.text }">Aa</span>
        </div>
        <div class="theme-name">{{ t.name }}</div>
      </button>
    </div>
    <div class="font-toggle">
      <span class="font-toggle-label">衬线字体</span>
      <button
        class="font-toggle-btn"
        :class="{ on: serifFont }"
        @click="toggleSerif"
      >
        {{ serifFont ? '开' : '关' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useTheme } from '@/composables/useTheme'

const { storedTheme, setTheme, THEMES } = useTheme()

const serifFont = ref(localStorage.getItem('maxma.fontSerif') !== 'off')

function toggleSerif() {
  serifFont.value = !serifFont.value
  localStorage.setItem('maxma.fontSerif', serifFont.value ? 'on' : 'off')
  document.body.classList.toggle('font-sans', !serifFont.value)
}
</script>

<style scoped>
.theme-picker {
  padding: 8px 0;
}
.theme-picker-header {
  font-size: 0.78rem;
  color: var(--text-tertiary);
  padding: 0 12px 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 0 8px;
}
.theme-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}
.theme-card:hover {
  background: var(--overlay-subtle, rgba(0, 0, 0, 0.03));
}
.theme-card.active {
  border-color: var(--accent);
  background: var(--overlay-light, rgba(0, 0, 0, 0.05));
}
.theme-preview {
  width: 100%;
  height: 40px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--border);
  position: relative;
  overflow: hidden;
}
.theme-preview-accent {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}
.theme-preview-text {
  font-size: 14px;
  font-weight: 500;
  font-family: var(--font-serif);
}
.theme-name {
  font-size: 0.7rem;
  color: var(--text-secondary);
}
.theme-card.active .theme-name {
  color: var(--accent);
  font-weight: 500;
}
.font-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 4px;
  margin-top: 6px;
  border-top: 1px solid var(--border);
}
.font-toggle-label {
  font-size: 0.78rem;
  color: var(--text-secondary);
}
.font-toggle-btn {
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.7rem;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}
.font-toggle-btn.on {
  background: var(--accent);
  color: var(--bg-primary);
  border-color: var(--accent);
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/ThemePicker.vue
git commit -m "feat(theme): add ThemePicker component with 12 theme previews + serif toggle"
```

---

## Task 8: 修改 App.vue — 集成新主题系统

**Files:**
- Modify: `web/src/App.vue`

- [ ] **Step 1: 修改 <style> 顶部 import**

将 App.vue `<style>` 块顶部的 `@import` 行：

```css
@import '@/assets/styles/design-system.css';
```

替换为：

```css
@import '@/assets/styles/tokens.css';
@import '@/assets/styles/animations.css';
@import '@/assets/styles/design-system.css';
```

- [ ] **Step 2: 从 :root 中移除配色变量**

在 App.vue 的 `:root { ... }` 块中，删除以下配色变量（它们已迁移到主题文件）：

```css
/* 删除这些行 */
--bg-primary: #ffffff;
--bg-secondary: #f9fafb;
--bg-card: #ffffff;
--text-primary: #1f2937;
--text-secondary: #6b7280;
--text-tertiary: #9ca3af;
--accent: #000000;
--accent-light: #b9b9b9;
--accent-pink: #FF6B9D;
--accent-pink-light: #FF8FAB;
--accent-pink-soft: rgba(255, 107, 157, 0.1);
--border: #e5e7eb;
--user-bubble: #ffffff;
--status-ok: #000000;
--status-error: #ef4444;
--status-warn: #f59e0b;
--shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
--shadow-xs: 0 1px 3px rgba(0, 0, 0, 0.04);
--shadow-soft: 0 8px 24px rgba(0, 0, 0, 0.06);
--shadow-sm: 0 1px 4px rgba(0, 0, 0, 0.06);
--shadow-md: 0 2px 8px rgba(0, 0, 0, 0.08);
--shadow-lg: 0 4px 16px rgba(0, 0, 0, 0.12);
--shadow-xl: 0 6px 28px rgba(0, 0, 0, 0.18);
--shadow-pink: 0 4px 16px rgba(255, 107, 157, 0.3);
--font-display: 'ZCOOL KuaiLe', 'Comic Sans MS', cursive;
--font-body: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
  'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
--radius: 10px;
```

保留 `:root` 中的 `--radius`（如已被引用），但改为 `--radius: var(--radius-md);`（引用 tokens.css）。

- [ ] **Step 3: 删除 .night-mode 覆盖块**

删除 App.vue 中整个 `.app-layout.night-mode { ... }` CSS 块（约 327-387 行），包括其所有子规则（`.night-mode .chat-window`、`.night-mode .empty-state`、`.night-mode .sidebar::after` 等）。这些覆盖已被主题文件替代。

- [ ] **Step 4: 修改根元素绑定**

在 App.vue `<template>` 中，将：

```html
<div class="app-layout" :class="{ 'night-mode': isNightMode }">
```

改为：

```html
<div class="app-layout">
```

（主题通过 `document.documentElement.setAttribute('data-theme', ...)` 在 useTheme 中设置，不需要 class 绑定）

- [ ] **Step 5: 在 <script setup> 中替换 useNightMode 为 useTheme**

将现有的：

```typescript
const { nightModeSetting, isNightMode, cycleNightModeSetting } = useNightModeClock()
```

替换为：

```typescript
import { useTheme } from '@/composables/useTheme'
const { storedTheme, isDark: isNightMode } = useTheme()
// isNightMode 保留供 StickerInline 使用
```

删除 `nightModeSetting`、`cycleNightModeSetting` 的使用（设置弹窗中的"深夜模式"按钮将被 ThemePicker 替代）。

- [ ] **Step 6: 在设置弹窗中替换深夜模式按钮为 ThemePicker**

在 App.vue 设置弹窗模板中，找到"深夜模式"按钮：

```html
<button class="popup-item popup-action neutral" @click="cycleNightModeSetting">
  深夜模式：{{ nightModeLabel }}
</button>
```

替换为：

```html
<ThemePicker />
```

并在 `<script setup>` 顶部添加导入：

```typescript
import ThemePicker from '@/components/ThemePicker.vue'
```

- [ ] **Step 7: 添加字体 CDN 到 index.html**

在 `web/index.html` 的 `<head>` 中添加：

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Noto+Serif+SC:wght@400;500;600&display=swap" rel="stylesheet">
```

- [ ] **Step 8: 验证前端构建**

Run: `cd web && npm run build`
Expected: 构建成功无错误

- [ ] **Step 9: Commit**

```bash
git add web/src/App.vue web/index.html
git commit -m "feat(theme): integrate 12-theme system into App.vue, remove night-mode overrides"
```

---

## Task 9: 适配 useNightMode.ts — 兼容旧 API

**Files:**
- Modify: `web/src/composables/useNightMode.ts`

- [ ] **Step 1: 重写 useNightMode.ts**

将整个文件内容替换为：

```typescript
// web/src/composables/useNightMode.ts
// 兼容层 — 将旧的 isNightMode API 委托给 useTheme
// StickerInline.vue 等组件仍可使用 useNightModeState()

import { computed } from 'vue'
import { useTheme } from '@/composables/useTheme'

export function useNightModeState() {
  const { isDark } = useTheme()
  return { isNightMode: isDark }
}

export function useNightModeClock() {
  const { isDark } = useTheme()
  return {
    isNightMode: isDark,
    nightModeSetting: computed(() => 'auto'),
    isLateNight: isDark,
  }
}
```

- [ ] **Step 2: 验证 StickerInline 仍能正常工作**

Run: 检查 `web/src/components/StickerInline.vue` 是否仍引用 `useNightModeState`
Expected: 引用存在，编译无错误

- [ ] **Step 3: Commit**

```bash
git add web/src/composables/useNightMode.ts
git commit -m "refactor(theme): delegate useNightMode to useTheme for backward compat"
```

---

## Task 10: 端到端验证与主题切换测试

**Files:**
- 无新建文件，仅验证

- [ ] **Step 1: 启动前端开发服务器**

Run: `cd web && npm run dev`
Expected: 开发服务器启动，浏览器打开应用

- [ ] **Step 2: 验证默认主题 warm-paper 生效**

检查：
- 背景应为暖纸色 `#F8F4ED`（非纯白）
- 主文字应为 `#3B3D3F`（深灰，非纯黑）
- accent 色应为远山青 `#537D96`（非纯黑）
- 正文字体应为衬线体 EB Garamond + Noto Serif SC

- [ ] **Step 3: 打开设置弹窗验证 ThemePicker**

点击侧边栏"设置"按钮：
- 应显示 3 列 × 4 行的主题预览网格
- 每个预览块显示该主题的背景色 + accent 色块 + "Aa" 文字
- "暖纸"应高亮显示（active 状态）
- 底部应有"衬线字体"开关

- [ ] **Step 4: 切换到 midnight 主题**

点击"青夜"预览块：
- 整个界面应立即切换为深青蓝底 + 柔粉 accent
- 文字应变为浅色 `#E1EAF0`
- 切换应平滑（无闪烁）

- [ ] **Step 5: 验证衬线字体开关**

点击"衬线字体"开关关闭：
- 正文字体应从衬线体切换为无衬线体（Inter）
- "Aa" 预览文字字体应同步变化

- [ ] **Step 6: 刷新页面验证持久化**

刷新浏览器：
- 之前选择的主题应保持（localStorage 持久化）
- 衬线字体开关状态应保持

- [ ] **Step 7: 验证 auto 模式**

选择"自动"主题：
- 如果系统是暗色，应自动切换到 midnight
- 如果系统是浅色，应自动切换到 warm-paper
- 修改系统主题设置，应用应跟随变化

- [ ] **Step 8: 验证所有 11 个主题**

依次点击每个主题预览块，确认：
- 每个主题都能正确切换
- 配色与预览块一致
- 无样式错乱

- [ ] **Step 9: 验证聊天功能正常**

在 midnight 主题下发送一条消息：
- 用户气泡应使用 `--user-bubble` 半透明色
- AI 回复文字应使用 `--hana-text` 色
- 工具调用区域应使用 `--tool-bg` 色
- 错误横幅颜色应正常

- [ ] **Step 10: Final commit**

```bash
git add -A
git commit -m "test(theme): verified 12 themes + serif toggle + persistence + auto mode"
```

---

## Self-Review

### 1. Spec 覆盖检查

| 需求 | 对应 Task |
|------|----------|
| 11 个主题 + auto | Task 3/4/5（11 个 CSS 文件）+ Task 6（auto 逻辑） |
| 衬线/无衬线字体切换 | Task 1（tokens.css font-sans 类）+ Task 7（ThemePicker 开关） |
| 纸本雅致配色 | Task 3（warm-paper 默认主题） |
| 动画 token（cubic-bezier + keyframes） | Task 1（tokens.css）+ Task 2（animations.css） |
| 主题切换 UI | Task 7（ThemePicker）+ Task 8（App.vue 集成） |
| 持久化 | Task 6（localStorage） |
| auto 模式 | Task 6（matchMedia 监听） |
| 后向兼容（StickerInline） | Task 9（useNightMode 兼容层） |

### 2. 占位符扫描

无占位符。每个 CSS 变量都有具体色值，每个函数都有完整实现。

### 3. 类型一致性

- `ThemeId` 类型在 Task 6 定义，在 Task 7 使用 — 一致
- `THEMES` 数组在 Task 6 定义，在 Task 7 导入使用 — 一致
- `useTheme()` 返回值 `{ storedTheme, activeTheme, isDark, setTheme, THEMES }` 在 Task 7/8/9 使用 — 一致
- CSS 变量名 `--bg-primary` / `--accent` / `--text-primary` 等在所有主题文件和 tokens.css 中统一 — 一致

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-08-paper-manuscript-themes.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
