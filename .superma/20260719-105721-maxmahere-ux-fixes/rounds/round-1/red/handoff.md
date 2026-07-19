# Round 1 — Red Handoff

## What was done
Red team surveyed all UI components and views in `web/src/`. Identified 9 distinct UI/UX issues across 12 files, focusing on:
- **Font size** (primary complaint): Body minimum raised from 15px→16px; all token font sizes bumped ~0.1rem; fixes applied to ChatHeader, SessionSidebar, SessionItem, ChatInput, ProvidersView, OnboardingView, WelcomeScreen, AppearanceView, ActivityView
- **Spacing density**: Increased padding/gaps in sidebar, provider cards, onboarding, activity list, welcome screen
- **Layout crowding**: Added flex-wrap to ChatHeader right group, increased toggle button sizes

## Files modified (12)
1. `web/src/App.vue` — body font min 15px→16px; nav-item font/padding increased
2. `web/src/assets/styles/tokens.css` — all fs-* tokens bumped
3. `web/src/components/ChatHeader.vue` — increased padding, font sizes, added flex-wrap
4. `web/src/components/ChatInput.vue` — file-tag and shortcut-hint font sizes increased
5. `web/src/components/SessionSidebar.vue` — increased all font sizes and paddings
6. `web/src/components/SessionItem.vue` — session ID and count font sizes increased
7. `web/src/components/WelcomeScreen.vue` — increased action-btn, capability, example-chip sizes
8. `web/src/views/ActivityView.vue` — increased item font size and padding
9. `web/src/views/AppearanceView.vue` — increased h3 and desc font sizes
10. `web/src/views/ChatView.vue` — increased toggle button size and font
11. `web/src/views/OnboardingView.vue` — increased all font sizes, button padding, input padding
12. `web/src/views/ProvidersView.vue` — increased card text, model tags, buttons, form label sizes

## Patches
See `patches/all-fixes.patch` (comprehensive diff of all changes).

## Build status
Will verify with `npx vite build`.

## Notes for Blue
- All changes are CSS/style-only — no business logic or TypeScript was modified
- The root body font minimum was the most impactful single change
- Token font scale affects all components system-wide
- Some views (SkillsView, McpView) have similar small-font patterns but were not prioritized
