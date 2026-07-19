---
version: alpha
name: MaxmaHere-Warm-Precision
description: A warm-precision design system for MaxmaHere — an AI Agent desktop client. The system anchors on a warm cream canvas with terracotta accent, serif display headings for editorial warmth, and a four-step surface ladder for clear hierarchy. The design synthesizes Claude's editorial warmth, Notion's serif minimalism, Linear's precision engineering, and Ollama's monochrome discipline.
colors:
  # ── Canvas & Surfaces ──
  bg-primary: "#fcf9f5"          # Warm Cream — main application background
  bg-secondary: "#f5f0ea"        # Warm Sand — sidebar, secondary surfaces
  bg-card: "#fefcf8"             # Warm Card — card surfaces, chat bubbles
  bg-raised: "#fffdfa"           # Warm Raised — hover cards, popups, modals
  user-bubble-bg: "#fcf9f5"      # Same as canvas — user bubble background

  # ── Accent ──
  accent: "#c17a5c"              # Terracotta — primary actions, active states, wayfinding
  accent-hover: "#a8654a"        # Terracotta Dark — hover state for primary buttons
  accent-active: "#945840"       # Terracotta Deep — active/pressed state
  accent-light: "#e8d5c8"        # Terracotta Tint — light backgrounds, borders
  accent-soft: "rgba(193, 122, 92, 0.08)"  # Terracotta Soft — hover fills

  # ── Text ──
  text-primary: "#2c2825"        # Warm Ink — body text, headings (replaces #1f2937)
  text-secondary: "#7a7068"      # Warm Gray — secondary text, labels (replaces #6b7280)
  text-tertiary: "#a89e94"       # Warm Mute — tertiary text, placeholders (replaces #9ca3af)

  # ── Borders & Lines ──
  border: "rgba(200, 180, 160, 0.25)"    # Warm Hairline — default borders
  border-strong: "rgba(180, 160, 140, 0.35)"  # Warm Hairline Strong — input focus
  border-accent: "rgba(193, 122, 92, 0.4)"   # Accent border — active/running states

  # ── Shadow — warm-tinted (brown-black) ──
  shadow-color: "rgba(120, 100, 80, 0.10)"

  # ── Status ──
  status-ok: "#8aaa8a"           # Warm Green — operational status (softer than #16a34a)
  status-error: "#d06a60"        # Warm Red — error states (softer than #ef4444)
  status-warn: "#c99a6a"         # Warm Amber — warnings (softer than #f59e0b)
  status-info: "#7a9aaa"         # Warm Blue — informational (softer than #2563eb)

  # ── Accent RGB split (for rgba() usage) ──
  accent-rgb: "193, 122, 92"
