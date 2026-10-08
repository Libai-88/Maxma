/**
 * credits-format.js 的类型声明。
 *
 * 该文件是从 `dsh-codearts-auth/plugin-src/client/credits-format.js` **原样搬运**的
 * 纯逻辑（无 React 依赖），保持 `.js` 与逐字一致，故类型单独声明。
 */

/** 配额单位（窗口型额度）。**不求和、不显示均值** —— 它是并行的百分比。 */
export const QUOTA_UNIT: string

/** 按单位格式化数值（token / 配额 / 积分各走各的格式化）。 */
export function formatUnits(value: number, unit?: string): string

/** 积分格式化（带千分位）。 */
export function formatCredits(value: number): string

/** token 数量格式化（K/M 缩写）。 */
export function formatTokens(value: number): string

/** 配额（百分比）格式化。 */
export function formatQuota(value: number): string

/** 把资源包列表拼成一行配额描述；无可用包时返回 null。 */
export function formatQuotaLine(packages: unknown, unit?: string): string | null

/** 单位归一到展示口径（同义异拼 credit/credits/'' 归一，token 特例）。 */
export function normalizeUnit(value: unknown): string

/** 单位的展示名（账号卡片与徽标上的标签）。 */
export function unitLabel(unit: unknown): string
