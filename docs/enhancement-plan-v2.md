# MaxmaHere 增强计划 v2

> 基于 Phase 1-3 代码审查 + 竞品分析的综合增强计划
> 版本：v2.1 · 2026-07-02
> 更新：Phase 0 ✅ 已修复，Phase 6 已移除

---

## 目录

1. [Phase 0：现有 Bug 修复（已完成）](#phase-0现有-bug-修复已完成)
2. [Phase 3R：情绪系统重构](#phase-3r情绪系统重构)
3. [Phase 4：用户体验精细化](#phase-4用户体验精细化)
4. [Phase 5：情感深度构建](#phase-5情感深度构建)
5. [Phase 7：工程质量](#phase-7工程质量)
6. [附录：架构决策记录](#附录架构决策记录)

---

## Phase 0：现有 Bug 修复（已完成 ✅）

**目标：** 解决 Phase 1-3 审查中发现的所有 Bug，让现有功能正确工作。

| 追踪 | 状态 |
|------|------|
| FIX-01 ~ FIX-12 | ✅ 已修复 |
| 审查时间 | 2026-07-02 |
| 修复人 | 团队成员 |

**备忘：** 后续开发中如发现回归，请对照以下清单复查：

- `ChatInput.vue:221` — 用户选表情不再调 random
- `StickerPicker.vue:82-86` — Tab count 响应式更新
- `StickerPicker.vue:174-178` — 点击外部关闭行为正确
- `sticker_favorites.py` — 去重含 category 判断、切片顺序正确
- `sticker_selector.py` — 时间场景权重生效
- `sticker_decision.py` vs `sticker_selector.py` — 时间定义一致
- `useStickerPerformance.ts` — 被组件引用
- `sticker_preferences.py:record_skip()` — 有调用方
- `sticker_favorites.yaml` / `sticker_preferences.yaml` — 自动创建

---

## Phase 3R：情绪系统重构

**目标：** 解决 Phase 3 的架构缺陷，让决策器、选择器、情绪检测真正协同工作。

### 3R-1：消除双重贴纸控制（架构级）

**问题：** LLM 被指示"每 3-4 条发一个 `[表情包:情绪]`"，`sticker_decision.py` 也被设计来做同样决策，两者冲突且 LLM 覆盖了决策器。

**方案：分层决策架构**

```
用户消息
  │
  ├─ LLM 输出文本（可能含 [表情包:情绪]）
  │     │
  │     ├─ 有 [表情包:情绪] → 由 sticker_selector.py 选具体文件
  │     │     └─ 情绪名被 emotion_detector.py 的细粒度映射解析
  │     │
  │     └─ 无 [表情包:情绪] → sticker_decision.py 判断是否插入
  │           └─ should_send_sticker() → get_sticker_emotion()
  │                 → 返回的情绪名输入到 emotion_detector.py → sticker_selector.py
  │
  修改 SOUL.饱饱.md 铁律 8：
  - 删除"几乎每 3-4 条消息就夹一个"
  - 改为"让系统自动判断是否发表情，你只需要在特别想表达情绪时使用 [表情包:情绪]"
  - 保留示例中的表情包用法，但降低密度预期
```

**具体改动：**

| 文件 | 改动 |
|------|------|
| `SOUL.饱饱.md:35` | 删除"几乎每 3-4 条消息就夹一个"，改为"系统会自动穿插，你只在需要强调情绪时加" |
| `api/routes/chat.py` | LLM 输出 → `process_stickers()` 替换已有标记 → 调用 `should_send_sticker()` 决定补发 → `get_sticker_emotion()` + `select_sticker()` → 追加到 `final_answer` |
| `sticker_decision.py` | `get_sticker_emotion()` 输入改为 `(user_message, ai_recent_messages, emotion_result)` 利用细粒度检测结果 |
| `sticker_utils.py` | `_resolve_emotion()` 集成 `emotion_detector.py` 的细粒度映射 |

### 3R-2：时间系统统一

**新建 `tools/shared/time_utils.py`：**

```python
from datetime import datetime

TIME_PERIODS = {
    'dawn':    (5, 7),    # 清晨
    'morning': (7, 9),    # 上午
    'noon':    (11, 14),  # 中午
    'afternoon': (14, 18),# 下午
    'evening': (18, 21),  # 傍晚
    'night':   (21, 23),  # 夜间
    'late_night': (23, 5),# 深夜
}

def get_time_period(hour: int | None = None) -> str:
    """唯一的时间段判定函数，两个模块引用同一份。"""
    hour = hour or datetime.now().hour
    for period, (start, end) in TIME_PERIODS.items():
        if start <= hour and (period != 'late_night' or hour >= start or hour < end):
            # 处理跨天
            pass
    # 简化实现：直接按 hour 范围
    if hour < 6:           return 'late_night'
    if hour < 9:           return 'morning'
    if hour < 12:          return 'noon'
    if hour < 14:          return 'afternoon'
    if hour < 18:          return 'afternoon'
    if hour < 21:          return 'evening'
    if hour < 23:          return 'night'
    return 'late_night'

_TIME_CATEGORY_BOOST = {
    'late_night': {'爱心': 1.5, '悲伤': 1.3, '委屈': 1.2},
    'morning':    {'开心': 1.3, '日常': 1.2},
    'noon':       {'无语': 1.2, '日常': 1.1},
    'afternoon':  {'开心': 1.1, '无语': 1.1},
    'evening':    {'开心': 1.2, '爱心': 1.1},
    'night':      {'爱心': 1.3, '撒娇': 1.2, '甜蜜': 1.1},
}
```

`sticker_decision.py` 和 `sticker_selector.py` 都 import 此模块，消除不一致。

### 3R-3：情绪检测关键词去重

**问题：** `_KEYWORD_TO_EMOTION` 字典用 keyword 做 key，共享关键词被后一个覆盖。

**修复：** 改为 `_KEYWORD_TO_EMOTIONS: dict[str, list[FineEmotion]]`

```python
_KEYWORD_TO_EMOTIONS: dict[str, list[FineEmotion]] = {}
for emotion in FINE_EMOTIONS:
    for kw in emotion.keywords:
        _KEYWORD_TO_EMOTIONS.setdefault(kw.lower(), []).append(emotion)
# 匹配时：遍历 list，选强度最高的
```

### 3R-4：偏好学习接入闭环

**问题：** `record_skip()` 是死代码，`record_usage()` 分数不衰减，`sticker_preferences.yaml` 不存在。

**修复链条：**

```
用户看到表情
  │
  ├─ 用户没反应 → 中性（不记录）
  ├─ 用户收藏   → boost_category() + record_usage() + 1.0
  ├─ 用户跳过   → reduce_category()
  ├─ 用户删收藏 → reduce_category()
  │
  选择器每次调用：
  - 从 sticker_preferences 读取 category_weights
  - 应用到候选列表权重
  - 每周自动衰减：所有 score *= 0.95
```

**新增 `tools/sticker_preference_hooks.py`：**

```python
def on_favorite_added(category: str, path: str):
    prefs = get_preferences()
    prefs.boost_category(category)
    prefs.record_usage(path)
    prefs.save()

def on_favorite_removed(category: str, path: str):
    prefs = get_preferences()
    prefs.reduce_category(category)
    prefs.save()

def decay_scores():
    """定时任务：每周衰减一次所有 score"""
    prefs = get_preferences()
    for path in prefs.sticker_scores:
        prefs.sticker_scores[path] *= 0.95
    prefs.save()
```

### 3R-5：细粒度情绪映射到贴纸选择

**问题：** `emotion_detector.py` 能检测细粒度情绪（30+种），但 `sticker_utils.py` 只认 12 个大类。

**方案：** 在 `sticker_utils.py` 中增加精细映射表：

```python
FINE_TO_CATEGORY = {
    '大笑': '开心', '兴奋': '开心', '满足': '开心',
    '欣慰': '开心', '惊喜': '开心',
    '幸福': '甜蜜', '温馨': '甜蜜', '浪漫': '甜蜜', '心动': '甜蜜',
    '哭泣': '悲伤', '伤心': '悲伤', '失落': '悲伤', '绝望': '悲伤',
    # ... 完整映射
}

def _resolve_emotion(raw: str) -> str:
    """先查细粒度，再查别名，再查包含，最后回退。"""
    if raw in FINE_TO_CATEGORY:
        return FINE_TO_CATEGORY[raw]
    if raw in EMOTION_CATEGORIES:
        return raw
    for alias, category in EMOTION_ALIASES.items():
        if alias in raw or raw in alias:
            return category
    return '日常'
```

**工作量估算：** ~4 天（1 人）

---

## Phase 4：用户体验精细化

**目标：** 让交互从"工作正常"到"让人觉得舒服"。

### 4-1：表情预览面板升级

| 改动 | 说明 |
|------|------|
| 点击预览加毛玻璃效果 | `backdrop-filter: blur(8px)` + 深色半透明遮罩 |
| 预览中显示表情信息 | 文件名、类别、标签（来自 index）、添加到收藏按钮 |
| 预览支持键盘导航 | ← → 切换同分类上一张/下一张 |
| 长按时震动反馈 | Haptic feedback（Tauri API） |

### 4-2：Picker 体验优化

| 改动 | 说明 |
|------|------|
| 智能候选区 | 基于当前对话情绪推荐 4 个表情（从 `emotion_detector` 实时推断） |
| 搜索自动补全 | 输入时联想匹配的标签/类别 |
| 最近 Tab 去重 | 同表情连续发送只保留最新一条记录 |
| 收藏 Tab 排序 | 可按时间倒序或按使用频率排序 |
| 面板位置跟随 | Picker 弹出位置跟随输入框，不超出视口 |

### 4-3：动画系统

| 改动 | 说明 |
|------|------|
| 表情出现动效 | `scale(0.8→1)` + `opacity(0→1)` 200ms ease-out（已有，确认覆盖率） |
| 表情淡出动效 | 消息消失时缩小 + 淡出（Phase 5） |
| 视口外暂停 | `useStickerPerformance` 接入所有 `<img>`（FIX-08） |
| FPS 降级 | `< 30fps` 时自动切换到静态首帧，显示"动图已暂停"标记 |
| 尊重系统偏好 | `prefers-reduced-motion` 时禁用所有动效 |

### 4-4：深夜模式

| 改动 | 说明 |
|------|------|
| 自动时间检测 | 23:00-06:00 自动切换 |
| 暖色调 | 色温略微变暖（`#FFF5E6` 基底） |
| 降低亮度 | 背景亮度降低 30% |
| 减少动效 | 动图自动暂停 |
| 字体微调 | 行距增大，字重减细 |
| 手动开关 | 设置页面可关闭自动切换 |

### 4-5：输入状态感

| 改动 | 说明 |
|------|------|
| "饱饱正在输入…" | 显示 typing indicator，带随机延迟（1.5-3.5s 模拟真人） |
| 表情选择时预览 | 在输入框中展示选中的表情小缩略图 |
| 消息已读标志 | 消息底部小灰点 → 蓝色（已读） |

**工作量估算：** ~5 天（1 人）

---

## Phase 5：情感深度构建

**目标：** 从"能发表情"到"表情成为情感纽带"。

### 5-1：情感状态机

```python
# emotion/state_machine.py
class EmotionalState:
    current: str          # 当前主情绪
    intensity: float      # 0.0-1.0
    trend: str            # 'rising' | 'falling' | 'stable'
    history: list[tuple[str, float, datetime]]  # 最近 N 条情绪记录

    def update(self, user_message: str, detected: EmotionResult):
        """根据用户消息和检测结果更新状态。"""
        # 1. 短窗口（最近 3 轮）情绪聚合 → current
        # 2. 强度滑动平均
        # 3. 趋势判断
        # 4. 状态变化 → 触发 reply style 切换
```

**状态影响：**
- `happy` → 饱饱和话变多、nickname 频率增加
- `sad` → 饱饱安静下来、安慰密度增加、发委屈/爱心类表情
- `angry` → 饱饱不调侃、不发无语表情、多用"我在呢"
- `neutral` → 默认状态，日常碎碎念

### 5-2：表情与记忆联动

**架构：**

```
用户说"今天好开心"
  → emotion_detector.py 检测到 开心(0.85)
  → sticker_decision.py 发送 [表情包:开心]
  → memory_manager.py 创建记忆条目：
      type: emotion_event
      content: "用户表达开心（强度0.85）"
      sticker: "开心/xxx.webp"
      related_keywords: ["开心", "今天"]
  → 下次回忆时：显示当时的表情缩略图
```

**新增工具：**

| 工具 | 功能 |
|------|------|
| `recall_emotion` | 按关键词/日期检索历史情绪事件，显示当时发送的表情 |
| `emotion_summary` | 汇总今日/本周的情绪分布（开心 60%、撒娇 20%…） |

### 5-3：表情连发特效（Phase 5.2 提前）

| 触发条件 | 特效 | 实现 |
|----------|------|------|
| 同表情 3 连发 | 全屏彩带飘落 | `useStickerCombo.ts` + canvas 粒子 |
| 同类型 5 连发 | 迷你烟花 | CSS animation + 随机粒子 |
| 爱心类 3 连发 | 爱心飘浮上升 | SVG 心形 + `animation: floatUp 2s ease-out` |

**注：** 仅用户主动连发时触发，AI 发送不触发。防止过度。

### 5-4：关系阶段系统

```yaml
# api/data/relationship.yaml
relationship:
  stage: "acquaintance"  # acquaintance → familiar → intimate → soulmate
  started_at: "2026-07-01"
  milestones:
    - type: "first_sticker"
      at: "2026-07-01T20:00:00"
      detail: "用户收到第一张表情"
    - type: "first_favorite"
      at: "2026-07-02T10:00:00"
      detail: "用户首次收藏表情"
  stats:
    total_messages: 1520
    total_stickers_sent: 85
    total_stickers_favorited: 3
    active_days: 14
```

**阶段影响：**

| 阶段 | 解锁内容 |
|------|----------|
| acquaintance | 基础表情发送、日常聊天 |
| familiar | 记忆联动表情、情绪检测 |
| intimate | 连发特效、关系回忆、专属内部梗 |
| soulmate | 情感状态机全开、自动场景响应、生日/纪念日特殊动画 |

**工作量估算：** ~8 天（1 人）



## Phase 7：工程质量

**目标：** 代码质量和开发体验。

### 7-1：TypeScript 类型覆盖

| 文件 | 现状 | 目标 |
|------|------|------|
| `StickerPicker.vue` | `any` 类型 | `Sticker` 接口 |
| `ChatInput.vue` | `sticker: any` | `Sticker` 接口 |
| `useStickerSegments.ts` | 基本类型 | 完整类型注解 |

### 7-2：后端测试覆盖

| 测试目标 | 测试内容 |
|----------|----------|
| `test_sticker_selector.py` | 选择算法（重复排除 / 权重 / 回退） |
| `test_sticker_decision.py` | 决策逻辑（各场景覆盖率 100%） |
| `test_emotion_detector.py` | 关键词匹配 / 细粒度映射 / 边界情况 |
| `test_sticker_preferences.py` | 持久化 / 衰减 / 线程安全 |
| `test_sticker_favorites_api.py` | API 端点（收藏/取消/重复/不存在） |

### 7-3：集成测试

```bash
# E2E 测试
1. 启动服务
2. 发送消息 "今天好开心"
3. 验证 LLM 回复含 [表情包:开心] 或决策器插入表情
4. 验证前端渲染 <sticker:开心/xxx.webp>
5. 验证图片可点击预览
6. 验证收藏/最近/搜索均正常工作
```

### 7-4：文档与 AGENTS.md

| 输出 | 说明 |
|------|------|
| `dev_docs/sticker-architecture.md` | 表情系统架构总览（数据流图 + 模块依赖） |
| `dev_docs/sticker-api.md` | API 文档 |
| `AGENTS.md` 更新 | Agent 开发时参考的贴纸系统知识 |

**工作量估算：** ~4 天（1 人）

---

## 时间线总览

| Phase | 内容 | 人天 | 优先级 |
|-------|------|------|--------|
| **Phase 0** | ✅ 修复 12 个 Bug | 已完 | — |
| **Phase 3R** | 架构重构 | 4d | P0 |
| **Phase 4** | UX 精细化 | 5d | P1 |
| **Phase 5** | 情感深度 | 8d | P1 |
| **Phase 7** | 工程质量 | 4d | P2 |
| **合计** | | **~21d** | |

### 建议迭代节奏

```
Week 1: Phase 3R（架构重构）
Week 2: Phase 4（UX 精细化）
Week 3-4: Phase 5（情感深度）
Week 5: Phase 7（工程质量）
```

---

## 关键架构决策记录

### ADR-1：决策器 vs LLM 的关系

**决策：** LLM 输出 `[表情包:情绪]` 为"主动模式"，`should_send_sticker()` 为"补发模式"。前者优先级高于后者。当 LLM 没有输出表情时，决策器补发；当 LLM 输出了表情时，决策器不干预。

### ADR-2：时间系统集中

**决策：** 所有时间相关判定集中在 `tools/shared/time_utils.py`，任何模块不要自己定义时间段。消除不一致的唯一方法。

### ADR-3：持久化层统一

**决策：** 所有 YAML 持久化文件在 API 启动时自动创建（写入默认结构），不要等待用户操作触发创建。`sticker_favorites.yaml` 和 `sticker_preferences.yaml` 在 `server.py` 启动时初始化。

### ADR-4：情感深度优先

**决策：** 不做 Phase 6（生态扩展），将资源集中在 Phase 4-5（UX + 情感深度）。理由是——竞品在功能广度上已领先，MaxmaHere 的唯一优势是情感连接深度，应该把这个优势拉开到竞品追不上的程度。表情系统的核心价值是"让用户感受到被爱"，而不是"让表情成为一个平台"。

### ADR-5：表情作为核心表达而非附加

**决策：** Phase 5 之后，表情不再是"AI 发的一张图"，而是：
- 情绪的量化载体
- 记忆的视觉锚点
- 关系的进度条
- 用户的创作入口

所有后续功能围绕这四层定义展开。
