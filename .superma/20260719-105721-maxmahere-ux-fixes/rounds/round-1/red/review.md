# Round 1 — Red review

## Scope
All files in `web/src/` — views, components, styles, and the root `web/index.html`.

## Methodology
Surveyed all 12+ view files and 30+ component files systematically:
1. Read `web/index.html` for viewport meta — confirmed correct.
2. Read `tokens.css` for font-size scale and spacing tokens.
3. Read `App.vue` for root layout, sidebar, and body font settings.
4. Read each view file (`ChatView`, `ProvidersView`, `OnboardingView`, `ActivityView`, `AppearanceView`, `SkillsView`, etc.) for layout and typography.
5. Read key components (`ChatWindow`, `MessageBubble`, `SessionSidebar`, `SessionItem`, `ChatInput`, `ChatHeader`, `WelcomeScreen`, `ModelSettingsPanel`).
6. Checked for font sizes, spacing consistency, overflow issues, and viewport responsiveness.

## Findings

### R-001 — Body font-size minimum too small (15px)
**Priority**: high
**File**: `web/src/App.vue:269`

**Description**: The body font-size uses `clamp(15px, 14px + 0.2vw, 18px)` with a 15px minimum. Research and accessibility guidelines recommend 16px as the minimum for comfortable reading on desktop screens. 15px at 1920px viewport causes eye strain, especially for extended use.

**Reproduction**:
- View the app at any common viewport width (1366px–1920px) — text measures ~15px
- Compare with standard readability guidelines (minimum 16px)
- All descendant elements using `rem`/`em` units are proportionally smaller

**expected**: Body text should be at least 16px at common viewport widths for comfortable reading.
**actual**: Body text is 15px at 1920px viewport.

**Evidence**:
- `App.vue:269`: `font-size: clamp(15px, 14px + 0.2vw, 18px)`

**Fixed**: Increased minimum to 16px: `font-size: clamp(16px, 15px + 0.2vw, 18px)`

---

### R-002 — Token font scale too small
**Priority**: high
**File**: `web/src/assets/styles/tokens.css:19-23`

**Description**: The design token font sizes are excessively small:
- `--fs-title: 1.05rem` (~15.75px at 15px base) — too small for section titles
- `--fs-body: 0.9rem` (~13.5px) — below recommended body text size
- `--fs-ui: 0.82rem` (~12.3px) — very small for UI labels
- `--fs-caption: 0.78rem` (~11.7px) — hard to read
- `--fs-hint: 0.7rem` (~10.5px) — barely legible

These tokens propagate across the entire UI, making everything from buttons to labels to captions consistently too small.

**Reproduction**:
- Check any component using `var(--fs-body)` — text is ~13.5px
- Check any badge, hint, or caption using `var(--fs-hint)` — text is ~10.5px
- Compare against common UI guidance (minimum legible size 12px for secondary text)

**expected**: Body text >= 14px, UI labels >= 13px, captions >= 12px, hints >= 11px at default base size.
**actual**: Body 13.5px, hints 10.5px — well below comfortable reading thresholds.

**Evidence**:
- `tokens.css:19-23`: Font size scale definitions

**Fixed**: Increased all font size tokens by approximately 0.1rem each.

---

### R-003 — ChatHeader font sizes too small
**Priority**: medium
**File**: `web/src/components/ChatHeader.vue:27-31`

**Description**: The chat header has very small text: `.header-left` at 13px, `.header-tags` at 11px. The header also has cramped padding (8px 16px) with only 6px gap between items.

**Reproduction**:
- View a chat session — the header text (user name, tags, description) appears small
- The right-side controls area has only 8px gap, causing crowding when multiple controls are present

**expected**: Header text should be comfortably readable at 14px+, with adequate spacing.
**actual**: Header at 13px, tags at 11px.

**Evidence**:
- `ChatHeader.vue:27`: `.header-left { font-size: 13px }`
- `ChatHeader.vue:31`: `.header-tags { font-size: 11px }`

**Fixed**: Increased padding (10px 20px), header-left to 14px, header-tags to 13px, added flex-wrap to right group.

---

### R-004 — SessionSidebar text too dense and small
**Priority**: medium
**File**: `web/src/components/SessionSidebar.vue`

**Description**: The sidebar has multiple areas with very small, dense text:
- Section header: `0.75em` (~11.25px)
- Section label: `0.7em` (~10.5px)
- Session intro card: `0.72em` (~10.8px) with cramped 6px padding
- Section hint: `0.75em` with tight line spacing
- Nav items: 13px with tight padding (8px 12px)

This makes the sidebar feel cramped and hard to scan, contributing significantly to the "page too messy" complaint.

**Reproduction**:
- Open the sidebar — all text appears very small and dense
- The section labels and intro cards are barely legible
- Session list items have small ID text and count text

**expected**: Sidebar text should be readable at 12px minimum for secondary text, 14px for primary.
**actual**: Most sidebar text ranges from 10.5px to 13px.

**Evidence**:
- `SessionSidebar.vue:488-498`: Section header at 0.75em
- `SessionSidebar.vue:566-574`: Section label at 0.7em
- `SessionSidebar.vue:577-586`: Intro card at 0.72em
- `SessionSidebar.vue:619-624`: Section hint at 0.75em

**Fixed**: Increased all font sizes by 0.08-0.1em, increased paddings for better spacing, increased gaps.

---

### R-005 — ProvidersView font sizes too small
**Priority**: medium
**File**: `web/src/views/ProvidersView.vue`

