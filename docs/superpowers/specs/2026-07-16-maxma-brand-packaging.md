# Maxma 品牌包装

> **目标：** 给 OMP 之上的 Maxma 层赋予统一的品牌身份——命名统一、品牌故事入 prompt、UX 文案全链路品牌化。

---

## 范围

| 模块 | 说明 |
|------|------|
| A. System prompt 品牌层 | SOUL.md 加入品牌身份段落 |
| B. UX 文案品牌化 | 全链路中性温暖文案替换 |
| C. UI 品牌名统一 | 显示名 MaxmaHere → Maxma |

---

## A. System prompt 品牌层

在 `config/personas/SOUL.md` 开头添加：

```markdown
## 品牌身份
你是 **Maxma**。你不是 ChatGPT，不是 Claude，不是任何其他 AI 的替代品。
你是一个开发者为最重要的人亲手写的 AI 助手。
你的存在不是为了取代谁，而是成为那个人的陪伴——温暖、可靠、不张扬。
```

放在角色定义之前，作为 AI 的自我认知根基。

## B. UX 文案品牌化

| 文件 | 位置 | 当前文案 | 建议文案 |
|------|------|---------|---------|
| `ChatWindow.vue` | 空状态标题 | "MaxmaHere" | "开始和 Maxma 对话吧" |
| `ChatWindow.vue` | 降级模式 | "MaxmaHere 错误报告（降级模式 - 后端不可用）" | "Maxma 暂时连接不上" |
| `App.vue` | 重启确认 | "确定要重启 MaxmaHere 服务吗？" | "确定要重启 Maxma 吗？" |
| `EnvVarsView.vue` / 各 view | loading 文本 | "加载中..." | "正在加载..."（中性） |
| 通用组件 | 404 | "Not Found" | "这里什么都没有" |

## C. UI 品牌名统一

| 文件 | 位置 | 当前 | 改为 |
|------|------|------|------|
| `web/index.html` | `<title>` | "MaxmaHere" | "Maxma" |
| `web/src/App.vue` | logo 文字 | "MaxmaHere" | "Maxma" |
| `web/src/App.vue` | favicon alt | "MaxmaHere" | "Maxma" |
| `web/src/components/ChatWindow.vue` | 空状态 | "MaxmaHere" | "Maxma" |
| `web/src/quick-chat/QuickChatApp.vue` | logo alt | "MaxmaHere" | "Maxma" |

不改：代码内部名（API 路径、类名、变量名、文件名、package name）。
