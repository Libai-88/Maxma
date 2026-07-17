<template>
  <div class="kb-view">
    <!-- ── 标题栏 ── -->
    <div class="header">
      <h2>知识库 Knowledge Base</h2>
      <div class="header-actions">
        <button class="btn" :disabled="store.uploading" @click="triggerFilePick">
          <Icon name="file" :size="14" /> 上传文件
        </button>
        <button class="btn" :disabled="store.uploading" @click="openTextModal">添加文本</button>
        <button class="btn" :disabled="store.uploading" @click="openUrlModal">导入 URL</button>
        <button class="btn" :disabled="store.loadingDocs" @click="store.fetchDocuments">刷新</button>
      </div>
      <input
        ref="fileInputRef"
        type="file"
        class="hidden-input"
        accept=".txt,.md,.markdown,.pdf,.docx,.csv,.json"
        @change="onFilePicked"
      />
    </div>

    <!-- ── 上传拖拽区 ── -->
    <div
      class="drop-zone"
      :class="{ active: isDragging, busy: store.uploading }"
      @click="triggerFilePick"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="onDrop"
    >
      <Icon name="attach" :size="20" />
      <div class="drop-text">
        <strong>点击选择文件或拖拽到此处上传</strong>
        <div class="drop-hint">支持 txt / md / pdf / docx / csv / json</div>
      </div>
      <span v-if="store.uploading" class="drop-busy">上传中...</span>
    </div>

    <!-- ── 错误提示（带关闭按钮） ── -->
    <div v-if="store.error" class="msg error">
      {{ store.error }}
      <button class="msg-close" @click="store.error = ''">✕</button>
    </div>

    <!-- ── 搜索栏 ── -->
    <div class="search-bar">
      <input
        v-model="searchInput"
        class="ds-input search-input"
        placeholder="搜索知识库…"
        @keyup.enter="runSearch"
      />
      <button class="btn primary" :disabled="store.searching" @click="runSearch">
        {{ store.searching ? '搜索中...' : '搜索' }}
      </button>
      <button v-if="store.searchResults.length || store.searchQuery" class="btn" @click="clearSearch">清除</button>
    </div>

    <!-- ── 搜索结果 ── -->
    <section v-if="store.searchQuery" class="search-results">
      <div class="section-title">
        搜索结果（{{ store.searchResults.length }}）
        <span class="section-hint">query: "{{ store.searchQuery }}"</span>
      </div>
      <div v-if="store.searching" class="loading">搜索中...</div>
      <div v-else-if="store.searchResults.length === 0" class="empty">无匹配结果。</div>
      <div v-else class="result-list">
        <div v-for="r in store.searchResults" :key="r.chunk_id" class="result-card">
          <div class="result-header">
            <span class="result-source" :title="r.source_path">{{ r.source_filename || r.source_doc_id }}</span>
            <span class="result-score" :class="scoreClass(r.score_percent)">
              {{ formatScore(r.score_percent) }}%
            </span>
          </div>
          <div class="result-text">{{ r.text }}</div>
        </div>
      </div>
    </section>

    <!-- ── 文档列表 ── -->
    <section class="doc-section">
      <div class="section-title">
        已索引文档（{{ store.documents.length }}）
      </div>
      <div v-if="store.loadingDocs" class="loading">加载中...</div>
      <div v-else-if="store.documents.length === 0" class="empty">
        知识库为空。上传文件、添加文本或导入 URL 以开始。
      </div>
      <div v-else class="doc-table">
        <div class="doc-row doc-head">
          <div class="col-name">文件名 / 来源</div>
          <div class="col-type">类型</div>
          <div class="col-size">大小</div>
          <div class="col-chunks">切块</div>
          <div class="col-created">创建时间</div>
          <div class="col-actions">操作</div>
        </div>
        <div v-for="d in store.documents" :key="d.doc_id" class="doc-row">
          <div class="col-name">
            <div class="name-primary" :title="d.filename">{{ d.filename || d.doc_id }}</div>
            <div class="name-secondary" :title="d.source">{{ d.source || d.doc_id }}</div>
          </div>
          <div class="col-type">
            <span class="type-badge">{{ d.file_type || '-' }}</span>
          </div>
          <div class="col-size">{{ formatSize(d.size) }}</div>
          <div class="col-chunks">
            <span class="chunk-count">{{ d.indexed_chunk_count }}/{{ d.chunk_count }}</span>
          </div>
          <div class="col-created" :title="d.created_at">{{ formatDate(d.created_at) }}</div>
          <div class="col-actions">
            <button
              class="action-btn danger"
              :disabled="store.uploading || deletingDocId === d.doc_id"
              @click="onDelete(d)"
            >
              {{ deletingDocId === d.doc_id ? '删除中...' : '删除' }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ── 添加文本模态 ── -->
    <Transition name="fade">
      <div v-if="showTextModal" class="ds-modal-overlay" @click.self="closeTextModal">
        <div class="ds-modal kb-modal">
          <h3 class="ds-modal__title">添加文本到知识库</h3>
          <div class="form-section">
            <label class="form-label">文档 ID (doc_id) *</label>
            <input v-model="textForm.doc_id" class="ds-input ds-input--mono" placeholder="例如: my-notes-001" />
          </div>
          <div class="form-section">
            <label class="form-label">文件名（可选）</label>
            <input v-model="textForm.filename" class="ds-input" placeholder="例如: notes.txt" />
          </div>
          <div class="form-section">
            <label class="form-label">来源（可选）</label>
            <input v-model="textForm.source" class="ds-input" placeholder="例如: manual-input" />
          </div>
          <div class="form-section">
            <label class="form-label">内容 *</label>
            <textarea
              v-model="textForm.content"
              class="content-editor"
              rows="10"
              placeholder="粘贴或输入要索引的文本…"
            ></textarea>
          </div>
          <div v-if="modalError" class="msg error">{{ modalError }}</div>
          <div class="ds-modal__actions">
            <button class="btn" :disabled="store.uploading" @click="closeTextModal">取消</button>
            <button class="btn primary" :disabled="store.uploading || !canSubmitText" @click="submitText">
              {{ store.uploading ? '索引中...' : '索引' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── 导入 URL 模态 ── -->
    <Transition name="fade">
      <div v-if="showUrlModal" class="ds-modal-overlay" @click.self="closeUrlModal">
        <div class="ds-modal kb-modal">
          <h3 class="ds-modal__title">从 URL 导入</h3>
          <div class="form-section">
            <label class="form-label">URL *</label>
            <input
              v-model="urlForm.url"
              class="ds-input ds-input--mono"
              placeholder="https://example.com/article"
            />
          </div>
          <div class="form-section">
            <label class="form-label">文档 ID（可选）</label>
            <input v-model="urlForm.doc_id" class="ds-input ds-input--mono" placeholder="留空则自动生成" />
          </div>
          <div class="form-hint">
            将使用 Tavily Extract 提取页面 Markdown 后索引。需要后端已配置 Tavily。
          </div>
          <div v-if="modalError" class="msg error">{{ modalError }}</div>
          <div class="ds-modal__actions">
            <button class="btn" :disabled="store.uploading" @click="closeUrlModal">取消</button>
            <button class="btn primary" :disabled="store.uploading || !urlForm.url.trim()" @click="submitUrl">
              {{ store.uploading ? '导入中...' : '导入' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive } from 'vue'
import Icon from '@/components/Icon.vue'
import { useKbStore } from '@/stores/kb'
import type { KbDocument } from '@/types'

const store = useKbStore()

// ── setTimeout 统一清理 ──
const timers: number[] = []
function schedule(fn: () => void, delay: number) {
  const id = window.setTimeout(fn, delay)
  timers.push(id)
}
onUnmounted(() => {
  while (timers.length) {
    window.clearTimeout(timers.pop())
  }
})

// ── 文件上传 ──
const fileInputRef = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)

function triggerFilePick() {
  if (store.uploading) return
  fileInputRef.value?.click()
}

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) handleUpload(file)
  input.value = ''
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) handleUpload(file)
}

