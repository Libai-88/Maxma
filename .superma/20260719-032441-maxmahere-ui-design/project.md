# Project under review — MaxmaHere UI Design

## Name
MaxmaHere — AI Agent 桌面客户端

## Root path
`D:\Maxma\MaxmaHere`

## Current design system
See `DESIGN.md` for the full existing design system — a restrained monochrome (chroma 0) "Workbench" philosophy.

## Competition theme: 前端 UI 设计方案对抗

### Goal
Each team proposes a UI design improvement方案 for MaxmaHere that:
1. Is **inspired by** the awesome-design-md collection (73 real-world design systems)
2. **Respects** the existing design philosophy where appropriate
3. **Improves** the visual quality, usability, and user experience
4. Is **practical** — can be implemented within the existing Vue 3 + CSS token architecture

### Design inspiration source
https://github.com/VoltAgent/awesome-design-md — 73 DESIGN.md files from real products including:
- AI/LLM: Claude, Vercel, Cursor, Ollama, Replicate
- Productivity: Linear, Notion, Superhuman, Raycast
- Fintech: Stripe, Coinbase, Revolut
- Consumer: Apple, Spotify, Tesla, Nike
- And many more...

### Current UI architecture
- Vue 3 + Vite 5 + Pinia + TypeScript
- CSS design tokens via `tokens.css`
- 11 themes in `web/src/themes/`
- Components in `web/src/components/`
- Views in `web/src/views/`
- Design system documented in `DESIGN.md`

### Deliverable
Each team produces:
1. A **design proposal document** (review.md) describing their vision, inspiration sources, and specific changes
2. An **updated DESIGN.md** that reflects their proposed design system
3. (Optional) **CSS token changes** or **component modifications** demonstrating the design

### Evaluation criteria
- Visual quality & coherence (how well it hangs together)
- Inspiration usage (how effectively they used awesome-design-md)
- Practicality (can it be implemented?)
- Respect for existing brand identity
- User experience improvement
