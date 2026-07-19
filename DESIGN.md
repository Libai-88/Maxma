---
version: alpha
name: MaxmaHere-Warm-Precision
description: A warm-precision design system for MaxmaHere — an AI Agent desktop client. Warm cream canvas, terracotta accent, serif display headings, four-step surface ladder.
colors:
  bg-primary: "#fcf9f5"
  bg-secondary: "#f5f0ea"
  bg-card: "#fefcf8"
  text-primary: "#2c2825"
  text-secondary: "#7a7068"
  text-tertiary: "#a89e94"
  accent: "#c17a5c"
  accent-hover: "#a8654a"
  accent-dark: "#945840"
  accent-light: "#e8d5c8"
  border: "rgba(200, 180, 160, 0.25)"
  border-strong: "rgba(180, 160, 140, 0.35)"
  user-bubble-bg: "#fcf9f5"
  status-ok: "#8aaa8a"
  status-error: "#d06a60"
  status-warn: "#c99a6a"
  status-info: "#7a9aaa"
typography:
  display:
    fontFamily: "'EB Garamond', 'Noto Serif SC', 'Source Han Serif SC', serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.3px"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  message:
    fontFamily: "inherit"
    fontSize: "16px"
    lineHeight: 1.6
  code:
    fontFamily: "'JetBrains Mono', 'SF Mono', 'Consolas', monospace"
    fontSize: "13px"
  label:
    fontSize: "10.5px"
    fontWeight: 500
    letterSpacing: "0.4px"
    textTransform: "uppercase"
  label-serif:
    fontFamily: "'EB Garamond', 'Noto Serif SC', serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.2px"
    textTransform: "uppercase"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "16px"
  pill: "100px"
  full: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "9px 22px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    borderColor: "{colors.border}"
    rounded: "{rounded.md}"
    padding: "6px 14px"
  input:
    backgroundColor: "{colors.bg-primary}"
    textColor: "{colors.text-primary}"
    borderColor: "{colors.border}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  chat-bubble-user:
    backgroundColor: "{colors.user-bubble-bg}"
    textColor: "{colors.text-primary}"
    borderColor: "{colors.border-strong}"
    rounded: "{rounded.xl}"
    asymmetric: "bottom-right 6px"
  chat-bubble-assistant:
    backgroundColor: "{colors.bg-card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
    asymmetric: "bottom-left 6px"
  nav-item:
    rounded: "{rounded.lg}"
    padding: "8px 14px"
  nav-item-active:
    backgroundColor: "rgba(193, 122, 92, 0.08)"
    textColor: "{colors.accent}"
    rounded: "{rounded.lg}"
    padding: "8px 14px"
    fontWeight: 500
  card-container:
    backgroundColor: "{colors.bg-card}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
  tool-bubble:
    backgroundColor: "{colors.bg-card}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
  sidebar:
    width: "240px"
    background: "{colors.bg-secondary}"
    paperTexture: true
    paperTextureOpacity: 0.15
  chat-input-wrapper:
    backgroundColor: "{colors.bg-card}"
    borderColor: "{colors.border}"
    rounded: "16px"
    padding: "4px 4px 4px 18px"
---

# Design System: MaxmaHere — Warm Precision

## 1. Overview

**Creative North Star: "The Workbench, Warmed"**

MaxmaHere is a workbench — in the center sits the conversation, the piece being crafted. Around it, arranged with intention, sit the tools: session management, provider configuration, memory inspection, environmental controls. Every tool has its place, and nothing distracts from the work itself.

The original design philosophy — **"The Workbench"** — is preserved. But a workbench can be warm. A well-used workshop has character: the worn wood of the bench, the patina on the tools, the warm light of a reading lamp. **Warm Precision** adds this dimension. The palette shifts from clinical white to warm cream, from black accent to terracotta, from pure sans-serif to a careful serif-for-headings hybrid. The result is a space that still feels engineered — but engineered for human use, not machine efficiency.

**This system rejects:** SaaS dashboard clichés (colored side-stripe borders, gradient accents, glassmorphism), generic AI-chat clones (pastel bubble colors, rounded-rectangle avatars, pill-shaped input bars with gradient send buttons), and any decorative flourish that competes with the conversation.

