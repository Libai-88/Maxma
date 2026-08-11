/**
 * 系统通知（GAP-A3-001）— Notification API 封装，零依赖零 API 成本。
 *
 * WebView2（Windows）原生支持 HTML5 Notification（映射为系统 toast），
 * 桌面端无需任何权限/付费配置即可使用。
 *
 * 策略：
 * - 仅当 ①用户开启系统通知开关 ②权限已授予 ③窗口处于后台（document.hidden）
 *   时才弹出系统通知——用户正看着界面时应用内 UI 已足够，避免打扰。
 * - 权限请求必须由用户手势触发（设置页"测试通知"按钮），不做自动弹窗。
 * - 所有路径安全降级：无 Notification API / 权限拒绝 / 存储不可用时静默。
 */
import { safeGetItem, safeSetItem } from '@/lib/storage'

const NOTIFY_ENABLED_KEY = 'maxma_notify_enabled'

export function isNotifyEnabled(): boolean {
  try {
    return safeGetItem(NOTIFY_ENABLED_KEY) !== '0'
  } catch {
    return true
  }
}

export function setNotifyEnabled(enabled: boolean): void {
  safeSetItem(NOTIFY_ENABLED_KEY, enabled ? '1' : '0')
}

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported'
  return Notification.permission
}

/** 请求通知权限（必须由用户手势调用）。返回授予与否。 */
export async function requestNotifyPermission(): Promise<boolean> {
  if (!isNotificationSupported()) return false
  try {
    const permission = await Notification.requestPermission()
    return permission === 'granted'
  } catch {
    return false
  }
}

/**
 * 弹出系统通知。仅在 开关开启 + 权限授予 + 窗口后台 时真正弹出；
 * 否则静默返回 false（不打扰、不报错）。
 * force=true 时忽略窗口前台限制（设置页"测试通知"使用——用户正主动操作，
 * 需要即时可见的反馈）。
 */
export function showSystemNotification(title: string, body: string, force = false): boolean {
  try {
    if (!isNotifyEnabled()) return false
    if (!isNotificationSupported()) return false
    if (Notification.permission !== 'granted') return false
    if (!force && typeof document !== 'undefined' && !document.hidden) return false
    const notification = new Notification(title, {
      body,
      tag: 'maxma-notify',
      silent: true,
    })
    // 用户点击通知 → 聚焦窗口
    notification.onclick = () => {
      try {
        window.focus()
        notification.close()
      } catch { /* silent */ }
    }
    return true
  } catch {
    return false
  }
}
