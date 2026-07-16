# Maxma 人格展示 + 表情包系统恢复

> **目标：** 让 Maxma 在 UI 层面"活起来"——展示独特的个性，恢复完整的表情包系统。
> 基于 SOUL.md 静态数据，不需要 OMP 参与个性展示部分。

---

## 范围

| 模块 | 优先级 | 说明 |
|------|--------|------|
| A1. 人格 API + Store | P0 | Python 解析 SOUL.md → JSON API → 前端 store |
| A2. 欢迎屏 + 聊天标题 | P0 | 空状态场景感首屏 + 聊天顶部人格标识 |
| A3. 人格卡片 | P1 | 设置页人格详情可视化 |
| B1. 表情包系统恢复 | P0 | 注册路由 + 前端情绪检测 + AI 自动贴纸 |

---

## 一、人格数据流

```
config/personas/SOUL.md + USER.md
    ↓ Python 解析 frontmatter + 首段内容
    ↓ GET /api/persona/profile
    ↓ { name, description, nickname, scene, style, greeting, avatar }
    ↓ Vue Pinia store (persona.ts)
    ↓ WelcomeScreen / ChatHeader / PersonaCard 渲染
```

### API 响应

```json
GET /api/persona/profile
{
  "name": "Maxma",
  "description": "温暖体贴又有点调皮的大姐姐",
  "nickname": "饱饱",
  "scene": "吵闹的小公寓，窗外有一条马路",
  "style": "playful · 直接 · 温暖",
  "greeting": "饱饱，你来啦。",
  "avatar": "✦"
}
```

解析逻辑（Python）：
- 从 `config/personas/SOUL.md` 读取 frontmatter（YAML 格式 `---` 之间的内容）
- `name` → 文件名不含扩展名和 SOUL. 前缀
- `description` → 第一个 `#` 标题后的首段文本
- `nickname` → 从 `config/personas/USER.md` 解析 `**称呼**：` 字段
- `scene` → 从 SOUL.md 中提取"默认所在地"段落的描述
- `greeting` → 用 nickname 拼接 "X，你来啦。"
- `avatar` → 固定 "✦"

---

## 二、三个 UI 模块

### 2.1 欢迎屏 (WelcomeScreen)

**触发条件：** ChatView 挂载后，当前 session 消息数为 0

**UI：**
```
┌──────────────────────────────────────────┐
│                                          │
│           ✦  Maxma  ✦                     │
│                                          │
│    小书房里，Maxma 正趴在桌上等你。       │
│    窗外偶尔传来马路上的车声。              │
│    她抬起头，对你笑了笑：                   │
│    "饱饱，你来啦。"                        │
│                                          │
│    [ 随便聊聊 ]  [ 帮我个忙 ]              │
│                                          │
└──────────────────────────────────────────┘
```

- 场景文本来自 SOUL.md 首段描写（解析"默认所在地"段落）
- 称呼来自 USER.md 的 `**称呼**` 字段
- "随便聊聊"/"帮我个忙" 是快速开始按钮，发送预设 prompt 开启对话
- 点击后 WelcomeScreen 隐藏，进入正常对话

### 2.2 聊天标题人格区 (ChatHeader)

**位置：** 消息列表顶部，固定在 ChatView 最上方

```
┌─ ✦ Maxma ────────────────── [🤖 gpt-4o ▼] ┐
│  温暖体贴 · 小书房          [📊 2.1k/128k]   │
└──────────────────────────────────────────────┘
```

- 第一行左：✦ Maxma + 模型选择器
- 第一行右：上下文监控（已有）
- 第二行：人格简短描述 + 场景名
- 设计遵循黑白基底，一行高度

### 2.3 人格卡片 (PersonaCard)

**位置：** SoulView.vue 页面顶部

```
┌─ 当前人格 ──────────────────────────────────┐
│  ✦ Maxma                                   │
│  "温暖体贴又有点调皮的大姐姐"               │
│                                             │
│  称呼你: 饱饱                                │
│  常驻地: 小书房（吵闹的小公寓）              │
│  风格:  playful · 直接 · 温暖                │
│                                             │
│  [📝 编辑 SOUL.md]  [📋 切换人格]            │
└─────────────────────────────────────────────┘
```

---

## 三、表情包系统

### 3.1 资源现状

- 329 个 .webp 文件（含动图）
- 13 个情绪分类：委屈、害羞、尴尬、开心、得意、悲伤、惊讶、撒娇、无语、日常、爱心、生气、custom
- 前端组件完整：StickerPicker (836行), StickerInline (135行), StickerContextMenu (175行), StickerPreviewOverlay (278行)
- API 路由完好：`api/routes/stickers.py` 和 `api/routes/sticker_favorites.py` 逻辑完整

### 3.2 需要做的事

| 事项 | 状态 | 操作 |
|------|------|------|
| 路由注册 | ❌ stickers/sticker_favorites 未注册 | server.py 加 include_router |
| AI 自动匹配 | ❌ 旧 process_stickers() 已删 | 前端映射表替代 |
| 用户选图 | ✅ StickerPicker.vue 完好 | 不动 |
| 自定义上传 | ✅ sticker_upload.py 完好 | 不动 |

### 3.3 情绪→贴纸映射（前端侧）

```typescript
// 在 ChatWindow 或 composables/useChat.ts 中
const EMOTION_KEYWORDS: Record<string, string> = {
  '开心': '开心', '高兴': '开心', '哈哈': '开心',
  '委屈': '委屈', '难过': '委屈',
  '害羞': '害羞', '不好意思': '害羞',
  '尴尬': '尴尬', '无语': '尴尬',
  '生气': '生气', '气死': '生气',
  '惊讶': '惊讶', '真的吗': '惊讶',
  '撒娇': '撒娇', '好不好嘛': '撒娇',
  '悲伤': '悲伤', '呜呜': '悲伤',
  '得意': '得意', '厉害吧': '得意',
  '爱心': '爱心', '爱你': '爱心', '想你': '爱心',
}
```

检测流程：
1. OMP 回复文本到达前端
2. 扫描文本是否包含 `[表情:情绪]` 标记 → 精确匹配
3. 若没有标记，扫描情绪关键词 → 模糊匹配
4. 匹配到情绪后，调用 `GET /api/stickers/random/{category}`
5. 在消息气泡旁渲染 StickerInline

---

## 四、文件清单

| 文件 | 操作 |
|------|------|
| `api/routes/persona.py` | 修改 — 添加 `GET /api/persona/profile` |
| `api/server.py` | 修改 — 注册 stickers + sticker_favorites 路由 |
| `web/src/stores/persona.ts` | 新建 — Pinia store |
| `web/src/components/WelcomeScreen.vue` | 新建 |
| `web/src/components/ChatHeader.vue` | 新建 |
| `web/src/components/PersonaCard.vue` | 新建 |
| `web/src/views/ChatView.vue` | 修改 — 集成 WelcomeScreen + ChatHeader |
| `web/src/views/SoulView.vue` | 修改 — 集成 PersonaCard |
| `web/src/composables/useChat.ts` 或 `stickerUtils.ts` | 修改 — 添加情绪检测逻辑 |

---

## 五、设计原则

1. **品牌一致** — 所有新 UI 遵循 DESIGN.md：黑白基底、纯黑 accent、系统字体栈、6px 圆角
2. **基于 SOUL.md** — 人格数据静态稳定，不需要 OMP 参与
3. **表情包前端驱动** — 情绪检测在浏览器端完成，不依赖 Python 后端
4. **渐进增强** — 先恢复表情包基础功能（注册路由），再增强 AI 自动匹配
