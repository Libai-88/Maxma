<template>
  <span
    class="icon"
    :class="`icon--${size}`"
    :aria-hidden="decorative ? 'true' : undefined"
    :aria-label="!decorative ? ariaLabel : undefined"
    :role="!decorative && ariaLabel ? 'img' : undefined"
    v-html="svgContent"
  ></span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import chatRaw from '@/assets/icons/sidebar/chat.svg?raw'
import memoryRaw from '@/assets/icons/sidebar/memory.svg?raw'
import modelRaw from '@/assets/icons/sidebar/model.svg?raw'
import pinRaw from '@/assets/icons/sidebar/pin.svg?raw'
import citeSpeechRaw from '@/assets/icons/context-menu/cite-speech.svg?raw'
import copyRaw from '@/assets/icons/context-menu/copy.svg?raw'
import undoArrowRaw from '@/assets/icons/context-menu/undo-arrow.svg?raw'
import attachRaw from '@/assets/icons/chat-input/attach.svg?raw'
import fileRaw from '@/assets/icons/chat-input/file.svg?raw'
import menuFileRaw from '@/assets/icons/chat-input/menu-file.svg?raw'
import menuFolderRaw from '@/assets/icons/chat-input/menu-folder.svg?raw'
import linkRaw from '@/assets/icons/chat-input/link.svg?raw'
import sparklesRaw from '@/assets/icons/chat-input/sparkles.svg?raw'
import toolRaw from '@/assets/icons/chat-input/tool.svg?raw'
import sendRaw from '@/assets/icons/chat-input/send.svg?raw'
import stopRaw from '@/assets/icons/chat-input/stop.svg?raw'
// sidebar/
import playgroundRaw from '@/assets/icons/sidebar/playground.svg?raw'
// chat-input/
import citeRaw from '@/assets/icons/chat-input/cite.svg?raw'
import closeRaw from '@/assets/icons/chat-input/close.svg?raw'
// tools/
import arrowRightRaw from '@/assets/icons/tools/arrow-right.svg?raw'
import bikeRaw from '@/assets/icons/tools/bike.svg?raw'
import busRaw from '@/assets/icons/tools/bus.svg?raw'
import calendarRaw from '@/assets/icons/tools/calendar.svg?raw'
import checkmarkRaw from '@/assets/icons/tools/checkmark.svg?raw'
import chevronDownRaw from '@/assets/icons/tools/chevron-down.svg?raw'
import chevronRightRaw from '@/assets/icons/tools/chevron-right.svg?raw'
import circleOutlineRaw from '@/assets/icons/tools/circle-outline.svg?raw'
import codeQualityRaw from '@/assets/icons/tools/code-quality.svg?raw'
import cookieRaw from '@/assets/icons/tools/cookie.svg?raw'
import docReaderRaw from '@/assets/icons/tools/doc-reader.svg?raw'
import errorRaw from '@/assets/icons/tools/error.svg?raw'
import filePageRaw from '@/assets/icons/tools/file-page.svg?raw'
import folderRaw from '@/assets/icons/tools/folder.svg?raw'
import mapPinRaw from '@/assets/icons/tools/map-pin.svg?raw'
import pdfReaderRaw from '@/assets/icons/tools/pdf-reader.svg?raw'
import pythonRaw from '@/assets/icons/tools/python.svg?raw'
import scraperRaw from '@/assets/icons/tools/scraper.svg?raw'
import searchRaw from '@/assets/icons/tools/search.svg?raw'
import syntaxErrorRaw from '@/assets/icons/tools/syntax-error.svg?raw'
import syntaxOkRaw from '@/assets/icons/tools/syntax-ok.svg?raw'
import todoDueRaw from '@/assets/icons/tools/todo-due.svg?raw'
import todoProjectRaw from '@/assets/icons/tools/todo-project.svg?raw'
import walkRaw from '@/assets/icons/tools/walk.svg?raw'
import warningRaw from '@/assets/icons/tools/warning.svg?raw'
// weather/
import weatherThunderRaw from '@/assets/icons/weather/thunder.svg?raw'
import weatherSnowRaw from '@/assets/icons/weather/snow.svg?raw'
import weatherRainRaw from '@/assets/icons/weather/rain.svg?raw'
import weatherFogRaw from '@/assets/icons/weather/fog.svg?raw'
import weatherSunnyRaw from '@/assets/icons/weather/sunny.svg?raw'
import weatherCloudyRaw from '@/assets/icons/weather/cloudy.svg?raw'
import weatherPartlyCloudyRaw from '@/assets/icons/weather/partly-cloudy.svg?raw'

