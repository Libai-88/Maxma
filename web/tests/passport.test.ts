import { describe, expect, test } from 'bun:test'

import { canonicalPassportJson, passportDigestBody, verifyPassport } from '../src/lib/passport'

const DIGEST = 'bcf53ef26586ba77667ec4cb74d3cb2a68937ab52f23ddc502665bf9f8ed28ac'

function fixture() {
  return {
    schema: 'maxma.cowork.passport/v1',
    brand: 'Maxma',
    artifacts: { items: [{ name: 'report.md', sha256: 'b'.repeat(64) }] },
    task: {
      id: 'task-1',
      model_policy: { profile: 'private' },
      title: 'Report',
    },
    passport_id: `maxma-${DIGEST.slice(0, 12)}`,
    integrity: { algorithm: 'sha256', canonicalization: 'json-sort-keys/v1', digest: DIGEST },
  }
}

describe('Maxma 护照本地核验（M4.1）', () => {
  test('规范 JSON 递归排序键、数组保序', () => {
    expect(canonicalPassportJson({ b: 1, a: { d: 2, c: [3, 1] } })).toBe('{"a":{"c":[3,1],"d":2},"b":1}')
  })

  test('指纹正文剔除 passport_id 与 integrity，不修改原对象', () => {
    const passport = fixture()
    const body = passportDigestBody(passport) as Record<string, unknown>
    expect(body.passport_id).toBeUndefined()
    expect(body.integrity).toBeUndefined()
    expect(passport.passport_id.startsWith('maxma-')).toBe(true)
    expect(canonicalPassportJson(body)).not.toContain('passport_id')
  })

  test('本地重算与外部 SHA-256 结果一致，且键顺序无关', async () => {
    const passport = fixture()
    const result = await verifyPassport(passport)
    expect(result.digest).toBe(DIGEST)
    expect(result.matches).toBe(true)
    expect(result.passportIdMatches).toBe(true)

    const reversed = Object.fromEntries(Object.entries(passport).reverse())
    const reordered = await verifyPassport(reversed)
    expect(reordered.matches).toBe(true)
    expect(reordered.passportIdMatches).toBe(true)
  })

  test('正文或编号被改动时核验失败', async () => {
    const tamperedBody = fixture()
    tamperedBody.task.title = 'Report v2'
    const bodyResult = await verifyPassport(tamperedBody)
    expect(bodyResult.matches).toBe(false)
    expect(bodyResult.passportIdMatches).toBe(false)

    const tamperedId = fixture()
    tamperedId.passport_id = 'maxma-000000000000'
    const idResult = await verifyPassport(tamperedId)
    expect(idResult.matches).toBe(true)
    expect(idResult.passportIdMatches).toBe(false)
  })
})
