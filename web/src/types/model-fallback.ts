/** MOD-1：本地模型不可达时，后端在开轮前自动换到下一个有凭据的渠道。 */
export interface ModelFallbackEvent {
  type: 'model_fallback'
  payload: {
    from: { provider_id: string; model: string; label: string }
    to: { provider_id: string; model: string; label: string }
    reason: string
  }
}
