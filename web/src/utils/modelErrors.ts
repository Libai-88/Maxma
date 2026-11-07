function diagnosticString(diagnostic: Record<string, unknown> | null | undefined): string {
  if (!diagnostic) return ''
  return Object.values(diagnostic)
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
}

export function userFacingModelError(
  message: string,
  diagnostic?: Record<string, unknown> | null,
): string {
  const combined = `${message} ${diagnosticString(diagnostic)}`.toLowerCase()
  const isOpenCodeFreeTierRejection =
    (combined.includes('403') || combined.includes('forbidden')) &&
    (combined.includes('free tier') || combined.includes('freetier') || combined.includes('only be used from within opencode'))

  if (isOpenCodeFreeTierRejection) {
    const modelName = typeof diagnostic?.model_name === 'string' ? diagnostic.model_name : ''
    const modelLabel = modelName ? `“${modelName}”` : '当前模型'
    return `模型 ${modelLabel} 的免费通道不允许在 Maxma 中使用，请切换到支持 Maxma 的接口或其他模型。`
  }

  // FREE-QUOTA-429-001：上游匿名免费额度耗尽（429，全端共享额度）。
  // kernel 的兜底链打满后如实回放这条原文——直接展示英文原文等于把
  // "恢复路径"藏进日志。按品牌口径给原因 + 恢复路径，不卖订阅。
  const isOpenCodeFreeQuotaExhausted =
    combined.includes('free usage limit reached') ||
    (combined.includes('429') && combined.includes('free'))
  if (isOpenCodeFreeQuotaExhausted) {
    return '内置免费通道的上游额度已用完（免费额度全端共享，与你无关）。可稍后重试，或在「模型设置」中改用其他模型；上游提示免费额度也可在 opencode.ai 使用。'
  }

  return message
}
