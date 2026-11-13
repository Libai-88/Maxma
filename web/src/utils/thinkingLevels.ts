/**
 * utils/thinkingLevels.ts — 思考档位的标签表（**前端唯一来源**）。
 *
 * 取值域由引擎决定（`PI_THINKING_LEVELS`），顺序必须与契约一致——
 * `engine-boundary.test.ts` 会对账本文件与契约的档位集合。
 *
 * 为什么抽出来：设置页与输入框底部的「思考」选择器都要用它。两处各写一份
 * 就会在引擎增删档位时各漂各的（本仓已有过 4 份档位副本的教训，见 HANDOFF
 * 的 AG-PERM-001 条目）。
 */
export const THINKING_LEVELS = [
  { value: 'off', label: '关闭' },
  { value: 'minimal', label: '极简' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '很高' },
  { value: 'max', label: '最高' },
] as const

export type ThinkingLevelValue = (typeof THINKING_LEVELS)[number]['value']

/** 档位值 → 中文短标签。未知档位回落到原值（不伪装成已知档位）。 */
export function thinkingLevelLabel(value: string): string {
  return THINKING_LEVELS.find((l) => l.value === value)?.label ?? value
}