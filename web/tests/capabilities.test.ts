import { describe, expect, test } from 'bun:test'

import { describeFeatureAvailability } from '../src/stores/capabilities.ts'
import type { CapabilityFeatures } from '../src/types/index.ts'

describe('能力清单诚实性判定', () => {
  test('清单未加载时不猜原因', () => {
    expect(describeFeatureAvailability(null, 'cowork')).toEqual({
      kind: 'manifest_unloaded',
      reason: '尚未取得后端能力清单，暂时无法判断该功能为何不可用',
      actionable: false,
    })
  })

  test('清单没有该特性时说明当前部署未包含', () => {
    expect(describeFeatureAvailability({}, 'cowork')).toEqual({
      kind: 'not_deployed',
      reason: '当前部署的能力清单未包含该特性，界面无法提供入口',
      actionable: false,
    })
  })

  test('引擎不支持时原样透传后端原因', () => {
    const features: CapabilityFeatures = {
      cowork: { enabled: false, engine_supported: false, reason: '引擎没有任务运行时' },
    }
    expect(describeFeatureAvailability(features, 'cowork')).toEqual({
      kind: 'engine_unsupported',
      reason: '引擎没有任务运行时',
      actionable: false,
    })
  })

  test('版本能力默认关闭时不能说成“去设置开启”', () => {
    const features: CapabilityFeatures = {
      cowork: {
        enabled: false,
        engine_supported: true,
        user_toggleable: false,
        reason: 'Cowork 任务层将在 M1 启用',
      },
    }
    expect(describeFeatureAvailability(features, 'cowork')).toEqual({
      kind: 'not_deployed',
      reason: 'Cowork 任务层将在 M1 启用',
      actionable: false,
    })
  })

  test('用户关闭的能力才提供可操作提示', () => {
    const features: CapabilityFeatures = {
      sub_agents: { enabled: false, engine_supported: true },
    }
    expect(describeFeatureAvailability(features, 'sub_agents')).toEqual({
      kind: 'user_disabled',
      reason: '该功能当前在设置中被关闭，可以在对应设置面板里重新开启',
      actionable: true,
    })
  })

  test('启用中的能力不再解释为不可用', () => {
    const features: CapabilityFeatures = {
      memory: { enabled: true },
    }
    expect(describeFeatureAvailability(features, 'memory')).toEqual({
      kind: 'available',
      reason: '能力清单显示该特性当前是启用的，可能是页面状态过期',
      actionable: false,
    })
  })
})
