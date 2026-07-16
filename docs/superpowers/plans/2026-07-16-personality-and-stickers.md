# Maxma Personality + Stickers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make Maxma's personality visible in the UI (WelcomeScreen, ChatHeader, PersonaCard) and restore the full sticker pack system with AI emotion matching.

**Architecture:** Personality data from SOUL.md → Python API → Pinia store → Vue components. Stickers: frontend detects emotions in OMP responses, calls REST API for random sticker from category.

**Tech Stack:** Vue 3 + Pinia + TypeScript, Python FastAPI, 329 WebP sticker assets across 13 categories.

---

## File Structure

```
api/
  routes/
    persona.py              ← Modify: add GET /api/persona/profile
  server.py                 ← Modify: register sticker routers

web/src/
  stores/
    persona.ts              ← Create: Pinia persona store
  components/
    WelcomeScreen.vue       ← Create: empty-state welcome
    ChatHeader.vue          ← Create: chat header with personality
    PersonaCard.vue         ← Create: personality detail card
  views/
    ChatView.vue            ← Modify: integrate WelcomeScreen + ChatHeader
    SoulView.vue            ← Modify: integrate PersonaCard
  composables/
    useChat.ts              ← Modify (or create stickerUtils.ts): emotion→sticker mapping
```

---

### Task A1: Persona API + Store

**Files:**
- Modify: `api/routes/persona.py`
- Create: `web/src/stores/persona.ts`

- [ ] **Step 1: Add persona profile endpoint**

Read `D:\Maxma\MaxmaHere\api\routes\persona.py` first, then add this function:

```python
import re
from pathlib import Path
from fastapi import APIRouter

router = APIRouter()

PERSONAS_DIR = Path("config/personas")

@router.get("/persona/profile")
async def get_persona_profile():
    """返回当前活跃人格的展示信息（从 SOUL.md + USER.md 解析）。"""
    soul_path = PERSONAS_DIR / "SOUL.md"
    user_path = PERSONAS_DIR / "USER.md"

    name = "Maxma"
    description = "温暖体贴又有点调皮的大姐姐"
    scene = "吵闹的小公寓，窗外有一条马路"
    style = "playful · 直接 · 温暖"
    nickname = "你"
    greeting = "你来啦。"

    # Parse SOUL.md
    if soul_path.exists():
        text = soul_path.read_text("utf-8")
        # Extract name from first heading
        m = re.search(r'^#\s+(.+)', text, re.MULTILINE)
        if m: name = m.group(1).strip()
        # Extract description (first para after first heading)
        parts = re.split(r'\n#+\s+', text)
        if len(parts) > 0:
            lines = [l.strip() for l in parts[0].split('\n') if l.strip() and not l.startswith('#')]
            if lines: description = lines[0][:50]
        # Extract scene from "默认所在地" section
        scene_m = re.search(r'默认居住在一个(.+?)(?:\n|$)', text)
        if scene_m: scene = scene_m.group(1).strip()
        # Extract style from "说话风格" hints
        style_hints = []
        for kw in [' playful', '直接', '温暖', '调皮', '可爱']:
            if kw.lower() in text.lower(): style_hints.append(kw.strip())
        if style_hints: style = ' · '.join(style_hints[:3])

    # Parse USER.md for nickname
    if user_path.exists():
        user_text = user_path.read_text("utf-8")
        nn = re.search(r'\*\*称呼\*\*\s*[：:]\s*(.+)', user_text)
        if nn: nickname = nn.group(1).strip()

    greeting = f"{nickname}，你来啦。"

    return {
        "name": name,
        "description": description,
        "nickname": nickname,
        "scene": scene,
        "style": style,
        "greeting": greeting,
        "avatar": "✦",
    }
```

- [ ] **Step 2: Create persona Pinia store**

`D:\Maxma\MaxmaHere\web\src\stores\persona.ts`:

```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface PersonaProfile {
  name: string
  description: string
  nickname: string
  scene: string
  style: string
  greeting: string
  avatar: string
}

export const usePersonaStore = defineStore('persona', () => {
  const profile = ref<PersonaProfile>({
    name: 'Maxma',
    description: '温暖体贴又有点调皮的大姐姐',
    nickname: '你',
    scene: '吵闹的小公寓',
    style: 'playful · 直接 · 温暖',
    greeting: '你来啦。',
    avatar: '✦',
  })
  const loading = ref(false)

  async function fetchProfile() {
    loading.value = true
    try {
      const res = await fetch('/api/persona/profile')
      const data = await res.json()
      if (data) profile.value = data
    } catch { /* use defaults */ }
    finally { loading.value = false }
  }

  return { profile, loading, fetchProfile }
})
```

