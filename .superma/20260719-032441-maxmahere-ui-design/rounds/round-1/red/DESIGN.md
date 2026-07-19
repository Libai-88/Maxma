---
name: MaxmaHere
description: "A ReAct AI Agent desktop client — The Study design system"
colors:
  canvas: "#F8F4ED"
  surface: "#FCFAF5"
  surface-soft: "#F4F0EA"
  ink: "#2A2A2E"
  ink-muted: "#5C5E64"
  ink-subtle: "#8A8C90"
  accent: "#537D96"
  accent-hover: "#456A80"
  accent-soft: "rgba(83, 125, 150, 0.10)"
  accent-warm: "#C27A6E"
  accent-warm-soft: "rgba(194, 122, 110, 0.10)"
  border: "rgba(100, 80, 70, 0.15)"
  border-strong: "rgba(100, 80, 70, 0.25)"
  user-bubble: "rgba(83, 125, 150, 0.12)"
  shadow-color: "rgba(50, 40, 30, 0.08)"
  status-ok: "#7BAE7F"
  status-error: "#8B3A3A"
  status-warn: "#C99A6A"
  status-info: "#537D96"
typography:
  display-xl:
    fontFamily: "'EB Garamond', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.3px
  display-lg:
    fontFamily: "'EB Garamond', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: -0.2px
  display-md:
    fontFamily: "'EB Garamond', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: -0.1px
  display-sm:
    fontFamily: "'EB Garamond', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0
  body:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  message:
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: 16px
    lineHeight: 1.6
  code:
    fontFamily: "'JetBrains Mono', 'SF Mono', 'Consolas', monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontSize: 11px
    fontWeight: 600
    letterSpacing: 0.5px
    textTransform: "uppercase"
  caption:
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: 6px
  md: 8px
  lg: 10px
  xl: 14px
  pill: 100px
  full: 50%
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "10px 24px"
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "{typography.body-sm.fontSize}"
    fontWeight: 500
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    borderColor: "transparent"
    rounded: "{rounded.md}"
    padding: "6px 14px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderColor: "{colors.border}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
  chat-bubble-user:
    backgroundColor: "{colors.user-bubble}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
  chat-bubble-assistant:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
  nav-item:
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
    padding: "20px"
  tool-bubble:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.border}"
    rounded: "{rounded.lg}"
---

# Design System: MaxmaHere — "The Study"

## 1. Overview

**Creative North Star: "The Study"**

MaxmaHere is a study. A warm, well-lit room where thought meets tool, where conversation becomes creation. In the center sits the dialogue — a manuscript in progress, rendered on cream paper in a careful hand. Around it, arranged with intention, sit the reference books: session logs, provider configs, memory archives, tool palettes.

The design is a **warm editorial system**: cream paper canvases, deep sage-teal accents, warm terracotta secondary accents, and a two-typeface typographic hierarchy (serif display + sans-serif body). The palette is inspired by leather-bound books, fountain pen ink, and the warm glow of a desk lamp — functional, tactile, and quietly intellectual.

This system evolves from the original "Workbench" philosophy. Where the workbench was industrial and precision-focused, the study is warm and editorial. Both share a commitment to clarity, restraint, and content-forward layout. The difference is in the materials: warm paper instead of cold steel, terracotta instead of black, serif character instead of sans uniformity.

### Key Characteristics:
- Warm cream canvas (chroma-adjacent to neutral white but unmistakably warm)
- Two-color accent system: deep sage-teal (primary) + warm terracotta (secondary)
- Editorial typography: serif display headings, sans-serif body text
- Subtle paper texture on surfaces (default-on, toggleable)
- Warm-tinted shadows for physical depth
- Generous whitespace and content-forward layout
- 11 themable color schemes sharing a consistent variable structure
- Dark-on-light default; dark themes invert the warm/cool balance

## 2. Colors

A warm editorial palette built on a cream-to-sage axis. Every color carries a subtle warmth — even the grays lean slightly brown rather than blue. The sole exceptions are functional status colors (green, red, amber) which remain at their standard hues but are desaturated to match the system's warmth.

### Core Palette