typography:
  display:
    fontFamily: "'EB Garamond', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'STSong', serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.3px"
    textTransform: "none"
  display-lg:
    fontFamily: "'EB Garamond', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'STSong', serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.5px"
    textTransform: "none"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  message:
    fontFamily: "inherit"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  code:
    fontFamily: "'JetBrains Mono', 'SF Mono', 'Consolas', monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontSize: "10.5px"
    fontWeight: 500
    letterSpacing: "0.4px"
    textTransform: "uppercase"
  label-serif:
    fontFamily: "'EB Garamond', 'Noto Serif SC', 'Source Han Serif SC', serif"
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
  section: "96px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "9px 22px"
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "14px"
    fontWeight: 500
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "9px 22px"
  button-primary-active:
    backgroundColor: "{colors.accent-active}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "9px 22px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    borderColor: "{colors.border}"
    rounded: "{rounded.md}"
    padding: "6px 14px"
  button-ghost-hover:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.text-primary}"
    borderColor: "{colors.border-strong}"
    rounded: "{rounded.md}"
    padding: "6px 14px"
  input:
    backgroundColor: "{colors.bg-primary}"
    textColor: "{colors.text-primary}"
    borderColor: "{colors.border}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "14px"
  input-focus:
    backgroundColor: "{colors.bg-primary}"
    textColor: "{colors.text-primary}"
    borderColor: "{colors.border-accent}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  chat-bubble-user:
    backgroundColor: "{colors.user-bubble-bg}"
    textColor: "{colors.text-primary}"
    borderColor: "{colors.border-strong}"
    rounded: "{rounded.xl}"
    asymmetric: "bottom-right 6px"
    padding: "10px 18px"
    maxWidth: "72%"
    shadow: "0 2px 8px rgba(120, 100, 80, 0.10)"
  chat-bubble-assistant:
    backgroundColor: "{colors.bg-card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
    asymmetric: "bottom-left 6px"
    padding: "10px 18px"
    maxWidth: "72%"
    shadow: "0 2px 8px rgba(120, 100, 80, 0.08)"
  nav-item:
    rounded: "{rounded.lg}"
    padding: "8px 14px"
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "14px"
  nav-item-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.lg}"
    padding: "8px 14px"
    fontWeight: 500
    indicator: "3px dot at left, {colors.accent}"
  card-container:
    backgroundColor: "{colors.bg-card}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
    padding: "16px"
  tool-bubble:
    backgroundColor: "{colors.bg-card}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  tool-bubble-running:
    backgroundColor: "{colors.bg-card}"
    borderColor: "{colors.border-accent}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  toggle-active:
    backgroundColor: "{colors.accent}"
    borderColor: "{colors.accent}"
    rounded: "{rounded.sm}"
  toggle-inactive:
    backgroundColor: "transparent"
    borderColor: "{colors.border}"
    rounded: "{rounded.sm}"
  file-tag:
    backgroundColor: "{colors.bg-secondary}"
    borderColor: "{colors.border}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
    fontSize: "11px"
  sidebar:
    width: "240px"
    background: "{colors.bg-secondary}"
    borderRight: "1px solid {colors.border}"
    paperTexture: "true"
    paperTextureOpacity: "0.15"
  chat-input-wrapper:
    backgroundColor: "{colors.bg-card}"
    borderColor: "{colors.border}"
    rounded: "16px"
    shadow: "0 8px 28px rgba(120, 100, 80, 0.12)"
    padding: "4px 4px 4px 18px"
---

# Design System: MaxmaHere — Warm Precision

## 1. Overview

**Creative North Star: "The Workbench, Warmed"**

MaxmaHere is a workbench — a space where ideas are crafted with AI. In the center sits the conversation, the piece being made. Around it, arranged with intention, sit the tools: session management, provider configuration, memory inspection, environmental controls.

The original design philosophy — **"The Workbench"** — is preserved. Every tool has its place. Nothing distracts from the work itself.

But a workbench can be warm. A well-used workshop has character: the worn wood of the bench, the patina on the tools, the warm light of a reading lamp. **Warm Precision** adds this dimension. The palette shifts from clinical white to warm cream, from black accent to terracotta, from pure sans-serif to a careful serif-for-headings hybrid. The result is a space that still feels engineered — but engineered for human use, not machine efficiency.

### Key Characteristics:
- **Warm cream canvas** (`#fcf9f5`) — reduces eye strain, feels personal, not institutional
- **Terracotta accent** (`#c17a5c`) — draws attention with warmth, not harshness
- **Serif display headings** — editorial character in section titles and view headers
- **Four-step surface ladder** — canvas → sand → card → raised, for clear depth hierarchy
- **Warm-tinted shadows** — brown-black falloff matches the cream base naturally
- **Paper texture** — subtle non-repeating texture on sidebar (already in codebase)
- **System-native fonts** — serif for display, system sans for body (no web font overhead)
- **Content-forward layout** — UI chrome recedes, conversation leads

## 2. Color Palette

A warm monochrome palette with terracotta as the single accent. Every surface and text color stays within a warm-neutral axis. The warmth comes from the cream-tinted whites and the brown-tinted grays, not from saturation.

### 2.1 Accent — Terracotta

- **Terracotta** (`#c17a5c`): The sole accent color. Used for primary buttons, active navigation states, toggle active states, focus rings, and link emphasis. It replaces pure black as the primary interactive signal.
- **Terracotta Dark** (`#a8654a`): Hover state for primary buttons.
- **Terracotta Deep** (`#945840`): Active/pressed state for primary buttons.
- **Terracotta Tint** (`#e8d5c8`): Light backgrounds, running-state borders on tool bubbles.
- **Terracotta Soft** (`rgba(193, 122, 92, 0.08)`): Hover fill for ghost buttons, active nav item background.

**The Scarce Accent Rule.** Terracotta is used sparingly. It appears on primary CTAs, active navigation, focus indicators, and toggle switches. It never appears as decoration, section background, or card fill.

