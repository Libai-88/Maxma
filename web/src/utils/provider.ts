const LOCAL_PROVIDER_TYPES = new Set(['ollama', 'vllm', 'lm-studio'])

export function isLocalProvider(providerType?: string, baseUrl?: string): boolean {
  if (providerType && LOCAL_PROVIDER_TYPES.has(providerType.toLowerCase())) return true
  if (!baseUrl) return false
  try {
    const url = new URL(baseUrl)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  } catch {
    return false
  }
}
