<template>
  <div class="evolution-view">
    <header class="evolution-hero">
      <div>
        <span class="eyebrow">EVOCORE</span>
        <h1>行为成长</h1>
        <p>把明确的用户反馈沉淀为可验证、可撤销、按需生效的行为策略。</p>
      </div>
      <div class="evolution-stats" aria-label="成长统计">
        <div><strong>{{ stats.active }}</strong><span>生效策略</span></div>
        <div><strong>{{ stats.total }}</strong><span>策略总数</span></div>
        <div><strong>{{ Math.round(stats.avg_confidence * 100) }}%</strong><span>平均置信度</span></div>
      </div>
    </header>

    <section class="evolution-learn card">
      <div class="section-heading">
        <div><h2>添加一条长期行为</h2><p>只处理明确的偏好或规则，不从普通对话猜测你的性格。</p></div>
        <span class="cost-chip">无需额外模型调用</span>
      </div>
      <div class="learn-row">
        <input v-model="learnText" maxlength="4000" placeholder="例如：以后回答代码时先给出最小可运行示例" @keydown.enter="learn" />
        <input v-model="scope" maxlength="80" class="scope-input" placeholder="作用域：全局 / 编程" />
        <button class="primary" :disabled="!learnText.trim() || saving" @click="learn">{{ saving ? '保存中…' : '记录成长' }}</button>
      </div>
      <p v-if="notice" class="notice">{{ notice }}</p>
    </section>

    <section class="card">
      <div class="section-heading"><div><h2>当前行为策略</h2><p>只有 active 策略会在匹配当前请求时进入上下文；每条策略都可以暂停或纠正。</p></div><button class="ghost" @click="load">刷新</button></div>
      <div v-if="loading" class="empty">正在读取策略…</div>
      <div v-else-if="rules.length === 0" class="empty">还没有成长策略。明确告诉 Maxma“以后……”或“请记住……”即可开始。</div>
      <div v-else class="rule-list">
        <article v-for="rule in rules" :key="String(rule.id)" class="rule-item">
          <div class="rule-main"><span class="rule-status" :class="String(rule.status)"></span><p>{{ rule.rule_text }}</p></div>
          <div class="rule-meta"><span>{{ rule.scope }}</span><span>置信度 {{ Math.round(Number(rule.confidence ?? 0) * 100) }}%</span><span>{{ rule.evidence_count }} 次证据</span></div>
          <div class="rule-actions">
            <button class="ghost" @click="feedback(String(rule.id), 'positive')">有效</button>
            <button class="ghost" @click="feedback(String(rule.id), 'negative')">降低权重</button>
            <button class="danger" @click="pause(String(rule.id))">暂停</button>
          </div>
        </article>
      </div>
    </section>

    <section class="principles">
      <span>机制边界</span><p>人格成长只改变可回滚的行为策略，不会覆盖工具权限、安全规则或文件白名单。</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api } from '@/api'

const rules = ref<Array<Record<string, unknown>>>([])
const stats = reactive({ total: 0, active: 0, candidates: 0, paused: 0, avg_confidence: 0 })
const loading = ref(false)
const saving = ref(false)
const learnText = ref('')
const scope = ref('global')
const notice = ref('')

async function load() {
  loading.value = true
  try {
    const [ruleData, statData] = await Promise.all([api.listEvolutionRules('active'), api.getEvolutionStats()])
    rules.value = ruleData.rules ?? []
    Object.assign(stats, statData)
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '读取成长策略失败'
  } finally { loading.value = false }
}

async function learn() {
  const text = learnText.value.trim()
  if (!text || saving.value) return
  saving.value = true
  try {
    const result = await api.learnEvolutionRule(text, scope.value.trim() || 'global')
    notice.value = result.learned ? '已记录为可回滚的行为策略。' : '这句话没有被识别为明确的长期偏好。'
    if (result.learned) { learnText.value = ''; await load() }
  } catch (error) { notice.value = error instanceof Error ? error.message : '保存成长策略失败' }
  finally { saving.value = false }
}

