# Plan: 修复所有 v-for 缺失 :key 的问题

## 背景
Vue 3 要求 `v-for` 必须有 `:key` 以实现高效的列表 diff 和稳定的组件状态。以下组件缺少 `:key`。

## 需要修改的文件清单

| # | 文件 | 行号 | v-for 表达式 | 应使用的 key |
|---|------|------|-------------|-------------|
| 1 | `src/components/AutocompletePanel.vue` | 6 | `v-for="(s, i) in items"` | `:key="s.value \|\| i"` |
| 2 | `src/components/BarChartMini.vue` | 6 | `v-for="(item, idx) in normalizedItems"` | `:key="item.label \|\| idx"` |
| 3 | `src/components/HealthPanel.vue` | 6 | `v-for="(item, i) in items"` (需加index) | `:key="item.label \|\| item.key \|\| i"` |
| 4 | `src/components/MessageBubble.vue` | 23 | `v-for="(r, idx) in refs"` | `:key="'ref-'+idx"` |
| 5 | `src/components/PermissionModeControl.vue` | 26 | `v-for="option in options"` | `:key="option.value"` |
| 6 | `src/components/PlanCard.vue` | 11 | `v-for="(step, i) in plan.steps"` | `:key="'step-'+i"` |
| 7 | `src/components/SessionSidebar.vue` | 18 | `v-for="s in constSessions"` | `:key="s.session_id"` |
| 8 | `src/components/SessionSidebar.vue` | 37 | `v-for="s in tempSessions"` | `:key="s.session_id"` |
| 9 | `src/components/StatusBadge.vue` | 8 | `v-for="(item, idx) in items"` | `:key="item.key \|\| idx"` |
| 10 | `src/components/StickerPicker.vue` | 36 | `v-for="suggestion in searchSuggestions"` | `:key="suggestion.id \|\| suggestion.occurrenceKey"` |
| 11 | `src/components/StickerPicker.vue` | 48 | `v-for="tab in tabs"` | `:key="tab.id \|\| tab.name"` |
| 12 | `src/components/StickerPicker.vue` | 66 | `v-for="sticker in recommendedStickers"` | `:key="sticker.occurrenceKey \|\| sticker.path"` |
| 13 | `src/components/StickerPicker.vue` | 95 | `v-for="(sticker, index) in filteredStickers"` | `:key="sticker.occurrenceKey \|\| index"` |
| 14 | `src/components/ChatInput.vue` | 40 | `v-for="seg in stickerSegments"` | `:key="seg.occurrenceKey"` |
| 15 | `src/components/ChatInput.vue` | 51 | `v-for="(r, idx) in imageRefs"` | `:key="'img-'+idx"` |
| 16 | `src/components/ChatInput.vue` | 61 | `v-for="(r, idx) in nonImageRefs"` | `:key="'ref-'+idx"` |
| 17 | `src/components/ChatInput.vue` | 77 | `v-for="q in quotedSelections"` | `:key="q.id \|\| q.source + q.text"` |
| 18 | `src/components/ChatWindow.vue` | 116 | `v-for="(me, i) in turn.memoryEvents"` | `:key="'mem-'+i"` |
| 19 | `src/components/ChatWindow.vue` | 222 | `v-for="(turn, idx) in turns"` | `:key="turn.id"` |

## 操作原则
1. 优先使用数据中已有的唯一 ID（如 `session_id`、`occurrenceKey`、`value`）
2. 如果没有唯一 ID，使用 `idx` 索引但要加前缀避免跨列表冲突
3. 每个文件逐行读取 → 确认 → 修改

## 处理步骤
1. ~~创建计划文件~~ ✅
2. 逐个读取相关文件，找到对应的 v-for 行
3. 执行 Edit 添加 `:key`
4. 运行 `npx vue-tsc --noEmit` 验证
5. 打印修改摘要
