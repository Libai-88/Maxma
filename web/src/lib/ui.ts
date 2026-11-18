/**
 * 全站一套的交互类名。
 *
 * 之前 focus ring 有三种写法（`ring-3`、`ring-2 ring-ring/60`、干脆没有），
 * 键盘走一遍能看到焦点在跳。这里收成一套：2px 环、55% 的 ring 色、不偏移
 * （玻璃面上 offset 会画出一条缝）。
 *
 * 时长与曲线来自 `solid-glass.css` 的 `--motion-*` 与 `--ease-*`：
 * 只换颜色 → `fast`；要位移或改尺寸 → `base` + quint 曲线。
 */
export const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring/55"

/** 只变颜色/背景的过渡（hover、选中态）。 */
export const interactive = "transition-colors duration-fast ease-standard"

/** 按下时的 1px 下沉；只用于本来就有立体感的控件。 */
export const press = "active:translate-y-px transition-transform duration-fast ease-out-quint"
