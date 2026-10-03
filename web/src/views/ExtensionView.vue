<template>
  <div class="ext-view" ref="rootEl">
    <div class="header">
      <h2>插件与工具</h2>
      <p class="header-sub">管理外部工具连接，查看已加载的 Skills</p>
    </div>

    <div class="extension-tabs" role="tablist" aria-label="插件类别">
      <button role="tab" :aria-selected="activeTab === 'tools'" :class="{ active: activeTab === 'tools' }" @click="setTab('tools')">工具</button>
      <button role="tab" :aria-selected="activeTab === 'skills'" :class="{ active: activeTab === 'skills' }" @click="setTab('skills')">Skills</button>
      <button role="tab" :aria-selected="activeTab === 'mcp'" :class="{ active: activeTab === 'mcp' }" @click="setTab('mcp')">MCP 服务</button>
    </div>

    <McpView v-if="activeTab === 'mcp'" />
    <div v-else-if="loading" class="extension-loading" role="status" aria-live="polite" aria-label="正在扫描插件">
      <span class="sr-only">正在扫描插件与 Skills…</span>
      <div class="extension-skeleton-grid" aria-hidden="true">
        <div v-for="n in 6" :key="n" class="extension-skeleton-card"><span></span><span></span><span></span></div>
      </div>
    </div>
    <div v-else-if="error" class="empty extension-error">
      <div class="empty-icon" aria-hidden="true">⚠</div>
      <div class="empty-title">插件列表暂时不可用</div>
      <p class="empty-desc">{{ error.includes("操作过于频繁") ? "请求过于频繁，稍后重试即可；页面上的其它功能不受影响。" : error }}</p>
      <button class="btn" @click="load">重试</button>
    </div>
    <template v-else>
      <!-- 系统状态 -->
      <div v-if="activeTab === 'tools'" class="section status-section">
        <div class="status-grid">
          <div class="status-item">
            <span class="status-dot" :class="systemStatus.sidecar_available ? 'online' : 'offline'"></span>
            <span>Pi Agent {{ systemStatus.sidecar_available ? '运行中' : '离线' }}</span>
          </div>
          <div class="status-item">
            <span class="status-value">{{ tools.length }}</span>
            <span class="status-label">工具</span>
          </div>
          <div class="status-item">
            <span class="status-value">{{ mcpServers.length }}</span>
            <span class="status-label">已配置 MCP 服务</span>
          </div>
          <div class="status-item">
            <span class="status-value">{{ customTools.length }}</span>
            <span class="status-label">自定义工具</span>
          </div>
        </div>
      </div>

      <!-- 自定义工具 / 扩展 -->
      <div class="section" v-if="activeTab === 'tools' && customTools.length">
        <h3>自定义工具 ({{ customTools.length }})</h3>
        <div class="ext-list">
          <div v-for="t in customTools" :key="t.name" class="ext-card">
            <div class="ext-header">
              <span class="ext-name">{{ t.label || t.name }}</span>
              <span class="ext-source">{{ t.category }}</span>
            </div>
            <div v-if="t.description" class="ext-desc">{{ t.description }}</div>
          </div>
        </div>
      </div>

      <!-- 内置工具 -->
      <div class="section" v-if="activeTab === 'tools' && builtinTools.length">
        <h3>内置工具 ({{ builtinTools.length }})</h3>
        <div class="tool-grid">
          <div v-for="t in builtinTools" :key="t.name" class="tool-chip" :title="t.description">
            {{ t.label || t.name }}
          </div>
        </div>
      </div>

      <!-- MCP 服务器 -->
      <!-- Skills（SKILLS-UI-001：sidecar get_discovered_skills 此前无 UI） -->
      <div class="section" v-if="activeTab === 'skills'">
        <div class="skill-market">
          <div class="skill-market-heading"><div><h3>SkillHub 技能市场</h3><p>搜索并安装社区共享的 Agent Skills</p></div><a href="https://skillhub.cn" target="_blank" rel="noreferrer">打开市场 ↗</a></div>
          <div class="skill-market-search"><input v-model="skillQuery" placeholder="搜索中文或英文技能" @keydown.enter="searchSkillMarket"><button class="btn" :disabled="skillMarketLoading" @click="searchSkillMarket">{{ skillMarketLoading ? '搜索中…' : '搜索' }}</button></div>
          <p v-if="skillMarketError" class="skill-market-error">{{ skillMarketError }}</p>
          <div v-else-if="skillMarketLoading" class="loading">正在搜索 SkillHub…</div>
          <div v-else class="skill-market-results">
            <article v-for="item in marketSkills" :key="item.slug" class="skill-market-card">
              <div class="skill-market-card-title"><strong>{{ item.name || item.slug }}</strong><span>{{ item.source === 'official' ? '官方' : '社区' }}</span></div>
              <p>{{ item.description_zh || item.description || '暂无简介' }}</p>
              <div class="skill-market-meta"><span>{{ item.ownerName || 'SkillHub' }}</span><span>↓ {{ Number(item.downloads || 0).toLocaleString() }}</span><span>★ {{ Number(item.stars || 0).toLocaleString() }}</span></div>
              <button class="btn skill-market-install" :disabled="installingSkill === item.slug || installedSkillNames.has(item.slug)" @click="installSkill(item)">{{ installedSkillNames.has(item.slug) ? '已安装' : installingSkill === item.slug ? '安装中…' : '下载并安装' }}</button>
            </article>
            <div v-if="marketSkills.length === 0" class="empty compact-empty"><div class="empty-desc">输入关键词搜索 SkillHub 中的技能。</div></div>
            <div v-if="marketTotal > marketPageSize" class="marketplace-pagination">
              <button class="btn" :disabled="marketPage <= 1 || skillMarketLoading" @click="changeSkillMarketPage(-1)">上一页</button>
              <span>第 {{ marketPage }} 页，共 {{ Math.ceil(marketTotal / marketPageSize) }} 页</span>
              <button class="btn" :disabled="marketPage * marketPageSize >= marketTotal || skillMarketLoading" @click="changeSkillMarketPage(1)">下一页</button>
            </div>
          </div>
        </div>
        <h3>已发现的 Skills ({{ skills.length }})</h3>
        <div class="ext-list">
          <div v-for="sk in skills" :key="sk.name" class="ext-card">
            <div class="ext-header">
              <span class="ext-name">{{ sk.name }}</span>
              <span class="ext-source" :class="sk.source === 'auto' ? 'source-warn' : 'source-ok'">{{ sk.source }}</span>
            </div>
            <div v-if="sk.description" class="ext-desc">{{ sk.description }}</div>
          </div>
        </div>
        <div v-if="skills.length === 0" class="empty compact-empty">
          <div class="empty-title">未发现 Skills</div>
          <div class="empty-desc">Pi 会从当前配置的技能目录自动加载可用技能。</div>
        </div>
      </div>

      <!-- 空状态 -->
      <!-- UX-EXTENSION-EMPTY-001：空态纳入全部数据源——此前只检查 customTools/
           mcpServers，只有内置工具/Skills 时误报"暂未发现扩展" -->
      <div v-if="activeTab === 'tools' && !builtinTools.length && !customTools.length" class="empty">
        <div class="empty-icon">🧩</div>
        <div class="empty-title">暂无可用工具</div>
      </div>

      <div class="section refresh-row">
        <button class="btn" :disabled="loading" @click="loadAll">
          {{ loading ? '刷新中…' : '⟳ 刷新' }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/api'
import { useViewEntrance } from '@/composables/useViewEntrance'
import { useButtonFx } from '@/composables/useButtonFx'
import McpView from '@/views/McpView.vue'

interface ToolInfo {
  name: string
  label?: string
  description?: string
  category?: string
  builtin?: boolean
}

interface McpServerInfo {
  id?: string
  name?: string
  status?: string
  tool_count?: number
}

interface CapabilitiesData {
  tools?: ToolInfo[]
  mcp_servers?: McpServerInfo[]
  system?: { sidecar_available?: boolean; session_count?: number }
}

const loading = ref(true)
const error = ref('')
const route = useRoute()
const router = useRouter()
const validTabs = ['tools', 'skills', 'mcp'] as const
type ExtensionTab = typeof validTabs[number]
const activeTab = ref<ExtensionTab>(validTabs.includes(route.query.tab as ExtensionTab) ? route.query.tab as ExtensionTab : 'tools')
const tools = ref<ToolInfo[]>([])
const mcpServers = ref<McpServerInfo[]>([])
const skills = ref<{ name: string; description: string; source: string; base_dir?: string; file_path?: string }[]>([])
interface MarketSkill { slug: string; name?: string; description?: string; description_zh?: string; source?: string; ownerName?: string; downloads?: number; stars?: number }
const skillQuery = ref('')
const marketPage = ref(1)
const marketTotal = ref(0)
const marketPageSize = 12
const marketSkills = ref<MarketSkill[]>([])
const skillMarketLoading = ref(false)
const skillMarketError = ref('')
const installingSkill = ref('')
const installedSkillNames = computed(() => new Set(skills.value.flatMap(skill => [skill.name, skill.base_dir?.split(/[\\/]/).filter(Boolean).pop(), skill.file_path?.split(/[\\/]/).slice(-2, -1)[0]].filter((name): name is string => Boolean(name)))))
const systemStatus = ref<{ sidecar_available: boolean }>({ sidecar_available: false })

const rootEl = ref<HTMLElement | null>(null)
useViewEntrance(() => rootEl.value, { header: '.header', blocks: '.section', ready: () => !loading.value })

// 重试按钮 hover 弹性放大（error 态挂载后由 watchSources 补绑定）
useButtonFx(() => rootEl.value, '.btn', { watchSources: [error] })

// builtin !== false: includes builtin:true AND absent/undefined (which defaults to builtin)
const builtinTools = computed(() => tools.value.filter(t => t.builtin !== false))
// only tools with explicit builtin:false are custom
const customTools = computed(() => tools.value.filter(t => t.builtin === false))

watch(() => route.query.tab, (value) => {
  if (typeof value === 'string' && validTabs.includes(value as ExtensionTab)) activeTab.value = value as ExtensionTab
  else if (value === undefined) activeTab.value = 'tools'
})

function setTab(tab: ExtensionTab) {
  activeTab.value = tab
  void router.replace({ query: tab === 'tools' ? {} : { tab } })
}


async function searchSkillMarket() {
  marketPage.value = 1
  await loadSkillMarketPage()
}

async function loadSkillMarketPage() {
  skillMarketLoading.value = true
  skillMarketError.value = ''
  try {
    const query = new URLSearchParams({ page_size: String(marketPageSize), page: String(marketPage.value) })
    if (skillQuery.value.trim()) query.set('q', skillQuery.value.trim())
    const result = await api.request('/skills/market?' + query.toString()) as { skills: MarketSkill[]; total: number }
    marketSkills.value = result.skills || []
    marketTotal.value = result.total || 0
  } catch (e) {
    skillMarketError.value = e instanceof Error ? e.message : String(e)
  } finally { skillMarketLoading.value = false }
}

function changeSkillMarketPage(delta: number) {
  marketPage.value = Math.max(1, marketPage.value + delta)
  void loadSkillMarketPage()
}

async function installSkill(skill: MarketSkill) {
  installingSkill.value = skill.slug
  try {
    await api.request('/skills/market/install', { method: 'POST', body: JSON.stringify({ slug: skill.slug }) })
    await load()
  } catch (e) {
    skillMarketError.value = e instanceof Error ? e.message : String(e)
  } finally { installingSkill.value = '' }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const caps = await api.request<CapabilitiesData>('/capabilities')
    tools.value = caps.tools || []
    mcpServers.value = caps.mcp_servers || []
    systemStatus.value = { sidecar_available: caps.system?.sidecar_available ?? false }
    // SKILLS-UI-001：自动发现 Skills（sidecar 未就绪时为空，不阻塞页面）
    try {
      skills.value = await api.request<{ name: string; description: string; source: string }[]>('/skills/discovered')
    } catch {
      skills.value = []
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

// UX-EXTENSION-REFRESH-001：手动刷新入口
function loadAll() {
  void load()
}

onMounted(() => { void load(); void searchSkillMarket() })
</script>

<style scoped>
.skill-market { margin: 0 0 24px; padding: 18px; border: 1px solid var(--border); border-radius: 14px; background: var(--bg-secondary); }
.skill-market-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.skill-market-heading h3 { margin: 0; font-size: 1rem; }
.skill-market-heading p { margin: 4px 0 0; color: var(--text-tertiary); font-size: .82rem; }
.skill-market-heading a { color: var(--accent); font-size: .82rem; text-decoration: none; }
.skill-market-search { display: flex; gap: 8px; margin: 14px 0; }
.skill-market-search input { flex: 1; min-width: 0; padding: 9px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-primary); color: var(--text-primary); }
.skill-market-results { display: grid; grid-template-columns: repeat(auto-fill,minmax(220px,1fr)); gap: 10px; }
.skill-market-card { min-width: 0; padding: 13px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-primary); }
.skill-market-card-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.skill-market-card-title span { flex: none; color: var(--text-tertiary); font-size: .72rem; }
.skill-market-card p { min-height: 3.4em; margin: 8px 0; color: var(--text-secondary); font-size: .8rem; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.skill-market-meta { display: flex; gap: 10px; color: var(--text-tertiary); font-size: .72rem; }
.skill-market-install { width: 100%; margin-top: 10px; }
.skill-market-error { color: var(--danger, #c44); font-size: .84rem; }
.skill-market .marketplace-pagination { grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; gap: 12px; padding-top: 4px; color: var(--text-tertiary); font-size: .82rem; }
.ext-view { flex: 1; min-height: 0; overflow-y: auto; max-width: 800px; width: 100%; margin: 0 auto; padding: 24px 16px 80px; }
.header { margin-bottom: 16px; }
.header h2 { font-size: var(--fs-display-lg); font-weight: 600; font-family: var(--font-display); letter-spacing: -0.01em; margin: 0; }
.header-sub { font-size: 0.82em; color: var(--text-tertiary); margin: 4px 0 0; }
.extension-tabs { display: flex; gap: 4px; margin: 0 0 16px; padding: 4px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-secondary); }
.extension-tabs button { flex: 1; min-height: 38px; border: 0; border-radius: 6px; background: transparent; color: var(--text-secondary); font: inherit; cursor: pointer; }
.extension-tabs button.active { background: var(--bg-card); color: var(--text-primary); box-shadow: 0 1px 3px color-mix(in srgb, var(--text-primary) 12%, transparent); }
.compact-empty { padding: 22px; }
.loading, .empty { text-align: center; padding: 40px; color: var(--text-tertiary); }
.extension-loading { padding: 12px 0 28px; }
.extension-skeleton-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.extension-skeleton-card { display: grid; gap: 9px; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-card); }
.extension-skeleton-card span { display: block; height: 10px; border-radius: 999px; background: linear-gradient(90deg, var(--bg-secondary) 25%, color-mix(in srgb, var(--accent) 10%, var(--bg-secondary)) 50%, var(--bg-secondary) 75%); background-size: 240% 100%; animation: extension-skeleton-shimmer 1.35s ease-in-out infinite; }
.extension-skeleton-card span:nth-child(2) { width: 78%; }
.extension-skeleton-card span:nth-child(3) { width: 46%; }
.extension-error { border: 1px solid color-mix(in srgb, var(--status-warn) 35%, var(--border)); border-radius: var(--radius); background: color-mix(in srgb, var(--status-warn) 5%, transparent); }
@keyframes extension-skeleton-shimmer { 0% { background-position: 160% 0; } 100% { background-position: -80% 0; } }
@media (max-width: 520px) { .extension-skeleton-grid { grid-template-columns: 1fr; } }
.empty-icon { font-size: 2em; margin-bottom: 8px; }
.empty-title { font-size: 1em; font-weight: 600; margin-bottom: 4px; }
.empty-desc { font-size: 0.85em; line-height: 1.6; }

.section {
  margin-bottom: 20px; background: var(--bg-card); border-radius: var(--radius);
  padding: 16px; border: 1px solid var(--border);
}
.section h3 { font-size: 1em; font-weight: 600; margin: 0 0 12px; color: var(--text-primary); }

.status-section { padding: 14px 16px; }
.status-grid { display: flex; gap: 24px; flex-wrap: wrap; }
.status-item { display: flex; align-items: center; gap: 6px; font-size: 0.85em; color: var(--text-secondary); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; }
.status-dot.online { background: var(--status-ok); }
.status-dot.offline { background: var(--status-error); }
.status-value { font-weight: 700; font-size: 1.1em; color: var(--text-primary); }
.status-label { font-size: 0.85em; color: var(--text-tertiary); }

.ext-list { display: flex; flex-direction: column; gap: 6px; }
.ext-card { padding: 10px 12px; background: var(--bg-secondary); border-radius: 6px; }
.ext-header { display: flex; align-items: center; gap: 8px; }
.ext-name { font-weight: 600; font-size: 0.9em; color: var(--text-primary); }
.ext-source { font-size: 0.75em; padding: 2px 6px; border-radius: 4px; background: var(--bg-card); color: var(--text-tertiary); }
.source-ok { color: var(--status-ok); }
.source-warn { color: var(--status-warn); }
.ext-desc { font-size: 0.82em; color: var(--text-secondary); margin-top: 4px; line-height: 1.5; }

.tool-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.tool-chip {
  font-size: 0.78em; padding: 4px 10px; border-radius: 4px;
  background: var(--bg-secondary); color: var(--text-secondary);
  cursor: default;
}

.quick-links { display: flex; flex-direction: column; gap: 8px; }
.quick-link { font-size: 0.85em; color: var(--accent); text-decoration: none; }
.quick-link:hover { text-decoration: underline; }
.btn { padding: 6px 16px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-secondary); cursor: pointer; font-size: 0.85em; margin-top: 8px; }
</style>
