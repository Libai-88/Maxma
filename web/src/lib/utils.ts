type ClassValue = string | boolean | null | undefined | ClassValue[] | Record<string, boolean | null | undefined>

export function cn(...classes: ClassValue[]): string {
  const result: string[] = []

  for (const c of classes) {
    if (!c) continue
    if (typeof c === 'string') {
      result.push(c)
    } else if (Array.isArray(c)) {
      result.push(cn(...c))
    } else if (typeof c === 'object') {
      for (const [key, value] of Object.entries(c)) {
        if (value) result.push(key)
      }
    }
  }

  return result.join(' ')
}