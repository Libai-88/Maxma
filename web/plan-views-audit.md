# Maxma 视图页面状态完整性审计计划

## 环境信息

- 项目路径: `D:/Maxma/MaxmaHere/web`
- 审计范围: `src/views/` 下所有 Vue 视图页面 (共 22 个文件)
- 职责: 仅修改前端 Vue 文件，不涉及后端

---

## 审计发现总览

### 1. Loading/Empty/Error 状态检查

#### 1.1 状态完备的页面 (无需修改)

| 页面 | Loading | Empty | Error | Normal |
|------|---------|-------|-------|--------|
| **McpView.vue** | `v-if="loading"` | `servers.length === 0` | `loadError` + 重试 | card-grid |
| **SkillsView.vue** | `v-if="loading"` | `currentList.length === 0` | `loadError` + 重试 | card-grid |
| **ProvidersView.vue** | store loading | `providers.length === 0` | `loadError` + 重试 | card-grid |
| **SoulView.vue** | `v-if="loading"` | (编辑器自带 placeholder) | `loadError` + 重试 | editor-wrapper |
| **MetricsView.vue** | `loading-text` | `empty-text` | badge-error | 统计卡片 |
| **AuditLogView.vue** | `loading-text` | `empty-text` | badge-error | log-list |
| **ChatView.vue** | provider 加载/无提供商/正常三重状态 | | | |
| **PlaygroundView.vue** | 静态页面，无数据加载 | | | |
| **NotFoundView.vue** | 静态 404 页面 | | | |

#### 1.2 状态缺失/不完善的页面 (需要修改)

| 页面 | 缺失状态 | 问题描述 |
|------|---------|---------|
| **ActivityView.vue** | **Loading** + **Error** | 模板没有显示加载中状态；也没有错误提示和重试按钮。仅有的空状态在 `store.records.length === 0` 时显示"暂无活动记录"。 |
| **NewsView.vue** | **Error** | 有 loading 和 empty 状态，但 catch 只 `console.error`，没有错误提示 UI。 |
| **MemoryView.vue** | **Error** | 有 loading 和 empty 状态，但 store 的 catch 块没有暴露错误给视图显示。 |
| **EnvVarsView.vue** | **Error** + **Empty** | loading 状态存在，但 catch 只 `console.error`；没有显式 empty 状态（列表为空时只显示空白）。 |
| **MaxmaBlockerView.vue** | **Error** | 有 loading 和 empty 状态，但 catch 只 `console.error`。 |
| **PathWhitelistView.vue** | **Error** | 有 loading 和 empty 状态，但 catch 只 `console.error`。 |
| **AppearanceView.vue** | N/A | 静态页面，无数据加载，无需修改。 |
| **UserView.vue** | N/A | 代理给 MarkdownEditor 组件，无需修改。 |

#### 1.3 ActivityView.vue 重点分析

- 模板 (line 3-49): 使用 `store.records` 直接渲染，无 loading 指示器，无错误提示
- Empty 状态 (line 45-47): `v-if="!store.records.length"` 显示"暂无活动记录"
- `store.fetchRecent()` 和 `store.startStream()` 在 onMounted 中调用，但结果状态不反映到模板
- **需要修复**: 添加 loading 和 error 状态的模板渲染逻辑

---

### 2. 未使用的视图/页面检查

#### 2.1 HooksView.vue ✅ 已完成简化
- 当前内容: OMP 提示页，显示"事件钩子已由 OMP 内置管理"
- 标题: `事件钩子 Event Hooks` ✅
- 状态: 完整，无需修改

#### 2.2 KbView.vue ✅ 已完成简化
- 当前内容: OMP 提示页，显示"知识库已由 OMP 内置管理"
- 标题: `知识库 Knowledge Base` ✅
- 状态: 完整，无需修改

#### 2.3 AuditLogView.vue ❌ 未完成简化
- 当前内容: 仍然保留完整的审计日志功能（统计、日志列表、过滤、操作区）
- 有一个 OMP disabled banner 作为降级方案，但功能代码仍然存在
- 标题: `审计日志` ❌ 缺少英文
- **需要评估**: 是按照 HooksView/KbView 的风格完全简化为 OMP 提示页，还是保留当前"功能代码 + disabled banner"的模式？

根据任务描述"之前改为 OMP 提示页"，应该按 HooksView/KbView 风格统一简化。

---

### 3. 页面标题一致性检查

#### 3.1 符合 "中文 English" 格式的页面 ✅

| 页面 | 当前标题 | 判定 |
|------|---------|------|
| McpView.vue | `MCP 服务 MCP` | ✅ 一致 |
| SkillsView.vue | `Skills & 宏` | ✅ 英文在前，特殊格式，可接受 |
| ProvidersView.vue | `提供商管理 PROVIDERS` | ✅ 一致 |
| HooksView.vue | `事件钩子 Event Hooks` | ✅ 一致 |
| KbView.vue | `知识库 Knowledge Base` | ✅ 一致 |
| AppearanceView.vue | `外观 APPEARANCE` | ✅ 一致 |
| SoulView.vue | `人设 SOUL` | ✅ 一致 (dynamic) |
| MaxmaBlockerView.vue | `拒止锚 MaxmaBlocker` | ✅ 一致 (但表单页`添加拒止锚`缺少英文) |
| UserView.vue | `用户 USER` | ✅ 一致 (via MarkdownEditor) |

