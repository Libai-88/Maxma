/** Vitest 全局测试设置 */
// mock localStorage（jsdom 已提供，但确保 API 完整）
if (!globalThis.localStorage) {
  const store: Record<string, string> = {}
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { Object.keys(store).forEach(k => delete store[k]) },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() { return Object.keys(store).length },
  } as Storage
}

// 模拟 window.matchMedia —— GSAP 在 jsdom 中需要此 API
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})
