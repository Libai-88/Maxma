<template>
  <div class="help-view">
    <div class="header">
      <h2>帮助 & 关于 HELP</h2>
      <p class="header-sub">了解 Maxma 是什么、能做什么、如何开始</p>
    </div>

    <!-- ── 项目介绍 ── -->
    <section class="section">
      <h3>Maxma 是什么？</h3>
      <p>
        <strong>Maxma</strong> 是一款 <strong>本地优先</strong> 的 AI 桌面工作站。它把大模型对话、工具调用、MCP 生态、
        可复用 Skills、长期记忆与人设系统整合在一个应用中，所有数据都保存在你的电脑上，无需注册账号、无需上云。
      </p>
      <p>
        和 Claude Desktop / ChatGPT Desktop 等云端方案不同，Maxma 让你 <strong>掌控自己的 AI</strong>：
        自由选择模型（DeepSeek / OpenAI / Qwen / Ollama 本地模型等 40+ 提供商）、
        自由扩展工具（通过 MCP 协议接入文件、数据库、命令行、Web 服务）、
        自由定义工作方式（通过 Skills 沉淀你的流程规范）。
      </p>
    </section>

    <!-- ── 核心能力 ── -->
    <section class="section">
      <h3>核心能力一览</h3>
      <div class="capability-grid">
        <div class="capability-card" v-for="cap in capabilities" :key="cap.title">
          <div class="capability-icon">{{ cap.icon }}</div>
          <div class="capability-body">
            <div class="capability-title">{{ cap.title }}</div>
            <div class="capability-desc">{{ cap.desc }}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── 快速开始 ── -->
    <section class="section">
      <h3>三步开始使用</h3>
      <ol class="steps">
        <li>
          <span class="step-no">1</span>
          <div class="step-body">
            <div class="step-title">配置一个 AI 模型</div>
            <div class="step-desc">
              前往「模型 MODELS」页面，选择一个提供商（推荐 <strong>DeepSeek</strong> 注册即送免费额度，或 <strong>Ollama</strong> 完全本地运行），
              填入 API Key 后保存。
              <router-link to="/providers" class="inline-link">→ 前往模型设置</router-link>
            </div>
          </div>
        </li>
        <li>
          <span class="step-no">2</span>
          <div class="step-body">
            <div class="step-title">回到对话页开始聊天</div>
            <div class="step-desc">
              在对话页输入任何问题，Maxma 会调用所选模型进行回复。可使用上方示例或自由提问。
              <router-link to="/" class="inline-link">→ 返回对话</router-link>
            </div>
          </div>
        </li>
        <li>
          <span class="step-no">3</span>
          <div class="step-body">
            <div class="step-title">按需扩展能力</div>
            <div class="step-desc">
              想让 AI 读写文件？配置 <router-link to="/mcp" class="inline-link">MCP 服务器</router-link>。
              想让 AI 遵循固定流程？创建 <router-link to="/skills" class="inline-link">Skill</router-link>。
              想让 AI 记住你的偏好？启用 <router-link to="/memory" class="inline-link">长期记忆</router-link>。
            </div>
          </div>
        </li>
      </ol>
    </section>

    <!-- ── FAQ ── -->
    <section class="section">
      <h3>常见问题 FAQ</h3>
      <div class="faq-list">
        <details v-for="(faq, idx) in faqs" :key="idx" class="faq-item">
          <summary>{{ faq.q }}</summary>
          <p class="faq-answer">
            <template v-for="(seg, i) in faq.segments" :key="i">
              <strong v-if="seg.strong">{{ seg.text }}</strong>
              <code v-else-if="seg.code">{{ seg.text }}</code>
              <template v-else>{{ seg.text }}</template>
            </template>
          </p>
        </details>
      </div>
    </section>

    <!-- ── 与竞品对比（面向 Enthusiast） ── -->
    <section class="section">
      <h3>与 Claude Desktop / ChatGPT Desktop 的区别</h3>
      <div class="compare-table">
        <div class="compare-row compare-header-row">
          <div class="compare-cell">能力</div>
          <div class="compare-cell">Maxma</div>
          <div class="compare-cell">Claude Desktop</div>
          <div class="compare-cell">ChatGPT Desktop</div>
        </div>
        <div class="compare-row" v-for="row in comparison" :key="row.cap">
          <div class="compare-cell cap-name">{{ row.cap }}</div>
          <div class="compare-cell">
            <strong v-if="row.maxma.highlight">{{ row.maxma.text }}</strong>
            <template v-else>{{ row.maxma.text }}</template>
          </div>
          <div class="compare-cell">
            <strong v-if="row.claude.highlight">{{ row.claude.text }}</strong>
            <template v-else>{{ row.claude.text }}</template>
          </div>
          <div class="compare-cell">
            <strong v-if="row.chatgpt.highlight">{{ row.chatgpt.text }}</strong>
            <template v-else>{{ row.chatgpt.text }}</template>
          </div>
        </div>
      </div>
    </section>

    <!-- ── 关于 ── -->
    <section class="section about-section">
      <h3>关于</h3>
      <p>
        Maxma 是一个开源项目，遵循本地优先、隐私优先、可扩展的设计理念。
        所有数据保存在本地（<code>{{ dataPath }}</code>），不上传任何对话内容到第三方服务器（仅在你调用模型时直接与模型提供商通信）。
      </p>
      <p class="about-links">
        <router-link to="/privacy" class="inline-link">隐私仪表盘</router-link>
        <span class="link-sep">·</span>
        <router-link to="/appearance" class="inline-link">外观设置</router-link>
        <span class="link-sep">·</span>
        <router-link to="/user" class="inline-link">用户偏好</router-link>
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'HelpView' })

