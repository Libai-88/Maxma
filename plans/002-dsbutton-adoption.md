# 002 — Adopt `DsButton` to replace native `<button>` elements

- **Status**: TODO
- **Commit**: `bf78e8d`
- **Severity**: HIGH
- **Category**: Physicality
- **Estimated scope**: ~15 files, ~100+ button instances (phased)

## Problem

The codebase has 236 raw `<button>` elements across 67 files. Only ~25 have `:active { transform: scale(...) }` press feedback. The `DsButton` component (`web/src/components/ui/DsButton.vue`) has correct press feedback (triple-gated hover, `scale(0.96)` active, `--ease-spring` easing, reduced-motion aware) but is **never used** — 0 references in templates.

Worst offenders (no transition at all, no `:active`):
```css
/* web/src/components/MarkdownEditor.vue:131 — .save-button has no transition */
/* web/src/views/SoulView.vue:356 — .save-button has no transition */
/* web/src/views/McpView.vue:1286 — .action-btn has no transition */
/* web/src/components/ModelSettingsPanel.vue:43 — .toggle-btn has no transition */
/* web/src/components/ProcessFoldBlock.vue:143 — .process-fold__action has no transition */
/* web/src/quick-chat/QuickChatApp.vue:288 — .qc-stop-btn has no transition */
/* web/src/quick-chat/QuickChatApp.vue:321 — .qc-new-session has no transition */
```

## Target

Replace high-frequency native `<button>` elements with `<DsButton>` in priority components. DsButton already provides:

```vue
<!-- DsButton provides (already implemented): -->
<!-- - transform: scale(0.96) on :active with 80ms transition -->
<!-- - hover: translateY(-2px) gated behind @media (prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine) -->
<!-- - var(--ease-spring) for transform, var(--ease-out) for opacity -->
<!-- - spinner slot with reduced-motion slowdown -->
```

## Repo conventions to follow

- DsButton is at `web/src/components/ui/DsButton.vue`.
- Import pattern: `import DsButton from '@/components/ui/DsButton.vue'` (or relative path matching existing imports in the file).
- DsButton accepts `variant` ("primary" | "ghost" | "danger"), `size`, `disabled`, `loading` props. Check `DsButton.vue` for full API.
- Exemplar usage: `web/src/views/McpView.vue` and `web/src/views/EnvVarsView.vue` already use `.ds-btn` class (not the component, but the styles).

## Steps

### Phase A — High-frequency components (do first)

1. **ChatInput.vue** — Replace these button classes with `<DsButton>`:
   - `.chat-connection-error-close` (line ~1145)
   - `.link-input-cancel` (line ~1513)
   - `.link-input-confirm` (line ~1502)
   - `.btn-add-file` (line ~1616)
   - `.add-file-menu-item` (line ~1667)
   - `.btn-sticker` (line ~1697)
   - Keep `.btn-send` and `.btn-stop` as-is (they have custom shapes/layouts that DsButton may not fit without visual regression).

2. **ApprovalBubble.vue** — Replace `.btn-approve` and `.btn-reject` (line ~211) with `<DsButton variant="primary">` and `<DsButton variant="danger">`.

3. **ErrorCard.vue** — Replace `.error-card__btn` (line ~142) with `<DsButton>`.

4. **MarkdownEditor.vue** — Replace `.save-button` (line ~131) and `.md-template-btn` (line ~256) with `<DsButton>`.

5. **SoulView.vue** — Replace `.save-button` (line ~356), `.md-template-btn` (line ~500), `.btn-create-persona` (line ~517) with `<DsButton>`.

6. **McpView.vue** — Replace `.action-btn` (line ~1286) with `<DsButton>`.

7. **ModelSettingsPanel.vue** — Replace `.toggle-btn` (line ~43) with `<DsButton variant="ghost">`.

8. **ProcessFoldBlock.vue** — Replace `.process-fold__action` (line ~143) with `<DsButton variant="ghost">`.

9. **QuickChatApp.vue** — Replace `.qc-stop-btn` (line ~288) and `.qc-new-session` (line ~321) with `<DsButton>`.

### Phase B — Medium-frequency (optional, separate PR)

10. MediaViewer `.mv-btn`, PlanCard `.plan-btn`, ChatWindow `.error-copy-btn`, etc.

### For each replacement:
- Import DsButton at top of `<script setup>`.
- Replace `<button class="foo">` with `<DsButton variant="..." @click="...">`.
- Remove the old `.foo` CSS class's `:active`/hover rules (DsButton handles these).
- Keep any layout-specific CSS (margin, position, size) on a wrapper or via `class` prop.
- Preserve all event handlers and disabled states.

## Boundaries

- Do NOT replace buttons that have highly custom shapes (circular icon buttons with specific sizing, buttons that are part of a composite control like tag-remove chips).
- Do NOT change DsButton.vue itself — it already has correct behavior.
- Do NOT replace `<router-link>` elements even if styled as buttons.
- Do NOT force DsButton where it causes visual regression — if a button has a unique visual identity, leave it and add `:active` scale manually instead.
- If DsButton's variants don't match a button's current style, use `variant="ghost"` and override via `class` prop rather than modifying DsButton.

## Verification

- **Mechanical**: `cd web && npx vue-tsc --noEmit && npm run build` — both pass.
- **Feel check**:
  - Press each replaced button — confirm `scale(0.96)` press feedback is visible.
  - Hover each replaced button — confirm `translateY(-2px)` lift on desktop.
  - Toggle `prefers-reduced-motion: reduce` — confirm hover/active transforms disabled, color transitions remain.
  - Confirm no visual layout breakage (button sizes, spacing, alignment).
- **Done when**: All Phase A components use DsButton; `:active` press feedback works on every replaced button; build passes.