### 2.2 Surfaces

| Token | Hex | Role |
|-------|-----|------|
| `--bg-primary` (Warm Cream) | `#fcf9f5` | Main application background, input backgrounds |
| `--bg-secondary` (Warm Sand) | `#f5f0ea` | Sidebar background, secondary surfaces, hover states |
| `--bg-card` (Warm Card) | `#fefcf8` | Card surfaces, chat bubbles, popups |
| `--bg-raised` (Warm Raised) | `#fffdfa` | Hover cards, modals, elevated surfaces |

### 2.3 Text

| Token | Hex | Role |
|-------|-----|------|
| `--text-primary` (Warm Ink) | `#2c2825` | Body text, headings. Near-black with warm undertone. |
| `--text-secondary` (Warm Gray) | `#7a7068` | Secondary text, labels, descriptions, metadata. |
| `--text-tertiary` (Warm Mute) | `#a89e94` | Tertiary text, placeholder text, disabled states. |

### 2.4 Borders

| Token | Value | Role |
|-------|-------|------|
| `--border` (Warm Hairline) | `rgba(200, 180, 160, 0.25)` | Default borders, dividers, card outlines |
| `--border-strong` (Warm Strong) | `rgba(180, 160, 140, 0.35)` | Input focus, active states |
| `--border-accent` (Accent Border) | `rgba(193, 122, 92, 0.4)` | Running-state tool bubbles, accent borders |

### 2.5 Shadows

Shadows use warm-tinted black (`rgba(120, 100, 80, ...)`) to match the cream canvas naturally.

| Token | Value | Role |
|-------|-------|------|
| `--shadow-xs` | `0 1px 3px rgba(120, 100, 80, 0.06)` | Hairline separation |
| `--shadow-soft` | `0 8px 24px rgba(120, 100, 80, 0.10)` | Chat input glow |
| `--shadow-sm` | `0 1px 4px rgba(120, 100, 80, 0.08)` | Card resting elevation |
| `--shadow-md` | `0 2px 8px rgba(120, 100, 80, 0.10)` | Active card, message bubbles |
| `--shadow-lg` | `0 4px 16px rgba(120, 100, 80, 0.14)` | Dropdown, popup, context menu |
| `--shadow-xl` | `0 8px 32px rgba(120, 100, 80, 0.20)` | Modal, confirmation dialog |

### 2.6 Status Colors

- **Warm Green** (`#8aaa8a`): Operational status, connected indicators.
- **Warm Red** (`#d06a60`): Error states, destructive actions, error banners.
- **Warm Amber** (`#c99a6a`): Warning states, private mode indicators, auto-approve.
- **Warm Blue** (`#7a9aaa`): Information banners, info badges.

Status colors are desaturated from the original system to match the warm palette. They appear only for functional signaling, never as decoration.

### Named Rules

**The Warm Ramp Rule.** The neutral ramp (cream → sand → card → raised) covers exactly four stops. Each stop has a distinct role. Background temperature is warm throughout — no cool grays appear.

**The One Accent Rule.** Terracotta is the single accent. No secondary accent color competes with it. Status colors (green, red, amber, blue) appear only for their functional purpose and never as decoration.

## 3. Typography

The typography system uses a **serif/sans hybrid** — serif for display headings, system sans for body text. This is already supported by the codebase (`--font-serif` and `--font-display` exist in tokens.css) but was never activated in the DESIGN.md spec.

### Font Families

- **Display (Serif):** `'EB Garamond', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'STSong', serif` — for view titles, section headers, sidebar category labels.
- **Body (System Sans):** `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif` — for all body text, UI labels, buttons, chat messages.
- **Code (Mono):** `'JetBrains Mono', 'SF Mono', 'Consolas', monospace` — for code blocks, inline code, timestamps, monospace data.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|-------|------|--------|-------------|----------------|-----|
| Display Large (serif) | 22px | 600 | 1.25 | -0.5px | View titles, section headers |
| Display (serif) | 18px | 600 | 1.3 | -0.3px | Sidebar section labels, modal headers |
| Body | 15px | 400 | 1.6 | 0 | Default UI text |
| Message | 16px | 400 | 1.6 | 0 | Chat conversation text |
| Code / Mono | 13px | 400 | 1.5 | 0 | Code blocks, timestamps |
| Label (serif) | 12px | 600 | 1.3 | 0.2px uppercase | Section category labels in sidebar |
| Label (sans) | 10.5px | 500 | 1.3 | 0.4px uppercase | Metadata labels, field labels |

