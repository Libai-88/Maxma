<template>
  <div class="blocker-view ds-view" ref="rootEl">
    <!-- ── 列表 ── -->
    <template v-if="!showForm">
      <div class="header view-header view-header--split">
        <h2>拒止锚 <span class="subtitle">MaxmaBlocker</span></h2>
        <div class="view-header__actions">
          <button class="btn btn-primary" @click="startAdd">添加</button>
        </div>
      </div>

      <details class="intro-card" open>
        <summary>什么是拒止锚？什么时候需要用到？</summary>
        <div class="intro-body">
          <p>拒止锚（MaxmaBlocker）是 Maxma 的<strong>执行阻断标记</strong>——在某个目录中放置一个名为 <code>.maxma_blocker</code> 的标记文件后，AI 的文件类工具调用一旦指向该目录及其子目录，<strong>会在执行开始前被拦下</strong>，拒绝原因会回给模型。</p>
          <p>可以把它理解为 AI 的"禁区铁门"：会话权限模式决定"要不要先问你"，拒止锚决定"问了也不放行"——即使会话切到 <code>auto</code>（不再弹确认），拒止锚照样拦截。</p>
          <p><strong>典型使用场景</strong>：</p>
          <ul>
            <li>🔒 <strong>含敏感信息的财务 / 证件目录</strong>——银行流水、身份证扫描件、合同等，即使模型拿到了文件工具的批准也读不到。</li>
            <li>📔 <strong>私人日记 / 心理咨询笔记目录</strong>——属于绝对隐私，不应被 AI 工具触碰。</li>
            <li>🔑 <strong>密钥 / 凭证目录</strong>——<code>.ssh</code>、<code>.aws</code>、GPG 密钥等，避免任何 AI 误读。</li>
            <li>🧪 <strong>正在实验 / 不稳定的项目目录</strong>——避免 AI 误改或误读未完成的代码。</li>
          </ul>
          <p class="intro-note">📋 拒止锚划定"绝对不能碰哪里"；除此之外没有预先放行清单——一次文件操作能不能落地，取决于会话权限模式（默认「每次确认」）。</p>
        </div>
      </details>

      <details class="rule-card">
        <summary class="rule-summary">规则说明</summary>
        <div class="rule-body">
          <p>拒止锚是无条件生效的强制机制，任何会话权限模式都不得绕过：</p>
          <ul>
            <li>在指定目录中创建 <code>.maxma_blocker</code> 标记文件（无扩展名），AI 的文件类工具调用指向该目录或其子目录时，会在执行前被拦下。</li>
            <li>检查时会从目标路径逐级向上查找，一旦发现任何父目录包含 <code>.maxma_blocker</code> 文件即强制阻断。</li>
            <li>拦截只终止这一次工具调用并把原因回给模型，整轮对话不中断；模型可自行改道，其余操作照常。</li>
            <li>附件上传与路径检查（<code>check-path-blocked</code>）同样会标记被阻断的路径；路径含 NUL 字节或无法解析时按"存在拒止锚"处理（fail-closed）。</li>
          </ul>
          <p class="rule-note">除拒止锚外，文件访问的约束只剩会话权限模式的逐次确认（会话默认「每次确认」）；<code>auto</code> 档不弹确认，此时拒止锚是仅存的文件拦截层。</p>
        </div>
      </details>

      <div v-if="loading" class="loading ds-state">加载中...</div>
      <div v-else-if="entries.length === 0" class="empty-state ds-state">
        <div class="empty-icon ds-state__icon"><Icon name="blocker" :size="24" /></div>
        <h3 class="ds-state__title">还没有任何拒止锚</h3>
        <p class="empty-desc ds-state__desc">当前没有放置任何拒止锚，AI 的文件操作只受会话权限模式的逐次确认约束（会话默认「每次确认」，<code>auto</code> 档不弹确认）。如果有不希望 AI 触及的敏感目录（财务 / 私人笔记 / 密钥），点击下方添加拒止锚，将目录强制阻断。</p>
        <div class="ds-state__actions">
          <button class="btn btn-primary" @click="startAdd">+ 添加拒止锚</button>
        </div>
      </div>
      <div v-else class="entry-list">
        <div v-for="(entry, i) in entries" :key="i" class="entry-card">
          <div class="entry-body">
            <div class="entry-path">{{ entry.path }}</div>
            <div v-if="entry.description" class="entry-desc">{{ entry.description }}</div>
          </div>
          <button class="btn btn-danger" @click="confirmDelete(i)">删除</button>
        </div>
      </div>
    </template>

    <!-- ── 添加表单 ── -->
    <template v-else>
      <div class="header view-header">
        <h2>添加拒止锚</h2>
      </div>
      <div class="form-card">
        <div class="form-section">
          <label class="form-label">目录</label>
          <div class="path-row">
            <input
              v-model="formPath"
              class="input mono"
              placeholder="输入或选择目录路径"
            />
            <button class="btn" @click="pickDir">选择目录</button>
          </div>
        </div>
        <div class="form-section">
          <label class="form-label">描述（可选）</label>
          <input
            v-model="formDesc"
            class="input"
            placeholder="用途说明"
          />
        </div>
        <div v-if="formError" class="msg error">{{ formError }}</div>
        <div class="form-actions">
          <button class="btn" @click="cancelForm">取消</button>
          <button class="btn btn-primary" :disabled="saving || !formPath.trim()" @click="handleSave">
            {{ saving ? '创建中...' : '创建拒止锚' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { api } from '@/api'
import Icon from '@/components/Icon.vue'
import type { BlockerEntry } from '@/types'
import { confirmAction } from '@/composables/useConfirm'
import { ref, onMounted } from 'vue'
import { createLogger } from '@/utils/logger'
import { useViewEntrance } from '@/composables/useViewEntrance'
import { useButtonFx } from '@/composables/useButtonFx'

const log = createLogger('MaxmaBlockerView')

const showForm = ref(false)
const entries = ref<BlockerEntry[]>([])
const loading = ref(true)
const saving = ref(false)
const formError = ref('')
const formPath = ref('')
const formDesc = ref('')

const rootEl = ref<HTMLElement | null>(null)
useViewEntrance(() => rootEl.value, { header: '.header', blocks: '.intro-card, .rule-card, .entry-card', ready: () => !loading.value })

// 按钮交互动效：主操作磁吸；常规弹性；危险（解除拒止/删除）hover 左倾抖动
useButtonFx(() => rootEl.value, '.btn-primary', { magnetic: 10, watchSources: [showForm, entries] })
useButtonFx(() => rootEl.value, '.btn:not(.btn-primary):not(.btn-danger)', { watchSources: [showForm] })
useButtonFx(() => rootEl.value, '.btn-danger', { danger: true, watchSources: [entries] })

async function loadEntries() {
  loading.value = true
  try {
    const res = await api.listBlockers()
    entries.value = res.entries
    } catch (e: unknown) {
      log.error('加载拒止锚失败', e)
  } finally {
    loading.value = false
  }
}

function startAdd() {
  formPath.value = ''
  formDesc.value = ''
  formError.value = ''
  showForm.value = true
}

function cancelForm() {
  showForm.value = false
}

async function pickDir() {
  try {
    const res = await api.selectFolder()
    if (res.path) {
      formPath.value = res.path
      formError.value = ''
    }
  } catch {
    formError.value = '选择目录失败'
  }
}

async function handleSave() {
  if (!formPath.value.trim()) return
  saving.value = true
  formError.value = ''
  try {
    await api.addBlocker({ path: formPath.value.trim(), description: formDesc.value.trim() })
    await loadEntries()
    showForm.value = false
  } catch (e: unknown) {
    formError.value = e instanceof Error ? e.message : '创建失败'
  } finally {
    saving.value = false
  }
}

async function confirmDelete(i: number) {
  if (!await confirmAction({
    title: '解除拒止',
    message: `确定解除对此目录的拒止？\n${entries.value[i].path}\n\nMaxmaBlocker 标记文件将被删除。`,
    confirmText: '解除',
    danger: true,
  })) return
  try {
    await api.deleteBlocker(i)
    entries.value.splice(i, 1)
  } catch (e: unknown) {
    log.error('删除失败', e)
  }
}

onMounted(loadEntries)
</script>

<style scoped>
.blocker-view {
  flex: 1;
  overflow-y: auto;
}
.subtitle {
  font-weight: 400;
  font-size: 14px;
  color: var(--text-tertiary);
  margin-left: var(--space-4);
}

/* ── Novice 引导卡片 ── */
.intro-card {
  margin-bottom: var(--section-gap);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--status-error) 5%, var(--bg-card));
  border-color: color-mix(in srgb, var(--status-error) 25%, var(--border));
  overflow: hidden;
}
.intro-card > summary {
  padding: var(--space-12) var(--space-16);
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
  list-style: none;
}
.intro-card > summary::-webkit-details-marker { display: none; }
.intro-card > summary::before {
  content: '▸';
  display: inline-block;
  margin-right: var(--space-8);
  color: var(--text-tertiary);
  transition: transform 0.15s;
}
.intro-card[open] > summary::before { transform: rotate(90deg); }
.intro-body {
  padding: 0 var(--space-16) var(--space-12);
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.75;
}
.intro-body p { margin: var(--space-6) 0; }
.intro-body strong { color: var(--text-primary); }
.intro-body ul { margin: var(--space-6) 0; padding-left: var(--space-24); }
.intro-body li { margin-bottom: var(--space-4); }
.intro-body code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--bg-secondary);
  padding: var(--space-2) var(--space-6);
  border-radius: var(--radius-sm);
}
.intro-note {
  margin-top: var(--space-12) !important;
  padding: var(--space-8) var(--space-12);
  background: var(--bg-secondary);
  border-left: 3px solid var(--accent);
  border-radius: 0 var(--radius-input) var(--radius-input) 0;
  font-size: 12.5px;
}

