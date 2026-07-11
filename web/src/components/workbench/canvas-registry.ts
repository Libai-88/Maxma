import type { Component } from 'vue'
import CodeCard from './cards/CodeCard.vue'
import TableCard from './cards/TableCard.vue'
import SummaryCard from './cards/SummaryCard.vue'
import ConfirmationCard from './cards/ConfirmationCard.vue'
import ChoiceCard from './cards/ChoiceCard.vue'
import type { CanvasCardType } from '@/types/workbench'

/** Canvas 卡片注册表：card type → 组件 */
const registry: Record<CanvasCardType, Component> = {
  code: CodeCard,
  table: TableCard,
  summary: SummaryCard,
  confirmation: ConfirmationCard,
  choice: ChoiceCard,
  // JSON is intentionally shown as text, rather than parsed into an
  // executable/editor surface. Markdown remains plain text in this narrow
  // workbench card surface; rich rendering belongs to the chat renderer.
  json: CodeCard,
  markdown: SummaryCard,
  // HTML is handled directly by CanvasContainer so it always passes through
  // HtmlSandbox instead of a card component that could accidentally use
  // v-html.
  html: SummaryCard,
}

export function getCardComponent(type: CanvasCardType): Component | null {
  return registry[type] || null
}
