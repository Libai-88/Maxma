import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

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
  { icon: '🔒', title: '本地优先', desc: '所有数据保存在本地，无需注册账号；拒止锚强制阻断 + 工具调用逐次确认' },
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
      { text: 'Maxma 本身完全免费开源，并内置无需 API Key 的免费模型通道。你也可以为使用的 AI 模型付费（如 OpenAI / DeepSeek 按 API 调用计费），或使用 ' },
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
      { text: '想立即开始可先使用 Maxma 内置的免费模型。国内用户也推荐 ' },
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
    q: '斜杠命令是什么？有哪些可用？',
    segments: [
      { text: '在输入框输入 / 会弹出全部斜杠命令——Maxma 的进阶操作统一由命令管理，无需记忆分散的功能按钮：' },
      { text: '/help', strong: true },
      { text: ' 命令帮助；' },
      { text: '/plan', strong: true },
      { text: ' 计划模式；' },
      { text: '/goal <目标>', strong: true },
      { text: ' 设定目标（子命令 pause/resume/drop）；' },
      { text: '/checkpoint [restore]', strong: true },
      { text: ' 检查点/回退；' },
      { text: '/undo', strong: true },
      { text: ' 撤回上一轮；' },
      { text: '/retry', strong: true },
      { text: ' 重试；' },
      { text: '/compact', strong: true },
      { text: ' 压缩上下文；' },
      { text: '/clear', strong: true },
      { text: ' 清空会话；' },
      { text: '/private /auto', strong: true },
      { text: ' 私密模式与自动执行开关。' },
    ],
  },
  {
    q: '如何让 AI 遵循固定工作流（如写周报、代码评审）？',
    segments: [
      { text: '创建一个 ' },
      { text: 'Skill', strong: true },
      { text: '（Markdown 文档），描述该任务的步骤、规范、格式要求。当你说出相关指令时（如"帮我写周报"），Maxma 会自动加载该 Skill 并让 AI 遵循。前往「扩展管理」页面查看已发现的 Skills。' },
    ],
  },
  {
    q: '数据安全吗？AI 能访问我的哪些文件？',
    segments: [
      { text: 'AI 只能访问允许的目录，关键配置文件由「拒止锚」保护。你可在「拒止锚」页面精细控制 AI 禁止访问的敏感路径，所有敏感操作都会经过审批。' },
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
  { cap: '模型选择', maxma: { text: '40+ 提供商，自由切换', highlight: true }, claude: { text: '仅 Claude 系列' }, chatgpt: { text: '仅 OpenAI 系列' } },
  { cap: '数据存储', maxma: { text: '完全本地', highlight: true }, claude: { text: '云端（Anthropic 服务器）' }, chatgpt: { text: '云端（OpenAI 服务器）' } },
  { cap: '工具扩展', maxma: { text: 'MCP 开放协议，任意工具', highlight: true }, claude: { text: 'MCP 完整支持' }, chatgpt: { text: '内置工具，不可扩展' } },
  { cap: '工作流定义', maxma: { text: 'Skills（Markdown）', highlight: true }, claude: { text: 'Projects（受限）' }, chatgpt: { text: 'GPTs / Projects' } },
  { cap: '长期记忆', maxma: { text: '本地持久化，可私密', highlight: true }, claude: { text: '有限（Project 内存）' }, chatgpt: { text: '有限（Memory 功能）' } },
  { cap: '本地模型', maxma: { text: '支持 Ollama / vLLM', highlight: true }, claude: { text: '不支持' }, chatgpt: { text: '不支持' } },
  { cap: '开源', maxma: { text: '开源', highlight: true }, claude: { text: '闭源' }, chatgpt: { text: '闭源' } },
]

const dataPath = 'api/data/'

interface Step {
  title: string
  desc: ReactNode
}

const inlineLink = 'text-primary font-semibold no-underline hover:underline'

const steps: Step[] = [
  {
    title: '配置一个 AI 模型',
    desc: (
      <>
        前往<Link to="/providers" className={inlineLink}>模型设置</Link>页面，选择一个提供商（推荐 <strong className="text-foreground font-semibold">DeepSeek</strong> 注册即送免费额度，或 <strong className="text-foreground font-semibold">Ollama</strong> 完全本地运行）。云端服务填入 API Key，本地服务无需填写。
      </>
    ),
  },
  {
    title: '回到对话页开始聊天',
    desc: (
      <>
        在对话页输入任何问题，Maxma 会调用所选模型进行回复。可使用上方示例或自由提问。<Link to="/" className={inlineLink}>→ 返回对话</Link>
      </>
    ),
  },
  {
    title: '按需扩展能力',
    desc: (
      <>
        想让 AI 读写文件？配置 <Link to="/mcp" className={inlineLink}>MCP 服务器</Link>。想让 AI 遵循固定流程？在对话中让 AI 学习并使用 Skill。想让 AI 记住你的偏好？启用 <Link to="/memory" className={inlineLink}>长期记忆</Link>。
      </>
    ),
  },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h3 className="mb-3 text-base font-bold text-foreground">{title}</h3>
      {children}
    </section>
  )
}

function renderSegment(seg: FaqSegment, i: number) {
  if (seg.strong) return <strong key={i} className="text-foreground font-semibold">{seg.text}</strong>
  if (seg.code) return <code key={i} className="rounded-sm bg-muted px-1.5 py-1.5 font-mono text-xs">{seg.text}</code>
  return <span key={i}>{seg.text}</span>
}

