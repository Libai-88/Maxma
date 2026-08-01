<template>
  <canvas
    ref="canvasRef"
    class="liquid-logo"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  imageUrl?: string
  patternScale?: number
  refraction?: number
  edge?: number
  patternBlur?: number
  liquid?: number
  speed?: number
  showProcessing?: boolean
}>(), {
  imageUrl: '',
  patternScale: 2,
  refraction: 0.015,
  edge: 0.4,
  patternBlur: 0.005,
  liquid: 0.07,
  speed: 0.3,
  showProcessing: true,
})

const canvasRef = ref<HTMLCanvasElement | null>(null)

// ── GLSL shaders ──

const vertexSrc = `#version 100
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`

const fragmentSrc = `#version 100
precision highp float;

uniform sampler2D u_texture;
uniform float u_time;
uniform float u_pattern_scale;
uniform float u_refraction;
uniform float u_edge;
uniform float u_pattern_blur;
uniform float u_liquid;
uniform float u_speed;
uniform vec2 u_resolution;
uniform float u_alpha;

varying vec2 v_uv;

// 2D hash
float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

// Smooth noise
float snoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// FBM (Fractal Brownian Motion) — 产生液态有机纹理
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * snoise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = v_uv;
  float t = u_time * u_speed;

  // ── 液态扭曲场 ──
  vec2 liquidUv = uv * u_pattern_scale;
  float n1 = fbm(liquidUv + vec2(t * 0.12, t * 0.07));
  float n2 = fbm(liquidUv + vec2(t * 0.09, t * 0.14) + 1.7);

  // 折射偏移
  vec2 offset = vec2(n1 - 0.5, n2 - 0.5) * u_refraction * 50.0;
  offset *= u_liquid * 12.0;
  vec2 distortedUv = uv + offset;

  // ── 采样纹理 ──
  vec4 color = texture2D(u_texture, distortedUv);

  // 透明像素跳过（不浪费计算）
  if (color.a < 0.02) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  // ── 边缘发光（Sobel 近似） ──
  if (u_edge > 0.01) {
    vec2 texel = 1.0 / u_resolution;
    float e = u_edge * 4.0;
    vec2 eUv = distortedUv;

    float tl = length(texture2D(u_texture, eUv + vec2(-texel.x, -texel.y) * e).rgb);
    float t  = length(texture2D(u_texture, eUv + vec2( 0.0, -texel.y) * e).rgb);
    float tr = length(texture2D(u_texture, eUv + vec2( texel.x, -texel.y) * e).rgb);
    float l  = length(texture2D(u_texture, eUv + vec2(-texel.x,  0.0) * e).rgb);
    float r  = length(texture2D(u_texture, eUv + vec2( texel.x,  0.0) * e).rgb);
    float bl = length(texture2D(u_texture, eUv + vec2(-texel.x,  texel.y) * e).rgb);
    float b  = length(texture2D(u_texture, eUv + vec2( 0.0,  texel.y) * e).rgb);
    float br = length(texture2D(u_texture, eUv + vec2( texel.x,  texel.y) * e).rgb);

    float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
    float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
    float edgeVal = clamp(sqrt(gx*gx + gy*gy), 0.0, 1.0);

    color.rgb = mix(color.rgb, vec3(1.0), edgeVal * u_edge * 0.6);
  }

  // ── 图案模糊 ──
  if (u_pattern_blur > 0.005) {
    float blur = u_pattern_blur * 4.0;
    vec4 blurred = vec4(0.0);
    vec2 texel = 1.0 / u_resolution;
    for (int x = -2; x <= 2; x++) {
      for (int y = -2; y <= 2; y++) {
        blurred += texture2D(u_texture, distortedUv + vec2(float(x), float(y)) * texel * blur);
      }
    }
    color = mix(color, blurred / 25.0, u_pattern_blur * 0.8);
  }

  // ── 最终输出 ──
  gl_FragColor = vec4(color.rgb, color.a * u_alpha);
}`

// ── WebGL 工具 ──

function createShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[LiquidLogo] shader compile error:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    throw new Error('shader compile failed')
  }
  return shader
}

function createProgram(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const prog = gl.createProgram()!
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[LiquidLogo] program link error:', gl.getProgramInfoLog(prog))
    gl.deleteProgram(prog)
    throw new Error('program link failed')
  }
  return prog
}

