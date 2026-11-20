/** Electron preload 暴露的桌面能力类型。 */

export interface DesktopPickResult {
  path?: string
  canceled?: boolean
}

export interface MaxmaDesktopBridge {
  platform?: string
  pickPath: (kind: 'file' | 'folder') => Promise<DesktopPickResult>
  revealPath: (path: string) => Promise<void>
}

declare global {
  interface Window {
    maxmaDesktop?: MaxmaDesktopBridge
  }
}

export {}