interface Capability {
  icon: string
  title: string
  desc: string
}

const capabilities: Capability[] = [
  { icon: '💬', title: '多模型对话', desc: '支持 40+ 提供商（OpenAI / DeepSeek / Qwen / Ollama 等），可随时切换、fallback、对比' },
  { icon: '🛠️', title: 'MCP 工具生态', desc: '通过 Model Context Protocol 接入文件、数据库、命令行、Web 服务等任意工具' },
  { icon: '⚡', title: 'Skills 技能', desc: '用 Markdown 沉淀工作流与规范，AI 会根据上下文自动加载相关 Skill' },
  { icon: '🧠', title: '长期记忆', desc: '记住你的偏好、项目背景、历史决策；可私密模式临时关闭' },
  { icon: '🎨', title: '人设系统', desc: '为 AI 设定角色、语气、专业领域，适配不同场景' },
  { icon: '🔒', title: '本地优先', desc: '所有数据保存在本地，无需注册账号；支持路径白名单与拒止锚安全策略' },
]

interface FaqSegment {
  text: string
  strong?: boolean
  code?: boolean
}

interface Faq {
  q: string
  segments: FaqSegment[]
}

const faqs: Faq[] = [
  {
    q: '需要付费吗？',
    segments: [
      { text: 'Maxma 本身完全免费开源。你需要为使用的 AI 模型付费（如 OpenAI / DeepSeek 按 API 调用计费），但也可以使用 ' },
      { text: 'Ollama', strong: true },
      { text: ' 运行本地模型，完全免费。' },
    ],
  },
  {
    q: '我的对话数据会被上传到哪里？',
    segments: [
      { text: '对话内容仅保存在本地（' },
      { text: 'api/data/const-sessions/', code: true },
      { text: '）。当你与 AI 对话时，消息会直接发送给你配置的模型提供商（如 OpenAI），但 Maxma 本身不中转、不存储你的数据到第三方服务器。' },
    ],
  },
  {
    q: '不知道选哪个模型？',
    segments: [
      { text: '国内用户推荐 ' },
      { text: 'DeepSeek', strong: true },
      { text: '（性价比高、注册即送免费额度、中文表现优秀）或 ' },
      { text: '通义千问 Qwen', strong: true },
      { text: '（阿里云、免费额度充足）。海外用户推荐 ' },
      { text: 'OpenAI', strong: true },
      { text: '（体验最佳）。完全离线/隐私敏感场景推荐 ' },
      { text: 'Ollama', strong: true },
      { text: '（本地运行，无需 API Key）。' },
    ],
  },
  {
    q: '和 Claude Desktop / ChatGPT Desktop 有什么区别？',
    segments: [
      { text: 'Maxma 是 ' },
      { text: '本地优先', strong: true },
      { text: ' 的——你掌控所有数据；' },
      { text: '模型无关', strong: true },
      { text: '——可接入任意 OpenAI 兼容 API；' },
      { text: '可扩展', strong: true },
      { text: '——通过 MCP 接入任意工具；' },
      { text: '可定义', strong: true },
      { text: '——通过 Skills 沉淀工作流。竞品通常是封闭生态，模型/工具/数据都被锁定。' },
    ],
  },
  {
    q: '什么是 MCP？我能用它做什么？',
    segments: [
      { text: 'MCP（Model Context Protocol）是一种让 AI 与外部工具通信的开放协议。通过配置 MCP 服务器，你的 AI 能读写文件、查询数据库、执行命令、抓取网页、管理代码仓库等。访问「MCP 服务」页面查看内置示例。' },
    ],
  },
  {
    q: '不会写代码能用吗？',
    segments: [
      { text: '可以。Maxma 提供 GUI 化配置：所有模型、MCP、Skills、记忆、人设都可通过界面管理。内置 Onboarding 引导和示例 MCP 服务器，开箱即用。极客用户可深入自定义 Markdown / YAML / 命令行，普通用户无需触碰代码。' },
    ],
  },
  {
    q: '如何让 AI 遵循固定工作流（如写周报、代码评审）？',
    segments: [
      { text: '创建一个 ' },
      { text: 'Skill', strong: true },
      { text: '（Markdown 文档），描述该任务的步骤、规范、格式要求。当你说出相关指令时（如"帮我写周报"），Maxma 会自动加载该 Skill 并让 AI 遵循。前往「Skills & 宏」页面新建。' },
    ],
  },
  {
    q: '数据安全吗？AI 能访问我的哪些文件？',
    segments: [
      { text: 'AI 只能访问「路径白名单」中明确允许的目录，关键配置文件由 MaxmaBlocker 保护。你可在「路径白名单」页面精细控制 AI 的文件访问权限，所有敏感操作都会经过审批。' },
    ],
  },
]

