# Plan: 对齐 Maxma Provider 配置前端与 OMP Catalog

## 审计发现

### 1. OMP Catalog 总量

OMP 的 `CATALOG_PROVIDERS` 中定义了 **61 个 provider**（`descriptors.ts`），包含：
- 通用 LLM API：openai, anthropic, google, deepseek, groq, mistral, together, fireworks, xai, cerebras, huggingface, nvidia, novita, etc.
- 国内厂商：moonshot/kimi, minimax, qianfan, qwen-portal, zhipu-coding-plan, xiaomi, etc.
- 本地推理：ollama, lm-studio, vllm
- 网关/聚合：openrouter, litellm, cloudflare-ai-gateway, vercel-ai-gateway, kilo, zenmux
- 特殊（已有独立 UI 管理）：cursor, devin, github-copilot, gitlab-duo, openai-codex, google-antigravity, google-gemini-cli

### 2. Maxma 前端当前预设（ProvidersView.vue 第 188-196 行）

仅有 7 个预设：
```typescript
const presets = [
  { id: 'deepseek', label: 'DeepSeek', base_url: 'https://api.deepseek.com' },
  { id: 'qwen', label: 'Qwen', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'kimi', label: 'Kimi', base_url: 'https://api.moonshot.cn/v1' },
  { id: 'minimax', label: 'MiniMax', base_url: 'https://api.minimax.chat/v1' },
  { id: 'openrouter', label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1' },
  { id: 'mimo', label: 'Mimo', base_url: 'https://api.xiaomimimo.com/v1' },
  { id: 'custom', label: 'Custom', base_url: '' },
]
```

### 3. 存在的 Bug / 问题

#### Bug 1：`provider_type` 被硬编码为 `'openai'`（第 377 行）
```typescript
provider_type: 'openai',  // BUG: 应该使用 form.value.provider_type
```
这导致无论用户在下拉框中选择 DeepSeek、MiniMax 还是其他，发送给后端的 `provider_type` 始终是 `openai`。

#### Bug 2：卡片仅显示 `OPENAI` 标签（第 22 行）
```html
<span class="card-type-badge">OPENAI</span>
```
应该动态显示实际的 `provider_type`。

### 4. 缺失的重要 Provider 预设

| OMP provider_id | 标签 | 推荐 base_url | 优先级 |
|---|---|---|---|
| openai | OpenAI | https://api.openai.com/v1 | 极高 |
| anthropic | Anthropic | https://api.anthropic.com/v1 | 极高 |
| google | Google Gemini | https://generativelanguage.googleapis.com | 高 |
| ollama | Ollama | http://127.0.0.1:11434/v1 | 高 |
| moonshot | Kimi / Moonshot | https://api.moonshot.cn/v1 | 高（替代当前 kimi） |
| zhipu-coding-plan | 智谱 Coding Plan | https://open.bigmodel.cn/api/coding/paas/v4 | 高 |
| qwen | 通义千问 | https://dashscope.aliyuncs.com/compatible-mode/v1 | 高（当前已有，保留） |
| qianfan | 百度千帆 | https://qianfan.baidubce.com/v2 | 中 |
| groq | Groq | https://api.groq.com/openai/v1 | 中 |
| mistral | Mistral AI | https://api.mistral.ai/v1 | 中 |
| together | Together AI | https://api.together.xyz/v1 | 中 |
| fireworks | Fireworks | https://api.fireworks.ai/inference/v1 | 中 |
| xai | xAI Grok | https://api.x.ai/v1 | 中 |
| novita | Novita | https://api.novita.ai/openai/v1 | 中 |
| vllm | vLLM | (用户自定义) | 中 |
| litellm | LiteLLM | (用户自定义) | 中 |
| lm-studio | LM Studio | (用户自定义) | 中 |
| huggingface | Hugging Face | https://router.huggingface.co/v1 | 中 |
| cerebras | Cerebras | https://api.cerebras.ai/v1 | 中 |
| nvidia | NVIDIA | https://integrate.api.nvidia.com/v1 | 中 |
| cloudflare-ai-gateway | Cloudflare AI Gateway | (用户自定义) | 低 |
| vercel-ai-gateway | Vercel AI Gateway | (用户自定义) | 低 |

## 修改计划

### Step 1：修复 Bug - 使用实际选择的 provider_type

**文件：** `D:/Maxma/MaxmaHere/web/src/views/ProvidersView.vue`

1. **第 22 行：** 将 `OPENAI` 硬编码改为动态 `{{ p.provider_type.toUpperCase() }}`
2. **第 377 行：** 将 `provider_type: 'openai'` 改为 `provider_type: form.value.provider_type`

### Step 2：扩展预设列表

在 `presets` 数组中，保留现有 7 条并新增以下预设（按标签排序）：

| id | label | base_url |
|---|---|---|
| openai | OpenAI | https://api.openai.com/v1 |
| anthropic | Anthropic | https://api.anthropic.com/v1 |
| deepseek | DeepSeek | (保留现有) |
| google | Google Gemini | https://generativelanguage.googleapis.com |
| ollama | Ollama | http://127.0.0.1:11434/v1 |
| qwen | 通义千问 | (保留现有) |
| kimi | Kimi / Moonshot | (保留现有, 改 label 为 "Kimi / Moonshot") |
| minimax | MiniMax | (保留现有) |
| zhipu-coding-plan | 智谱 Coding Plan | https://open.bigmodel.cn/api/coding/paas/v4 |
| qianfan | 百度千帆 | https://qianfan.baidubce.com/v2 |
| groq | Groq | https://api.groq.com/openai/v1 |
| mistral | Mistral AI | https://api.mistral.ai/v1 |
| together | Together AI | https://api.together.xyz/v1 |
| fireworks | Fireworks | https://api.fireworks.ai/inference/v1 |
| xai | xAI Grok | https://api.x.ai/v1 |
| openrouter | OpenRouter | (保留现有) |
| mimo | Mimo | (保留现有) |
| novita | Novita | https://api.novita.ai/openai/v1 |
| huggingface | Hugging Face | https://router.huggingface.co/v1 |
| cerebras | Cerebras | https://api.cerebras.ai/v1 |
| nvidia | NVIDIA | https://integrate.api.nvidia.com/v1 |
| vllm | vLLM | (空，用户自定义) |
| litellm | LiteLLM | (空，用户自定义) |
| lm-studio | LM Studio | (空，用户自定义) |
| cloudflare-ai-gateway | Cloudflare AI Gateway | (空，用户自定义) |
| custom | Custom | (保留现有) |

### Step 3：类型定义补充

在 `D:/Maxma/MaxmaHere/web/src/types/provider.ts` 中，字段基本上完整。但可以考虑添加一个 `ProviderPreset` 接口来规范预设类型。

### Step 4：验证

运行 `npx vue-tsc --noEmit` 确保无类型错误。

## 不修改的内容

- OMP 中的特殊 provider（cursor, devin, github-copilot, gitlab-duo, openai-codex, google-antigravity, google-gemini-cli）不在前端预设中添加，因为它们是 OMP 内部管理的。
- 部分代理/路由类 provider（firepass, kilo, zenmux, wafer-serverless, sakana, synthetic, umans, alibaba-coding-plan, baseten, aimlapi, opencode-go, opencode-zen）也暂不添加，因其目标用户群体较窄。
- xiaomi-token-plan-* 系列属于小米内部不同区域的 token plan，不适合作为通用预设。
