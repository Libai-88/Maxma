/**
 * Agent 组件契约测试（AgentCard / AgentOrchestrator / AgentFlowCanvas / AgentStatusTimeline）。
 *
 * ## 覆盖的问题
 *
 * 1. **XSS**：上一版 AgentCard 用 `v-html` 直接渲染子任务结果，且只做了
 *    `\n → <br>` 和反引号替换——子任务结果来自 LLM，等于半可控输入。
 *    现在改走仓库统一的 `RenderMarkdown`（内部 `sanitizeHtml` 消毒）。
 * 2. **假功能**：编排器的「暂停全部 / 恢复全部」后端并无对应端点；
 *    自动刷新是个只打 debug 日志的空转定时器。两者都已移除。
 * 3. **假交互**：流程图的缩放按钮只改百分比数字，缩放值从未应用到任何元素；
 *    展开按钮只有 `aria-expanded` 没有 `@click`，是个死控件。
 * 4. **可访问性**：图标按钮需要 aria-label，展开按钮需要 aria-expanded；
 *    可点击的非交互元素（卡片头、流程图节点）需要键盘路径。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import AgentCard from '@/components/agent/AgentCard.vue'
import AgentOrchestrator from '@/components/agent/AgentOrchestrator.vue'
import AgentFlowCanvas from '@/components/agent/AgentFlowCanvas.vue'
import AgentStatusTimeline from '@/components/agent/AgentStatusTimeline.vue'
import type { Agent } from '@/types/agent'

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    title: '子任务 abcdef12',
    status: 'running',
    attempts: 1,
    cancellable: true,
    ...overrides,
  }
}

describe('AgentCard', () => {
  it('结果内容走消毒后的渲染，不把原始 HTML 注入 DOM', async () => {
    const wrapper = mount(AgentCard, {
      props: {
        agentId: 'agent-1',
        status: 'succeeded',
        result: '<img src=x onerror="window.__pwned=1">正常文本',
      },
    })

    // 展开卡片才会渲染结果区
    await wrapper.get('.agent-card-header').trigger('click')

    // 危险内容必须被隔离：RenderMarkdown 对含 HTML 的内容启用 iframe 沙箱，
    // 不会把它直接塞进当前文档的 DOM。
    const iframe = wrapper.find('iframe')
    expect(iframe.exists()).toBe(true)

    // 当前文档里不得出现被注入的 img/事件处理器。
    expect(wrapper.element.querySelector('img[onerror]')).toBeNull()
    expect(wrapper.element.querySelector('img')).toBeNull()
    expect((wrapper.vm as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it('可访问名称与展开状态暴露给辅助技术', async () => {
    const wrapper = mount(AgentCard, {
      props: { agentId: 'agent-1', status: 'running' },
    })

    const expandBtn = wrapper.get('.expand-btn')
    expect(expandBtn.attributes('aria-expanded')).toBe('false')
    expect(expandBtn.attributes('aria-label')).toBeTruthy()

    await expandBtn.trigger('click')
    expect(wrapper.get('.expand-btn').attributes('aria-expanded')).toBe('true')
  })

  it('展开按钮自身真的能展开卡片（此前是死控件：只有 aria-expanded 没有 @click）', async () => {
    const wrapper = mount(AgentCard, {
      props: { agentId: 'agent-1', status: 'running' },
    })

    expect(wrapper.find('.agent-card-body').exists()).toBe(false)

    await wrapper.get('.expand-btn').trigger('click')

    expect(wrapper.find('.agent-card-body').exists()).toBe(true)
    expect(wrapper.emitted('expand')?.[0]).toEqual(['agent-1'])
  })

  it('卡片头部可键盘操作（Enter/Space 都能展开）', async () => {
    const wrapper = mount(AgentCard, {
      props: { agentId: 'agent-1', status: 'running' },
    })

    const header = wrapper.get('.agent-card-header')
    // 头部此前只是 <header @click>：不可聚焦、无 role，键盘用户完全用不了。
    expect(header.attributes('role')).toBe('button')
    expect(header.attributes('tabindex')).toBe('0')

    await header.trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('.agent-card-body').exists()).toBe(true)

    await header.trigger('keydown', { key: ' ' })
    expect(wrapper.find('.agent-card-body').exists()).toBe(false)
  })

  it('内部取消按钮按 Enter 不会被头部 role=button 当成展开', async () => {
    const wrapper = mount(AgentCard, {
      props: { agentId: 'agent-1', status: 'running' },
    })

    await wrapper.get('.cancel-btn').trigger('keydown', { key: 'Enter' })
    expect(wrapper.find('.agent-card-body').exists()).toBe(false)
  })

  it('状态图标带 role，aria-label 才对辅助技术生效', () => {
    const wrapper = mount(AgentCard, {
      props: { agentId: 'agent-1', status: 'running' },
    })

    // 无 role 的 <div aria-label> 会被大多数读屏忽略。
    expect(wrapper.get('.status-icon').attributes('role')).toBe('img')
  })

  it('取消按钮带 aria-label 且发出 cancel 事件', async () => {
    const wrapper = mount(AgentCard, {
      props: { agentId: 'agent-1', status: 'running' },
    })

    const btn = wrapper.get('.cancel-btn')
    expect(btn.attributes('aria-label')).toBeTruthy()

    await btn.trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
    expect(wrapper.emitted('cancel')?.[0]).toEqual(['agent-1'])
  })

  it('非活跃状态不显示取消按钮', () => {
    const wrapper = mount(AgentCard, {
      props: { agentId: 'agent-1', status: 'succeeded' },
    })
    expect(wrapper.find('.cancel-btn').exists()).toBe(false)
  })
})

describe('AgentOrchestrator', () => {
  it('不提供后端并不存在的暂停/恢复按钮', () => {
    const wrapper = mount(AgentOrchestrator, {
      props: { agents: [makeAgent()] },
    })

    // 「暂停全部」在真实后端没有对应端点，属于假功能，必须不存在。
    expect(wrapper.find('.pause-all-btn').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('暂停全部')
  })

  it('提供流程图/列表两种视图切换并标记 aria-pressed', async () => {
    const wrapper = mount(AgentOrchestrator, {
      props: { agents: [makeAgent()] },
    })

    const toggles = wrapper.findAll('.view-toggle-btn')
    expect(toggles.length).toBe(2)
    // 默认是列表视图
    expect(toggles[0].attributes('aria-pressed')).toBe('false')
    expect(toggles[1].attributes('aria-pressed')).toBe('true')

    await toggles[0].trigger('click')
    const after = wrapper.findAll('.view-toggle-btn')
    expect(after[0].attributes('aria-pressed')).toBe('true')
    expect(after[1].attributes('aria-pressed')).toBe('false')
  })

  it('空任务列表展示空状态', () => {
    const wrapper = mount(AgentOrchestrator, {
      props: { agents: [] },
    })
    expect(wrapper.text()).toContain('暂无 Agent 任务')
  })

  it('统计数字与任务状态一致', async () => {
    const wrapper = mount(AgentOrchestrator, {
      props: {
        agents: [
          makeAgent({ id: 'a', status: 'running' }),
          makeAgent({ id: 'b', status: 'queued' }),
          makeAgent({ id: 'c', status: 'succeeded' }),
          makeAgent({ id: 'd', status: 'failed' }),
        ],
      },
    })

    // 统计值由 GSAP 补间写入 ref，DOM 更新是异步的（Vue 调度在 nextTick）。
    await nextTick()

    const stats = wrapper.findAll('.stat-value')
    expect(stats[0].text()).toBe('1') // 运行中
    expect(stats[1].text()).toBe('1') // 等待中
    expect(stats[2].text()).toBe('1') // 已完成
    expect(stats[3].text()).toBe('1') // 失败
  })
})

describe('AgentStatusTimeline', () => {
  const events = [
    {
      id: 'e1',
      type: 'progress' as const,
      status: 'running' as const,
      title: '子任务 abcdef12',
      description: '执行中',
      timestamp: Date.now() - 60_000,
    },
    {
      id: 'e2',
      type: 'complete' as const,
      status: 'succeeded' as const,
      title: '子任务 fedcba98',
      description: '已完成',
      timestamp: Date.now() - 10_000,
    },
  ]

  it('按过滤条件筛选事件', async () => {
    const wrapper = mount(AgentStatusTimeline, { props: { events } })

    expect(wrapper.findAll('.timeline-event-item').length).toBe(2)

    const filters = wrapper.findAll('.filter-btn')
    await filters[1].trigger('click') // 进行中
    expect(wrapper.findAll('.timeline-event-item').length).toBe(1)

    await filters[2].trigger('click') // 已完成
    expect(wrapper.findAll('.timeline-event-item').length).toBe(1)
  })

  it('事件操作按钮把 eventId 与 actionType 一起抛出', async () => {
    const wrapper = mount(AgentStatusTimeline, {
      props: {
        events: [
          {
            ...events[0],
            actions: [{ label: '取消', type: 'cancel' }],
          },
        ],
      },
    })

    await wrapper.get('.event-action-btn').trigger('click')
    expect(wrapper.emitted('action')?.[0]).toEqual(['e1', 'cancel'])
  })

  it('空事件列表展示空状态而不是空白', () => {
    const wrapper = mount(AgentStatusTimeline, { props: { events: [] } })
    expect(wrapper.text()).toContain('时间线为空')
  })

  it('过滤按钮暴露 aria-pressed（此前只靠 .active 类传达状态）', () => {
    const wrapper = mount(AgentStatusTimeline, { props: { events } })

    const filters = wrapper.findAll('.filter-btn')
    expect(filters.length).toBe(3)
    expect(filters[0].attributes('aria-pressed')).toBe('true')
    expect(filters[1].attributes('aria-pressed')).toBe('false')
    expect(filters[2].attributes('aria-pressed')).toBe('false')
  })
})

describe('AgentFlowCanvas', () => {
  const agents: Agent[] = [
    { id: 'a1', title: '任务一', status: 'running' },
    { id: 'a2', title: '任务二', status: 'succeeded' },
  ]
  const dependencies = [{ from: 'a1', to: 'a2', type: 'sequential' as const }]

  it('缩放真的作用到视口上（此前只改百分比数字，缩放值没用到任何元素）', async () => {
    const wrapper = mount(AgentFlowCanvas, {
      props: { agents, dependencies },
    })

    const viewport = () => wrapper.get('.flow-viewport').attributes('style') ?? ''
    expect(viewport()).toContain('scale(1)')

    await wrapper.get('.zoom-btn[aria-label="放大"]').trigger('click')
    expect(viewport()).toContain('scale(1.1)')

    await wrapper.get('.zoom-btn[aria-label="缩小"]').trigger('click')
    expect(viewport()).toContain('scale(1)')

    await wrapper.get('.zoom-btn[aria-label="放大"]').trigger('click')
    await wrapper.get('.zoom-btn[aria-label="重置"]').trigger('click')
    expect(viewport()).toContain('scale(1)')
  })

  it('可拖动平移画布，重置后归零', async () => {
    const wrapper = mount(AgentFlowCanvas, {
      props: { agents, dependencies },
    })
    const canvas = wrapper.get('.agent-flow-canvas')
    const viewport = () => wrapper.get('.flow-viewport').attributes('style') ?? ''

    await canvas.trigger('mousedown', { button: 0, clientX: 10, clientY: 10 })
    expect(canvas.classes()).toContain('is-panning')

    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 30 }))
    await nextTick()
    expect(viewport()).toContain('translate(50px, 20px)')

    window.dispatchEvent(new MouseEvent('mouseup'))
    await nextTick()
    expect(canvas.classes()).not.toContain('is-panning')

    await wrapper.get('.zoom-btn[aria-label="重置"]').trigger('click')
    expect(viewport()).toContain('translate(0px, 0px)')
  })

  it('节点可键盘选中', async () => {
    const wrapper = mount(AgentFlowCanvas, {
      props: { agents, dependencies },
    })

    const node = wrapper.get('.agent-node')
    expect(node.attributes('role')).toBe('button')
    expect(node.attributes('tabindex')).toBe('0')

    await node.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select')?.[0]).toEqual(['a1'])
  })

  it('受控的 selectedId 决定高亮项', async () => {
    const wrapper = mount(AgentFlowCanvas, {
      props: { agents, dependencies, selectedId: 'a2' },
    })

    const selected = wrapper.findAll('.agent-node.is-selected')
    expect(selected).toHaveLength(1)
    expect(selected[0].attributes('data-agent-id')).toBe('a2')
  })
})