async function handleUpload(file: File) {
  try {
    await store.uploadDocument(file)
  } catch (e: any) {
    console.error('upload failed', e)
  }
}

// ── 文档删除（防抖） ──
const deletingDocId = ref('')
async function onDelete(d: KbDocument) {
  if (deletingDocId.value) return  // 防抖
  if (!confirm(`确定删除文档「${d.filename || d.doc_id}」？此操作将一并删除其所有切块，且不可恢复。`)) return
  deletingDocId.value = d.doc_id
  try {
    await store.deleteDocument(d.doc_id)
  } catch (e: any) {
    console.error('delete failed', e)
  } finally {
    deletingDocId.value = ''
  }
}

// ── 搜索（竞态保护） ──
const searchInput = ref('')
let searchSeq = 0

async function runSearch() {
  const q = searchInput.value.trim()
  if (!q) return
  const mySeq = ++searchSeq
  try {
    await store.searchKb(q)
    // 竞态保护：丢弃过期响应
    if (mySeq !== searchSeq) return
  } catch (e: any) {
    if (mySeq !== searchSeq) return
    console.error('search failed', e)
  }
}

function clearSearch() {
  searchSeq++  // 取消正在进行的搜索
  searchInput.value = ''
  store.clearSearch()
}

function scoreClass(score: number): string {
  if (score == null || isNaN(score)) return 'low'
  if (score >= 75) return 'high'
  if (score >= 50) return 'mid'
  return 'low'
}

