<template>
  <div class="canvas-container">
    <div v-if="cards.length === 0" class="canvas-empty">
      <span class="empty-icon">&#128204;</span>
      <p>画布为空</p>
      <p class="empty-hint">点击工具结果上的图钉按钮，将重要内容固定到画布</p>
    </div>
    <template v-else-if="canvasTabsEnabled">
      <CanvasTabs
        :tabs="workspaceTabs"
        :active-card-id="activeCard?.id ?? null"
        @select="workbench.selectCard"
        @toggle-pin="workbench.toggleCardPin"
        @close="removeCard"
      />
      <section v-if="activeCard" class="canvas-tab-panel" role="tabpanel">
        <!-- v-if ensures a large document is mounted only after its tab opens. -->
        <HtmlSandbox v-if="activeCard.type === 'html'" :html="activeCard.content" />
        <component
          v-else-if="getCardComponent(activeCard.type)"
          :is="getCardComponent(activeCard.type)!"
          :card="activeCard"
          @remove="removeCard(activeCard.id)"
          @artifact-action="$emit('artifact-action', $event)"
        />
        <div v-else class="canvas-card-fallback">未知卡片类型: {{ activeCard.type }}</div>
      </section>
    </template>
    <div v-else class="canvas-list">
      <div
        v-for="card in cards"
        :key="card.id"
        class="canvas-card-wrapper"
      >
        <component
          v-if="getCardComponent(card.type)"
          :is="getCardComponent(card.type)!"
          :card="card"
          @remove="$emit('remove', card.id)"
          @artifact-action="$emit('artifact-action', $event)"
        />
        <div v-else class="canvas-card-fallback">
          <span>未知卡片类型: {{ card.type }}</span>
          <button @click="$emit('remove', card.id)">&times;</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CanvasCard } from '@/types/workbench'
import { getCardComponent } from './canvas-registry'
import CanvasTabs from './CanvasTabs.vue'
import HtmlSandbox from '@/components/HtmlSandbox.vue'
import { useWorkbenchStore } from '@/stores/workbench'

const props = defineProps<{
  cards: CanvasCard[]
}>()

const emit = defineEmits<{
  remove: [id: string]
  'artifact-action': [payload: { artifactId: string; actionId: string; token: string }]
}>()

// The release stays opt-in until the desktop setting is exposed by the API.
// Keeping the legacy list below preserves the existing card entry point.
const canvasTabsEnabled = import.meta.env.VITE_CANVAS_TABS_ENABLED === 'true'
const workbench = useWorkbenchStore()
const workspaceTabs = computed(() => props.cards.map(card => ({
  id: `canvas-tab-${card.id}`,
  cardId: card.id,
  title: card.title,
  type: card.type,
  pinned: card.pinned === true,
  sourceTurnId: card.sourceTurnId,
})))
const activeCard = computed(() =>
  props.cards.find(card => card.id === workbench.activeCardId) ?? props.cards[0] ?? null,
)

function removeCard(id: string) {
  emit('remove', id)
}
</script>

<style scoped>
.canvas-container {
  min-height: 100%;
}

.canvas-empty {
  text-align: center;
  padding: 60px 16px;
  color: var(--text-secondary, #999);
}

.empty-icon {
  font-size: 32px;
  display: block;
  margin-bottom: 12px;
}

.empty-hint {
  font-size: 12px;
  margin-top: 8px;
  opacity: 0.7;
}

.canvas-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.canvas-tab-panel {
  min-width: 0;
}

.canvas-card-wrapper {
  position: relative;
}

.canvas-card-fallback {
  padding: 12px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-secondary, #999);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
