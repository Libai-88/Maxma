/** Electron preload 暴露的桌面能力类型。 */

export interface DesktopPickResult {
  path?: string
  canceled?: boolean
}

export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  visible: boolean
  error?: { code: number; description: string; url: string }
}

export interface MaxmaBrowserBridge {
  show: (bounds: BrowserBounds) => Promise<BrowserState>
  hide: () => Promise<void>
  setBounds: (bounds: BrowserBounds) => Promise<void>
  getState: () => Promise<BrowserState>
  navigate: (url: string) => Promise<BrowserState>
  back: () => Promise<void>
  forward: () => Promise<void>
  reload: () => Promise<void>
  stop: () => Promise<void>
  external: () => Promise<void>
  clearData: () => Promise<BrowserState>
  onState: (callback: (state: BrowserState) => void) => void
  offState: () => void
}

export interface MaxmaDesktopBridge {
  platform?: string
  pickPath: (kind: 'file' | 'folder') => Promise<DesktopPickResult>
  revealPath: (path: string) => Promise<void>
  openPath: (path: string) => Promise<void>
  browser?: MaxmaBrowserBridge
}

declare global {
  interface Window {
    maxmaDesktop?: MaxmaDesktopBridge
  }
}

export {}