#### 3.2 需要修复的页面 ❌

| 页面 | 当前标题 | 建议修改 |
|------|---------|---------|
| **ActivityView.vue** | `活动中心` | `活动中心 Activity Center` |
| **EnvVarsView.vue** | `工具环境变量` | `工具环境变量 Env Vars` |
| **MemoryView.vue** | `AI 记忆` | `AI 记忆 Memory` |
| **MetricsView.vue** | `运行时指标` | `运行时指标 Metrics` |
| **NewsView.vue** | `更新动态` | `更新动态 News` |
| **PathWhitelistView.vue** | `路径白名单` | `路径白名单 Path Whitelist` |
| **PrivacyView.vue** | `隐私仪表盘` | `隐私仪表盘 Privacy Dashboard` |
| **AuditLogView.vue** | `审计日志` | `审计日志 Audit Log` |

---

## 修复计划

### Step 1: ActivityView.vue 添加 Loading/Error 状态

文件: `D:\Maxma\MaxmaHere\web\src\views\ActivityView.vue`

修改:
- 给 h1 标题添加英文: `活动中心 Activity Center`
- 添加 `loading` ref 和 `error` ref 追踪状态
- 模板添加 loading 和 error 条件渲染
- 在 fetchRecent/fetchStats 调用前后控制状态

### Step 2: NewsView.vue 添加 Error 状态

文件: `D:\Maxma\MaxmaHere\web\src\views\NewsView.vue`

修改:
- 添加 `error` ref
- catch 中设置错误信息
- 模板添加 error 状态渲染

### Step 3: MemoryView.vue 修正 Loading 响应性 + 添加 Error 状态

文件: `D:\Maxma\MaxmaHere\web\src\views\MemoryView.vue`

修改:
- 使用 `storeToRefs` 解构 loading 以获得响应性
- 添加错误状态显示

### Step 4: EnvVarsView.vue 添加 Error/Empty 状态

文件: `D:\Maxma\MaxmaHere\web\src\views\EnvVarsView.vue`

修改:
- 添加 `loadError` ref
- catch 中设置错误信息
- 模板添加 error 和 empty 条件渲染

### Step 5: MaxmaBlockerView.vue 添加 Error 状态

文件: `D:\Maxma\MaxmaHere\web\src\views\MaxmaBlockerView.vue`

修改:
- 添加 `loadError` ref
- catch 中设置错误信息
- 模板添加 error 条件渲染

### Step 6: PathWhitelistView.vue 添加 Error 状态

文件: `D:\Maxma\MaxmaHere\web\src\views\PathWhitelistView.vue`

修改:
- 添加 `loadError` ref
- catch 中设置错误信息
- 模板添加 error 条件渲染

### Step 7: AuditLogView.vue 简化为 OMP 提示页

文件: `D:\Maxma\MaxmaHere\web\src\views\AuditLogView.vue`

修改: 按 HooksView/KbView 风格完全简化
- 移除所有功能代码（统计、日志列表、过滤、操作区、store 依赖）
- 改为 OMP 提示信息
- 标题改为 `审计日志 Audit Log`

### Step 8-14: 页面标题统一

| Step | 文件 | 当前标题 | 改为 |
|------|------|---------|------|
| 8 | ActivityView.vue | `活动中心` | `活动中心 Activity Center` |
| 9 | EnvVarsView.vue | `工具环境变量` | `工具环境变量 Env Vars` |
| 10 | MemoryView.vue | `AI 记忆` | `记忆 Memory` |
| 11 | MetricsView.vue | `运行时指标` | `运行时指标 Metrics` |
| 12 | NewsView.vue | `更新动态` | `更新动态 News` |
| 13 | PathWhitelistView.vue | `路径白名单` | `路径白名单 Path Whitelist` |
| 14 | PrivacyView.vue | `隐私仪表盘` | `隐私仪表盘 Privacy Dashboard` |

---

## 执行顺序

1. Step 1: ActivityView.vue (loading + error + title)
2. Step 2: NewsView.vue (error + title)
3. Step 3: MemoryView.vue (error + reactivity fix + title)
4. Step 4: EnvVarsView.vue (error + empty + title)
5. Step 5: MaxmaBlockerView.vue (error)
6. Step 6: PathWhitelistView.vue (error + title)
7. Step 7: AuditLogView.vue (OMP simplify + title)
8. Step 8: MetricsView.vue (title only)
9. Step 9: PrivacyView.vue (title only)
10. 运行 `npx vue-tsc --noEmit` 验证
11. 输出审计摘要