function formatScore(score: number): string {
  if (score == null || isNaN(score)) return '0.0'
  return score.toFixed(1)
}

// ── 文本模态 ──
const showTextModal = ref(false)
const modalError = ref('')
const textForm = reactive({
  doc_id: '',
  filename: '',
  source: '',
  content: '',
})

const canSubmitText = computed(
  () => textForm.doc_id.trim() !== '' && textForm.content.trim() !== '',
)

function openTextModal() {
  if (store.uploading) return
  modalError.value = ''
  textForm.doc_id = ''
  textForm.filename = ''
  textForm.source = ''
  textForm.content = ''
  showTextModal.value = true
}

function closeTextModal() {
  showTextModal.value = false
  modalError.value = ''
}

async function submitText() {
  if (!canSubmitText.value) return
  modalError.value = ''
  try {
    await store.indexText({
      doc_id: textForm.doc_id.trim(),
      filename: textForm.filename.trim() || undefined,
      source: textForm.source.trim() || undefined,
      content: textForm.content,
    })
    closeTextModal()
  } catch (e: any) {
    modalError.value = e?.message || String(e)
  }
}

// ── URL 模态 ──
const showUrlModal = ref(false)
const urlForm = reactive({
  url: '',
  doc_id: '',
})

function openUrlModal() {
  if (store.uploading) return
  modalError.value = ''
  urlForm.url = ''
  urlForm.doc_id = ''
  showUrlModal.value = true
}

function closeUrlModal() {
  showUrlModal.value = false
  modalError.value = ''
}

async function submitUrl() {
  if (!urlForm.url.trim()) return
  modalError.value = ''
  try {
    await store.importUrl({
      url: urlForm.url.trim(),
      doc_id: urlForm.doc_id.trim() || undefined,
    })
    closeUrlModal()
  } catch (e: any) {
    modalError.value = e?.message || String(e)
  }
}

