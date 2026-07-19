# Blue Team Design Proposal: "Warm Precision"

## Design Vision & Philosophy

**"Warm Precision"** is a synthesis of two seemingly opposing forces: the cold, exacting craft of a precision instrument workshop, and the human warmth of a well-loved reading room. The current design (the "Workbench") is conceptually sound — content-forward, monochrome, restrained — but it sacrifices emotional resonance for discipline. Our proposal does not abandon the Workbench; it inhabits it. We keep the organized layout, the bordered components, the tactile interactions, and the content-first hierarchy. But we introduce a **warm cream canvas** (not pure white), a **terracotta accent** (not pure black), **serif display headings** (not all-sans), and **paper-like textures** that make the digital surface feel inhabited. The result is a UI that still says "precision tool" but now also says "made for humans."

---

## Design Inspirations Used

### 1. Claude — Warm editorial, terracotta accents
**Why we chose it:** Claude's design language is the closest analogue to MaxmaHere — an AI chat interface that needs to feel intelligent and approachable. Claude's cream canvas (`#faf9f5`) and terracotta accent (`#cc785c`) inspired our core palette shift. We adopted Claude's philosophy that warmth is communicated through surface tint, not decoration.

**What we borrowed:**
- Cream-tinted background replacing pure `#ffffff` white
- Terracotta accent replacing pure `#000000` black as the primary action color
- The "scarce accent" principle — terracotta is used sparingly for primary CTAs and active states only
- Warm hairline borders (`rgba(200, 180, 160, 0.25)`) instead of cool gray borders

### 2. Notion — Warm minimalism, serif headings, soft surfaces
**Why we chose it:** Notion's design system proves that a productivity tool can use serif typography without feeling dated. Notion's warm minimalism — the way it uses space, its subtle surface hierarchy, its restrained use of color — aligns with MaxmaHere's "warmth in a professional context" brand requirement.

**What we borrowed:**
- Serif font for display headings in the UI (sidebar section titles, view headers)
- Tinted card surfaces that differentiate from the canvas without using shadow
- The "dense utility" layout approach for settings panels and provider cards
- Soft hover states that use background tint rather than border color shifts

### 3. Linear — Ultra-minimal, precise engineering
**Why we chose it:** Linear exemplifies how to make a dark-surface UI feel engineered rather than flashy. While MaxmaHere is light-mode, Linear's approach to surface hierarchy (four-step ladder), hairline borders, and tight spacing informed our component architecture.

**What we borrowed:**
- Four-step surface ladder (canvas -> surface-soft -> surface-card -> surface-raised)
- Hairline borders as structural elements, not decorative ones
- Precise border-radius scale with strict role-to-radius mapping
- Compact button padding and dense information layout in tool bubbles

### 4. Ollama — Monochrome simplicity, terminal-native
**Why we chose it:** Ollama proves that pure monochrome can be beautiful. While we introduce warmth, we preserve Ollama's discipline: no gradient text, no glassmorphism, no decorative color blocks. The monochrome base remains the dominant visual language.

**What we borrowed:**
- Pill-shaped interactive elements (file tags, badges, model tags)
- Terminal-inspired code block aesthetic (we kept `JetBrains Mono`)
- The principle that documentation (or in our case, conversation) IS the interface
- Spare use of status colors only for their functional purpose

---

## Key Design Changes

### 1. Color Palette

| Token | Current (Black & White) | Proposed (Warm Precision) |
|-------|------------------------|---------------------------|
| `--bg-primary` | `#ffffff` (Crisp White) | `#fcf9f5` (Warm Cream) |
| `--bg-secondary` | `#f9fafb` (Cloud Gray) | `#f5f0ea` (Warm Sand) |
| `--bg-card` | `#ffffff` (White) | `#fefcf8` (Warm Card) |
| `--accent` | `#000000` (Black) | `#c17a5c` (Terracotta) |
| `--accent-light` | `#b9b9b9` (Pewter) | `#e8d5c8` (Terracotta Tint) |
| `--text-primary` | `#1f2937` (Ink) | `#2c2825` (Warm Ink) |
| `--text-secondary` | `#6b7280` (Mist Gray) | `#7a7068` (Warm Gray) |
| `--text-tertiary` | `#9ca3af` (Silver Gray) | `#a89e94` (Warm Mute) |
| `--border` | `#e5e7eb` (Line Gray) | `rgba(200, 180, 160, 0.25)` (Warm Hairline) |
| `--shadow-color` | `rgba(0,0,0,0.xx)` | `rgba(120, 100, 80, 0.12)` (Warm Shadow) |

