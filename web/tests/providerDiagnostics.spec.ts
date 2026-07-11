import { describe, expect, it } from 'vitest'

import { diagnosticMessage, retryMessage } from '@/utils/providerDiagnostics'

describe('provider diagnostics', () => {
  it('uses safe server summaries before local reason-code text', () => {
    expect(diagnosticMessage({
      reason_code: 'authentication_failed',
      summary: 'Configuration could not be authenticated.',
    })).toBe('Configuration could not be authenticated.')
  })

  it('maps stable reason codes without rendering transport details', () => {
    expect(diagnosticMessage({
      reason_code: 'authentication_failed',
      summary: null,
    })).toBe('验证失败，请检查 API Key。')
    expect(diagnosticMessage({ reason_code: null, summary: null })).toBeNull()
  })

  it('formats only valid retry timestamps', () => {
    expect(retryMessage(null)).toBeNull()
    expect(retryMessage(Number.NaN)).toBeNull()
    expect(retryMessage(0)).toContain('下次重试：')
  })
})