### Key Characteristics:
- **Warm cream canvas** (`#fcf9f5`) — reduces eye strain, feels personal, not institutional
- **Terracotta accent** (`#c17a5c`) — draws attention with warmth, not harshness
- **Serif display headings** — editorial character in view headers and section labels
- **Four-step surface ladder** — canvas → sand → card → raised, for clear depth hierarchy
- **Warm-tinted shadows** — brown-black falloff matches the cream base naturally
- **Paper texture** — subtle non-repeating texture on sidebar
- **System-native fonts** — serif for display (already loaded via Google Fonts), system sans for body
- **Content-forward layout** — UI chrome recedes, conversation leads

## 2. Colors

A warm monochrome palette with terracotta as the single accent. Every surface and text color stays within a warm-neutral axis. The warmth comes from cream-tinted whites and brown-tinted grays, not from saturation.

### 2.1 Accent — Terracotta

- **Terracotta** (`#c17a5c`): The sole accent color. Used for primary buttons, active navigation states, toggle active states, focus rings, and link emphasis. It replaces pure black as the primary interactive signal.
- **Terracotta Dark** (`#a8654a`): Hover state for primary buttons, active-state borders.
- **Terracotta Deep** (`#945840`): Active/pressed state for primary buttons.
- **Terracotta Tint** (`#e8d5c8`): Light backgrounds, running-state borders on tool bubbles.

**The Scarce Accent Rule.** Terracotta is used sparingly. It appears on primary CTAs, active navigation, focus indicators, and toggle switches. It never appears as decoration, section background, or card fill.

### 2.2 Neutral

- **Warm Cream** (`#fcf9f5`): Main application background (`--bg-primary`), input backgrounds. The dominant surface color.
- **Warm Sand** (`#f5f0ea`): Sidebar background, secondary surfaces, hover state backgrounds (`--bg-secondary`).
- **Warm Card** (`#fefcf8`): Card surfaces, chat bubbles, popups (`--bg-card`).
- **Warm Ink** (`#2c2825`): Body text (`--text-primary`). Near-black with warm undertone.
- **Warm Gray** (`#7a7068`): Secondary text, labels, descriptive information (`--text-secondary`).
- **Warm Mute** (`#a89e94`): Tertiary text, placeholder text (`--text-tertiary`).
- **Warm Hairline** (`rgba(200, 180, 160, 0.25)`): Borders, dividers, section separators (`--border`).

### 2.3 Status

- **Warm Green** (`#8aaa8a`): Operational status, connected indicators.
- **Warm Red** (`#d06a60`): Error states, destructive actions, error banners.
- **Warm Amber** (`#c99a6a`): Warning states, private-mode indicators.
- **Warm Blue** (`#7a9aaa`): Informational indicators.

### 2.4 Named Rules

**The One Accent Rule.** Terracotta is the single accent. No secondary accent color competes with it. Status colors appear only for their functional purpose and never as decoration.

**The Warm Ramp Rule.** The neutral ramp (cream → sand → card → raised) covers exactly four stops. Each stop has a distinct role. No mid-tone grays are added for "texture" or "atmosphere."

## 3. Typography

The typography system uses a **serif/sans hybrid** — serif for display headings, system sans for body text. The serif fonts (EB Garamond, Noto Serif SC) are already loaded via Google Fonts in the project and available through `--font-serif` in tokens.css.

**Body Font:** System UI stack — `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`
**Display Font:** `'EB Garamond', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'STSong', serif`
**Code Font:** `'JetBrains Mono', 'SF Mono', 'Consolas', monospace`

**Character:** A serif/sans hybrid system adapted for bilingual content (English + CJK). Display headings use the serif family for editorial warmth and visual hierarchy. Body text uses the OS system sans for proven readability and CJK support.

### Hierarchy
- **Display** (600 weight, 18px, -0.3px letter-spacing, serif): View headers in sidebar, section titles, modal headers. Never used for body text, buttons, or navigation items.
- **Body** (400 weight, 15px, 1.6 line-height): Default application text. Navigation items, labels, descriptions, tool content.
- **Message** (400 weight, 16px, 1.6 line-height): Chat conversation text. Slightly larger than body for comfortable reading.
- **Code / Mono** (400 weight, 13px): Inline code, code blocks, version labels, timestamps.
- **Label** (500 weight, 10.5px, 0.4px letter-spacing, uppercase): Metadata labels, field labels, chip labels.
- **Label Serif** (600 weight, 12px, 0.2px letter-spacing, uppercase, serif): Section category labels in sidebar.

