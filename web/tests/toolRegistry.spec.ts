/**
 * 工具名 → 中文展示名 / 气泡组件 两张表的一致性回归锁。
 *
 * 清单来源（照抄，勿凭记忆增删）：
 *   - 引擎内置 7 个：bun-sidecar/src/kernel/pi-session.ts:35
 *       `MAXMA_DEFAULT_PI_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"]`
 *   - Maxma 自定义 6 个：bun-sidecar/src/tools/* 里各工具定义对象的 `name:` 字段
 *       remember_memory（remember-memory.ts:70）、search_memories（memory.ts:90）、
 *       get_sticker（stickers.ts:73）、list_rules（rules.ts:102）、
 *       read_office_file（office.ts:163）、write_office_file（office.ts:197）
 *   - 计划工具 1 个：bun-sidecar/src/kernel/plan.ts:84 → submit_plan
 *
 * 断言的意图：这 14 个名字是「当前真的会被调用」的工具，任何一张表漏登记都会让用户
 * 看到英文原名标题（displayNames 缺失）或退化成兜底卡片（registry 缺失）。
 */
import { describe, expect, it } from 'vitest'
import { getBubbleComponent, getRegisteredTools } from '@/components/tools/registry'
import { ALL_TOOL_NAMES, toolDisplayName } from '@/components/tools/_shared/displayNames'

/** pi 引擎内置工具（MAXMA_DEFAULT_PI_TOOLS） */
const PI_BUILTIN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const

/** Maxma 注册给 pi 的自定义工具 */
const MAXMA_CUSTOM_TOOLS = [
  'remember_memory',
  'search_memories',
  'get_sticker',
  'list_rules',
  'read_office_file',
  'write_office_file',
] as const

/** 计划模式提交工具 */
const PLAN_TOOL = 'submit_plan'

const CJK = /[一-鿿]/

describe('tool displayNames 表覆盖当前实际可用工具', () => {
  it.each(PI_BUILTIN_TOOLS)('引擎内置工具 %s 有中文展示名（不是英文原名）', (name) => {
    const label = toolDisplayName(name)
    expect(label, `${name} 在 displayNames 中缺登记，气泡标题会显示英文原名`).not.toBe(name)
    expect(label).toMatch(CJK)
    expect(label.trim().length).toBeGreaterThan(0)
  })

  it.each([...MAXMA_CUSTOM_TOOLS, PLAN_TOOL])('Maxma 自定义/计划工具 %s 有展示名登记', (name) => {
    const label = toolDisplayName(name)
    expect(label, `${name} 未登记，气泡标题会显示英文原名`).not.toBe(name)
    expect(label).toMatch(CJK)
  })

  it('展示名不与工具名本身相同（避免“登记了但等于没登记”）', () => {
    for (const name of [...PI_BUILTIN_TOOLS, ...MAXMA_CUSTOM_TOOLS, PLAN_TOOL]) {
      expect(ALL_TOOL_NAMES).toContain(name)
    }
  })
})

describe('tool registry 气泡映射', () => {
  it.each([...MAXMA_CUSTOM_TOOLS, PLAN_TOOL, 'find', 'ls'])(
    '当前会被调用的工具 %s 已登记气泡组件（不退化为兜底卡片）',
    (name) => {
      expect(getBubbleComponent(name), `${name} 未登记气泡组件`).not.toBeNull()
    },
  )

  it('getBubbleComponent 对未注册名字返回 null（现状行为，锁住它）', () => {
    expect(getBubbleComponent('definitely_not_a_real_tool')).toBeNull()
    expect(getBubbleComponent('')).toBeNull()
    expect(getBubbleComponent('Read')).toBeNull()
    expect(getBubbleComponent('read_file')).toBeNull()
  })

  // PROTOTYPE-KEY 回归锁：旧写法 `registry[name] ?? null` 会命中 Object.prototype 的
  // 继承键，于是名为 constructor/toString/... 的 MCP 工具会把一个原型函数当组件渲染。
  // 现改为 Object.hasOwn(registry, name) ? registry[name] : null。
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'prototype'])(
    '原型链键 %s 不再被当成已注册工具（返回 null）',
    (name) => {
      expect(getBubbleComponent(name)).toBeNull()
    },
  )

  it('修复前后差异证据：等价对象字面量表的旧查找返回函数，新查找返回 null', () => {
    const legacyTable: Record<string, unknown> = { read: 'marker' }
    const legacyLookup = (name: string) => legacyTable[name] ?? null
    // 修复前的行为：命中继承键 → 拿到 Object 构造函数
    expect(typeof legacyLookup('constructor')).toBe('function')
    expect(legacyLookup('toString')).not.toBeNull()
    // 修复后的行为：同一类键一律 null
    expect(getBubbleComponent('constructor')).toBeNull()
    expect(getBubbleComponent('toString')).toBeNull()
    // 真实注册项不受影响
    expect(getBubbleComponent('read')).not.toBeNull()
  })

  it('getRegisteredTools 返回的每个名字都有中文展示名（两张表不脱节）', () => {
    const missing = getRegisteredTools().filter((name) => !ALL_TOOL_NAMES.includes(name))
    expect(missing, `registry 里有气泡但 displayNames 无中文名：${missing.join(', ')}`).toEqual([])
  })
})