/* ── 空状态 ── */
.empty-state {
  border: 1.5px dashed var(--border);
  border-radius: var(--radius-lg);
}
.empty-icon { font-size: 42px; margin-bottom: var(--space-12); }
.empty-state h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 var(--space-8);
}
.empty-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin: 0 auto var(--space-16);
  max-width: 440px;
}

/* ── 规则说明 ── */
.rule-card {
  margin-bottom: var(--section-gap);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  overflow: hidden;
}
.rule-summary {
  padding: var(--space-12) var(--space-16);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  transition: border-color var(--duration-fast) var(--ease-out);
}
.rule-summary:hover {
  border-color: var(--border-strong, color-mix(in srgb, var(--accent) 30%, var(--border)));
}
.rule-body {
  padding: 0 var(--space-16) var(--space-12);
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
}
.rule-body ul {
  margin: var(--space-6) 0;
  padding-left: var(--space-24);
}
.rule-body li {
  margin-bottom: var(--space-4);
}
.rule-body code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--bg-secondary);
  padding: var(--space-2) var(--space-6);
  border-radius: var(--radius-sm);
}
.rule-note {
  margin-top: var(--space-8);
  padding: var(--space-8) var(--space-12);
  background: color-mix(in srgb, var(--status-info) 12%, var(--bg-card));
  border-radius: var(--radius-input);
	  color: var(--text-secondary);
	  font-size: 12px;
	}
	.rule-note code {
	  font-family: var(--font-mono);
	  font-size: 12px;
	  background: color-mix(in srgb, var(--status-info) 20%, var(--bg-secondary));
  padding: var(--space-2) var(--space-6);
  border-radius: var(--radius-sm);
	}

