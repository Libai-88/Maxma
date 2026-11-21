/**
 * memory/search.ts — 记忆混合检索（BM25 + 精确短语 + 分类/时间加权）。
 *
 * 设计边界：
 * - 纯本地、无向量依赖；中文按「单字 + 二元组」切 token，英文/数字按词切。
 * - 排序分三部分：BM25(description 权重 3、category 权重 1.5)、整句包含加分、较新记忆轻微加权。
 * - 返回近重复分组与「可能冲突」提示，但不自动改写记忆文件。
 */

export interface MemoryEntry {
  id: string
  description: string
  category: string
  updatedAt: string
}

export interface RankedMemory extends MemoryEntry {
  score: number
  matchedTokens: string[]
}

export interface MemorySearchResult {
  total: number
  returned: RankedMemory[]
  duplicateGroups: Array<{ ids: string[]; reason: string }>
  possibleConflicts: Array<{ ids: string[]; reason: string }>
}

const CJK = /[\u3400-\u9fff]/
const WORD = /[a-z0-9_]+/g

/** 把文本切成可比较的检索 token（小写）。 */
export function tokenizeMemory(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens: string[] = []
  for (const word of lower.match(WORD) ?? []) tokens.push(word)
  for (const run of lower.match(/[\u3400-\u9fff]+/g) ?? []) {
    for (let i = 0; i < run.length; i += 1) {
      tokens.push(run[i]!)
      if (i + 1 < run.length) tokens.push(run.slice(i, i + 2))
    }
  }
  return tokens
}

function termFrequency(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const token of tokens) map.set(token, (map.get(token) ?? 0) + 1)
  return map
}

function idf(df: number, total: number): number {
  return Math.log(1 + (total - df + 0.5) / (df + 0.5))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

function numericTokens(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? []
}

/** 相似度只用英文词与中文二元组，避免「爸」「的」这类单字把不相干内容拉高。 */
function similarityTokens(text: string): Set<string> {
  const lower = text.toLowerCase()
  const tokens = new Set<string>()
  for (const word of lower.match(WORD) ?? []) tokens.add(word)
  for (const run of lower.match(/[\u3400-\u9fff]+/g) ?? []) {
    if (run.length === 1) tokens.add(run)
    for (let i = 0; i + 1 < run.length; i += 1) tokens.add(run.slice(i, i + 2))
  }
  return tokens
}

const NEGATION = /(?:不|没|无|未|取消|停止|不再|并非|不是)/

function looksConflicting(a: MemoryEntry, b: MemoryEntry, overlap: number): boolean {
  if (overlap < 0.25) return false
  const negA = NEGATION.test(a.description)
  const negB = NEGATION.test(b.description)
  if (negA !== negB) return true
  const numsA = numericTokens(a.description)
  const numsB = numericTokens(b.description)
  if (numsA.length > 0 && numsB.length > 0) {
    return numsA.join('|') !== numsB.join('|')
  }
  return false
}

/**
 * 检索记忆。query 为空时按更新时间返回（仍做分类过滤与去重）。
 */
export function searchMemoryEntries(
  entries: MemoryEntry[],
  options: { query?: string; category?: string; limit?: number } = {},
): MemorySearchResult {
  const queryRaw = (options.query ?? '').trim()
  const query = queryRaw.toLowerCase()
  const category = (options.category ?? '').trim()
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 10), 1), 50)

  let candidates = entries.filter((entry) => entry.description !== '')
  if (category) candidates = candidates.filter((entry) => entry.category === category)

  if (!query) {
    const sorted = candidates
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const top = sorted.slice(0, limit).map((entry) => ({ ...entry, score: 0, matchedTokens: [] }))
    return { total: sorted.length, returned: top, duplicateGroups: [], possibleConflicts: [] }
  }

  const queryTokens = [...new Set(tokenizeMemory(queryRaw))]
  const docs = candidates.map((entry) => {
    const descriptionTokens = tokenizeMemory(entry.description)
    const categoryTokens = tokenizeMemory(entry.category)
    const weighted = new Map<string, number>()
    for (const [token, count] of termFrequency(descriptionTokens)) weighted.set(token, count * 3)
    for (const [token, count] of termFrequency(categoryTokens)) {
      weighted.set(token, (weighted.get(token) ?? 0) + count * 1.5)
    }
    return {
      entry,
      weighted,
      length: descriptionTokens.length * 3 + categoryTokens.length * 1.5,
      tokenSet: similarityTokens(`${entry.description} ${entry.category}`),
    }
  })

  const total = docs.length
  const avgdl = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(total, 1) || 1
  const df = new Map<string, number>()
  for (const token of queryTokens) {
    df.set(token, docs.filter((doc) => doc.weighted.has(token)).length)
  }

  const k1 = 1.2
  const b = 0.75
  type Scored = RankedMemory & { tokenSet: Set<string> }
  const ranked: Scored[] = docs
    .map((doc) => {
      let score = 0
      const matched: string[] = []
      for (const token of queryTokens) {
        const tf = doc.weighted.get(token)
        if (!tf) continue
        matched.push(token)
        score += idf(df.get(token) ?? 0, total) * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / avgdl)))
      }
      if (doc.entry.description.toLowerCase().includes(query)) score += 2.5
      if (doc.entry.category.toLowerCase().includes(query)) score += 1
      // 新记忆轻微优先，避免同分时旧内容压过新内容。
      const ageDays = Math.max(0, (Date.now() - new Date(doc.entry.updatedAt.replace(' ', 'T')).getTime()) / 86_400_000)
      if (Number.isFinite(ageDays)) score += Math.max(0, 0.2 - Math.min(ageDays, 365) / 1825)
      return { ...doc.entry, score, matchedTokens: matched, tokenSet: doc.tokenSet }
    })
    .filter((entry) => entry.matchedTokens.length > 0)
    .sort((a, b2) => b2.score - a.score || b2.updatedAt.localeCompare(a.updatedAt))

  // 近重复分组：只影响展示提示，不改变条目本身。
  const duplicateGroups: Array<{ ids: string[]; reason: string }> = []
  const possibleConflicts: Array<{ ids: string[]; reason: string }> = []
  for (let i = 0; i < ranked.length; i += 1) {
    const left = ranked[i]!
    for (let j = i + 1; j < ranked.length; j += 1) {
      const right = ranked[j]!
      const overlap = jaccard(left.tokenSet, right.tokenSet)
      if (overlap >= 0.5) {
        duplicateGroups.push({ ids: [left.id, right.id], reason: `描述相似度 ${(overlap * 100).toFixed(0)}%` })
      } else if (looksConflicting(left, right, overlap)) {
        possibleConflicts.push({ ids: [left.id, right.id], reason: '关键词高度重合但数字或否定表述不同' })
      }
    }
  }

  const returned = ranked.slice(0, limit).map(({ tokenSet: _tokenSet, ...entry }) => entry)
  return { total: ranked.length, returned, duplicateGroups, possibleConflicts }
}
