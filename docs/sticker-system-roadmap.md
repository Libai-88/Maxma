# MaxmaHere 表情包系统演进规划

> 版本：v2.0  
> 创建日期：2026-07-01  
> 最后更新：2026-07-02  
> 状态：**已结项**  
> 目标：从"能用"到"好用"再到"爱用"

---

## 一、现状分析

### 1.1 已完成

| 模块 | 状态 | 说明 |
|------|------|------|
| 资源准备 | ✅ | 329 张 WebP，12 情绪分类，24MB |
| 后端解析 | ✅ | `[表情包:情绪]` → `<sticker:xxx>` 标记 |
| 前端渲染 | ✅ | 文字/表情混排，点击预览 |
| 人格指令 | ✅ | SOUL.饱饱.md 集成 |
| 基础修复 | ✅ | Auth 白名单、Tauri URL、流式隐藏 |
| 智能选择器 | ✅ | 避免重复、收藏加成、时间感知 |
| 过渡动画 | ✅ | 表情出现 scale+opacity 动画 |
| 性能优化 | ✅ | 视口外动图暂停 |
| 表情选择器 UI | ✅ | 最近/收藏/全部 Tab，搜索功能 |
| 收藏系统 | ✅ | 添加/取消收藏，持久化存储 |
| 右键菜单 | ✅ | 收藏/复制路径 |
| 用户发送表情 | ✅ | 选择器→插入→发送→渲染 |
| 细粒度情绪 | ✅ | 30+ 种子情绪，关键词匹配 |
| 上下文感知 | ✅ | 决策器过滤 LLM 表情输出 |
| 用户偏好学习 | ✅ | 收藏/使用/跳过反馈，权重调整 |
| 自定义上传 | ✅ | 拖拽/按钮上传，自动转 WebP |

### 1.2 核心问题

| 问题 | 影响 | 优先级 |
|------|------|--------|
| **随机选择** | 同一情绪每次不同，缺乏一致性 | 高 |
| **无用户控制** | 用户无法主动发送表情 | 高 |
| **无记忆** | 不记得用户喜欢的表情 | 中 |
| **分类粗糙** | 12 类覆盖不全，粒度不够 | 中 |
| **无搜索** | 329 张表情无法快速定位 | 中 |
| **动图性能** | 大量动图同时播放可能卡顿 | 低 |

---

## 二、产品理念对齐

基于 MaxmaHere 的设计原则：

| 原则 | 表情系统体现 |
|------|--------------|
| **对话即界面** | 表情是对话的自然组成部分，不突兀、不干扰 |
| **克制中的温度** | 表情传递情感，但不过度花哨，保持专业感 |
| **渐进式复杂度** | 基础功能简单，高级功能可探索 |
| **本地优先** | 表情库本地存储，隐私安全 |

---

## 三、演进路线

### Phase 1：体验打磨（1-2 周）

**目标：** 让现有功能"好用"

#### 1.1 智能选择算法

**现状：** 随机选择，同一情绪每次不同

**改进：**
```python
# 伪代码
def select_sticker(category, context):
    candidates = get_stickers(category)
    
    # 1. 避免重复（最近 N 条消息用过的排除）
    recent = get_recent_stickers(context, limit=10)
    candidates = [s for s in candidates if s not in recent]
    
    # 2. 权重调整（用户收藏的优先）
    favorites = get_user_favorites()
    for s in candidates:
        if s in favorites:
            s.weight *= 3
    
    # 3. 时间感知（深夜用温馨类，白天用活泼类）
    hour = datetime.now().hour
    if 23 <= hour or hour <= 2:
        candidates = boost(candidates, tags=['温馨', '安静'])
    
    return weighted_random(candidates)
```

**产出：**
- `tools/sticker_selector.py` — 智能选择器
- 集成到 `sticker_utils.py`

#### 1.2 表情动画优化

**问题：** 多张动图同时播放可能卡顿

**方案：**
- 视口外动图暂停（Intersection Observer）
- 缩略图模式：小尺寸时显示静态首帧，点击/ hover 播放
- 性能监控：FPS 低于 30 时自动降级

**产出：**
- `web/src/composables/useStickerPerformance.ts`
- 修改 `StickerBubble.vue` 添加性能感知

#### 1.3 过渡动画

**现状：** 表情突然出现，缺乏过渡