.entry-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}
.entry-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-16);
  padding: var(--card-padding);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  transition: box-shadow 0.15s;
}
.entry-card:hover {
  box-shadow: var(--shadow-sm);
}
.entry-body {
  flex: 1;
  min-width: 0;
}
.entry-path {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-all;
  line-height: 1.4;
}
.entry-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: var(--space-2);
}

/* ── 表单 ── */
.form-card {
  max-width: var(--view-max-width-narrow);
  display: flex;
  flex-direction: column;
  gap: var(--section-gap);
}
.form-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.form-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.path-row {
  display: flex;
  gap: var(--space-8);
}
.path-row .input {
  flex: 1;
}
.input {
  padding: var(--space-8) var(--space-12);
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
  font-size: 14px;
  color: var(--text-primary);
  background: var(--bg-card);
  outline: none;
  transition: border-color 0.15s;
}
.input:focus {
  border-color: var(--accent);
}
.input.mono {
  font-family: var(--font-mono);
  font-size: 13px;
}
.form-actions {
  display: flex;
  gap: var(--space-8);
}
.msg {
  padding: var(--space-8) var(--space-12);
  border-radius: var(--radius-input);
  font-size: 13px;
}
.msg.error {
	  background: color-mix(in srgb, var(--status-error) 12%, var(--bg-card));
	  color: var(--status-error-text);
	}

/* ── 按钮 ── */
.btn {
  padding: var(--space-6) var(--space-12);
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  transition: border-color var(--duration-fast) var(--ease-out);
  white-space: nowrap;
}
.btn:hover { border-color: var(--border-strong, color-mix(in srgb, var(--accent) 30%, var(--border))); }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
.btn-danger {
  color: var(--status-error-text);
  border-color: var(--status-error);
}
</style>
