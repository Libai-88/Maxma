import { chromium } from 'playwright'

const baseUrl = process.env.MAXMA_BASE_URL || 'http://127.0.0.1:5173/'
const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
]

const browser = await chromium.launch({ headless: true })
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport })
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(250)

    const metrics = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      railWidth: document.querySelector('.icon-rail')?.getBoundingClientRect().width ?? null,
    }))

    if (metrics.documentWidth > metrics.viewportWidth) {
      throw new Error(`${viewport.width}px: document overflow ${metrics.documentWidth} > ${metrics.viewportWidth}`)
    }
    if (metrics.railWidth !== null && Math.round(metrics.railWidth) !== 56) {
      throw new Error(`${viewport.width}px: icon rail is ${metrics.railWidth}px, expected 56px`)
    }
    await page.close()
  }
  console.log(`workspace layout passed: ${viewports.map(({ width }) => `${width}px`).join(', ')}`)
} finally {
  await browser.close()
}
