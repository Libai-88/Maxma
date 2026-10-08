/**
 * account-model-link.js 的类型声明（原样搬运的纯逻辑）。
 */

/**
 * 停用某账号后，该 provider 是否**不再有任何启用账号**。
 *
 * 只在「停用」方向、且该账号当前确实启用时返回 true（对已停用账号再点停用是空操作）。
 */
export function disablingLeavesNoEnabledAccount(
  accounts: Array<{ id?: string; provider?: string; enabled?: boolean }> | null | undefined,
  accountId: string,
  provider: string,
): boolean

/** 该渠道的模型是否**全部**处于停用状态。 */
export function allModelsDisabled(models: Array<{ disabled?: boolean }> | null | undefined): boolean