interface CompareCell {
  text: string
  highlight?: boolean
}

interface CompareRow {
  cap: string
  maxma: CompareCell
  claude: CompareCell
  chatgpt: CompareCell
}

const comparison: CompareRow[] = [
  {
    cap: '模型选择',
    maxma: { text: '40+ 提供商，自由切换', highlight: true },
    claude: { text: '仅 Claude 系列' },
    chatgpt: { text: '仅 OpenAI 系列' },
  },
  {
    cap: '数据存储',
    maxma: { text: '完全本地', highlight: true },
    claude: { text: '云端（Anthropic 服务器）' },
    chatgpt: { text: '云端（OpenAI 服务器）' },
  },
  {
    cap: '工具扩展',
    maxma: { text: 'MCP 开放协议，任意工具', highlight: true },
    claude: { text: 'MCP 完整支持' },
    chatgpt: { text: '内置工具，不可扩展' },
  },
  {
    cap: '工作流定义',
    maxma: { text: 'Skills（Markdown）', highlight: true },
    claude: { text: 'Projects（受限）' },
    chatgpt: { text: 'GPTs / Projects' },
  },
  {
    cap: '长期记忆',
    maxma: { text: '本地持久化，可私密', highlight: true },
    claude: { text: '有限（Project 内存）' },
    chatgpt: { text: '有限（Memory 功能）' },
  },
  {
    cap: '本地模型',
    maxma: { text: '支持 Ollama / vLLM', highlight: true },
    claude: { text: '不支持' },
    chatgpt: { text: '不支持' },
  },
  {
    cap: '开源',
    maxma: { text: '开源', highlight: true },
    claude: { text: '闭源' },
    chatgpt: { text: '闭源' },
  },
]

const dataPath = 'api/data/'
</script>

<style scoped>
.help-view {
  padding: 24px 32px;
  max-width: 960px;
  margin: 0 auto;
  overflow-y: auto;
  height: 100%;
}

.header {
  margin-bottom: 24px;
}
.header h2 {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px;
}
.header-sub {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.section {
  margin-bottom: 24px;
  padding: 18px 20px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-card);
}
.section h3 {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 12px;
}
.section p {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
}
.section p:last-child { margin-bottom: 0; }
.section strong { color: var(--text-primary); font-weight: 600; }
.section code {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--bg-secondary);
  color: var(--text-primary);
}

/* ── 能力卡片 ── */
.capability-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
@media (max-width: 700px) {
  .capability-grid { grid-template-columns: 1fr; }
}
.capability-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
}
.capability-icon {
  font-size: 24px;
  flex-shrink: 0;
  line-height: 1;
}
.capability-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.capability-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

/* ── 步骤 ── */
.steps {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.steps li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.step-no {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--bg-primary, #fff);
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.step-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.step-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.inline-link {
  color: var(--accent);
  text-decoration: none;
  font-weight: 600;
  margin-left: 4px;
}
.inline-link:hover { text-decoration: underline; }

/* ── FAQ ── */
.faq-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.faq-item {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
  overflow: hidden;
}
.faq-item summary {
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
  list-style: none;
  position: relative;
  padding-right: 32px;
}
.faq-item summary::-webkit-details-marker { display: none; }
.faq-item summary::after {
  content: '▸';
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  transition: transform 0.15s;
}
.faq-item[open] summary::after {
  transform: translateY(-50%) rotate(90deg);
}
.faq-item p {
  margin: 0;
  padding: 0 14px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.faq-item p :deep(strong) { color: var(--text-primary); font-weight: 600; }
.faq-item p :deep(code) {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--bg-secondary);
}

/* ── 对比表 ── */
.compare-table {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.compare-row {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr 1fr;
  border-bottom: 1px solid var(--border);
}
.compare-row:last-child { border-bottom: none; }
.compare-header-row {
  background: var(--bg-secondary);
  font-weight: 700;
  color: var(--text-primary);
  font-size: 12px;
}
.compare-cell {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  border-right: 1px solid var(--border);
}
.compare-cell:last-child { border-right: none; }
.compare-cell :deep(strong) { color: var(--text-primary); font-weight: 600; }
.cap-name {
  font-weight: 600;
  color: var(--text-primary);
}
@media (max-width: 700px) {
  .compare-row { grid-template-columns: 1fr 1fr; }
  .compare-cell { font-size: 11px; padding: 6px 8px; }
  .compare-header-row .compare-cell:nth-child(n+3) { display: none; }
  .compare-row:not(.compare-header-row) .compare-cell:nth-child(n+3) {
    grid-column: 1 / -1;
    border-top: 1px dashed var(--border);
  }
}

/* ── About ── */
.about-section .about-links {
  margin-top: 12px;
  font-size: 12px;
}
.link-sep {
  margin: 0 8px;
  color: var(--text-tertiary);
}
</style>
