# 设计系统（尺度、材质、状态）

> 主题的唯一事实源是 `web/src/solid-glass.css`；这份文档说明**为什么**是这些数，以及**新页面该用哪一档**。
> 建立于 2026-11-18 的排版整理（此前 33 个视图写了 125 处任意字号、11 个档位）。

## 一、五条材质规则（来自 Solid Glass 主题）

1. **色在边缘。** 面本身是薄的、透的；厚度靠边缘的光（`--glass-rim`）、外侧发丝线（`--glass-edge`）和脚下的影（`--glass-shade`）说出来。面板正面不加渐变。
2. **厚而不透。** 越高的层越实：`.glass-panel`（面板列）< `.bg-card`（一张卡）< `.bg-popover`（浮层）。
3. **深度 = 厚度。** 抬得越高，影越长越散；不要给平的卡片加浮层的影。
4. **一个状态语言。** 选中就是 `.glass-chosen`；按下去就是 `active:translate-y-px`；悬停只变底色一档（`--hover` / `--hover-faint`）。
5. **玻璃只在既有四类上。** `backdrop-filter` 由 `.bg-card` / `.bg-popover` / `.glass-panel` / `.glass-control` 提供，**不要给别的元素加 `backdrop-blur`**。

## 二、字号：六档，没有第七档

| token | 值 | 用在哪 | 不要用在哪 |
|---|---|---|---|
| `text-caption` | 11px / 1.45 | 分组标签、代码块、脚注、trace | 正文 |
| `text-meta` | 12px / 1.45 | 时间戳、计数、标签、副文案 | 表单值、段落 |
| `text-ui` | 13px / 1.5 | 导航项、面板行、按钮文案、菜单项 | 长段落 |
| `text-body` | 14px / 1.65 | 消息正文、说明段落、表单值 | 表格单元格（用 meta） |
| `text-subtitle` | 16px / 1.35 | 面板内小节标题、卡片标题 | 页面级大标题（用 `text-xl` 以上） |
| `text-display` | 22px / 1.15 | 指标大数 | 任何正文 |

规则：

- **不要写 `text-[13.5px]` 这种任意值。** 需要第七个尺寸的时候，通常是间距或字重的问题。
- `text-xs` / `text-sm` 这两个 Tailwind 内置档保留给 shadcn 组件（它们是 12/14，恰好落在 meta/body 上）；视图里请用 token。
- 数字列、耗时、Token 数一律配 `tabular-nums`，否则刷新时列宽会跳。

## 三、动效：三种时长，两条曲线

| token | 值 | 用在哪 |
|---|---|---|
| `duration-fast` + `ease-standard` | 120ms / `cubic-bezier(0.2,0,0,1)` | 只变颜色或背景（hover、选中、禁用） |
| `duration-base` + `ease-out-quint` | 200ms / `cubic-bezier(0.22,1,0.36,1)` | 有位移或尺寸变化（展开、旋转箭头、气泡出现） |
| `duration-slow` | 320ms | 整块进出（抽屉、浮层、页面切换） |

`prefers-reduced-motion` 已在 `index.css` 全局降级，不要再逐组件写一遍。

代码里的公共类名在 `web/src/lib/ui.ts`：

```ts
focusRing   // 2px 环、ring/55、不偏移
interactive // transition-colors duration-fast ease-standard
press       // active:translate-y-px duration-fast ease-out-quint
```

## 四、层级：三级

| 类 | 用于 | 值 |
|---|---|---|
| `elev-1` | 贴在页面上的小件（chip、悬浮按钮） | rim + 发丝线 + 1px 接触影 |
| `elev-2` | 页面由它铺开的卡与面板 | 同 `.glass-panel` |
| `elev-3` | 浮在页面上的菜单、popover、dialog | 同 `.bg-popover` |

**`.bg-card` / `.bg-popover` 本身就画了这些影**（它们是无层样式，会盖住 Tailwind 的 `shadow-*`）。所以：

- 玻璃面 **不要**再写 `shadow-sm/lg/2xl`——那些类从来没生效过，留着只会误导下一个人。
- 非玻璃面（`bg-background`、`bg-muted`）要抬起来时用 `elev-1/2/3`。