**改进：**
- 表情出现：scale(0.8) → scale(1) + opacity 0→1，200ms ease-out
- 表情 hover：scale(1) → scale(1.15)，150ms ease
- 预览打开：backdrop blur + scale 动画

**产出：**
- 更新 `StickerBubble.vue` 样式
- 添加 `@keyframes stickerAppear`

---

### Phase 2：用户控制（2-3 周）

**目标：** 让用户"能用"表情，不只是 AI 发

#### 2.1 表情选择器 UI

**位置：** 输入框右侧按钮，点击弹出面板

**布局：**
```
┌─────────────────────────────────┐
│ 🔍 搜索表情...                   │
├─────────────────────────────────┤
│ 最近  收藏  全部                  │
├─────────────────────────────────┤
│ [😀] [😂] [🥺] [😍] [😤] ...   │
│ [😀] [] [🥺] [😍] [😤] ...   │
│ [😀] [😂] [🥺] [😍] [😤] ...   │
└─────────────────────────────────┘
```

**功能：**
- Tab 切换：最近使用 / 收藏 / 全部
- 点击插入到输入框（特殊语法 `::sticker:category/filename::`）
- 后端解析此语法，与 AI 发送的表情统一处理

**产出：**
- `web/src/components/StickerPicker.vue`
- 修改 `ChatInput.vue` 添加触发按钮
- 后端支持用户发送表情语法

#### 2.2 收藏系统

**数据结构：**
```yaml
# api/data/sticker_favorites.yaml
favorites:
  - category: 开心
    filename: abc123.webp
    added_at: 2026-07-01T20:00:00
  - category: 撒娇
    filename: def456.webp
    added_at: 2026-07-01T20:05:00
```

**交互：**
- 长按/右键表情 → 弹出菜单 → "收藏"
- 收藏表情在 Picker 中独立 Tab
- 收藏数据本地存储（`DATA_DIR`）

**产出：**
- `api/routes/sticker_favorites.py`
- `web/src/components/StickerContextMenu.vue`

#### 2.3 最近使用

**逻辑：**
- 记录用户发送和 AI 发送的表情
- 按时间倒序，保留最近 50 张
- 存储在 `api/data/sticker_recent.yaml`

**产出：**
- 集成到表情选择器"最近"Tab

#### 2.4 搜索功能

**方案：**
- 前端搜索：按文件名、标签过滤（无需后端）
- 标签数据：在构建时生成 `sticker_index.json`
  ```json
  {
    "abc123.webp": {
      "category": "开心",
      "tags": ["大笑", "兴奋", "卡通"],
      "filename": "abc123.webp"
    }
  }
  ```

**产出：**
- `scripts/generate_sticker_index.py`
- `web/src/composables/useStickerSearch.ts`

---

### Phase 3：智能增强（3-4 周）

**目标：** 让 AI "懂"什么时候发什么表情

#### 3.1 上下文感知发送

**现状：** 按固定频率（每 3-4 条）发送

**改进：**
```python
def should_send_sticker(context) -> bool:
    # 1. 情感强度检测
    sentiment = analyze_sentiment(context.last_user_message)
    if sentiment.intensity > 0.7:
        return True
    
    # 2. 对话阶段
    if context.is_greeting or context.is_farewell:
        return True
    
    # 3. 用户情绪响应
    if context.user_emotion in ['sad', 'excited', 'angry']:
        return True
    
    # 4. 避免过度
    if context.recent_sticker_count > 2:
        return False
    
    return False
```

**产出：**
- `tools/sticker_decision.py` — 发送决策器
- 修改 `SOUL.饱饱.md` 移除固定频率规则

#### 3.2 情绪细粒度检测

**现状：** 12 分类，LLM 手动指定

**改进：**
- 后端自动分析用户消息情绪
- 映射到更细粒度的情绪标签（30+ 种）
- 自动选择匹配的表情