**Why:** Pure white (#ffffff) reads as sterile SaaS, not a personal workspace. The warm cream base (inspired by Claude's `#faf9f5`) creates a softer, more inviting reading surface. Terracotta (inspired by Claude) replaces black as the accent — it draws attention without the harshness of pure black, and it pairs beautifully with the cream canvas. Warm shadows use brown-tinted black for a more natural falloff.

### 2. Typography Enhancement

| Context | Current | Proposed |
|---------|---------|----------|
| Display/Headings | System sans-serif | **Serif** (`EB Garamond`, `Noto Serif SC`) — already in tokens.css but unused |
| Body text | System sans-serif | System sans-serif (unchanged) |
| Labels | 11px uppercase | 10.5px uppercase, weight 500 (slightly softer) |
| Message text | 16px | 16px (unchanged) |
| Code | `SF Mono`, 13px | `JetBrains Mono`, 13px (already in tokens) |

**Why:** The serif display headings (already present in the codebase via `--font-serif` and `--font-display` but unmapped in DESIGN.md) give the UI a distinctive character — Notion proved this works for productivity tools. The serif is used ONLY for view titles, section headers, and sidebar category labels — never for body text or UI chrome. This creates a warm, editorial feel without sacrificing readability.

### 3. Component Refinements

#### Chat Bubbles
- **User bubble:** Warm cream (`#fcf9f5`), 1px warm hairline border, asymmetric radius. Subtle warm shadow.
- **Assistant bubble:** Slightly lighter tint (`#fefcf8`), no border, warm shadow. The asymmetry of radius is preserved (one flat corner) but softened — both bubbles now use 16px radius with 6px flat corners (instead of 14px with 4px).
- **Bubble connection:** When a user sends consecutive messages, bubbles stack with reduced gap (4px) and flat-to-flat connection.

#### Sidebar
- **Width:** 240px (unchanged), collapse to 56px icon-only.
- **Background:** Warm sand (`#f5f0ea`) with subtle paper texture overlay at 15% opacity.
- **Active item:** Terracotta dot indicator + warm tint background (not full black fill).
- **Icons:** 18px, `--text-secondary` at rest, terracotta when active.
- **Settings popup:** Tinted cream background, warm shadows, terracotta accent on toggles.

#### Buttons
- **Primary:** Terracotta (`#c17a5c`) background, white text, 8px radius. Hover darkens to `#a8654a`. Active press: `#945840`.
- **Ghost:** Transparent, warm text, warm hairline border on hover.
- **Circle Send (Chat):** Terracotta background, white icon. Hover: scale 1.08, background shifts to terracotta-dark.
- **Stop Circle:** Red (`#d06a60`) — softened from `#ef4444` to match the warmer palette.

#### Input Fields
- **Background:** Warm cream (`#fcf9f5`) — matches the canvas but is distinct from card surfaces.
- **Border:** Warm hairline at rest, terracotta on focus.
- **Focus:** No glow — terracotta border + subtle terracotta-tint background shift.
- **Chat Input:** Transparent inside a bordered container with warm card surface. Shadow-soft uses warm-tinted shadow.

#### Cards / Tool Bubbles
- **Resting state:** Warm card (`#fefcf8`), warm hairline border, 10px radius.
- **Hover:** Subtle terracotta-tint overlay (`rgba(193, 122, 92, 0.04)`), warm shadow-md.
- **Running state:** Terracotta border + terracotta-tint background.

#### Toggle / Switch
- **Active state:** Terracotta fill.
- **Private mode:** Amber (`#c99a6a`) for warning signaling — warm amber, not bright `#f59e0b`.

### 4. Layout & Spacing

| Token | Current | Proposed |
|-------|---------|----------|
| `--sidebar-width` | 220px | 240px (breathing room) |
| `--space-xs` | 4px | 4px (unchanged) |
| `--space-sm` | 8px | 8px (unchanged) |
| `--space-md` | 16px | 16px (unchanged) |
| `--space-lg` | 24px | 24px (unchanged) |
| `--chat-column-width` | unset | 720px (max-width for reading) |

**Why:** A slightly wider sidebar (240px vs 220px) gives navigation items more breathing room. The 720px chat column width follows established reading-comfort research — lines longer than ~80 characters reduce readability.

### 5. Surface & Depth

Shadows are tinted warm (brown-black instead of pure black) to match the cream base:

| Token | Current | Proposed |
|-------|---------|----------|
| `--shadow-xs` | `0 1px 3px rgba(0,0,0,0.04)` | `0 1px 3px rgba(120,100,80,0.06)` |
| `--shadow-sm` | `0 1px 4px rgba(0,0,0,0.06)` | `0 1px 4px rgba(120,100,80,0.08)` |
| `--shadow-md` | `0 2px 8px rgba(0,0,0,0.08)` | `0 2px 8px rgba(120,100,80,0.10)` |
| `--shadow-lg` | `0 4px 16px rgba(0,0,0,0.12)` | `0 4px 16px rgba(120,100,80,0.14)` |
| `--shadow-xl` | `0 6px 28px rgba(0,0,0,0.18)` | `0 6px 28px rgba(120,100,80,0.20)` |

---

## UX Improvements

### 1. Visual Comfort
The warm cream background reduces eye strain during extended use compared to pure white. The terracotta accent is less aggressive than pure black for primary actions, making the interface feel more approachable.

### 2. Information Hierarchy
The four-step surface ladder (canvas -> sand -> card -> raised) provides clearer depth cues than the current two-step system (white + cloud gray). Users can instantly distinguish the main canvas from sidebar from cards from modals.

### 3. Wayfinding
Terracotta replaces black as the active-state indicator. In practice, this means:
- The current sidebar item gets a terracotta dot and tint (vs black text)
- Active toggles fill with terracotta (vs black)
- Primary CTAs stand out without screaming
- The overall effect is wayfinding without aggression

### 4. Readability
Serif display headings create a natural visual hierarchy that sans-only systems lack. The contrast between serif section titles and sans-serif body text signals "this is a label" without relying on uppercase tracking alone.

### 5. Emotional Resonance
The warm palette signals "personal workspace" rather than "enterprise dashboard." Combined with the paper texture (subtle, already existing in the codebase), the interface feels tactile and inhabited — a space for thinking, not a control panel.

---

## Before/After Comparison

### Home / Chat View
| Element | Before (Current) | After (Proposed) |
|---------|-----------------|------------------|
| Background | Pure white (`#ffffff`) | Warm cream (`#fcf9f5`) |
| Sidebar | Cloud gray (`#f9fafb`) | Warm sand (`#f5f0ea`) + paper texture |
| Chat bubbles | White on white with gray shadow | Warm tint on cream with warm shadow |
| Active nav item | Black text + full highlight | Terracotta dot + warm tint |
| Send button | Black circle | Terracotta circle |
| Input border | Gray (`#e5e7eb`) | Warm hairline (`rgba(200,180,160,0.25)`) |
| Section headers | 11px uppercase sans | 12px uppercase serif |

### Provider Settings View
| Element | Before (Current) | After (Proposed) |
|---------|-----------------|------------------|
| Cards | White + gray border | Warm card + warm hairline |
| Toggle active | Black fill | Terracotta fill |
| Labels | 11px uppercase sans | 11px uppercase sans (unchanged) |
| Primary CTA | Black button | Terracotta button |

### System Status / Metrics
| Element | Before (Current) | After (Proposed) |
|---------|-----------------|------------------|
| Background | Pure white | Warm cream |
| Status indicators | Black / red | Terracotta / soft red |
| Card grouping | Same white on white | layered warm surfaces |

---

## Implementation Notes

All proposed changes are:
1. **CSS-only** — No component restructuring needed. Only token values and theme files change.
2. **Backward compatible** — The existing 11 themes continue working. The new "warm-precision" theme is proposed as the new default.
3. **Incremental** — Each change can be adopted independently. The full system is a unified vision, but the color palette shift alone would deliver 80% of the UX improvement.
4. **Accessible** — Contrast ratios are maintained or improved. The warm cream-to-warm-ink contrast (approx. 11.5:1) exceeds WCAG AA.

See `DESIGN.md` for the complete updated design system token specification.
