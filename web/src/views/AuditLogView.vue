<template>
  <div class="audit-log-view">
    <div class="header">
      <h2>审计日志 Audit Log</h2>
      <p class="header-sub">了解 Maxma 记录了什么、在哪里查看、如何清除。</p>
    </div>

    <!-- 引导：OMP 内置审计说明 -->
    <section class="card intro-card">
      <div class="intro-head">
        <span class="intro-icon">📋</span>
        <h3>审计能力由 OMP 引擎内置管理</h3>
      </div>
      <p class="intro-desc">
        Maxma 的 Agent 引擎（OMP / oh-my-pi）在运行过程中会自动记录关键事件，
        包括工具调用、网络请求、配置变更与文件访问等。你不需要手动开启或维护审计——
        事件由引擎自动产生与归档。
      </p>
      <ul class="intro-list">
        <li><strong>记录什么</strong>：模型调用、工具调用（含参数与结果摘要）、网络出口、敏感配置变更。</li>
        <li><strong>不记录什么</strong>：对话正文内容、SOUL.md / USER.md 的具体文本、API Key 明文。</li>
        <li><strong>存储位置</strong>：本地 <code>logs/audit.jsonl</code>（详见<router-link to="/privacy">隐私仪表盘</router-link>）。</li>
      </ul>
    </section>

    <!-- 操作引导 -->
    <section class="card">
      <h3>查看与操作</h3>
      <p class="section-desc">下面是查看审计记录、导出日志与清除数据的常用入口。</p>
      <div class="action-grid">
        <router-link to="/privacy" class="action-card">
          <div class="action-icon">🛡️</div>
          <div class="action-body">
            <div class="action-title">前往隐私仪表盘</div>
            <div class="action-sub">查看网络活动统计、最近审计日志、清除审计记录</div>
          </div>
          <div class="action-arrow">↗</div>
        </router-link>

        <button class="action-card" @click="exportErrorLog" :disabled="exporting">
          <div class="action-icon">📦</div>
          <div class="action-body">
            <div class="action-title">{{ exporting ? '导出中...' : '导出运行日志' }}</div>
            <div class="action-sub">包含应用错误日志，便于反馈问题或离线审计</div>
          </div>
          <div class="action-arrow">↗</div>
        </button>

        <router-link to="/metrics" class="action-card">
          <div class="action-icon">📊</div>
          <div class="action-body">
            <div class="action-title">查看运行指标</div>
            <div class="action-sub">HTTP 请求、工具调用、LLM 调用的实时统计与历史趋势</div>
          </div>
          <div class="action-arrow">↗</div>
        </router-link>
      </div>
    </section>

    <!-- FAQ -->
    <section class="card">
      <h3>常见问题</h3>
      <details class="faq-item">
        <summary>审计日志和运行指标有什么区别？</summary>
        <div class="faq-body">
          <strong>审计日志</strong>关注"谁在什么时候做了什么"——按事件类型（API 调用 / 文件访问 / 配置变更）记录可追溯条目，
          适合安全审计与事后追查。<br>
          <strong>运行指标</strong>关注"系统表现如何"——聚合统计 HTTP 请求数 / 延迟、工具调用错误率、LLM Token 消耗等，
          适合性能监控与健康检查。
        </div>
      </details>
      <details class="faq-item">
        <summary>为什么这里没有直接展示日志条目？</summary>
        <div class="faq-body">
          当前版本的审计日志查看能力统一在<router-link to="/privacy">隐私仪表盘</router-link>中：
          支持「全部 / API 调用 / 文件访问 / 配置变更」类型筛选，最近 50 条记录按时间倒序展示。
          当后端切换到 OMP 模式后，部分审计能力由引擎内部托管，前端展示会降级为只读 banner。
        </div>
      </details>
      <details class="faq-item">
        <summary>如何彻底清除已产生的审计记录？</summary>
        <div class="faq-body">
          前往<router-link to="/privacy">隐私仪表盘</router-link>的「数据管理」区块，点击「清除审计日志」。
          注意：此操作仅清除审计数据库，不会影响对话历史或已加密的 API 密钥。
        </div>
      </details>
      <details class="faq-item">
        <summary>API 密钥会被记录在日志里吗？</summary>
        <div class="faq-body">
          不会。审计事件按设计仅记录"事件类型 + 目标 + 状态 + 时间戳"，不捕获请求/响应体中的密钥或对话内容。
          API 密钥本身存储在 <code>.env</code> 或 <code>providers.yaml</code>，可在隐私仪表盘点击「加密 API 密钥」进行静态加密。
        </div>
      </details>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { api } from '@/api'
