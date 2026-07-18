<template>
  <div class="kb-view">
    <div class="header">
      <h2>知识库 Knowledge Base</h2>
      <p class="header-sub">此页面已合并到 OMP Agent 引擎的自动记忆系统——你不需要手动上传或索引文档。</p>
    </div>

    <div class="content">
      <!-- 引导：什么是知识库，为什么不需要上传 -->
      <details class="intro-card" open>
        <summary>什么是知识库？为什么这里没有上传按钮？</summary>
        <div class="intro-body">
          <p>
            <strong>知识库（Knowledge Base）</strong>通常指 AI 可查询的结构化知识集合——
            其他工具（如 NotebookLM、ChatGPT Files）会让你上传 PDF/Word/Markdown 文档，
            然后由 AI 在对话中检索引用。
          </p>
          <p>
            Maxma 的 <strong>OMP（oh-my-pi）Agent 引擎</strong>采用了不同的方案：通过
            <code>memory_recall</code>（回忆）、<code>memory_reflect</code>（反思）、
            <code>memory_retain</code>（保留）等工具<strong>自动</strong>管理知识——
            AI 会在对话中判断哪些信息值得记住、何时该调用记忆，无需你手动维护。
          </p>
          <p class="intro-note">
            💡 简单说：你不需要「先上传文档让 AI 学习」——直接在对话中告诉 AI 信息，
            它会自己决定该记什么；下次需要时它也会自动调用记忆回答。
          </p>
        </div>
      </details>

      <!-- 操作引导 -->
      <div class="action-grid">
        <router-link to="/memory" class="action-card">
          <div class="action-icon">🧠</div>
          <div class="action-body">
            <div class="action-title">查看已记住的事实</div>
            <div class="action-desc">
              前往「记忆」页面查看 AI 自动记录的全部事实，可删除不准确项或编辑关键偏好。
            </div>
          </div>
        </router-link>
        <router-link to="/soul" class="action-card">
          <div class="action-icon">🎨</div>
          <div class="action-body">
            <div class="action-title">在 SOUL 中固定核心背景</div>
            <div class="action-desc">
              若有「项目背景、长期角色、专业领域」等需要 AI 永远知道的信息，写在 SOUL 人设里更稳定（不会被遗忘）。
            </div>
          </div>
        </router-link>
        <router-link to="/" class="action-card">
          <div class="action-icon">💬</div>
          <div class="action-body">
            <div class="action-title">在对话中即时提供资料</div>
            <div class="action-desc">
              想让 AI 处理一份文档？直接把内容粘贴到对话里，或配置文件类 MCP 服务器让 AI 读取本地文件。
            </div>
          </div>
        </router-link>
      </div>

      <!-- FAQ -->
      <div class="faq-section">
        <h3 class="faq-title">常见问题</h3>
        <details class="faq-item">
          <summary>「知识库」和「记忆 Memory」是什么关系？</summary>
          <p>
            在 Maxma 中两者是同一套系统：OMP 引擎通过记忆工具自动管理知识。
            「知识库」原本是规划中的独立模块（手动上传文档），现已合并到「记忆」——记忆页就是你的知识库。
          </p>
        </details>
        <details class="faq-item">
          <summary>我能上传 PDF 让 AI 学习吗？</summary>
          <p>
            目前不支持直接上传 PDF 到「知识库」。变通方案：(1) 配置文件类 MCP 服务器让 AI 读取本地 PDF 文件；
            (2) 将 PDF 内容复制粘贴到对话中；(3) 用支持 PDF 解析的 MCP 服务器（如 Claude 官方 pdf-mcp）。
          </p>
        </details>
        <details class="faq-item">
          <summary>AI 会记住我说的所有内容吗？</summary>
          <p>
            不会全部记住。OMP 引擎会判断信息的重要性与时效性：明显是长期偏好的（如「我对花生过敏」）会被保留，
            临时性的（如「今天天气不错」）通常不会。你可在「记忆」页面查看与删除已记录的事实。
          </p>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kb-view { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
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
.intro-body code {
  background: var(--bg-secondary);
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.88em;
  font-family: var(--font-mono, 'SF Mono', monospace);
}
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
