/**
 * 界面密度：comfortable（默认）/ compact。
 *
 * 只影响**纵向节奏**（导航行高、页面留白、列表间距），不动字号、不动控件尺寸：
 * 字号属于尺度（`--text-*` 六档），密度属于呼吸感——把两者绑在一起，用户想"更紧凑"
 * 时会连可读性一起丢。控件也不缩，避免把 44px 的点击区压到难点的程度。
 *
 * 与主题同构：读 / 写 / 应用 / 启动恢复都在这一个文件里，组件只调 `setDensity`。
 */

export type DensityId = 'comfortable' | 'compact'

export const DENSITY_STORAGE_KEY = 'maxma.density'

export const DEFAULT_DENSITY: DensityId = 'comfortable'

/** 存储里可能是任意字符串（旧版本、手改、被别的工具写坏），一律收敛到已知值。 */
export function normalizeDensity(value: unknown): DensityId {
  return value === 'compact' || value === 'comfortable' ? value : DEFAULT_DENSITY
}

export function readDensity(): DensityId {
  try {
    return normalizeDensity(globalThis.localStorage?.getItem(DENSITY_STORAGE_KEY))
  } catch {
    return DEFAULT_DENSITY
  }
}

/** 写 `data-density`：CSS 侧据此切换 `--density-*` 三档变量。 */
export function applyDensity(density: DensityId): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-density', normalizeDensity(density))
}

export function persistDensity(density: DensityId): void {
  try {
    globalThis.localStorage?.setItem(DENSITY_STORAGE_KEY, normalizeDensity(density))
  } catch {
    /* 忽略持久化失败（隐私模式 / 存储被禁用） */
  }
}

export function setDensity(density: DensityId): void {
  applyDensity(density)
  persistDensity(density)
}

export function restoreDensity(): DensityId {
  const density = readDensity()
  applyDensity(density)
  return density
}