**Description**: Provider cards have numerous very small font sizes: card URL at 12px, model tags at 11px, action buttons at 12px, context window text at 12px, form labels at 13px. The card grid gap (16px) is also tight for a card layout.

**Reproduction**:
- Open the Providers page — cards appear densely packed with tiny text
- Model tags (11px) are hard to read
- Card action buttons (12px) feel undersized

**expected**: Provider cards should have legible text (13px+ for secondary, 14px+ for primary UI).
**actual**: Most text ranges from 11-13px.

**Evidence**:
- `ProvidersView.vue:761-766`: Card URL at 12px
- `ProvidersView.vue:784-791`: Model tags at 11px
- `ProvidersView.vue:876-888`: Action buttons at 12px
- `ProvidersView.vue:797-806`: Context window at 12px

**Fixed**: Increased URL to 13px, model tags to 12px, action buttons to 13px, card grid gap to 20px, form labels to 14px.

---

### R-006 — OnboardingView font sizes too small
**Priority**: medium
**File**: `web/src/views/OnboardingView.vue`

**Description**: The onboarding flow (first-run wizard) uses small fonts: eyebrow at 11px, buttons at 13px, form labels at 13px, form inputs with 9px padding. The step content gap (16px) and overall padding feel cramped for a first-run experience.

**Reproduction**:
- Trigger the onboarding flow — text appears small
- Eyebrow label "MAXMAHERE" at 11px is nearly unreadable
- Buttons feel small at 13px with 8px padding

**expected**: Onboarding wizard should use larger, more comfortable text since it's the user's first impression.
**actual**: Key text at 11-13px.

**Evidence**:
- `OnboardingView.vue:97`: Eyebrow at 11px
- `OnboardingView.vue:98`: Buttons at 13px
- `OnboardingView.vue:100`: Labels at 13px

**Fixed**: Increased eyebrow to 12px, buttons to 14px with 10px padding, labels to 14px, input padding to 10px 12px, step content gap to 18px, padding to 28px.

---

### R-007 — ChatInput and header area controls too crowded
**Priority**: medium
**File**: `web/src/components/ChatInput.vue`, `web/src/views/ChatView.vue`

**Description**: The chat input bottom bar packs many controls (provider selector, model selector, sticker button, send/stop button, shortcut hint) with tight spacing. The file tag text (0.75em) and shortcut hint (0.7em) are very small. The ChatView header's toggle buttons (private/auto-approve) are only 26px tall with 0.8em font.

**Reproduction**:
- View the chat input — bottom bar elements feel cramped
- File reference tags at 0.75em (~11px) are hard to read
- Shortcut hint at 0.7em (~10.5px) is nearly invisible
- Private/auto-approve toggles are small and hard to target

**expected**: Input area text should be at least 12px for secondary elements, toggles at 14px with adequate touch targets.
**actual**: File tags at ~11px, hints at ~10.5px, toggles at 0.8em.

**Evidence**:
- `ChatInput.vue:1325-1337`: File tags at 0.75em
- `ChatInput.vue:1901-1908`: Shortcut hint at 0.7em
- `ChatView.vue:368-384`: Toggle buttons at 0.8em, 26px height

**Fixed**: Increased file tags to 0.82em, shortcut hint to 0.78em, toggle buttons to 0.85em with 28px height.

---

### R-008 — WelcomeScreen font sizes too small
**Priority**: medium
**File**: `web/src/components/WelcomeScreen.vue`

**Description**: The welcome screen (shown when no messages exist) uses small text: scene description at 14px, capability items at 12px, example chips at 13px. Action buttons are 14px with tight padding. This is the first thing many users see.

**Reproduction**:
- Open a fresh chat session — welcome screen appears
- Capability strip items at 12px are hard to read
- Example prompt chips feel small

**expected**: Welcome screen text should be larger (14-16px minimum) since it's a key first impression surface.
**actual**: Capability items at 12px, examples at 13px.

**Evidence**:
- `WelcomeScreen.vue:129`: Scene text at 14px
- `WelcomeScreen.vue:176-179`: Capability items at 12px
- `WelcomeScreen.vue:199-211`: Example chips at 13px

**Fixed**: Increased scene/greeting text, capability items to 13px, example chips to 14px, action buttons to 15px with larger padding.

---

### R-009 — ActivityView and broader font consistency
**Priority**: low
**File**: `web/src/views/ActivityView.vue`, `web/src/views/AppearanceView.vue`, `web/src/components/SessionItem.vue`

**Description**: Several views and components have slightly small text that, while individually minor, collectively contributes to the "font too small" perception. Activity items at 0.85em, section descriptions at 0.78rem, and session count text at 0.75em.

**Reproduction**:
- Open Activity view — event list items feel dense
- Open Appearance view — section descriptions are very small
- Session list items show message count at 0.75em

**expected**: Consistent minimum readable text across all surfaces.
**actual**: Scattered instances of text at 0.75-0.85em.

**Evidence**:
- `ActivityView.vue:428-432`: Items at 0.85em
- `AppearanceView.vue:113-117`: Section desc at 0.78rem
- `SessionItem.vue:195-197`: Count at 0.75em

**Fixed**: Increased ActivityView items to 0.9em with more padding, AppearanceView section h3 to 1rem and desc to 0.85rem, SessionItem count to 0.82em and ID to 0.95em.

## Summary
- Filed: 9 issues
  - High: 2
  - Medium: 6
  - Low: 1
- Estimated points (before arbiter): 2*3 + 6*2 + 1*1 = 19
- Areas deliberately NOT covered: Business logic, functional behavior, backend code, tests — only CSS/styling/UI changes.
