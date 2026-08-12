/**
 * SPLASH-CANVAS-002：启动等待屏全屏 Canvas 动画（星空 + 流星 + 星屑光尘）。
 *
 * 配合「墨色山水 · 月下灯火」整屏 SVG 夜景：Canvas 负责动态层——
 * 夜空的星星缓慢闪烁漂移、偶尔有流星划过、细小的星屑光尘在画面中
 * 缓缓飘落明灭。SVG 的山水/灯火/倒影由 CSS 动画驱动，两层互不干扰。
 *
 * 说明：
 * - 独立模块脚本（同源，符合 CSP script-src 'self'），在 Vue 挂载前运行；
 * - MutationObserver 监听 #app-loading 被移除后自动停止动画并销毁 canvas；
 * - prefers-reduced-motion 时只渲染一帧静态星空，不运行动画循环；
 * - devicePixelRatio 适配（上限 2x），粒子规模按视口面积缩放。
 */
(function () {
  const splash = document.getElementById('app-loading')
  if (!splash) return

  const canvas = document.createElement('canvas')
  canvas.id = 'splash-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  splash.prepend(canvas)

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  let width = 0
  let height = 0
  let dpr = 1

  let stars = []
  let meteors = []
  /** 星屑光尘：缓慢飘落、明灭（氛围微光） */
  let dusts = []

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    width = window.innerWidth
    height = window.innerHeight
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = width + 'px'
    canvas.style.height = height + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    seedParticles()
  }

  function seedParticles() {
    const area = width * height
    // 星星：集中在天空区域（上部 60%），避免与山脚灯火混淆
    const starCount = Math.min(280, Math.round(area / 3000))
    stars = Array.from({ length: starCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height * 0.6,
      r: 0.4 + Math.random() * 1.3,
      base: 0.2 + Math.random() * 0.55,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 1.2,
      driftX: (Math.random() - 0.5) * 0.05,
      driftY: (Math.random() - 0.5) * 0.025,
      warm: Math.random() < 0.65,
    }))
    // 星屑光尘：全画面缓慢飘落
    const dustCount = Math.min(22, Math.round(area / 42000))
    dusts = Array.from({ length: dustCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 0.6 + Math.random() * 1.5,
      vy: 0.08 + Math.random() * 0.22,
      vx: (Math.random() - 0.5) * 0.12,
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 1,
    }))
  }

  function spawnMeteor() {
    const fromLeft = Math.random() < 0.5
    meteors.push({
      x: fromLeft ? Math.random() * width * 0.3 : width * (0.7 + Math.random() * 0.3),
      y: Math.random() * height * 0.35,
      vx: (Math.random() * 1.6 + 2.2) * (fromLeft ? 1 : -1),
      vy: (Math.random() * 0.6 + 1.1),
      life: 1,
      decay: 0.008 + Math.random() * 0.008,
    })
  }

  function drawSky() {
    // 天空底色：与 SVG 夜空无缝衔接（最上层 canvas 的底色就是夜空，
    // 但我们让 canvas 透明，由 SVG 提供底色——这里只画星星等动态元素）
    // 注意：canvas 是透明的，天空由 SVG .scene 承担，无需画底色。
    ctx.clearRect(0, 0, width, height)
  }

  function drawStars(t) {
    for (const s of stars) {
      const twinkle = s.base + Math.sin(t * 0.001 * s.speed + s.phase) * 0.22
      ctx.globalAlpha = Math.max(0.06, twinkle)
      ctx.fillStyle = s.warm ? '#FFEFC9' : '#DDE3F5'
      ctx.beginPath()
      ctx.arc(s.x + s.driftX * t * 0.01, s.y + s.driftY * t * 0.01, s.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  function drawMeteors(t) {
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i]
      m.x += m.vx
      m.y += m.vy
      m.life -= m.decay
      if (m.life <= 0) { meteors.splice(i, 1); continue }
      const len = 90
      const tailX = m.x - m.vx * (len / 6)
      const tailY = m.y - m.vy * (len / 6)
      const grad = ctx.createLinearGradient(m.x, m.y, tailX, tailY)
      grad.addColorStop(0, `rgba(255, 246, 222, ${0.9 * m.life})`)
      grad.addColorStop(1, 'rgba(255, 246, 222, 0)')
      ctx.strokeStyle = grad
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(m.x, m.y)
      ctx.lineTo(tailX, tailY)
      ctx.stroke()
    }
  }

  /** 星屑光尘：缓慢飘落 + 明灭（撞边回卷） */
  function drawDusts(t) {
    for (const d of dusts) {
      d.y += d.vy
      d.x += d.vx
      // 回卷：落到画面底部后从顶部重新出现
      if (d.y > height + 10) { d.y = -10; d.x = Math.random() * width }
      if (d.x < -10) d.x = width + 10
      if (d.x > width + 10) d.x = -10
      const alpha = 0.25 + Math.sin(t * 0.0012 * d.speed + d.phase) * 0.22
      const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r * 4)
      g.addColorStop(0, `rgba(255, 236, 200, ${Math.max(0.05, alpha)})`)
      g.addColorStop(1, 'rgba(255, 236, 200, 0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(d.x, d.y, d.r * 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  let rafId = null
  let meteorTimer = null
  let t0 = performance.now()
  /** 帧计数（写入 canvas data-frame，供观测动画是否在运行） */
  let frameCount = 0

  function frame(now) {
    const t = now - t0
    drawSky()
    drawStars(t)
    drawMeteors(t)
    drawDusts(t)
    frameCount++
    canvas.setAttribute('data-frame', String(frameCount))
    rafId = requestAnimationFrame(frame)
  }

  function start() {
    resize()
    window.addEventListener('resize', resize)
    if (reduced) {
      frame(0)
      cancelAnimationFrame(rafId)
      rafId = null
      return
    }
    meteorTimer = window.setInterval(spawnMeteor, 5000 + Math.random() * 4000)
    rafId = requestAnimationFrame(frame)
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId)
    if (meteorTimer) clearInterval(meteorTimer)
    window.removeEventListener('resize', resize)
    canvas.remove()
  }

  const observer = new MutationObserver(() => {
    if (!document.body.contains(splash)) {
      observer.disconnect()
      stop()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  start()
})()
