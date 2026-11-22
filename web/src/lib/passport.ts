/**
 * Maxma 任务护照的前端自校验。
 *
 * 与后端 `json-sort-keys/v1` 保持同一规则：对象键递归按字典序排序、数组保序、无空白。
 * 这里用浏览器 Web Crypto 本地重算，不把“验真”再交回服务器。
 */

export interface PassportVerification {
  digest: string
  matches: boolean
  passportIdMatches: boolean
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(',')}}`
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return 'null'
  return JSON.stringify(value)
}

/** 指纹正文：去掉 passport_id 与 integrity 后的护照对象。 */
export function passportDigestBody(passport: object): Record<string, unknown> {
  const body = { ...(passport as Record<string, unknown>) }
  delete body.passport_id
  delete body.integrity
  return body
}

export function canonicalPassportJson(value: unknown): string {
  return canonicalize(value)
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function verifyPassport(passport: {
  passport_id?: string
  integrity?: { digest?: string }
}): Promise<PassportVerification> {
  const digest = await sha256Hex(canonicalize(passportDigestBody(passport)))
  const expected = passport.integrity?.digest ?? ''
  const expectedId = passport.passport_id ?? ''
  return {
    digest,
    matches: digest === expected,
    passportIdMatches: expectedId === `maxma-${digest.slice(0, 12)}`,
  }
}
