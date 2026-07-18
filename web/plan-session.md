# 增强 SessionItem 视觉反馈 — 计划

## 文件范围
只修改：`src/components/SessionItem.vue` 的 `<style scoped>` 部分  
不涉及：`SessionSidebar.vue`、template、script

---

## 任务 1：入场动画（slideIn）

### 改动
在 `SessionItem.vue` 的 `<style scoped>` 末尾添加：

```css
/* ── Entrance animation ── */
@media (prefers-reduced-motion: no-preference) {
  .session-item {
    animation: session-slide-in 0.25s ease-out both;
  }
  @keyframes session-slide-in {
    from { opacity: 0; transform: translateX(-8px); }
    to   { opacity: 1; transform: translateX(0); }
  }
}
```

- 动画名 `session-slide-in`，与已有的 `pulse` 动画不冲突。
- `both` 填充模式确保动画开始前元素不可见，结束后保持最终状态。
- 用 `@media (prefers-reduced-motion: no-preference)` 包裹，尊重系统无障碍设置。
- 对 `.session-item` 生效：所有新挂载的列表项都会播放一次入场动画。

---

## 任务 2：增强 active 状态可视性（左侧色条）

### 改动
1. 在 `.session-item` 中添加 `position: relative;`（目前缺失，`::before` 需要定位锚点）。
2. 添加 `::before` 伪元素：

```css
.session-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  bottom: 6px;
  width: 3px;
  background: var(--accent);
  border-radius: 0 2px 2px 0;
}
```

3. 对 const 会话覆盖，因为已有注释表示"无需侧边条"：

```css
.session-item.is-const.active::before {
  display: none;
}
```

### 注意事项
- 现有 `.session-item.active` 已有 `background` 和 `box-shadow`，左侧色条是额外视觉强化。
- `is-const.active` 被显式排除，保持与当前设计意图一致。

---

## 任务 3：删除按钮过渡

### 分析结论：**当前代码已经满足要求**

查看现有 CSS（lines 173-189）：

```css
.btn-delete {
  opacity: 0;
  transition: opacity 0.15s ease 0.05s, transform 0.25s ease 0.05s, color 0.15s;
}
.session-item:hover .btn-delete {
  opacity: 1;
}
```

已包含：
- `opacity: 0` 默认隐藏
- `opacity` 的 `0.15s` 过渡
- hover 时 `opacity: 1`

实际实现比用户建议的版本更完善（多了 `transform` / `color` 过渡和 `0.05s` 延迟），**无需额外修改**。

---

## 验证

修改完成后运行：
```
npx vue-tsc --noEmit
```

确保无类型/CSS 错误。
