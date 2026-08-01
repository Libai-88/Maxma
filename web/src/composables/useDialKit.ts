export interface DialKitConfig {
  hue: number
  saturation: number
  brightness: number
  speed: number
  mouseSensitivity: number
  damping: number
  frameRate: number
  pixelRatio: number
  noise: {
    opacity: number
    scale: number
  }
}

const defaultConfig: DialKitConfig = {
  hue: 0,
  saturation: 70,
  brightness: 60,
  speed: 1,
  mouseSensitivity: 1,
  damping: 0.93,
  frameRate: 60,
  pixelRatio: 1,
  noise: {
    opacity: 0,
    scale: 1,
  },
}

export function useDialKit(overrides?: Partial<DialKitConfig>): DialKitConfig {
  return { ...defaultConfig, ...overrides }
}