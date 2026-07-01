# MaxmaHere 表情包系统实施计划

> 创建日期：2026-07-01
> 状态：待实施
> 资源：778 个微信表情（329 已标注，449 待标注暂不使用）

---

## 一、目标

让 Agent 在对话中能够发送表情包，解析 LLM 输出的 `[表情包:情绪]` 占位符，从本地表情库中选取对应情绪的表情，前端渲染为图片与文字混排。

---

## 二、资源现状

| 项目 | 数据 |
|------|------|
| 表情文件总数 | 778 个 |
| 已标注数量 | 329 个（`D:\Maxma\emoji_labels.csv`） |
| 未标注数量 | 449 个（本阶段不使用） |
| 文件格式 | GIF 432 / PNG 230 / JPG 115 / WebP 1 |
| 文件位置 | `D:\Maxma\私聊_九曜山的小猪\media\emojis\` |

---

## 三、标签体系

### 3.1 情绪标签（LLM 使用，12 分类）

| 情绪分类 | 说明 | 预估数量 |
|----------|------|----------|
| 开心 | 高兴、兴奋、大笑 | ~20 |
| 无语 | 无奈、翻白眼、冷漠 | ~35 |
| 委屈 | 难过、可怜、求安慰 | ~15 |
| 悲伤 | 哭泣、伤心、失落 | ~20 |
| 害羞 | 脸红、不好意思、腼腆 | ~15 |
| 生气 | 愤怒、不满、炸毛 | ~10 |
| 惊讶 | 震惊、意外、吃惊 | ~10 |
| 尴尬 | 局促、无语凝噎 | ~8 |
| 撒娇 | 卖萌、求关注、哼哼 | ~5 |
| 得意 | 骄傲、嘚瑟、自信 | ~5 |
| 爱心 | 喜欢、想念、表白 | ~30 |
| 日常 | 问候、晚安、打招呼等兜底 | ~20 |

### 3.2 内容标签（保留现有，用于筛选）

卡通、动物、文字、搞笑、可爱、人物、动漫、物品、场景等 — 不参与表情选择逻辑。

---

## 四、实施步骤

### Phase 1：资源准备（预估 2-3 小时）

- [ ] 1.1 从 CSV 中提取 329 条已标注记录
- [ ] 1.2 清洗标签数据（统一分隔符为逗号，去除非情绪标签）
- [ ] 1.3 将每条记录的情绪标签映射到 12 分类之一
- [ ] 1.4 按情绪分类创建子目录，复制对应文件
- [ ] 1.5 批量转换 GIF/PNG/JPG → WebP（动图保留动画，静态图压缩）
- [ ] 1.6 统一缩放到 256x256px
- [ ] 1.7 将整理好的表情库放入 `config/stickers/` 目录

**产出：** `config/stickers/{情绪分类}/*.webp`，总计 ~300 张，总体积 <40MB

### Phase 2：后端实现（预估 2-3 小时）

- [ ] 2.1 新建 `api/routes/stickers.py` — 贴纸文件服务路由
  - `GET /api/stickers/{category}/{filename}` — 返回 WebP 文件
  - 路径安全校验（防穿越）
  - 设置长缓存头（`Cache-Control: max-age=86400`）
- [ ] 2.2 在 `api/server.py` 注册 stickers 路由
- [ ] 2.3 新建 `tools/sticker_utils.py` — 表情解析工具函数
  - `process_stickers(text: str) -> tuple[str, list[str]]`
  - 正则匹配 `\[表情包(?::(\w+))?\]`
  - 从对应分类目录随机选一张
  - 替换为 `<sticker:category/filename.webp>` 标记
- [ ] 2.4 修改 `api/routes/chat.py` 的 `_get_final_answer` 或 `_stream_turn`
  - 在发送 answer 事件前调用 `process_stickers()`
  - WebSocket 消息增加 `stickers` 字段

**产出：** 后端能解析占位符并提供表情文件访问

### Phase 3：前端实现（预估 3-4 小时）

- [ ] 3.1 新建 `web/src/components/StickerBubble.vue` — 表情渲染组件
  - 接收 `src` prop，渲染为 `<img>`
  - 点击放大预览（overlay + 关闭按钮）
  - hover 缩放动效
- [ ] 3.2 修改 `web/src/components/ChatWindow.vue` 的消息渲染逻辑
  - 解析 `content` 中的 `<sticker:xxx>` 标记
  - 将消息分段为 text/sticker 交替数组
  - sticker 段渲染 `StickerBubble`，text 段渲染普通文本
- [ ] 3.3 样式适配
  - 表情尺寸 120x120px，与文字混排
  - 预览 overlay 全屏遮罩
- [ ] 3.4 在 `registry.ts` 注册 sticker 相关类型（如需要）

**产出：** 前端能正确渲染表情，与文字混排，支持点击预览

### Phase 4：人格指令更新（预估 0.5 小时）

- [ ] 4.1 修改 `config/personas/SOUL.饱饱.md`
  - 将 `[表情包]` 改为 `[表情包:情绪分类]` 格式
  - 添加使用说明：情绪分类可选值列表
- [ ] 4.2 同步修改 `config/personas/SOUL.md`（Maxma 人格，如需要）

**产出：** LLM 能按正确格式输出表情指令

### Phase 5：集成测试（预估 1-2 小时）

- [ ] 5.1 端到端测试：发送消息 → LLM 输出带 `[表情包:xxx]` → 前端正确渲染
- [ ] 5.2 测试各情绪分类是否都有表情可发
- [ ] 5.3 测试找不到分类时的降级行为（应删除占位符而非显示原文）
- [ ] 5.4 测试动图 WebP 在 WebView2 中的播放效果
- [ ] 5.5 测试 Tauri 打包后表情文件是否正确包含

---

## 五、技术细节

### 5.1 WebP 转换命令

```bash
# 静态图（PNG/JPG → WebP）
cwebp -q 80 input.png -o output.webp

# 动图（GIF → 动画 WebP）
ffmpeg -i input.gif -vcodec libwebp -lossless 0 -q:v 75 -preset default -loop 0 output.webp

# 批量缩放
ffmpeg -i input.webp -vf "scale=256:256:force_original_aspect_ratio=decrease" output.webp
```

### 5.2 后端解析正则

```python
import re
STICKER_RE = re.compile(r'\[表情包(?::(\w+))?\]')
```

匹配规则：
- `[表情包]` → 从"日常"分类随机选
- `[表情包:撒娇]` → 从"撒娇"分类随机选
- `[表情包:未知分类]` → 删除占位符（不显示）

### 5.3 前端消息分段

```typescript
function parseMessage(content: string): Segment[] {
  // 将 "你好呀<sticker:撒娇/s1.webp>嘻嘻" 拆分为：
  // [{type:'text', text:'你好呀'}, {type:'sticker', src:'/api/stickers/撒娇/s1.webp'}, {type:'text', text:'嘻嘻'}]
}
```

### 5.4 文件体积控制

| 类型 | 单张目标 | 300 张总计 |
|------|----------|------------|
| 静态 WebP | <30KB | <9MB |
| 动图 WebP | <100KB | <25MB |
| **合计** | — | **<34MB** |

当前安装包 32MB + 34MB = **66MB**，远低于 150MB 上限。

---

## 六、后续扩展（本阶段不做）

- [ ] 449 个未标注表情的 LLM 自动标注
- [ ] 用户自定义表情上传
- [ ] 第三方表情 API 接入（Giphy/Tenor）
- [ ] 表情收藏功能
- [ ] 表情搜索工具（Agent 主动搜索发送）

---

## 七、风险与应对

| 风险 | 概率 | 应对 |
|------|------|------|
| WebP 动图在 WebView2 不播放 | 低 | WebView2 基于 Chromium，原生支持动画 WebP；备选方案：动图保留 GIF 格式 |
| 某些情绪分类表情太少 | 中 | 合并相近分类（如尴尬→无语，得意→开心）；后续用 LLM 补标注扩充 |
| LLM 输出不稳定的情绪分类名 | 中 | 后端做模糊匹配（如"撒骄"→"撒娇"）；在 SOUL 中给出明确的分类列表 |
| 表情包文件被用户误删 | 低 | 打包时嵌入资源目录；启动时检查完整性 |