| Token | Value | Role |
|-------|-------|------|
| `--canvas` | `#F8F4ED` | Main application background. Warm cream, the foundation surface. |
| `--surface` | `#FCFAF5` | Card surfaces, chat bubbles, elevated panels. Slightly lighter than canvas for subtle distinction. |
| `--surface-soft` | `#F4F0EA` | Sidebar background, secondary surfaces, hover backgrounds. Warm cloud. |
| `--ink` | `#2A2A2E` | Body text. Near-black with a warm tint — softer than pure black. |
| `--ink-muted` | `#5C5E64` | Secondary text, labels, metadata. Warm mid-gray. |
| `--ink-subtle` | `#8A8C90` | Tertiary text, placeholder text. The most muted legible gray. |
| `--accent` | `#537D96` | Deep sage-teal. Primary accent for buttons, active states, links. |
| `--accent-hover` | `#456A80` | Darker variant of accent for hover states and active borders. |
| `--accent-soft` | `rgba(83,125,150,0.10)` | Tinted backgrounds, hover fills, badge backgrounds. |
| `--accent-warm` | `#C27A6E` | Warm terracotta. Secondary accent for danger actions, warnings, highlights. |
| `--accent-warm-soft` | `rgba(194,122,110,0.10)` | Warm tinted backgrounds. |
| `--border` | `rgba(100,80,70,0.15)` | Default borders and dividers. Warm-tinted for cohesion. |
| `--border-strong` | `rgba(100,80,70,0.25)` | Stronger borders for active/focused states. |
| `--shadow-color` | `rgba(50,40,30,0.08)` | Shadow base — warm brown instead of neutral black. |

### Status Colors

| Token | Value | Role |
|-------|-------|------|
| `--status-ok` | `#7BAE7F` | Success states, enabled indicators. Warm sage-green. |
| `--status-error` | `#8B3A3A` | Error states, destructive actions. Deep brick red. |
| `--status-warn` | `#C99A6A` | Warning states, attention indicators. Warm amber. |
| `--status-info` | `#537D96` | Information, neutral prompts. Matches accent. |

### The Sage-Terracotta Rule

The accent system uses two colors with distinct roles:

- **Sage-teal** (`--accent`): Primary actions, active navigation, links, focus indicators, toggle-active states, brand recognition. This is the "default accent" — the color users learn to follow for primary interactions.

- **Terracotta** (`--accent-warm`): Destructive actions (delete, remove), high-priority warnings, secondary highlights, rate/limit indicators, the send button hover state. This is the "warm accent" — used sparingly for emotional weight.

No other accent colors compete with this pair. Status colors (green, red, amber) appear only for their functional purpose and never as decoration.

### The Warm Gradient Rule

The neutral ramp (canvas, surface, surface-soft, ink, ink-muted, ink-subtle) covers six stops, each with a warm lean. No cool grays are introduced. The warmth is consistent across all stops — a subtle brown undertone that makes the interface feel physically warm, like paper under lamplight.

## 3. Typography

A two-typeface editorial system. Serif for display and emphasis, sans-serif for body and UI. This pairing creates a clear hierarchy that distinguishes "what to read" from "where to act."

### Display Type (Serif)

**Font Stack:** `'EB Garamond', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'STSong', serif`

The serif face is used for:
- Section headings in the sidebar ("Sessions", "Tools", "Settings")
- Card titles and panel headers
- Chat message sender labels
- Welcome screen and onboarding copy
- Any text that benefits from editorial character

**Sizes:**
- **Display XL** (24px, 600 weight, 1.3 line-height, -0.3px tracking): Page-level headings, welcome screens
- **Display LG** (20px, 600 weight, 1.35 line-height, -0.2px tracking): Panel headings, section titles
- **Display MD** (18px, 600 weight, 1.4 line-height, -0.1px tracking): Card titles, modal headers
- **Display SM** (16px, 600 weight, 1.4 line-height): Subsection titles, sidebar group labels

### Body Type (Sans-Serif)

**Font Stack:** `'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', 'Microsoft YaHei', sans-serif`

The sans-serif face is used for:
- All UI chrome (buttons, inputs, navigation items)
- Chat message body text
- Labels, tags, metadata
- Code (in the monospace variant)
- Any text where maximum readability at small sizes is critical

**Sizes:**
- **Body** (15px, 400 weight, 1.6 line-height): Default application text
- **Body SM** (14px, 400 weight, 1.5 line-height): Navigation items, sidebar text, captions
- **Message** (16px, 400 weight, 1.6 line-height): Chat conversation text, slightly larger for comfortable reading
- **Caption** (12px, 400 weight, 1.4 line-height): Small metadata, timestamps