- [ ] **Step 3: Verify**

```bash
cd "D:/Maxma/MaxmaHere" && source .venv/Scripts/activate && python -c "from api.routes.persona import router; print('OK')"
cd "D:/Maxma/MaxmaHere/web" && npx vue-tsc --noEmit 2>&1 | head -5
```

- [ ] **Step 4: Commit**

```bash
cd "D:/Maxma/MaxmaHere" && git add api/routes/persona.py web/src/stores/persona.ts && git commit -m "feat: add persona profile API + Pinia store"
```

---

### Task A2: WelcomeScreen + ChatHeader

**Files:**
- Create: `web/src/components/WelcomeScreen.vue`
- Create: `web/src/components/ChatHeader.vue`
- Modify: `web/src/views/ChatView.vue`

- [ ] **Step 1: Create WelcomeScreen.vue**

`D:\Maxma\MaxmaHere\web\src\components\WelcomeScreen.vue`:

```vue
<template>
  <div class="welcome-screen">
    <div class="welcome-content">
      <div class="welcome-avatar">{{ store.profile.avatar }}</div>
      <h1 class="welcome-name">{{ store.profile.name }}</h1>
      <p class="welcome-scene">
        {{ store.profile.scene ? store.profile.scene + '，' : '' }}Maxma 正趴在桌上等你。
      </p>
      <p class="welcome-greeting">{{ store.profile.greeting }}</p>
      <div class="welcome-actions">
        <button class="action-btn" @click="$emit('start', '随便聊聊')">💬 随便聊聊</button>
        <button class="action-btn" @click="$emit('start', '帮我看看最近有什么好玩的')">🔍 帮我个忙</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePersonaStore } from '../stores/persona'
const store = usePersonaStore()
defineEmits<{ start: [message: string] }>()
</script>

<style scoped>
.welcome-screen {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 48px 24px;
}
.welcome-content { text-align: center; max-width: 400px; }
.welcome-avatar { font-size: 48px; margin-bottom: 12px; }
.welcome-name { font-size: 24px; font-weight: 600; color: var(--text-primary, #1f2937); margin: 0 0 16px; }
.welcome-scene { font-size: 14px; color: var(--text-secondary, #6b7280); line-height: 1.7; margin: 0 0 8px; }
.welcome-greeting { font-size: 16px; color: var(--text-primary, #1f2937); font-weight: 500; margin: 0 0 32px; }
.welcome-actions { display: flex; gap: 12px; justify-content: center; }
.action-btn {
  padding: 10px 20px; border: 1px solid var(--border, #e5e7eb);
  border-radius: 6px; background: var(--bg-card, #fff);
  font-size: 14px; color: var(--text-primary, #1f2937);
  cursor: pointer; transition: all 0.15s;
}
.action-btn:hover { background: #000; color: #fff; border-color: #000; }
</style>
```

- [ ] **Step 2: Create ChatHeader.vue**

`D:\Maxma\MaxmaHere\web\src\components\ChatHeader.vue`:

```vue
<template>
  <div class="chat-header">
    <div class="header-left">
      <span class="header-avatar">{{ store.profile.avatar }}</span>
      <span class="header-name">{{ store.profile.name }}</span>
      <span class="header-divider">·</span>
      <span class="header-tags">{{ store.profile.description }} · {{ sceneShort }}</span>
    </div>
    <div class="header-right">
      <slot name="extra" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePersonaStore } from '../stores/persona'
const store = usePersonaStore()
const sceneShort = computed(() => {
  const s = store.profile.scene
  return s.length > 12 ? s.slice(0, 12) + '…' : s
})
</script>

<style scoped>
.chat-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px; border-bottom: 1px solid var(--border, #e5e7eb);
  background: var(--bg-primary, #fff);
}
.header-left { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.header-avatar { font-size: 16px; }
.header-name { font-weight: 600; color: var(--text-primary, #1f2937); }
.header-divider { color: var(--text-tertiary, #9ca3af); }
.header-tags { font-size: 11px; color: var(--text-secondary, #6b7280); }
.header-right { display: flex; align-items: center; gap: 8px; }
</style>
```

- [ ] **Step 3: Modify ChatView.vue**

