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
  tabs: BrowserTabState[]
  activeTabId: string | null
  downloads: BrowserDownload[]
  network: BrowserNetworkState
}

export interface BrowserTabState {
  id: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  active: boolean
  error?: { code: number; description: string; url: string }
}

export type BrowserDownloadState = 'progressing' | 'completed' | 'cancelled' | 'interrupted'

export interface BrowserDownload {
  id: string
  filename: string
  path: string
  state: BrowserDownloadState
  receivedBytes: number
  totalBytes: number
  tabId?: string
  url: string
  startedAt: number
  error?: string
}

export interface BrowserNetworkBlock {
  host: string
  url: string
  tabId?: string
  at: number
}

export interface BrowserNetworkState {
  mode: 'all' | 'allowlist'
  domains: string[]
  allowAll: boolean
  blocked: BrowserNetworkBlock[]
}

export interface BrowserNetworkPolicy {
  mode: 'all' | 'allowlist'
  domains: string[]
}

export interface BrowserCapture {
  dataUrl: string
  width: number
  height: number
}

export interface BrowserPickedElement {
  selector: string
  tag: string
  text: string
  href: string
}

export interface MaxmaBrowserBridge {
  show: (bounds: BrowserBounds) => Promise<BrowserState>
  hide: () => Promise<void>
  setBounds: (bounds: BrowserBounds) => Promise<void>
  getState: () => Promise<BrowserState>
  navigate: (url: string) => Promise<BrowserState>
  newTab: (url?: string) => Promise<BrowserState>
  selectTab: (tabId: string) => Promise<BrowserState>
  closeTab: (tabId: string) => Promise<BrowserState>
  back: () => Promise<void>
  forward: () => Promise<void>
  reload: () => Promise<void>
  stop: () => Promise<void>
  external: () => Promise<void>
  capture: () => Promise<BrowserCapture>
  pickElement: () => Promise<BrowserPickedElement | null>
  setPolicy: (policy: BrowserNetworkPolicy) => Promise<BrowserState>
  revealDownload: (id: string) => Promise<void>
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