## 五、三道自动化守卫

| 脚本 | 断言 | 失败时怎么办 |
|---|---|---|
| `web/scripts/check-type-scale.mjs` | 无任意字号、`transition` 必须有时长、无散落 `shadow-*` | 按提示改成 token；确属例外才动基线 |
| `web/scripts/check-css-weight.mjs` | `backdrop-filter` 生效声明 ≤ 8 组 | 不要靠加模糊变美 |
| `web/scripts/check-spacing.mjs` | 自绘边框/底色容器的内边距下限 | 补 `p-2 / px-2 / py-1.5` |

前两个都挂在 `bash scripts/verify-all-gates.sh` 里。排版守卫是**棘轮**：存量记在
`web/scripts/type-scale-baseline.json`，只准降不准涨；当前已降到 **0 条**（即硬约束）。
改动后跑一次 `node scripts/check-type-scale.mjs --prune` 收敛基线。

## 六、视觉验收（截图存证）

`scripts/verify-ui-visual.mjs` 起真实后端 + 真实 Electron 窗口（1280×800），把六个关键页面
（空对话 / 有会话 / 指标 / 设置 / 扩展 / 外观）截图到 `dev_docs/visual/<日期>/`，并输出每张图的
尺寸与平均亮度。亮度是廉价探针：玻璃塌了、遮罩写错、页面空白，会先在这里露馅。

```bash
bun scripts/verify-ui-visual.mjs                 # 存证到当天目录
bun scripts/verify-ui-visual.mjs --update-baseline  # 覆盖 dev_docs/visual/baseline/
VISUAL_THEME=light bun scripts/verify-ui-visual.mjs # 亮色抽查（主题由 DRIVE_THEME 钉住）
```

驱动每次运行都换一个干净的 Electron profile（`app.setPath('userData', mkdtemp)`）。
不这么做，上一次亮色抽查写进 `localStorage` 的 `maxma.theme` 会留到下一次，
"深色基线"就悄悄变成亮色（本轮真踩过：基线平均亮度从 17 跳到 228）。

像素级 diff 没有做：要自己解 PNG（zlib + filter），维护成本高于收益。改动前后人工对照这两组图即可。

## 七、滚动边缘

滚动容器加 `scroll-fade` 类 + `ref={useScrollFade()}`（`web/src/lib/useScrollFade.ts`）。
它在滚动时写 `data-fade-top` / `data-fade-bottom`，CSS 据此加 24px 遮罩：

- **没滚动就不渐隐**：静态 `mask-image` 会把首屏标题永久淡掉，比不渐隐更糟；
- 内容不足一屏两侧都不渐隐（判定见 `lib/scrollFade.ts` 的 `computeScrollEdges`，有单测）；
- 遮罩兜底是 `none`，未滚动时不给内容建合成层。

## 八、主题的唯一入口

`web/src/lib/theme.ts`（读 / 写 / 应用 / 启动恢复）。此前主题只在"打开外观页"时生效，
重启后选了浅色的人照样看到深色；引导页还往另一个键（`maxma-theme`）写。
现在 `main.tsx` 在等后端之前调用 `restoreTheme()`，组件只调 `setTheme`。

## 九、新页面自查清单

- [ ] 字号只用六档 token（`text-caption/meta/ui/body/subtitle/display`）
- [ ] 段落用 `text-body`，表格与行内信息用 `text-meta`，导航与按钮用 `text-ui`
- [ ] 过渡带 `duration-*` 与 `ease-*`（或直接用 `lib/ui.ts` 的常量）
- [ ] 玻璃面不写 `border` / `shadow-*`（材质自带）；非玻璃面用 `elev-*`
- [ ] 不新增 `backdrop-blur`
- [ ] 数字列加 `tabular-nums`
- [ ] 空态用 `components/common/EmptyState`，加载用 `components/ui/skeleton`
- [ ] 可滚动长列表加 `scroll-fade` + `useScrollFade`
- [ ] 主题相关一律走 `lib/theme.ts`，不要自己碰 `localStorage` 或 `document.documentElement`