Read `D:\Maxma\MaxmaHere\web\src\views\ChatView.vue` first. Then:

1. Add imports:
```typescript
import WelcomeScreen from '../components/WelcomeScreen.vue'
import ChatHeader from '../components/ChatHeader.vue'
import { usePersonaStore } from '../stores/persona'
```

2. Initialize persona store on mount:
```typescript
const personaStore = usePersonaStore()
onMounted(() => { personaStore.fetchProfile() })
```

3. In the template, wrap the chat area:
```vue
<template>
  <div class="chat-view">
    <ChatHeader>
      <template #extra>
        <!-- ModelSelector and ContextUsageBadge go here -->
        <ModelSelector />
        <ContextUsageBadge />
      </template>
    </ChatHeader>
    
    <!-- Message list -->
    <div class="message-list" v-if="hasMessages">
      <!-- existing message rendering -->
    </div>
    
    <!-- Welcome screen when no messages -->
    <WelcomeScreen v-else @start="handleQuickStart" />
    
    <!-- Chat input -->
    <ChatInput />
  </div>
</template>
```

4. Add the `handleQuickStart` method:
```typescript
function handleQuickStart(message: string) {
  // Send the message as a new chat
  sendMessage(message)
}
```

- [ ] **Step 4: Verify**

```bash
cd "D:/Maxma/MaxmaHere/web" && npx vue-tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 5: Commit**

```bash
cd "D:/Maxma/MaxmaHere" && git add web/src/components/WelcomeScreen.vue web/src/components/ChatHeader.vue web/src/views/ChatView.vue && git commit -m "feat: add WelcomeScreen and ChatHeader with Maxma personality"
```

---

### Task A3: PersonaCard

**Files:**
- Create: `web/src/components/PersonaCard.vue`
- Modify: `web/src/views/SoulView.vue`

- [ ] **Step 1: Create PersonaCard.vue**

`D:\Maxma\MaxmaHere\web\src\components\PersonaCard.vue`:

```vue
<template>
  <div class="persona-card">
    <div class="card-header">当前人格</div>
    <div class="card-body">
      <div class="persona-avatar">{{ store.profile.avatar }} {{ store.profile.name }}</div>
      <p class="persona-desc">"{{ store.profile.description }}"</p>
      <div class="persona-details">
        <div class="detail-row"><span class="label">称呼你</span><span class="value">{{ store.profile.nickname }}</span></div>
        <div class="detail-row"><span class="label">常驻地</span><span class="value">{{ store.profile.scene || '小书房' }}</span></div>
        <div class="detail-row"><span class="label">风格</span><span class="value">{{ store.profile.style }}</span></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePersonaStore } from '../stores/persona'
const store = usePersonaStore()
</script>