### Named Rules

**The Serif-For-Labels Rule.** Serif display type is used ONLY for:
- View headers (e.g., "Chat", "Providers", "Memory")
- Sidebar category labels (e.g., "Tools", "Configuration", "Account")
- Modal and popup headers

Serif is NEVER used for body text, chat messages, button labels, navigation items, or any interactive element.

**The No-Webfont Rule.** All type is system-native. Zero font downloads, zero FOIT, zero layout shift from type loading. The serif fonts (`EB Garamond`, `Noto Serif SC`) are commonly available or system-native on modern OS.

**The Size-On-Demand Rule.** Font sizes are not a modular scale. Components pick the size that fits their information density. Chat messages are 16px for readability; sidebar items are 14px for density; labels are 10.5px for metadata. No fixed ratio binds them.

## 4. Surface & Elevation

A **layered surface system** where depth is conveyed through background tint shifts (the four-step ladder) supplemented by warm-tinted box-shadows. The sidebar uses a subtle paper texture overlay (already in the codebase) as its single decorative texture.

### Surface Ladder

| Level | Token | Value | Use |
|-------|-------|-------|-----|
| 0 — Canvas | `--bg-primary` | `#fcf9f5` | Main background |
| 1 — Sand | `--bg-secondary` | `#f5f0ea` | Sidebar, secondary surfaces |
| 2 — Card | `--bg-card` | `#fefcf8` | Cards, bubbles, popups |
| 3 — Raised | `--bg-raised` | `#fffdfa` | Modals, hover cards, elevated popups |

### Paper Texture

The sidebar uses a CSS-generated paper texture overlay (`--paper-texture-url` from tokens.css) at 15% opacity, blended with `lighten` mode. This adds a tactile, material quality to the sidebar surface without adding image assets.

### Shadow Vocabulary

All shadows use warm-tinted rgba values to match the cream canvas naturally. The brown-black falloff creates shadows that feel like they belong to the surface.

- **Ambient Glow** (`--shadow-xs`): The lightest touch. Hairline separation of grouped elements.
- **Surface Soft** (`--shadow-soft`): Chat input glow at rest.
- **Card Rest** (`--shadow-sm`): Default card elevation. Tool bubbles, provider cards, empty-state cards.
- **Card Elevated** (`--shadow-md`): Active/hover card states, message bubbles.
- **Dropdown Lift** (`--shadow-lg`): Settings popup, drop-down menus, hover cards, context menus.
- **Modal Float** (`--shadow-xl`): Confirmation dialogs, heavy floating elements.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only as a response to state (hover, focus, elevation) or to distinguish layered chrome (dropdowns, popups).

**The One-Texture Rule.** The sidebar's paper texture is the only decorative texture in the system. No other surface uses background images, patterns, or gradients for decoration.

## 5. Components

### 5.1 Buttons

