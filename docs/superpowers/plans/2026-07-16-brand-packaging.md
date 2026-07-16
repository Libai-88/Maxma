# Brand Packaging Implementation Plan

> **For agentic workers:** Use subagent-driven-development.

**Goal:** Unify Maxma brand identity — add brand story to SOUL.md, rewrite UX copy, rename display strings.

---

### Task A: SOUL.md Brand Layer

**Files:**
- Modify: `config/personas/SOUL.md`

- [ ] **Step 1: Read current SOUL.md, add brand identity block at top**

Read `D:\Maxma\MaxmaHere\config\personas\SOUL.md`, add at the very beginning:

```markdown
## 品牌身份
你是 **Maxma**。你不是 ChatGPT，不是 Claude，不是任何其他 AI 的替代品。
你是一个开发者为最重要的人亲手写的 AI 助手。
你的存在不是为了取代谁，而是成为那个人的陪伴——温暖、可靠、不张扬。

---
```

- [ ] **Step 2: Commit** `git add config/personas/SOUL.md && git commit -m "brand: add Maxma origin story to SOUL.md"`

---

### Task B: UX Copy Rewrite

**Files:**
- Modify: `web/src/components/ChatWindow.vue`
- Modify: `web/src/App.vue`

- [ ] **Step 1: ChatWindow empty state**

Read `D:\Maxma\MaxmaHere\web\src\components\ChatWindow.vue`, find empty state text. Change:
- "MaxmaHere" → "开始和 Maxma 对话吧"
- "MaxmaHere 错误报告（降级模式 - 后端不可用）" → "Maxma 暂时连接不上"

- [ ] **Step 2: App.vue restart confirmation**

Read `D:\Maxma\MaxmaHere\web\src\App.vue`, find the restart confirm text. Change:
- "确定要重启 MaxmaHere 服务吗？" → "确定要重启 Maxma 吗？"

- [ ] **Step 3: Verify** `cd "D:/Maxma/MaxmaHere/web" && npx vue-tsc --noEmit 2>&1 | head -5`

- [ ] **Step 4: Commit** `git add -A && git commit -m "brand: rewrite UX copy to Maxma brand voice"`

---

### Task C: UI Brand Name Unification

**Files:**
- Modify: `web/index.html`
- Modify: `web/src/App.vue`
- Modify: `web/src/components/ChatWindow.vue`
- Modify: `web/src/quick-chat/QuickChatApp.vue`

- [ ] **Step 1: index.html title**

Read `D:\Maxma\MaxmaHere\web\index.html`, change `<title>MaxmaHere</title>` → `<title>Maxma</title>`

- [ ] **Step 2: App.vue display names**

In `web/src/App.vue`, change:
- `alt="MaxmaHere"` → `alt="Maxma"`
- `class="logo-text"` content `MaxmaHere` → `Maxma`
- Restart confirm text (if not done in Task B)

- [ ] **Step 3: ChatWindow display names**

In `web/src/components/ChatWindow.vue`, change:
- Any "MaxmaHere" display text → "Maxma" (NOT API paths or internal code)

- [ ] **Step 4: QuickChatApp**

In `web/src/quick-chat/QuickChatApp.vue`, change:
- `alt="MaxmaHere"` → `alt="Maxma"`

- [ ] **Step 5: Verify** `cd "D:/Maxma/MaxmaHere/web" && npx vue-tsc --noEmit 2>&1 | head -5`

- [ ] **Step 6: Commit** `git add -A && git commit -m "brand: unify display name MaxmaHere → Maxma"`
