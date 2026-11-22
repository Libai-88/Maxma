/**
 * 交付包内零依赖护照核验脚本的源码。
 *
 * 作为字符串随 ZIP 一起交付，避免收到包的人还要安装 Maxma 或访问服务器；
 * 只依赖 Node.js 18+ 内置模块。
 */
export const COWORK_PASSPORT_VERIFIER_FILENAME = "MAXMA-PASSPORT-VERIFY.mjs";

export const COWORK_PASSPORT_VERIFIER_SCRIPT = String.raw`/**
 * 交付包内的零依赖护照核验脚本。
 *
 * 用法：把本文件与 MAXMA-PASSPORT.json、artifacts/ 放在同一目录，运行
 *   node MAXMA-PASSPORT-VERIFY.mjs
 * 退出码 0 表示全部通过，1 表示有任一不一致。
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

function canonicalize(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return '[' + value.map((item) => canonicalize(item)).join(',') + ']'
  if (typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return '{' + entries.map(([key, item]) => JSON.stringify(key) + ':' + canonicalize(item)).join(',') + '}'
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return 'null'
  return JSON.stringify(value)
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function collectFiles(directory) {
  const files = []
  for (const name of readdirSync(directory)) {
    const full = join(directory, name)
    if (statSync(full).isDirectory()) files.push(...collectFiles(full))
    else files.push(full)
  }
  return files
}

function fail(message) {
  console.error('FAIL  ' + message)
  process.exit(1)
}

let passport
try {
  passport = JSON.parse(readFileSync(join(root, 'MAXMA-PASSPORT.json'), 'utf8'))
} catch {
  fail('当前目录缺少可解析的 MAXMA-PASSPORT.json')
}

const body = { ...passport }
delete body.passport_id
delete body.integrity
const digest = sha256(canonicalize(body))
const checks = [
  ['passport digest', digest === passport?.integrity?.digest],
  ['passport id', passport?.passport_id === 'maxma-' + digest.slice(0, 12)],
]

const artifactDir = join(root, 'artifacts')
let artifactFiles = []
try {
  artifactFiles = collectFiles(artifactDir)
} catch {
  fail('当前目录缺少 artifacts/ 产物目录')
}

const artifactHashes = artifactFiles.map((file) => ({
  file,
  sha256: sha256(readFileSync(file)),
}))
const items = Array.isArray(passport?.artifacts?.items) ? passport.artifacts.items : []
for (const item of items) {
  const found = artifactHashes.some((entry) => entry.sha256 === item?.sha256)
  checks.push(['artifact ' + (item?.name ?? item?.path ?? '(unnamed)'), found])
}
checks.push(['artifact count', artifactFiles.length === items.length])

let ok = true
for (const [name, passed] of checks) {
  console.log((passed ? 'OK  ' : 'FAIL') + '  ' + name)
  if (!passed) ok = false
}
console.log(ok ? ('\nMaxma Passport verified: ' + passport.passport_id) : '\nMaxma Passport verification failed')
process.exit(ok ? 0 : 1)
`;