function CompareCellView({ cell }: { cell: CompareCell }) {
  return cell.highlight
    ? <strong className="text-foreground font-semibold">{cell.text}</strong>
    : <>{cell.text}</>
}

export default function HelpView() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col mx-auto w-full max-w-3xl gap-4 p-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">帮助 &amp; 关于 HELP</h2>
          <p className="mt-1 text-sm text-muted-foreground">了解 Maxma 是什么、能做什么、如何开始</p>
        </div>

        <Section title="Maxma 是什么？">
          <p className="mb-2.5 text-sm leading-relaxed text-muted-foreground">
            <strong className="text-foreground font-semibold">Maxma</strong> 是一款 <strong className="text-foreground font-semibold">本地优先</strong> 的 AI 桌面工作站。它把大模型对话、工具调用、MCP 生态、
            可复用 Skills、长期记忆与人设系统整合在一个应用中，所有数据都保存在你的电脑上，无需注册账号、无需上云。
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            和 Claude Desktop / ChatGPT Desktop 等云端方案不同，Maxma 让你 <strong className="text-foreground font-semibold">掌控自己的 AI</strong>：
            自由选择模型（DeepSeek / OpenAI / Qwen / Ollama 本地模型等 40+ 提供商）、
            自由扩展工具（通过 MCP 协议接入文件、数据库、命令行、Web 服务）、
            自由定义工作方式（通过 Skills 沉淀你的流程规范）。
          </p>
        </Section>

        <Section title="核心能力一览">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {capabilities.map((cap) => (
              <div key={cap.title} className="flex items-start gap-3 rounded-lg border border-border bg-panel p-4">
                <span className="text-2xl leading-none">{cap.icon}</span>
                <div>
                  <div className="text-sm font-bold text-foreground">{cap.title}</div>
                  <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{cap.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="三步开始使用">
          <ol className="flex list-none flex-col gap-3 p-0">
            {steps.map((step, idx) => (
              <li key={idx} className="flex items-start gap-3 rounded-lg border border-border bg-panel p-4">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {idx + 1}
                </span>
                {/* min-w-0 + break-words：flex 子项默认 min-width:auto，长英文串会顶穿右边框 */}
                <div className="min-w-0 flex-1 break-words">
                  <div className="text-sm font-bold text-foreground">{step.title}</div>
                  <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.desc}</div>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section title="常见问题 FAQ">
          <div className="flex flex-col gap-2">
            {faqs.map((faq, idx) => (
              <details key={idx} className="rounded-md border border-border bg-panel">
                <summary className="cursor-pointer select-none break-words px-4 py-3 text-sm font-semibold text-foreground">
                  {faq.q}
                </summary>
                <p className="break-words px-4 pb-3.5 text-sm leading-relaxed text-muted-foreground">
                  {faq.segments.map(renderSegment)}
                </p>
              </details>
            ))}
          </div>
        </Section>

        <Section title="与 Claude Desktop / ChatGPT Desktop 的区别">
          <div className="flex flex-col overflow-hidden rounded-md border border-border">
            <div className="grid grid-cols-4 border-b border-border bg-muted text-sm font-bold text-foreground">
              <div className="min-w-0 break-words border-r border-border px-3.5 py-2.5">能力</div>
              <div className="min-w-0 break-words border-r border-border px-3.5 py-2.5">Maxma</div>
              <div className="min-w-0 break-words border-r border-border px-3.5 py-2.5">Claude Desktop</div>
              <div className="min-w-0 break-words px-3.5 py-2.5">ChatGPT Desktop</div>
            </div>
            {comparison.map((row) => (
              <div key={row.cap} className="grid grid-cols-4 border-b border-border last:border-b-0">
                <div className="min-w-0 break-words border-r border-border px-3.5 py-2.5 text-sm font-semibold text-foreground">{row.cap}</div>
                <div className="min-w-0 break-words border-r border-border px-3.5 py-2.5 text-sm text-muted-foreground"><CompareCellView cell={row.maxma} /></div>
                <div className="min-w-0 break-words border-r border-border px-3.5 py-2.5 text-sm text-muted-foreground"><CompareCellView cell={row.claude} /></div>
                <div className="min-w-0 break-words px-3.5 py-2.5 text-sm text-muted-foreground"><CompareCellView cell={row.chatgpt} /></div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="关于">
          <p className="mb-2.5 text-sm leading-relaxed text-muted-foreground">
            Maxma 是一个开源项目，遵循本地优先、隐私优先、可扩展的设计理念。
            所有数据保存在本地（<code className="rounded-sm bg-muted px-1.5 py-1.5 font-mono text-xs">{dataPath}</code>），不上传任何对话内容到第三方服务器（仅在你调用模型时直接与模型提供商通信）。
          </p>
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Link to="/privacy" className={inlineLink}>隐私仪表盘</Link>
            <span className="text-muted-foreground">·</span>
            <Link to="/appearance" className={inlineLink}>外观设置</Link>
            <span className="text-muted-foreground">·</span>
            <Link to="/user" className={inlineLink}>用户偏好</Link>
          </p>
        </Section>
      </div>
    </div>
  )
}