### Labels

- **Label** (11px, 600 weight, 0.5px letter-spacing, uppercase): Section headers, popup headers, metadata labels. Always uppercase for wayfinding.

### Code / Mono

- **Code** (13px, 400 weight): `'JetBrains Mono', 'SF Mono', 'Consolas', monospace`. Inline code, code blocks, version labels, monospace data.

### The Two-Face Rule

Display type is serif. UI type is sans-serif. This distinction is the system's primary typographic signal — it tells the user "this is content to read" vs. "this is a control to use." The serif toggle in settings switches the body font to serif as well for users who prefer a reading experience throughout, but the default separation is intentional and maintained.

### The No-Webfont Rule (modified)

Display serif and UI sans-serif are both system-native fonts. EB Garamond is available on most systems; Inter is loaded locally by the app. No external web font downloads, no FOIT, no layout shift. The serif option loads immediately because it uses the OS's installed fonts.

## 4. Elevation

A **warm shadow system**. Depth is conveyed through warm-tinted shadows that simulate the lighting of a desk lamp on paper. Shadows are subtle — low opacity, warm brown-black — and increase in spread as elevation grows.

### Shadow Vocabulary

| Token | Value | Use |
|-------|-------|-----|
| `--shadow-xs` | `0 1px 3px rgba(50,40,30,0.04)` | Subtle separation of grouped elements |
| `--shadow-soft` | `0 8px 24px rgba(50,40,30,0.06)` | Large-area glow under chat input |
| `--shadow-sm` | `0 1px 4px rgba(50,40,30,0.06)` | Default card elevation |
| `--shadow-md` | `0 2px 8px rgba(50,40,30,0.08)` | Active/hover card states, message bubbles |
| `--shadow-lg` | `0 4px 16px rgba(50,40,30,0.12)` | Dropdowns, popups, hover cards |
| `--shadow-xl` | `0 8px 32px rgba(50,40,30,0.18)` | Modals, confirmation dialogs |

### Named Rules

**The Warm-Shadow Rule.** All shadows use warm brown-tinted rgba instead of neutral black. This subtle shift makes shadows feel like they're cast by warm light, not ambient daylight. The shadow-color variable can be overridden per theme but must always carry a warm tint.

**The Flat-By-Default Rule (retained).** Surfaces are flat at rest. Shadows appear as a response to state (hover, focus, elevation) or to distinguish layered chrome.

**The One-Blur Exception (retained).** The sidebar uses a blurred background. No other surface uses backdrop-filter.

## 5. Paper Texture System

The paper texture is a signature element of the MaxmaHere identity. It differentiates the product from every other AI chat client on the market.

### Implementation
- SVG fractal noise generated as a data URI, rendered via CSS background-image
- Applied to body background, sidebar, cards, and input areas
- Three layers: surface (direct), card (lighten blend), brightness compensation
- Opacity: 35% by default (adjustable per theme)
- Texture size: 160px tile

### Default State
Paper texture is ON by default. Users can toggle it off via the theme picker. When toggled off, all surfaces return to flat colors.

