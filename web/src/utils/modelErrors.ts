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

  return message
}
