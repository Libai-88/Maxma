declare module 'vue-virtual-scroller' {
  import type { DefineComponent } from 'vue'
  // 该包未提供官方类型声明；这里给出最小化的组件占位类型，避免 vue-tsc 报错。
  // 实际 prop 类型由调用方在使用处自行保证。
  export const DynamicScroller: DefineComponent<Record<string, unknown>>
  export const DynamicScrollerItem: DefineComponent<Record<string, unknown>>
}

declare module 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