import { invoke } from '@tauri-apps/api/core'

const exporting = ref(false)

async function exportErrorLog() {
  if (exporting.value) return
  exporting.value = true
  try {
    const text = await api.getErrorLogText()
    const ts = new Date().toISOString().replace(/[:T]/g, '-').substring(0, 19)
    const filename = `maxma-audit-log-${ts}.txt`
    const result = await invoke<string | null>('save_text_file', {
      content: text,
      defaultFilename: filename,
    })
    if (result) {
      alert(`审计日志已保存到:\n${result}`)
    }
  } catch (e) {
    alert('导出失败: ' + (e instanceof Error ? e.message : String(e)))
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped>
.audit-log-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 24px 32px;
  max-width: 880px;
  margin: 0 auto;
  width: 100%;
}
.header {
  margin-bottom: 20px;
}
.header h2 {
  margin: 0 0 4px;
  font-size: 1.1em;
  font-weight: 700;
  color: var(--text-primary);
}
.header-sub {
  margin: 0;
  font-size: 0.85em;
  color: var(--text-secondary);
  line-height: 1.6;
}

.card {
  margin-bottom: 16px;
  padding: 18px 20px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-card);
}
.card h3 {
  margin: 0 0 8px;
  font-size: 0.95em;
  font-weight: 600;
  color: var(--text-primary);
}
.section-desc {
  margin: 0 0 14px;
  font-size: 0.8em;
  color: var(--text-secondary);
  line-height: 1.6;
}

/* ── 引导卡片 ── */
.intro-card {
  background: var(--bg-card);
  background: color-mix(in srgb, var(--accent) 6%, var(--bg-card));
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
}
.intro-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.intro-icon { font-size: 28px; }
.intro-head h3 { margin: 0; font-size: 1em; }
.intro-desc {
  margin: 0 0 12px;
  font-size: 0.85em;
  color: var(--text-secondary);
  line-height: 1.7;
}
.intro-list {
  margin: 0;
  padding-left: 20px;
  font-size: 0.82em;
  color: var(--text-secondary);
  line-height: 1.8;
}
.intro-list li { margin-bottom: 2px; }
.intro-list strong { color: var(--text-primary); font-weight: 600; }
.intro-list code {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 0.85em;
  background: var(--bg-secondary);
  padding: 1px 5px;
  border-radius: 3px;
}

/* ── 操作卡片网格 ── */
.action-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 10px;
}
.action-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
  text-decoration: none;
  color: inherit;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s, background 0.15s;
  font: inherit;
  text-align: left;
}
.action-card:hover:not(:disabled) {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, var(--bg-primary));
}
.action-card:disabled { opacity: 0.55; cursor: wait; }
.action-icon { font-size: 24px; flex-shrink: 0; }
.action-body { flex: 1; min-width: 0; }
.action-title {
  font-size: 0.88em;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
}
.action-sub {
  font-size: 0.75em;
  color: var(--text-secondary);
  line-height: 1.5;
}
.action-arrow {
  color: var(--text-tertiary);
  font-size: 1.1em;
  flex-shrink: 0;
}

/* ── FAQ ── */
.faq-item {
  border-top: 1px solid var(--border);
  padding: 10px 0;
}
.faq-item:first-of-type { border-top: none; padding-top: 0; }
.faq-item summary {
  cursor: pointer;
  font-size: 0.88em;
  font-weight: 500;
  color: var(--text-primary);
  list-style: none;
  user-select: none;
  padding: 4px 0;
  position: relative;
  padding-left: 18px;
}
.faq-item summary::-webkit-details-marker { display: none; }
.faq-item summary::before {
  content: '▸';
  position: absolute;
  left: 0;
  color: var(--text-tertiary);
  transition: transform 0.15s;
}
.faq-item[open] summary::before {
  transform: rotate(90deg);
}
.faq-body {
  margin-top: 8px;
  padding: 4px 0 6px 18px;
  font-size: 0.82em;
  color: var(--text-secondary);
  line-height: 1.75;
}
.faq-body strong { color: var(--text-primary); }
.faq-body code {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 0.85em;
  background: var(--bg-secondary);
  padding: 1px 5px;
  border-radius: 3px;
}

@media (max-width: 640px) {
  .audit-log-view { padding: 16px; }
  .action-grid { grid-template-columns: 1fr; }
}
</style>