### The Texture Rule
Paper texture is the only decorative element in the system. No gradients (except in the Dawn theme's body background), no glassmorphism, no noise overlays beyond the paper grain. When you see texture, you know it's MaxmaHere.

## 6. Components

### 6.1 Buttons

**Shape:** Gently rounded corners (8px radius). The send button is an exception — circular (36x36px, 50% radius).

**Primary (sage `--accent` bg):** For primary actions ("Send", "Save", "Confirm"). Sage background, white text, 10px 24px padding, 500 weight. Hover: translateY(-1px) lift, increased shadow, background darkens to `--accent-hover`. Active: scale(0.98). The sage is the anchor.

**Ghost (transparent bg):** For secondary/inline actions. Transparent background, `--ink-muted` text, no border at rest. Hover: `--accent-soft` background, `--ink` text. Active: slightly deeper tint.

**Danger (terracotta `--accent-warm` bg):** For destructive actions. Terracotta background, white text. Hover: darken. Use sparingly — the terracotta signals weight.

**Circle Send (sage bg, 50% radius):** Chat send button. 36x36px. Sage bg, white icon arrow. Hover: scale 1.08, warm shadow, background shifts to a deeper sage. On hover, the arrow icon can transition to a "sent" state.

**Stop Circle (terracotta bg, 50% radius):** Stop streaming. Warm terracotta background, white icon. Hover darkens.

### 6.2 Inputs / Fields

**Style:** Clean bordered fields. 1px solid `--border`, `--surface` background, 6px radius. Internal padding: 8px 12px. Font: body (15px).

**Focus:** Border shifts to `--accent` (sage). No glow, no ring — just a crisp colored outline. Focus-visible uses a 2px accent outline with offset for keyboard navigation.

**Placeholder:** `--ink-subtle`. Left-aligned, standard weight.

**Textarea (Chat Input):** `--surface` background inside a bordered container (20px radius pill-like shape). The container has `--shadow-soft` at rest and gains `--shadow-md` on focus. The border transitions from `--border` to `--accent` on focus.

**Error / Disabled:** Disabled inputs use 0.4 opacity. Error states use a terracotta border + inline error message below the field.

### 6.3 Navigation (Sidebar)

- **Container:** 240px wide (`--surface-soft` bg), right border (`--border`). Can collapse to 58px icon-only mode.
- **Items:** 14px font (`--body-sm`), 8px 12px padding, 10px radius. Default: `--ink-muted` text on transparent bg.
- **Hover:** `--accent-soft` background, `--ink` text.
- **Active:** `--accent-soft` background (slightly deeper), `--accent` text color, 600 weight.
- **Section headers:** Display SM (16px serif), uppercase label underneath for "Sessions", "Tools", etc.
- **Collapsed transition:** Width, padding, label visibility — all animated with 0.25s ease. Labels slide left and fade; icons center.
- **Settings area:** Pinned to the bottom via `margin-top: auto`. Opens a popup with `--shadow-lg`, `--surface` bg, 10px radius.

### 6.4 Chat Messages (Bubbles)

- **Style:** Both user and assistant bubbles share: max-width 72%, 10px 16px padding, 14px border-radius, 16px font, `--shadow-md` elevation.
- **User bubble:** Warm tinted background (`--user-bubble` = rgba of accent at 12%), no border. Bottom-right corner reduced to 4px (asymmetric to denote origin).
- **Assistant bubble:** `--surface` background, no border. Bottom-left corner reduced to 4px.
- **Read status:** Small dot + label ("Read" / "Delivered") below the bubble, using `--ink-muted` text.
- **Ref chips:** Small pill labels below the bubble for file references, tool calls, cited sources. Warm background with accent-tinted source badge.

### 6.5 Chips / Tags

- **File tags:** Pill shape (border-radius: 100px), `--surface-soft` background, 1px `--border` border, 11px font. Source badge inside: 9px uppercase pill with `--accent-soft` background. Removable via x button.
- **Model tags (Providers):** Small inline pills, `--accent-soft` background, 12px font, 4px radius.
- **Sub-badge (Session):** Tiny label (9px, 600 weight), border, 3px radius. `--ink-muted` on `--surface-soft`.

### 6.6 Cards / Containers

- **Tool bubbles:** 1px `--border` border, 10px radius, `--surface` background, `--shadow-sm` at rest. Collapsible header + body. Running state: `--accent` border.
- **Provider cards:** Full-width cards in a stacked layout. Headers with label + toggle switch, URL display, model tag list, action buttons at bottom.
- **Settings popup:** `position: fixed` overlay, 10px radius, `--shadow-lg`, 6px internal padding. Small header (11px uppercase) and divider-separated items.
- **Hover cards:** Used in sidebar for session details. `position: fixed`, 8px radius, `--shadow-lg`, `--surface` background. Appear on mouse hover with 0.15s fade-in transition.

### 6.7 Toggle / Switch

- **Private mode & Auto-approve toggles:** Inline button toggle, 62px min-width, 26px height, 1px `--border` border, 6px radius. Inactive: transparent with a sage dot indicator. Active: accent background+tint, accent text+dot.
- **Provider enable toggle:** Circle switch, styled per card. Active state: accent fill.

## 7. Theming

The system supports 11 themes, each defining the same set of CSS custom properties. Every theme must define all variables listed in the Theme Contract below.

### Theme Contract

Every theme must define:
```
--canvas, --surface, --surface-soft
--ink, --ink-muted, --ink-subtle
--accent, --accent-hover, --accent-soft
--accent-warm, --accent-warm-soft
--border, --border-strong, --shadow-color
--status-ok, --status-error, --status-warn, --status-info
--accent-rgb, --accent-warm-rgb
--user-bubble, --tool-bg, --sidebar-bg
--overlay-subtle, --overlay-light, --overlay-medium, --overlay-strong
```

### Theme Design Principles

1. **Warm anchor, cool accent.** Every theme should pair a warm background with a cool-leaning accent (sage, blue, lavender) to maintain the warm/cool tension that defines the system.
2. **Accent-warm as emotional weight.** The secondary accent should be warmer than the primary — terracotta, coral, amber — and used sparingly.
3. **Paper texture compatibility.** Themes should account for paper texture: the canvas should look good with the SVG noise overlay, and card backgrounds should support the lighten blend mode.
4. **Dark themes invert the warmth.** For midnight and dark-contrast themes, warm backgrounds become warm darks (deep navy, charcoal) and cool accents soften to maintain readability.

## 8. Spacing & Layout

- **Grid:** 4px base unit. All spacing values are multiples of 4px.
- **Sidebar:** 240px default, 58px collapsed.
- **Chat column:** 720px max-width, centered in the content area.
- **Titlebar:** 44px height.
- **Section padding:** 24px between major sections.
- **Card padding:** 20px internal (up from 16px).
- **Message spacing:** 16px between messages, 24px between turns (user + assistant pair).

## 9. Motion

- **Duration-instant:** 0.1s — hover, close, exit
- **Duration-fast:** 0.15s — default transitions (buttons, panels, focus)
- **Duration-slow:** 0.25s — modal, large block entrance
- **Ease-out:** `cubic-bezier(0.16, 1, 0.3, 1)` — elements exiting
- **Ease-in:** `cubic-bezier(0.7, 0, 0.84, 0)` — elements entering
- **Ease-standard:** `cubic-bezier(0.2, 0, 0, 1)` — default transitions
- **Ease-smooth:** `cubic-bezier(0.22, 0.68, 0, 1)` — decorative motion

### Motion Principles

1. **Transform and opacity only.** Never animate width, height, top, or left.
2. **Meaningful motion.** Every animation should communicate a state change or spatial relationship.
3. **Reduced motion respected.** All animations respect `prefers-reduced-motion`.

## 10. Do's and Don'ts

### Do:
- **Do** use the sage-terracotta accent pairing consistently: sage for primary actions, terracotta for emotional/destructive weight.
- **Do** use the warm neutral ramp consistently: cream canvas for backgrounds, warm ink for body text, muted warm gray for labels.
- **Do** keep buttons tactile — hover effects (lift + shadow + background shift) signal interactivity clearly.
- **Do** use asymmetric corner radii on chat bubbles (one flat corner) to distinguish speaker origin.
- **Do** use the shadow vocabulary by elevation role: card-rest to shadow-sm, popup to shadow-lg, modal to shadow-xl.
- **Do** keep paper texture as the default state. It is a signature identifier.
- **Do** use serif display type for headings and section titles — it signals editorial quality.
- **Do** collapse sidebar items gracefully — labels slide and fade, icons center. A single 0.25s ease curve ties the whole collapse animation.
- **Do** respect the two-face typographic system: serif for display, sans for body.

### Don't:
- **Don't** use pure black (#000000) as an accent color. The warm system requires warm-tinted darks.
- **Don't** use cool-toned grays (blue-gray, slate) in the neutral ramp. All neutrals must lean warm.
- **Don't** use gradient text (`background-clip: text`) for emphasis. Use weight or size instead.
- **Don't** use glassmorphism (backdrop-filter blur on cards) beyond the sidebar's intentional exception.
- **Don't** copy ChatGPT/Claude chat UI patterns — no pastel bubble colors, no rounded-rectangle avatar placements, no pill-shaped input bars with gradient send buttons.
- **Don't** use SaaS dashboard templates: no metric cards with big numbers + small labels, no icon+heading+text card grids, no colored left border accents.
- **Don't** add dark mode without rebalancing the entire warm neutral ramp. Dark themes invert warmth: backgrounds become warm darks, not cool darks.
- **Don't** animate layout properties (width, height, top, left). Animate transform and opacity only.
- **Don't** use numbered section markers (01/02/03) as decorative scaffolding.
- **Don't** use tiny uppercase tracked labels above every section. One as a deliberate system voice is identity; on every section it's AI grammar.