async function feedback(id: string, value: 'positive' | 'negative') {
  try { await api.feedbackEvolutionRule(id, value); await load() } catch (error) { notice.value = error instanceof Error ? error.message : '更新策略失败' }
}
async function pause(id: string) {
  try { await api.setEvolutionRuleStatus(id, 'paused'); await load() } catch (error) { notice.value = error instanceof Error ? error.message : '暂停策略失败' }
}
onMounted(load)
</script>

<style scoped>
.evolution-view { max-width: 1080px; margin: 0 auto; padding: 32px clamp(18px, 4vw, 48px) 64px; color: var(--text-primary, #172033); }
.evolution-hero { display:flex; justify-content:space-between; gap:28px; align-items:flex-end; margin-bottom:24px; }
.eyebrow { color:var(--accent,#635bff); font-size:12px; font-weight:800; letter-spacing:.14em; }
h1 { margin:7px 0 8px; font-size:clamp(28px,4vw,42px); letter-spacing:-.04em; } h2 { margin:0; font-size:18px; } p { margin:0; line-height:1.6; color:var(--text-secondary,#627086); }
.evolution-hero p { max-width:620px; } .evolution-stats { display:flex; gap:12px; flex-wrap:wrap; } .evolution-stats div { min-width:92px; padding:12px; border:1px solid var(--border,#dbe2ec); border-radius:12px; background:var(--bg-card,#fff); text-align:center; } .evolution-stats strong,.evolution-stats span { display:block; } .evolution-stats strong { font-size:22px; } .evolution-stats span { margin-top:3px; font-size:11px; color:var(--text-secondary,#627086); }
.card { margin-top:16px; padding:22px; border:1px solid var(--border,#dbe2ec); border-radius:16px; background:var(--bg-card,#fff); box-shadow:var(--shadow-sm,0 5px 18px #1720330b); } .section-heading { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; } .section-heading p { margin-top:4px; font-size:13px; }
.cost-chip { padding:5px 9px; border-radius:999px; color:#176b4b; background:#e9f8f0; font-size:11px; font-weight:700; white-space:nowrap; } .learn-row { display:flex; gap:8px; margin-top:18px; } input { min-width:0; flex:1; padding:11px 12px; border:1px solid #b9c6d6; border-radius:10px; background:#fbfcfe; color:inherit; font:inherit; } .scope-input { max-width:170px; } button { border:0; border-radius:9px; padding:10px 13px; font:inherit; cursor:pointer; } button:disabled { opacity:.5; cursor:not-allowed; } .primary { background:var(--accent,#635bff); color:white; font-weight:700; white-space:nowrap; } .ghost { background:var(--bg-secondary,#f4f7fb); color:var(--text-primary,#172033); } .danger { background:#fff0f1; color:#b53e4b; }
.notice { margin-top:10px; font-size:13px; color:var(--accent,#635bff); } .rule-list { display:grid; gap:10px; margin-top:18px; } .rule-item { padding:14px; border:1px solid var(--border,#dbe2ec); border-radius:12px; } .rule-main { display:flex; gap:9px; align-items:flex-start; } .rule-main p { color:var(--text-primary,#172033); font-size:14px; } .rule-status { width:8px; height:8px; margin-top:7px; flex:0 0 auto; border-radius:50%; background:#5c6c82; } .rule-status.active { background:#21a36b; } .rule-meta { display:flex; gap:12px; margin:8px 0 0 17px; color:var(--text-secondary,#627086); font-size:11px; } .rule-actions { display:flex; justify-content:flex-end; gap:7px; margin-top:10px; } .empty { padding:28px 0 6px; color:var(--text-secondary,#627086); font-size:13px; } .principles { display:flex; gap:10px; margin:14px 4px; font-size:12px; } .principles span { color:var(--accent,#635bff); font-weight:800; white-space:nowrap; } .principles p { font-size:12px; }
@media (max-width: 720px) { .evolution-hero { display:block; } .evolution-stats { margin-top:18px; } .learn-row { flex-wrap:wrap; } .scope-input { max-width:none; flex-basis:100%; } .learn-row .primary { width:100%; } .section-heading { display:block; } .cost-chip { display:inline-block; margin-top:12px; } }
</style>