<style scoped>
.persona-card { padding: 20px; border: 1px solid var(--border, #e5e7eb); border-radius: 10px; background: var(--bg-card, #fff); }
.card-header { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary, #6b7280); margin-bottom: 16px; }
.card-body { }
.persona-avatar { font-size: 20px; font-weight: 600; color: var(--text-primary, #1f2937); margin-bottom: 8px; }
.persona-desc { font-size: 14px; color: var(--text-secondary, #6b7280); font-style: italic; margin: 0 0 16px; }
.persona-details { display: flex; flex-direction: column; gap: 8px; }
.detail-row { display: flex; justify-content: space-between; font-size: 13px; padding: 6px 0; border-top: 1px solid var(--border, #e5e7eb); }
.label { color: var(--text-secondary, #6b7280); }
.value { color: var(--text-primary, #1f2937); font-weight: 500; }
</style>
```

- [ ] **Step 2: Modify SoulView.vue**

Read `D:\Maxma\MaxmaHere\web\src\views\SoulView.vue`, then add at the top of the template:

```vue
<PersonaCard />
```

And the import:
```typescript
import PersonaCard from '../components/PersonaCard.vue'
```

- [ ] **Step 3: Verify → Commit**

```bash
cd "D:/Maxma/MaxmaHere/web" && npx vue-tsc --noEmit 2>&1 | head -5
git add web/src/components/PersonaCard.vue web/src/views/SoulView.vue
git commit -m "feat: add PersonaCard to SoulView"
```

---

### Task B1: Sticker System Recovery

**Files:**
- Modify: `api/server.py`
- Create/Modify: `web/src/composables/stickerUtils.ts`

- [ ] **Step 1: Register sticker routers in server.py**

Read `D:\Maxma\MaxmaHere\api\server.py`. Add imports:

```python
from api.routes import stickers as stickers_router
from api.routes import sticker_favorites as sticker_favorites_router
from api.routes import sticker_upload as sticker_upload_router
```

Add registration (after existing routers):

```python
app.include_router(stickers_router.router, prefix="/api")
app.include_router(sticker_favorites_router.router, prefix="/api")
app.include_router(sticker_upload_router.router, prefix="/api")
```

- [ ] **Step 2: Create sticker emotion utils**

`D:\Maxma\MaxmaHere\web\src\composables\stickerUtils.ts`:

```typescript
/** 情绪关键词 → 表情包分类映射 */

const EMOTION_MAP: Record<string, string> = {
  '开心': '开心', '高兴': '开心', '哈哈': '开心', '嘻嘻': '开心', '真好': '开心',
  '委屈': '委屈', '难过': '委屈', '伤心': '委屈', '呜呜': '委屈', '哭': '委屈',
  '害羞': '害羞', '不好意思': '害羞', '羞': '害羞',
  '尴尬': '尴尬', '无语': '无语', '晕': '无语', '服了': '无语',
  '生气': '生气', '气死': '生气', '哼': '生气',
  '惊讶': '惊讶', '真的吗': '惊讶', '哇': '惊讶', '天哪': '惊讶',
  '撒娇': '撒娇', '好不好嘛': '撒娇', '人家': '撒娇',
  '悲伤': '悲伤', '泪': '悲伤',
  '得意': '得意', '厉害吧': '得意', '棒': '得意',
  '爱心': '爱心', '爱你': '爱心', '想你': '爱心', '喜欢': '爱心', '亲': '爱心',
  '日常': '日常',
}

/** 从文本中检测情绪，返回贴纸分类名或 null */
export function detectEmotion(text: string): string | null {
  if (!text) return null

  // 1. 优先检测 [表情:X] 精确标记
  const explicitMatch = text.match(/\[表情[:：]([^\]]+)\]/)
  if (explicitMatch && EMOTION_MAP[explicitMatch[1]]) {
    return EMOTION_MAP[explicitMatch[1]]
  }

  // 2. 模糊匹配关键词
  for (const [keyword, category] of Object.entries(EMOTION_MAP)) {
    if (text.includes(keyword)) return category
  }

  return null
}

/** 根据分类名获取随机贴纸 URL */
export function getStickerUrl(category: string): string {
  return `/api/stickers/random/${encodeURIComponent(category)}`
}
```

- [ ] **Step 3: Integrate emotion detection into message display**

In the component that renders assistant messages (likely `ChatWindow.vue` or `MessageBubble.vue` or `useChat.ts`), after a message is received:

```typescript
// After receiving an OMP answer event:
const emotion = detectEmotion(answerText)
if (emotion) {
  // Fetch random sticker from this category
  const res = await fetch(`/api/stickers/random/${emotion}`)
  const data = await res.json()
  // data contains the sticker URL — render it alongside the message
  turn.stickerUrl = data.url  // or however the turn state tracks stickers
}
```

Or simpler approach — add a `stickerUrl` to the message state and render StickerInline next to the message bubble:

```vue
<StickerInline v-if="msg.stickerUrl" :url="msg.stickerUrl" />
```

- [ ] **Step 4: Verify**

```bash
cd "D:/Maxma/MaxmaHere" && source .venv/Scripts/activate && python -c "from api.server import create_app; app = create_app(); print(f'OK: {len(app.routes)} routes')"
```

```bash
cd "D:/Maxma/MaxmaHere/web" && npx vue-tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 5: Commit**

```bash
cd "D:/Maxma/MaxmaHere" && git add -A && git commit -m "feat: restore sticker routes, add AI emotion→sticker matching"
```

---

## 验证清单

- [ ] `GET /api/persona/profile` 返回 Maxma 的 name/description/nickname/scene/style/greeting
- [ ] 空状态显示 WelcomeScreen 场景描写，点击"随便聊聊"开始对话
- [ ] ChatHeader 显示 ✦ Maxma · 温暖体贴 · 小书房
- [ ] SoulView 显示 PersonaCard 人格详情
- [ ] `GET /api/stickers/random/开心` 返回 200 + 贴纸 URL
- [ ] AI 回复包含"开心"时自动显示表情包
- [ ] TypeScript 编译零错误
- [ ] 服务端 12+ routes 注册