### Named Rules
**The No-Webfont Rule.** All type is system-native or already loaded. Zero additional font downloads, zero FOIT, zero layout shift from type loading.

**The Serif-For-Labels Rule.** Serif display type is used ONLY for view headers, sidebar section labels, and modal titles. It is NEVER used for body text, chat messages, button labels, or navigation items.

**The Size-On-Demand Rule.** Font sizes are not a modular scale. Components pick the size that fits their information density.

## 4. Elevation

A **layered surface system** where depth is conveyed through background tint shifts (the four-step ladder) supplemented by warm-tinted box-shadows. Shadows use brown-black falloff (`rgba(120, 100, 80, ...)`) to match the cream canvas naturally.

### Shadow Vocabulary
- **Ambient Glow** (`--shadow-xs`: `0 1px 3px rgba(120, 100, 80, 0.06)`): The lightest touch. Hairline separation of grouped elements.
- **Surface Soft** (`--shadow-soft`: `0 8px 24px rgba(120, 100, 80, 0.10)`): Chat input glow at rest.
- **Card Rest** (`--shadow-sm`: `0 1px 4px rgba(120, 100, 80, 0.08)`): Default card elevation. Tool bubbles, provider cards.
- **Card Elevated** (`--shadow-md`: `0 2px 8px rgba(120, 100, 80, 0.10)`): Active/hover card states, message bubbles.
- **Dropdown Lift** (`--shadow-lg`: `0 4px 16px rgba(120, 100, 80, 0.14)`): Settings popup, drop-down menus, context menus.
- **Modal Float** (`--shadow-xl`: `0 8px 32px rgba(120, 100, 80, 0.20)`): Confirmation dialogs, heavy floating elements.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only as a response to state (hover, focus, elevation) or to distinguish layered chrome (dropdowns, popups).

**The One-Texture Rule.** The sidebar's paper texture is the only decorative texture in the system. No other surface uses background images, patterns, or gradients for decoration.

## 5. Components

### Buttons
- **Shape:** Gently rounded corners (8px radius for primary, 6px for ghost). The send button is circular (36×36px, 50% radius).
- **Primary (Terracotta `#c17a5c` bg):** For primary actions. Terracotta background, white text, 9px 22px padding. Hover shifts to `#a8654a` — no shadow addition. Active press: `#945840`.
- **Ghost (transparent bg):** For secondary/inline actions. Transparent background, `--text-secondary` text, 1px `--border` on hover reveals the hit area. Hover: `rgba(193, 122, 92, 0.08)` background fill.
- **Circle Send (`--accent` terracotta bg, 50% radius):** Chat send button. 36×36px. Hover: scale 1.08, background shifts to `--accent-hover`.
- **Stop Circle (`--status-error` `#d06a60` bg, 50% radius):** Stop streaming. Warm red background, white icon. Hover darkens to `#b85a50`.

### Inputs / Fields
- **Style:** Clean bordered fields. 1px solid `--border` (warm hairline), `--bg-primary` background (warm cream), 6px radius. Internal padding: 8px 12px.
- **Focus:** Border shifts to `rgba(193, 122, 92, 0.4)` (terracotta tint). No glow, no ring — just a crisp warm outline. Background gets a subtle terracotta tint.
- **Placeholder:** `--text-tertiary` (`#a89e94`).
- **Chat Input:** `--bg-card` background inside a bordered container (16px radius). The container has `--shadow-soft` at rest and gains a warm-tinted focus border when active.
- **Disabled:** 0.4 opacity. Validation handled via inline messages, not border color shifts.

### Navigation (Sidebar)
- **Container:** 240px wide (`--bg-secondary` warm sand), right border (`--border`). Collapsible to 56px icon-only mode. Paper texture overlay at 15% opacity.
- **Items:** 14px font, 8px 14px padding, 10px radius. Default: `--text-secondary` text on transparent bg.
- **Hover:** `rgba(193, 122, 92, 0.08)` background, `--text-primary` text.
- **Active:** `rgba(193, 122, 92, 0.08)` background, `--accent` (terracotta) text, weight 500. 3px terracotta dot indicator at left edge.
- **Category Labels:** Set in serif display (18px, weight 600) — "Tools", "Configuration", "Account".
- **Collapse transition:** Width, padding, label visibility — all animated with 0.25s ease. Labels slide left and fade; icons center.
- **Settings area:** Pinned to bottom via `margin-top: auto`. Opens a popup with `--shadow-lg`, `--bg-card` bg, 10px radius.

