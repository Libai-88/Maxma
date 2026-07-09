import type { Component } from 'vue'
import CodeCard from './cards/CodeCard.vue'
import TableCard from './cards/TableCard.vue'
import SummaryCard from './cards/SummaryCard.vue'
import type { CanvasCardType } from '@/types/workbench'

/** Canvas 卡片注册表：card type → 组件 */
const registry: Record<CanvasCardType, Component> = {
  code: CodeCard,
  table: TableCard,
  summary: SummaryCard,
}

export function getCardComponent(type: CanvasCardType): Component | null {
  return registry[type] || null
}
