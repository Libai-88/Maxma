/**
 * Browser-safe ThinkPath presentation rules.
 *
 * The server remains authoritative: it accepts only known path IDs and ignores
 * them while its feature flag is off.  These local rules merely decide whether
 * it is useful to offer the optional chooser before a message is sent; they
 * never infer a sensitive topic or call a model.
 */
export type ThinkPathId = 'light' | 'standard' | 'deep'

export interface ThinkPathOption {
  id: ThinkPathId
  label: string
  description: string
  estimatedCost: string
  depth: string
}

export const THINK_PATH_OPTIONS: readonly ThinkPathOption[] = [
  {
    id: 'light',
    label: '轻量',
    description: '直接作答，适合已有明确方向的问题。',
    estimatedCost: '低',
    depth: '浅',
  },
  {
    id: 'standard',
    label: '标准',
    description: '先梳理要点，再给出可执行的答案。',
    estimatedCost: '中',
    depth: '中',
  },
  {
    id: 'deep',
    label: '深入',
    description: '拆分假设、权衡方案并检查关键风险。',
    estimatedCost: '较高',
    depth: '深',
  },
]

const COMPLEXITY_MARKERS = [
  '分析', '比较', '对比', '研究', '调查', '排查', '定位', '修复', '重构',
  '实现', '设计', '规划', '计划', '步骤', '总结', '审查', '迁移', '优化',
  'review', 'debug', 'research', 'compare', 'implement', 'design', 'plan',
]

/** Match the transparent server heuristic so the optional UI is predictable. */
export function shouldOfferThinkPaths(text: string): boolean {
  const raw = String(text || '')
  const hasMultipleLines = /[\r\n]/.test(raw)
  const normalized = raw.trim().replace(/\s+/g, ' ')
  if (normalized.length >= 60 || hasMultipleLines) return true
  const lower = normalized.toLowerCase()
  return COMPLEXITY_MARKERS.some(marker => lower.includes(marker))
}

export function isThinkPathId(value: unknown): value is ThinkPathId {
  return typeof value === 'string' && THINK_PATH_OPTIONS.some(path => path.id === value)
}