### Chat Messages (Bubbles)
- **Style:** Both user and assistant bubbles share: max-width 72%, 10px 18px padding, 16px radius, 16px font, warm shadow-md.
- **User bubble:** Warm cream (`--bg-primary`), 1px solid `--border-strong`. Bottom-right corner reduced to 6px (asymmetric to denote origin).
- **Assistant bubble:** Warm card (`--bg-card`), no border. Bottom-left corner reduced to 6px.
- **Stacking:** Consecutive same-speaker bubbles connect with 4px gap and flat-to-flat contact.
- **Ref chips:** Small pill labels below the bubble text for file references, tool calls, cited sources.

### Chips / Tags
- **File tags:** Pill shape (`border-radius: 100px`), `--bg-secondary` background, 1px `--border` border, 11px font. Removable via x button.
- **Model tags:** Small inline pills, `--bg-secondary` background, 12px font, 4px radius.
- **Sub-badge:** Tiny label (10px, weight 600), border, 3px radius.

### Cards / Containers
- **Tool bubbles:** 1px `--border` border, 10px radius, `--bg-card` background, `--shadow-sm` at rest. Collapsible header + body. Running state: terracotta-tint border.
- **Provider cards:** Full-width cards in a stacked layout. Headers with label + toggle switch, URL display, model tag list, action buttons at bottom.
- **Settings popup:** `position: fixed` overlay, 10px radius, `--shadow-lg`, warm card background. Small header (12px serif uppercase) and divider-separated items.
- **Hover cards:** Used in sidebar for session details. `position: fixed`, 8px radius, `--shadow-lg`, `--bg-card` background. Appear with 0.15s fade-in.

### Toggle / Switch
- **Provider toggle:** Circle switch. Active: terracotta fill. Inactive: transparent with warm hairline border.
- **Mode toggle (Private/Auto-approve):** 62px min-width, 26px height, 1px `--border` border, 6px radius. Inactive: transparent with warm dot. Active: warm amber border + background, amber text + dot.

## 6. Do's and Don'ts

### Do:
- **Do** use terracotta (`--accent: #c17a5c`) as the single accent color. It is the only voice for primary actions, active states, and wayfinding.
- **Do** use the warm neutral ramp consistently: warm cream for surfaces, warm sand for secondary backgrounds, warm ink for body text, warm gray for labels.
- **Do** use serif display type for view headers and sidebar section labels — it adds editorial character without compromising readability.
- **Do** keep buttons tactile — hover effects (scale, background tint) signal interactivity clearly.
- **Do** use asymmetric corner radii on chat bubbles (one flat corner) to distinguish speaker origin.
- **Do** use the four-step surface ladder (cream → sand → card → raised) for depth hierarchy.
- **Do** use warm-tinted shadows that match the cream base — brown-black falloff, not pure black.
- **Do** collapse sidebar items gracefully — labels slide and fade, icons center. A single 0.25s ease curve ties the whole collapse animation.
- **Do** use system fonts. Serif for display (already loaded), system sans for body. No additional font downloads.

### Don't:
- **Don't** use colored accents beyond terracotta. No blue links, no green success banners, no purple branding. (Exception: status colors for functional purposes only.)
- **Don't** use side-stripe borders (`border-left`/`border-right` at >1px as a colored accent).
- **Don't** use gradient text (`background-clip: text`) for emphasis. Use weight or size instead.
- **Don't** use glassmorphism (backdrop-filter blur on cards) as a default.
- **Don't** copy ChatGPT/Claude chat UI patterns — no pastel bubble colors, no rounded-rectangle avatar placements, no pill-shaped input bars with gradient send buttons.
- **Don't** use SaaS dashboard templates: no metric cards with big numbers + small labels, no icon+heading+text card grids, no colored left border accents.
- **Don't** add dark mode unless deliberately designed. The warm-precision system is light-mode only; dark would require rebalancing the entire warm palette.
- **Don't** animate layout properties (width, height, top, left). Animate transform and opacity only.
- **Don't** use serif type for body text, chat messages, button labels, or interactive elements.
- **Don't** use pure white (`#ffffff`) as the main background. Warm cream is the canvas.
