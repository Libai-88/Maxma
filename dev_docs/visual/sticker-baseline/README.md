# 表情界面视觉基线（产品回归基线）

这里保存的是 **Maxma 当前产品语言** 的回归基线，不是外部设计稿交付物。
仓库没有对应的 Figma/设计稿；验收依据来自相邻界面已经稳定的组件、颜色角色、
字体层级、间距尺度和无障碍约定。若以后有正式设计稿，应把本目录的图替换为
设计稿对应状态的截图，而不是继续把“当前实现”当作设计批准。

## 基线覆盖

| 文件 | 场景 |
|---|---|
| `sticker-picker.png` / `sticker-manager.png` | 1280×900，深色 |
| `sticker-picker-light.png` / `sticker-manager-light.png` | 1280×900，浅色 |
| `sticker-picker-narrow.png` / `sticker-manager-narrow.png` | 768×900，深色窄窗 |

阈值：像素差 > 6/255 记为不同；差异比例超过 **2%** 判失败。
当前最低支持窗口宽度为 **768px**。这是桌面应用；侧栏固定 224px，390px
手机宽度不属于支持范围，不做“手机版”承诺。

## 验收清单

- 选择器打开后焦点在搜索框；Tab 不逃出对话框；Escape 关闭并把焦点还给输入框。
- 搜索、触控点选、键盘 Enter 都能插入 `[表情: 描述]`；输入框标记可连续追加。
- 双指捏合不得误插入、不得关闭选择器；CDP 多触点只证明事件路径稳定，不等于真机触屏硬件。
- Chromium IME 组合输入可进入消息输入框；系统级中文输入法、候选窗和真机键盘不在自动化范围。
- 管理面板必须是可见的真实对话框（`opacity:1`），宽度 672px@桌面 / 视口内@窄窗；
  不能只检查 DOM 文本存在。
- 选择器和管理面板的图片、按钮、开关在深/浅色下均可辨认；禁止紫色强调色。
- 浏览器 console 不得有 warning/error；会话预取在测试中应使用干净窗口，不能跨 reload 串日志。
- 基线截图在 `win.showInactive()` 的真实窗口里采集；隐藏窗口的 CSS 入场动画会停在 opacity:0，
  不能用于像素验收。

## 更新与复核

```powershell
# 生成/更新 3 个场景共 6 张基线
bun scripts/verify-ui-stickers.mjs --update-baseline

# 只跑一个场景
$env:UI_SCENARIO='desktop-dark'; bun scripts/verify-ui-stickers.mjs

# 正常回归（不更新基线）
bun scripts/verify-ui-stickers.mjs

# 保留本次截图，便于人工复核
$env:UI_KEEP_SHOTS='1'; bun scripts/verify-ui-stickers.mjs
```

`dev_docs/visual/sticker-current/` 是 `UI_KEEP_SHOTS=1` 的临时输出，不应提交。