const props = withDefaults(defineProps<{
  name: string
  size?: 12 | 14 | 16 | 18 | 20
  /** 装饰性图标（默认 true）：渲染 aria-hidden="true"，对屏幕阅读器隐藏 */
  decorative?: boolean
  /** 当 decorative=false 时使用，作为图标的可访问名称 */
  ariaLabel?: string
  /** 生成 <title> 子元素插入到 svg 内，用于原生 tooltip + 屏幕阅读器 */
  title?: string
}>(), {
  size: 16,
  decorative: true,
})

const svgContents: Record<string, string> = {
  chat: chatRaw,
  memory: memoryRaw,
  model: modelRaw,
  pin: pinRaw,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
</svg>`,
  'cite-speech': citeSpeechRaw,
  copy: copyRaw,
  'undo-arrow': undoArrowRaw,
  attach: attachRaw,
  file: fileRaw,
  'menu-file': menuFileRaw,
  'menu-folder': menuFolderRaw,
  link: linkRaw,
  sparkles: sparklesRaw,
  tool: toolRaw,
  send: sendRaw,
  stop: stopRaw,
  playground: playgroundRaw,
  cite: citeRaw,
  close: closeRaw,
  'arrow-right': arrowRightRaw,
  bike: bikeRaw,
  bus: busRaw,
  calendar: calendarRaw,
  checkmark: checkmarkRaw,
  'chevron-down': chevronDownRaw,
  'chevron-right': chevronRightRaw,
  'circle-outline': circleOutlineRaw,
  'code-quality': codeQualityRaw,
  cookie: cookieRaw,
  'doc-reader': docReaderRaw,
  error: errorRaw,
  'file-page': filePageRaw,
  folder: folderRaw,
  'map-pin': mapPinRaw,
  'pdf-reader': pdfReaderRaw,
  python: pythonRaw,
  scraper: scraperRaw,
  search: searchRaw,
  'syntax-error': syntaxErrorRaw,
  'syntax-ok': syntaxOkRaw,
  'todo-due': todoDueRaw,
  'todo-project': todoProjectRaw,
  walk: walkRaw,
  warning: warningRaw,
  'weather-thunder': weatherThunderRaw,
  'weather-snow': weatherSnowRaw,
  'weather-rain': weatherRainRaw,
  'weather-fog': weatherFogRaw,
  'weather-sunny': weatherSunnyRaw,
  'weather-cloudy': weatherCloudyRaw,
  'weather-partly-cloudy': weatherPartlyCloudyRaw,
  sticker: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/>
  <path d="M14 2v6h6"/>
  <circle cx="10" cy="13" r="2"/>
  <path d="m16 15-2 2 2 2"/>
</svg>`,
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
  <circle cx="8.5" cy="8.5" r="1.5"/>
  <polyline points="21 15 16 10 5 21"/>
</svg>`,
}

const svgContent = computed(() => {
  const raw = svgContents[props.name]
  if (!raw) return ''
  let svg = raw.replace(/<\?xml[^>]*\?>/, '').trim()
  if (props.title) {
    // 转义 XML 特殊字符，防止破坏 svg
    const escaped = props.title
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
    const titleEl = `<title>${escaped}</title>`
    // 已有 <title> 时替换；否则作为 <svg> 第一个子元素插入
    if (/<title[\s>]/i.test(svg)) {
      svg = svg.replace(/<title[^>]*>[\s\S]*?<\/title>/i, titleEl)
    } else {
      svg = svg.replace(/<svg\b([^>]*)>/i, `<svg$1>${titleEl}`)
    }
  }
  return svg
})
</script>

<style scoped>
.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 0;
}
.icon :deep(svg) {
  width: 100%;
  height: 100%;
}
.icon--12 { width: 12px; height: 12px; }
.icon--14 { width: 14px; height: 14px; }
.icon--16 { width: 16px; height: 16px; }
.icon--18 { width: 18px; height: 18px; }
.icon--20 { width: 20px; height: 20px; }
</style>