// ── 格式化辅助 ──
function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatDate(iso: string): string {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

onMounted(() => {
  store.fetchDocuments()
})
</script>

<style scoped>
.kb-view {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.header h2 {
  font-size: 20px;
  font-weight: 700;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.hidden-input {
  display: none;
}

/* ── 按钮 ── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 0.15s, border-color 0.15s, background 0.15s;
}
.btn:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--bg-secondary);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn.primary {
  background: var(--accent);
  color: var(--bg-primary);
  border-color: var(--accent);
}
.btn.primary:hover:not(:disabled) {
  opacity: 0.9;
}

/* ── 拖拽区 ── */
.drop-zone {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border: 1.5px dashed var(--border);
  border-radius: 12px;
  background: var(--bg-card);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.drop-zone:hover,
.drop-zone.active {
  border-color: var(--accent);
  color: var(--text-primary);
  background: var(--bg-secondary);
}
.drop-zone.busy {
  opacity: 0.6;
  cursor: progress;
}
.drop-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.drop-text strong {
  color: var(--text-primary);
  font-size: 14px;
}
.drop-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}
.drop-busy {
  margin-left: auto;
  font-size: 13px;
  color: var(--accent);
  font-weight: 600;
}

/* ── 消息 ── */
.msg {
  font-size: 13px;
  padding: 10px 14px;
  border-radius: 8px;
  line-height: 1.5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.msg.error {
  background: color-mix(in srgb, var(--status-error) 8%, var(--bg-card));
  color: var(--status-error);
}
.msg-close {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
  opacity: 0.6;
  flex-shrink: 0;
}
.msg-close:hover {
  opacity: 1;
}

/* ── 搜索 ── */
.search-bar {
  display: flex;
  gap: 8px;
  align-items: center;
}
.search-input {
  flex: 1;
}

/* ── 区块标题 ── */
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
}
.section-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 400;
}

/* ── 搜索结果 ── */
.search-results {
  display: flex;
  flex-direction: column;
}
.result-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.result-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  background: var(--bg-card);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.result-source {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.result-score {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 100px;
  flex-shrink: 0;
}
.result-score.high {
  background: color-mix(in srgb, var(--status-ok) 12%, var(--bg-card));
  color: var(--status-ok);
}
.result-score.mid {
  background: color-mix(in srgb, var(--status-warn) 12%, var(--bg-card));
  color: var(--status-warn);
}
.result-score.low {
  background: var(--bg-secondary);
  color: var(--text-tertiary);
}
.result-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}

/* ── 文档列表 ── */
.doc-section {
  display: flex;
  flex-direction: column;
}
.doc-table {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-card);
}
.doc-row {
  display: grid;
  grid-template-columns: 2fr 0.8fr 0.8fr 0.8fr 1.4fr 0.8fr;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.doc-row:last-child {
  border-bottom: none;
}
.doc-row:not(.doc-head):hover {
  background: var(--bg-secondary);
}
.doc-head {
  background: var(--bg-secondary);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.col-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.name-primary {
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.name-secondary {
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.col-type,
.col-size,
.col-chunks,
.col-created {
  color: var(--text-secondary);
}
.type-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 11px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}
.chunk-count {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
}
.col-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}
.action-btn {
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.action-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text-primary);
}
.action-btn.danger {
  color: var(--status-error);
}
.action-btn.danger:hover:not(:disabled) {
  border-color: var(--status-error);
  background: color-mix(in srgb, var(--status-error) 6%, var(--bg-card));
}
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.loading,
.empty {
  text-align: center;
  color: var(--text-secondary);
  padding: 32px 0;
  font-size: 13px;
}

/* ── 模态 ── */
.kb-modal {
  width: 560px;
  max-width: 92vw;
}
.form-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}
.form-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.form-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: -6px;
}
.content-editor {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.6;
  outline: none;
  resize: vertical;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  box-sizing: border-box;
}
.content-editor:focus {
  border-color: var(--accent);
}

/* ── 过渡 ── */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ── 响应式：窄屏堆叠 ── */
@media (max-width: 900px) {
  .doc-row {
    grid-template-columns: 1.6fr 0.6fr 0.6fr 0.6fr 1fr 0.7fr;
    font-size: 12px;
    gap: 8px;
    padding: 10px 12px;
  }
  .header h2 {
    font-size: 18px;
  }
}
</style>
