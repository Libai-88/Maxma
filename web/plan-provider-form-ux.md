# Plan: Provider 配置表单 UX 改进

## 文件
`D:/Maxma/MaxmaHere/web/src/views/ProvidersView.vue`

## 改动清单

### 1. 表单字段分组（视觉重组）

将现有平铺的 8 个 `.form-section` 拆分为 3 个逻辑组，每组用 `<div class="form-section-group">` 包裹（内含组标题 `<h3 class="group-title">` 和原有字段）。

分组结构：

```
基础设置
├── 提供商 (select)      — required
├── 显示名称 (input)      — required
├── API Key (password)   — required
└── Base URL (input)     — required

模型参数
├── Context Window (number)
├── Max Tokens (number)  — 在 form-row--3cols 中
├── Temperature (number, step=0.1)
└── Top P (number, step=0.05)

高级设置
├── 超时 (number)
└── 自定义 Headers (JSON)
```

**注意：** 模型参数组中，`context_window` 当前是单独的 `.form-section`，紧随其后的是 `.form-row--3cols`（含 max_tokens、temperature、top_p）。改为：context_window 独立占一行，下面用 `.form-row--3cols` 展示 max_tokens、temperature、top_p，整个组在一个 group 内。

新增 CSS：
```css
.form-section-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
}
.group-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 4px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
```

### 2. 必填字段标记

在以下 `<label>` 中添加 `<span class="required-mark">*</span>`：
- 提供商（provider_type）
- 显示名称（label）
- API Key（api_key）
- Base URL（base_url）

新增 CSS：
```css
.required-mark {
  color: var(--status-error);
  margin-left: 2px;
}
```

### 3. 表单验证视觉反馈

- 添加一个 `formErrors` 响应式对象 `Record<string, string>` 来跟踪每个字段的错误状态。
- 在 `handleSave()` 中验证失败时，将字段名写入 `formErrors`。
- 为输入框添加动态 class `:class="{ 'input-error': formErrors['field_name'] }"`。
- 当 `formError` 被清除时（新操作），同时清空 `formErrors`。

新增 CSS：
```css
.input-error {
  border-color: var(--status-error) !important;
}
.input-error:focus {
  border-color: var(--status-error) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--status-error) 25%, transparent);
}
```

### 不做的事情

- 不改动表单保存、测试、发现模型的逻辑
- 不改动 TypeScript 类型
- 不改动整体布局结构（max-width、flex 等）
- 不改动列表模式

## 验证

执行 `npx vue-tsc --noEmit` 检查类型无误后提交。