**Primary Button (Terracotta)**
- Background: `--accent` (#c17a5c)
- Text: White (#ffffff)
- Radius: 8px (`--radius-md`)
- Padding: 9px 22px
- Font: System sans, 14px, weight 500
- Hover: Background shifts to `--accent-hover` (#a8654a), no shadow change
- Active: Background shifts to `--accent-active` (#945840)
- Disabled: Opacity 0.4, no hover effect

**Ghost Button**
- Background: Transparent
- Text: `--text-secondary`
- Border: None at rest; 1px `--border` on hover
- Radius: 8px
- Padding: 6px 14px
- Hover: `--accent-soft` background fill, text shifts to `--text-primary`
- Active: Slightly deeper tint

**Circle Send Button (Chat)**
- Size: 36x36px
- Background: `--accent` (terracotta)
- Icon: White arrow up
- Radius: 50% (circular)
- Hover: Scale 1.08, background shifts to `--accent-hover`, subtle warm shadow
- Active: Scale 0.96

**Stop Circle**
- Size: 36x36px
- Background: `--status-error` (#d06a60)
- Icon: White square
- Radius: 50%
- Hover: Darkens 10%

### 5.2 Inputs & Fields

**Standard Input**
- Background: `--bg-primary` (matching the canvas)
- Border: 1px solid `--border` (warm hairline)
- Radius: 6px (`--radius-sm`)
- Padding: 8px 12px
- Font: System sans, 14px
- Focus: Border shifts to `--border-accent` (terracotta tint). No glow, no ring extension. The background gets a subtle `--accent-soft` tint.
- Placeholder: `--text-tertiary`
- Disabled: Opacity 0.4

**Chat Input (Textarea)**
- Container: `--bg-card` background, 16px radius, `--shadow-soft` warm shadow
- Internal padding: 4px 4px 4px 18px
- Textarea: Transparent background, inherits container size
- Focus container: Border shifts to `--border-accent`, shadow deepens slightly
- File refs bar: Above the textarea, separated by a warm hairline

### 5.3 Navigation (Sidebar)

- **Width:** 240px, collapsible to 56px icon-only
- **Background:** `--bg-secondary` (warm sand) with paper texture overlay at 0.15 opacity
- **Right Border:** 1px solid `--border`
- **Items:** 14px system sans, 8px 14px padding, 10px radius
- **Default:** `--text-secondary` text, transparent background
- **Hover:** `--accent-soft` background, `--text-primary` text
- **Active:** `--accent-soft` background, `--accent` (terracotta) text, weight 500, with a 3px terracotta dot indicator at left edge
- **Section Labels:** Set in serif display (18px, weight 600) — "Tools", "Configuration", "Account"
- **Collapse Transition:** 0.25s ease with `--ease-standard` curve. Labels slide left and fade; icons center.
- **Settings Area:** Pinned to bottom via `margin-top: auto`. Opens a popup with `--bg-raised` background, `--shadow-lg`, 10px radius.

### 5.4 Chat Messages (Bubbles)

- **Structure:** Both user and assistant bubbles share: max-width 72%, 10px 18px padding, 16px radius, 16px font, warm shadow-md.
- **User Bubble:** Warm cream (`--bg-primary`), 1px solid `--border-strong`. Bottom-right corner reduced to 6px (asymmetric to denote origin).
- **Assistant Bubble:** Warm card (`--bg-card`), no border. Bottom-left corner reduced to 6px.
- **Bubble Stacking:** Consecutive same-speaker bubbles connect with 4px gap and flat-to-flat contact.
- **Ref Chips:** Small pill labels below bubble text. Warm sand background, warm hairline border, 11px font.

### 5.5 Chips / Tags

- **File Tags:** Pill shape (`border-radius: 100px`), warm sand background, 1px warm hairline border, 11px font. Removable via x button.
- **Model Tags:** Small inline pills, warm sand background, 12px font, 4px radius.
- **Sub-badges:** Tiny label (10px, weight 600), border, 3px radius. Warm text on warm sand.

### 5.6 Cards / Containers

- **Tool Bubbles:** 1px warm hairline border, 10px radius, warm card background, warm shadow-sm at rest. Collapsible header + body. Running state: terracotta-tint border.
- **Provider Cards:** Full-width stacked layout. Headers with label + toggle switch, URL display, model tag list, action buttons at bottom.
- **Settings Popup:** `position: fixed` overlay, 10px radius, warm shadow-lg, warm raised background. Small header (12px serif uppercase) and divider-separated items.
- **Hover Cards:** Used in sidebar for session details. 8px radius, warm shadow-lg, warm raised background. Appear with 0.15s fade-in.

### 5.7 Toggle / Switch

- **Provider Toggle (Circle):** Active: terracotta fill. Inactive: transparent with warm hairline border.
- **Mode Toggle (Private/Auto-approve):** 62px min-width, 26px height, 1px warm hairline border, 6px radius. Inactive: transparent with warm dot. Active: warm amber border + background, amber text + dot.

## 6. Layout & Spacing

### Grid System
- **Base unit:** 4px (`--space-xs`)
- **Spacing scale:** 4 / 8 / 16 / 24 / 48 / 96px
- **Sidebar width:** 240px (collapsed: 56px)
- **Chat column max-width:** 720px (reading comfort)
- **Content padding:** 24px from window edges

### Whitespace Philosophy
Whitespace is structural, not decorative. The 4px grid ensures alignment without measuring. Spaces between sections are 48px; spaces between related items are 16px; spaces between nested items are 8px.

## 7. Do's and Don'ts

### Do:
- **Do** use terracotta (`--accent`) as the single accent color for primary actions, active states, and wayfinding.
- **Do** use the warm cream canvas (`--bg-primary`) for the main background. It reduces eye strain compared to pure white.
- **Do** use serif display type for view headers and section labels — it adds editorial character.
- **Do** use the four-step surface ladder (canvas → sand → card → raised) for depth hierarchy.
- **Do** keep buttons tactile — hover effects (scale, background tint) signal interactivity clearly.
- **Do** use asymmetric corner radii on chat bubbles (one flat corner) to distinguish speaker origin.
- **Do** use warm-tinted shadows that match the cream base — brown-black, not pure black.
- **Do** collapse sidebar items gracefully with a single 0.25s ease curve.
- **Do** use system fonts. No custom font downloads.

### Don't:
- **Don't** use colored accents beyond terracotta. No blue links, no green success banners, no purple branding. (Exception: status colors for functional purposes only.)
- **Don't** use pure white (`#ffffff`) as the main background. Warm cream is the canvas.
- **Don't** use serif type for body text, chat messages, button labels, or interactive elements.
- **Don't** use glassmorphism (backdrop-filter blur) as a default. The sidebar's paper texture is the only decorative texture.
- **Don't** copy ChatGPT/Claude chat UI patterns — no pastel bubble colors, no rounded-rectangle avatars, no pill-shaped input bars with gradient send buttons.
- **Don't** use SaaS dashboard templates: no metric cards with big numbers + small labels, no icon+heading+text card grids.
- **Don't** add dark mode unless deliberately designed. The warm-precision system is light-mode only; dark would require rebalancing the entire warm palette.
- **Don't** animate layout properties (width, height, top, left). Animate transform and opacity only.
- **Don't** use numbered section markers (01/02/03) as decorative scaffolding.
- **Don't** use tiny uppercase tracked labels above every section. Use serif labels for section distinction.

## 8. Responsive & Adaptive Behavior

- **Sidebar Collapse:** At any viewport below 900px, sidebar auto-collapses to 56px icon-only mode with a toggle to expand.
- **Chat Width:** The 720px max-width for chat content centers naturally in wider viewports and adapts to full width below 800px.
- **Card Layouts:** Provider cards and tool grids transition from multi-column to single-column below 700px.
- **Input Resize:** The chat input area is user-resizable vertically (via drag handle) and grows by up to 240px before scrolling.

## 9. Accessibility Notes

- All text-a background contrast ratios exceed WCAG AA minimum (4.5:1 for normal text, 3:1 for large text).
- Warm Ink (`#2c2825`) on Warm Cream (`#fcf9f5`) yields approximately 11.5:1 contrast.
- Interactive elements have visible hover and focus states. Focus is indicated by border color shift (to terracotta), not outline removal.
- Touch targets for toggles and buttons meet minimum 44x44px size for pointer interaction.
- System fonts ensure CJK characters render correctly at all sizes.

## 10. Theme Implementation

The "warm-precision" design system is implemented as a CSS theme file at `web/src/themes/warm-precision.css`. This file defines CSS custom properties that override the shared structural tokens from `tokens.css`.

To activate:
- Default: `:root` or `[data-theme="warm-precision"]`
- The theme file replaces the current warm-paper.css default

The theme is fully compatible with the existing 11-theme system. All existing themes continue to work; only the default theme is replaced.

## 11. Summary of Changes from Original

| Area | Original (Black & White) | Warm Precision |
|------|--------------------------|----------------|
| Canvas | `#ffffff` pure white | `#fcf9f5` warm cream |
| Accent | `#000000` pure black | `#c17a5c` terracotta |
| Display type | System sans-serif | Serif (EB Garamond / Noto Serif SC) |
| Surface levels | 2 (white + cloud) | 4 (cream, sand, card, raised) |
| Shadows | Pure black falloff | Brown-black warm falloff |
| Borders | Gray (`#e5e7eb`) | Warm hairline (brown-tinted rgba) |
| Status colors | Bright (red/amber) | Desaturated warm (terracotta/gold) |
| Sidebar | Flat gray | Sand + paper texture |
| Chat bubbles | White on white | Warm tint on cream |
| Active nav | Black text + full highlight | Terracotta dot + tint |
