<template>
  <div class="hooks-view">
    <div class="header">
      <h2>事件钩子 Event Hooks</h2>
      <p class="header-sub">此页面已合并到 OMP Agent 引擎的自动工具系统——你不需要手动配置任何钩子。</p>
    </div>

    <div class="content">
      <!-- 引导：什么是事件钩子，为什么被弃用 -->
      <details class="intro-card" open>
        <summary>什么是事件钩子？为什么这里没有可配置的内容？</summary>
        <div class="intro-body">
          <p>
            <strong>事件钩子（Event Hooks）</strong>是一种「在特定事件发生时自动执行某段代码或命令」的机制，
            传统 AI 框架用它来实现「保存对话后触发推送」「工具调用前进行权限校验」等自动化。
          </p>
          <p>
            Maxma 当前使用的 <strong>OMP（oh-my-pi）Agent 引擎</strong>用更强大的
            <strong>自定义工具系统</strong>替代了旧的钩子：Agent 在需要时自动注册并触发工具，
            你只需在对话中描述需求，AI 会自己判断何时调用相应能力。
          </p>
          <p class="intro-note">
            💡 简单说：你不再需要预先配置「当 X 发生时做 Y」——告诉 AI 你的目标，它会自己规划与触发动作。
          </p>
        </div>
      </details>

      <!-- 操作引导 -->
      <div class="action-grid">
        <router-link to="/" class="action-card">
          <div class="action-icon">💬</div>
          <div class="action-body">
            <div class="action-title">在对话中描述需求</div>
            <div class="action-desc">
              例：「每次我提到周报，先列出本周完成的任务再生成 markdown」——AI 会自动调用工具完成。
            </div>
          </div>
        </router-link>
        <router-link to="/skills" class="action-card">
          <div class="action-icon">⚡</div>
          <div class="action-body">
            <div class="action-title">用 Skills 沉淀固定流程</div>
            <div class="action-desc">
              若希望 AI 反复遵循同一套规范（如代码评审清单、周报模板），创建一个 Skill 即可，比钩子更直观。
            </div>
          </div>
        </router-link>
        <router-link to="/mcp" class="action-card">
          <div class="action-icon">🛠️</div>
          <div class="action-body">
            <div class="action-title">通过 MCP 接入外部工具</div>
            <div class="action-desc">
              需要「文件读写 / 数据库查询 / 抓取网页」等能力？配置对应 MCP 服务器，AI 会在合适时机自动调用。
            </div>
          </div>
        </router-link>
      </div>

      <!-- FAQ -->
      <div class="faq-section">
        <h3 class="faq-title">常见问题</h3>
        <details class="faq-item">
          <summary>我之前的钩子配置还在吗？</summary>
          <p>OMP 引擎不读取旧的钩子配置文件。若你之前手动写过钩子，它不会被触发，可放心删除旧配置文件。</p>
        </details>
        <details class="faq-item">
          <summary>我想在「保存会话时自动同步到云端」怎么办？</summary>
          <p>这类需求建议在对话中直接告诉 AI：「保存当前会话后，帮我把它同步到 XX 位置」——AI 会调用文件/MCP 工具完成。若需要每次自动执行，可写成 Skill。</p>
        </details>
        <details class="faq-item">
          <summary>能不能像 Zapier 那样配置「事件 → 动作」的规则？</summary>
          <p>Maxma 走的是 Agent 路线：AI 根据上下文自行决策，而非规则引擎。若你有强烈的规则式自动化需求，欢迎反馈，未来版本可能提供。</p>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hooks-view { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.header { padding: 24px 32px 16px; border-bottom: 1px solid var(--border); }
.header h2 { margin: 0 0 4px; font-size: 1.1em; color: var(--text-primary); }
.header-sub { margin: 0; font-size: 0.82em; color: var(--text-secondary); line-height: 1.5; }

.content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

/* ── 引导卡片 ── */
.intro-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-card);
  margin-bottom: 20px;
}
.intro-card > summary {
  padding: 12px 16px;
  font-size: 0.88em;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
  list-style: none;
  position: relative;
  padding-right: 32px;
}
.intro-card > summary::-webkit-details-marker { display: none; }
.intro-card > summary::after {
  content: '▸';
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  transition: transform 0.15s;
}
.intro-card[open] > summary::after { transform: translateY(-50%) rotate(90deg); }
.intro-body {
  padding: 0 16px 14px;
  font-size: 0.85em;
  color: var(--text-secondary);
  line-height: 1.7;
}
.intro-body p { margin: 0 0 8px; }
.intro-body strong { color: var(--text-primary); font-weight: 600; }
.intro-note {
  font-size: 0.92em;
  color: var(--text-tertiary);
  margin-top: 8px !important;
}

/* ── 操作引导 ── */
.action-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 24px;
}
.action-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-card);
  text-decoration: none;
  transition: border-color 0.15s, transform 0.12s;
}
.action-card:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}
.action-icon { font-size: 22px; line-height: 1; flex-shrink: 0; }
.action-body { flex: 1; min-width: 0; }
.action-title {
  font-size: 0.9em;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.action-desc {
  font-size: 0.8em;
  color: var(--text-secondary);
  line-height: 1.55;
}

/* ── FAQ ── */
.faq-section { margin-top: 8px; }
.faq-title {
  font-size: 0.95em;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 10px;
}
.faq-item {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  margin-bottom: 8px;
  overflow: hidden;
}
.faq-item summary {
  padding: 10px 14px;
  font-size: 0.85em;
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
.faq-item[open] summary::after { transform: translateY(-50%) rotate(90deg); }
.faq-item p {
  margin: 0;
  padding: 0 14px 12px;
  font-size: 0.82em;
  color: var(--text-secondary);
  line-height: 1.7;
}

@media (max-width: 640px) {
  .header { padding: 18px 20px 12px; }
  .content { padding: 18px 20px; }
}
</style>