**情绪标签扩展：**
```python
EMOTION_FINE_GRAINED = {
    # 开心系
    '开心': ['大笑', '兴奋', '满足', '欣慰', '惊喜'],
    '甜蜜': ['幸福', '温馨', '浪漫', '心动'],
    '得意': ['骄傲', '嘚瑟', '自信', '小确幸'],
    
    # 难过系
    '悲伤': ['哭泣', '伤心', '失落', '绝望'],
    '委屈': ['难过', '可怜', '求安慰', '被误解'],
    '尴尬': ['局促', '无语凝噎', '社死', '手足无措'],
    
    # 愤怒系
    '生气': ['愤怒', '不满', '炸毛', '吃醋'],
    '无语': ['无奈', '翻白眼', '冷漠', '心累'],
    
    # 其他
    '害羞': ['脸红', '不好意思', '腼腆', '紧张'],
    '惊讶': ['震惊', '意外', '吃惊', '难以置信'],
    '撒娇': ['卖萌', '求关注', '哼哼', '依赖'],
    '爱心': ['喜欢', '想念', '表白', '感激'],
    '日常': ['问候', '晚安', '打招呼', '敷衍'],
}
```

**产出：**
- `tools/emotion_detector.py` — 情绪分析
- 更新 `sticker_utils.py` 支持细粒度映射

#### 3.3 用户偏好学习

**逻辑：**
- 记录用户对表情的反馈（收藏 = 正反馈，跳过 = 负反馈）
- 构建用户偏好向量
- 调整选择权重

**数据：**
```yaml
# api/data/sticker_preferences.yaml
user_preferences:
  favorite_categories:
    撒娇: 0.8
    开心: 0.6
    爱心: 0.7
  avoided_categories:
    生气: 0.1
  favorite_styles:
    - 卡通
    - 可爱
  last_updated: 2026-07-01
```

**产出：**
- `tools/sticker_preferences.py` — 偏好学习
- 集成到选择算法

---

### Phase 4：内容生态

**目标：** 让表情库"丰富"且"个性化"

#### 4.1 未标注表情处理 ❌ 取消

**原因：** 太消耗 token，用户自行处理

#### 4.2 主题表情包 ❌ 取消

**原因：** 当前表情库只有情绪分类，没有内容标签，无法正确组建主题包。等用户完成 449 张标注、有了内容标签后再重新实现。

#### 4.3 用户自定义上传 ✅ 已完成

**功能：**
- 拖拽上传表情（支持 GIF/PNG/WebP）
- 自动转换 WebP + 缩放
- 存储到 `DATA_DIR/config/stickers/custom/`

**产出：**
- `api/routes/sticker_upload.py`
- StickerPicker 内嵌上传按钮 + 拖拽上传

#### 4.4 表情创作工具 ❌ 取消

**原因：** 优先级低，暂不实施

---

### Phase 5：高级交互 ❌ 取消

表情回应、连发特效、记忆联动等功能暂不实施。

---

## 四、结项总结

表情包系统从 v1.0（基础解析渲染）演进到 v2.0（智能选择+用户控制+自定义上传），已完成 Phase 1-4.3 的全部工作。

**剩余待办（用户自行处理）：**
- 449 张未标注表情的标注
- 标注完成后重新实现主题包功能

---

## 五、技术架构

### 后端模块

```
tools/
├── sticker_utils.py        # 基础解析：[表情包:情绪] → <sticker:xxx>
├── sticker_selector.py     # 智能选择：避免重复、收藏加成、时间感知、偏好学习
├── sticker_decision.py     # 发送决策：上下文感知，过滤 LLM 表情输出
├── sticker_preferences.py  # 偏好学习：收藏/使用/跳过反馈
└── emotion_detector.py     # 情绪检测：30+ 细粒度情绪，关键词匹配

api/routes/
├── stickers.py             # 文件服务（内置+自定义）
├── sticker_favorites.py    # 收藏管理 + 表情索引
└── sticker_upload.py       # 自定义表情上传
```

### 前端组件

```
web/src/
├── components/
│   ├── StickerPicker.vue       # 表情选择器（最近/收藏/全部 + 上传）
│   ├── StickerContextMenu.vue  # 右键菜单（收藏/复制路径）
│   ├── MessageBubble.vue       # 消息气泡（表情渲染+预览）
│   └── ThinkingBlock.vue       # 思考块（表情渲染+预览）
├── composables/
│   ├── useStickerSegments.ts       # 表情分段解析
│   └── useStickerPerformance.ts    # 视口外动图暂停
```

### 数据流

```
LLM 输出 [表情包:情绪]
  → sticker_utils.process_stickers() 解析
  → sticker_decision 决策器过滤（上下文感知）
  → sticker_selector 智能选择（偏好/时间/重复）
  → <sticker:category/filename> 标记
  → 前端 useStickerSegments 分段渲染
  → StickerBubble 图片展示 + 点击预览
```