// ── 组件状态 ──

let animId = 0
let startTime = 0
let gl: WebGLRenderingContext | null = null
let program: WebGLProgram | null = null
let texture: WebGLTexture | null = null
let uniforms: Record<string, WebGLUniformLocation | null> = {}
let loadedImage: HTMLImageElement | null = null

function getUniformLocations(gl: WebGLRenderingContext, prog: WebGLProgram) {
  return {
    u_texture: gl.getUniformLocation(prog, 'u_texture'),
    u_time: gl.getUniformLocation(prog, 'u_time'),
    u_pattern_scale: gl.getUniformLocation(prog, 'u_pattern_scale'),
    u_refraction: gl.getUniformLocation(prog, 'u_refraction'),
    u_edge: gl.getUniformLocation(prog, 'u_edge'),
    u_pattern_blur: gl.getUniformLocation(prog, 'u_pattern_blur'),
    u_liquid: gl.getUniformLocation(prog, 'u_liquid'),
    u_speed: gl.getUniformLocation(prog, 'u_speed'),
    u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
    u_alpha: gl.getUniformLocation(prog, 'u_alpha'),
  }
}

function initWebGL(canvas: HTMLCanvasElement, img: HTMLImageElement) {
  // 获取 WebGL 上下文
  gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false })
  if (!gl) {
    gl = (canvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: false }) as WebGLRenderingContext | null)
    if (!gl) {
      console.warn('[LiquidLogo] WebGL not supported')
      return false
    }
  }

  // 编译着色器
  try {
    const vs = createShader(gl, gl.VERTEX_SHADER, vertexSrc)
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentSrc)
    program = createProgram(gl, vs, fs)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
  } catch {
    gl = null
    return false
  }

  // 顶点数据（全屏四边形）
  const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)

  const aPos = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  // 纹理
  texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  gl.uniform1i(uniforms.u_texture, 0)

  uniforms = getUniformLocations(gl, program)

  return true
}

function render(ts: number) {
  if (!gl || !program) return
  const canvas = canvasRef.value
  if (!canvas) return

  if (!startTime) startTime = ts
  const elapsed = (ts - startTime) / 1000

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = canvas.offsetWidth
  const h = canvas.offsetHeight
  if (w === 0 || h === 0) {
    animId = requestAnimationFrame(render)
    return
  }

  // 调整 canvas 尺寸
  const bw = w * dpr
  const bh = h * dpr
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw
    canvas.height = bh
  }

  gl.viewport(0, 0, bw, bh)
  gl.useProgram(program)

  gl.uniform1f(uniforms.u_time, elapsed)
  gl.uniform1f(uniforms.u_pattern_scale, props.patternScale)
  gl.uniform1f(uniforms.u_refraction, props.refraction)
  gl.uniform1f(uniforms.u_edge, props.edge)
  gl.uniform1f(uniforms.u_pattern_blur, props.patternBlur)
  gl.uniform1f(uniforms.u_liquid, props.liquid)
  gl.uniform1f(uniforms.u_speed, props.speed)
  gl.uniform2f(uniforms.u_resolution, w, h)
  gl.uniform1f(uniforms.u_alpha, 1.0)

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

  animId = requestAnimationFrame(render)
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`failed to load image: ${url}`))
    img.src = url
  })
}

// ── 生命周期 ──

onMounted(async () => {
  const canvas = canvasRef.value
  if (!canvas) return

  const url = props.imageUrl
  if (!url) return

  try {
    loadedImage = await loadImage(url)
    if (!canvasRef.value) return // 已卸载

    if (!initWebGL(canvas, loadedImage)) return
    animId = requestAnimationFrame(render)
  } catch (err) {
    console.warn('[LiquidLogo] image load failed:', err)
  }
})

onUnmounted(() => {
  cancelAnimationFrame(animId)
  if (gl && program) {
    const ext = gl.getExtension('WEBGL_lose_context')
    if (ext) ext.loseContext()
  }
  gl = null
  program = null
  texture = null
  loadedImage = null
})
</script>

<style scoped>
.liquid-logo {
  display: block;
  width: 100%;
  height: 100%;
}
</style>