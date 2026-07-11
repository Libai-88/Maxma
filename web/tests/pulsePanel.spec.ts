import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import PulsePanel from '@/components/PulsePanel.vue'
import type { HealthResponse } from '@/types'

const health: HealthResponse = { status: 'degraded', version: 'test', llm: { status: 'ok', latency_ms: 20, detail: null }, memory: { status: 'ok', latency_ms: 4, detail: null }, native_tools: { status: 'ok', latency_ms: 3, detail: null }, mcp_tools: { status: 'degraded', latency_ms: null, detail: null, reason_code: 'temporary_unavailable' }, anthropic_skills_count: 0, providers: { primary: { status: 'error', latency_ms: null, detail: null, reason_code: 'authentication_failed' } }, ltm: { status: 'ok', latency_ms: 6, detail: null }, timestamp: 1 }

describe('PulsePanel', () => {
  beforeEach(() => localStorage.clear())
  it('summarizes safe existing health state and persists collapse preference', async () => {
    const wrapper = mount(PulsePanel, { props: { health } })
    expect(wrapper.text()).toContain('2 项需要关注')
    expect(wrapper.text()).toContain('模型提供商')
    expect(wrapper.text()).toContain('验证失败，请检查 API Key。')
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('#pulse-details').exists()).toBe(false)
    expect(localStorage.getItem('maxma.pulse.collapsed')).toBe('true')
  })
})
