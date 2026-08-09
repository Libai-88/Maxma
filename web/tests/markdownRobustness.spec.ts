// 维度12（模型异常内容）核心防线：markdown 渲染 + 消毒链路对畸形/恶意输入
// 必须不抛异常且消毒彻底（无 script/onerror/javascript: 残留）
import { describe, expect, it } from 'vitest'
import { sanitizeHtml, contentNeedsIsolation, renderMarkdown } from '@/utils/markdown'

const MALICIOUS_CASES = [
  '嵌套危险标签<script><img src=x onerror=alert(1)></script>',
  '<p onclick="alert(1)">x</p>',
  '<a href="javascript:alert(1)">x</a>',
  '<img src="data:text/html;base64,PHNjcmlwdD4=">',
  '<div style="position:fixed;inset:0;background:red">x</div>',
  '<iframe src="https://evil.com"></iframe>',
  '<svg><script>alert(1)</script></svg>',
  '```html\n<script>alert(1)</script>\n```',
  '| a | b |\n|---|---|\n| <img src=x onerror=1> | y |',
  '<img src=x onerror=alert(1)><b>加粗</b>',
]

const WEIRD_CASES = [
  ['畸形未闭合标签', '<div><span>未闭合'],
  ['超长纯文本', 'x'.repeat(100000)],
  ['emoji/代理对', '😀🎉🇨🇳中文字符'],
  ['null 字节', 'a\u0000b\u0000c'],
  ['markdown 注入', '**加粗** [链接](https://x.com) `代码`'],
  ['空字符串', ''],
  ['纯空白', '   \n\t  '],
  ['只有符号', '!!!###***>>>'],
]

describe('robustness — markdown 消毒链路（模型异常内容不崩溃且不产生 XSS）', () => {
  it.each(MALICIOUS_CASES)('恶意输入消毒彻底: %s', (input) => {
    const rendered = renderMarkdown(input) // sanitize=true 默认路径
    expect(rendered).not.toMatch(/<script/i)
    expect(rendered).not.toMatch(/on\w+\s*=/i)
    expect(rendered).not.toMatch(/href\s*=\s*["']\s*javascript:/i)
  })

  it.each(MALICIOUS_CASES)('恶意输入触发沙箱隔离: %s', (input) => {
    expect(contentNeedsIsolation(input)).toBe(true)
  })

  it.each(WEIRD_CASES)('畸形/极端输入渲染不抛异常: %s', (_name, input) => {
    expect(() => {
      const raw = renderMarkdown(input, { sanitize: false })
      sanitizeHtml(raw)
    }).not.toThrow()
  })

  it('渲染缓存超限不崩溃（FIFO 淘汰路径）', () => {
    for (let i = 0; i < 300; i++) {
      renderMarkdown(`# 标题 ${i}\n内容 ${i}`)
    }
    // 不抛即通过；再渲染一次确认缓存仍工作
    expect(renderMarkdown('# 标题 0\n内容 0')).toContain('标题')
  })

  it('链接自动识别（linkify）与协议过滤', () => {
    const out = renderMarkdown('访问 https://example.com 或 javascript:bad()')
    expect(out).toContain('https://example.com')
    // javascript: 即使作为纯文本出现也绝不能成为 href（linkify 不认该协议，
    // sanitize 层也会移除 javascript: href）
    expect(out).not.toMatch(/href\s*=\s*["']?\s*javascript:/i)
    expect(out).not.toMatch(/<a[^>]*href="javascript:/i)
  })
})
