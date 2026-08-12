/**
 * SPLASH-CANVAS-001：启动等待屏全屏 Canvas 动画（星空 + 流星 + 萤火虫 + 光晕）。
 *
 * 设计理念「灯下待你」：深蓝夜空背景里，只有一扇窗亮着暖光——Maxma
 * 在等你回来。星星缓慢闪烁漂移、偶尔有流星划过、窗下浮着暖色萤火虫，
 * 中央窗户的暖光随"呼吸"向外扩散。
 *
 * 说明：
 * - 独立模块脚本（同源，符合 CSP script-src 'self'），在 Vue 挂载前运行；
 * - 通过 MutationObserver 监听 #app-loading 被移除后自动停止动画；
 * - prefers-reduced-motion 时只渲染一帧静态星空，不运行动画循环；
 * - 使用设备像素比适配高分屏，粒子规模按视口面积缩放控制性能。
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

  /** 星星：位置、半径、基础亮度、闪烁相位/速度、漂移速度 */
  let stars = []
  /** 流星：角度、速度、寿命计时 */
  let meteors = []
  /** 萤火虫：暖色光点，缓慢漂浮 */
  let fireflies = []
  /** 中央窗户光晕（由插画位置决定，像素坐标在 resize 时计算） */
  let glow = { x: 0, y: 0, r: 0 }

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
    // 窗户光晕锚点：中央偏上（插画所在区域）
    glow.x = width / 2
    glow.y = height * 0.44
    glow.r = Math.min(width, height) * 0.42
  }

  function seedParticles() {
    const area = width * height
    // 星数按面积缩放（约每 2600px² 一颗，上限 320 颗）
    const starCount = Math.min(320, Math.round(area / 2600))
    stars = Array.from({ length: starCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height * 0.92,
      r: 0.4 + Math.random() * 1.4,
      base: 0.25 + Math.random() * 0.6,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 1.2,
      driftX: (Math.random() - 0.5) * 0.06,
      driftY: (Math.random() - 0.5) * 0.03,
      warm: Math.random() < 0.7, // 70% 暖白星
    }))
    // 萤火虫：底部区域漂浮
    const fireflyCount = Math.min(18, Math.round(area / 52000))
    fireflies = Array.from({ length: fireflyCount }, () => ({
      x: Math.random() * width,
      y: height * 0.55 + Math.random() * height * 0.45,
      r: 1 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 0.8,
      vx: (Math.random() - 0.5) * 0.25,
      vy: -(0.05 + Math.random() * 0.15),
      hue: 32 + Math.random() * 12, // 暖橙到金黄
    }))
  }

  /** 生成一颗流星（从窗口上方任意位置斜落） */
  function spawnMeteor() {
    const fromLeft = Math.random() < 0.5
    meteors.push({
      x: fromLeft ? Math.random() * width * 0.3 : width * (0.7 + Math.random() * 0.3),
      y: Math.random() * height * 0.3,
      vx: (Math.random() * 1.6 + 2.2) * (fromLeft ? 1 : -1),
      vy: (Math.random() * 0.6 + 1.1),
      life: 1,
      decay: 0.008 + Math.random() * 0.008,
    })
  }

  function drawSky() {
    // 夜空渐变：深蓝紫 → 底部略暖（地平线微光）
    const g = ctx.createLinearGradient(0, 0, 0, height)
    g.addColorStop(0, '#181D30')
    g.addColorStop(0.55, '#211E3A')
    g.addColorStop(0.85, '#33264A')
    g.addColorStop(1, '#3A2B45')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, width, height)

    // 星云光晕（径向模糊感：多层半透明圆）
    const nebula = [
      { x: width * 0.22, y: height * 0.2, r: Math.min(width, height) * 0.34, c: 'rgba(120, 90, 190, 0.10)' },
      { x: width * 0.8, y: height * 0.32, r: Math.min(width, height) * 0.3, c: 'rgba(190, 120, 90, 0.07)' },
      { x: width * 0.5, y: height * 0.85, r: Math.min(width, height) * 0.42, c: 'rgba(194, 59, 34, 0.05)' },
    ]
    for (const n of nebula) {
      const g2 = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r)
      g2.addColorStop(0, n.c)
      g2.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g2
      ctx.fillRect(0, 0, width, height)
    }

    // 极淡噪点（颗粒质感）
    if (!reduced) {
      const grain = ctx.createImageData(1, 1)
      for (let i = 0; i < 220; i++) {
        const x = Math.random() * width
        const y = Math.random() * height
        const a = 0.03 + Math.random() * 0.05
        ctx.fillStyle = `rgba(255, 240, 210, ${a})`
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }

  function drawStars(t) {
    for (const s of stars) {
      const twinkle = s.base + Math.sin(t * 0.001 * s.speed + s.phase) * 0.25
      ctx.globalAlpha = Math.max(0.08, twinkle)
      ctx.fillStyle = s.warm ? '#FFEFC9' : '#DDE3F5'
      ctx.beginPath()
      ctx.arc(s.x + s.driftX * t * 0.01, s.y + s.driftY * t * 0.01, s.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  function drawFireflies(t) {
    for (const f of fireflies) {
      // 上下漂浮（正弦）+ 呼吸亮度
      const bob = Math.sin(t * 0.001 * f.speed + f.phase) * 14
      const alpha = 0.35 + Math.sin(t * 0.002 + f.phase * 2) * 0.3
      const x = f.x + f.vx * t * 0.01
      const y = f.y + f.vy * t * 0.01 + bob
      // 撞边反弹
      if (y < height * 0.4 || y > height * 0.98) f.vy = -f.vy
      if (x < 0 || x > width) f.vx = -f.vx
      const g = ctx.createRadialGradient(x, y, 0, x, y, f.r * 5)
      g.addColorStop(0, `hsla(${f.hue}, 90%, 70%, ${alpha})`)
      g.addColorStop(1, `hsla(${f.hue}, 90%, 70%, 0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, f.r * 5, 0, Math.PI * 2)
      ctx.fill()
    }
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

  /** 中央窗户的暖光：以插画位置为中心向外扩散，随呼吸脉动 */
  function drawGlow(t) {
    const breathe = 0.86 + Math.sin(t * 0.0012) * 0.12
    const g = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, glow.r)
    g.addColorStop(0, `rgba(255, 190, 110, ${0.16 * breathe})`)
    g.addColorStop(0.5, `rgba(255, 165, 90, ${0.06 * breathe})`)
    g.addColorStop(1, 'rgba(255, 160, 80, 0)')
    ctx.fillStyle = g
    ctx.fillRect(glow.x - glow.r, glow.y - glow.r, glow.r * 2, glow.r * 2)
  }

  let rafId = null
  let meteorTimer = null
  let t0 = performance.now()
  /** 帧计数（写入 canvas data-frame，供观测动画是否在运行） */
  let frameCount = 0

  function frame(now) {
    const t = now - t0
    drawSky()
    drawGlow(t)
    drawStars(t)
    drawMeteors(t)
    drawFireflies(t)
    frameCount++
    canvas.setAttribute('data-frame', String(frameCount))
    rafId = requestAnimationFrame(frame)
  }

  function start() {
    resize()
    window.addEventListener('resize', resize)
    if (reduced) {
      // 降级：绘制一帧静态星空（无动画循环）
      frame(0)
      cancelAnimationFrame(rafId)
      rafId = null
      return
    }
    // 流星定时器：每 5-9 秒随机一颗
    meteorTimer = window.setInterval(spawnMeteor, 5000 + Math.random() * 4000)
    rafId = requestAnimationFrame(frame)
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId)
    if (meteorTimer) clearInterval(meteorTimer)
    window.removeEventListener('resize', resize)
    // 移除 canvas（保留首屏其它内容）
    canvas.remove()
  }

  // 首屏被移除（后端就绪）时停止动画
  const observer = new MutationObserver(() => {
    if (!document.body.contains(splash)) {
      observer.disconnect()
      stop()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  start()
})()
