/**
 * settings-global.ts — 全局 SettingsManager 单例（阶段二 2.2g）。
 *
 * 供 settings 路由（全局语义）与 settings-panels（PANEL-WIRE-001 同步）
 * 共用。Bun 后端 in-process 后，"sidecar 全局 RPC set_settings" 变为
 * 直接调用官方 SettingsManager。
 */

import { SettingsManager } from "@earendil-works/pi-coding-agent";

let singleton: SettingsManager | null = null;

export function getGlobalSettingsSingleton(): SettingsManager {
  if (!singleton) {
    singleton = SettingsManager.inMemory();
  }
  return singleton;
}
