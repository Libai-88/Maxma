// 一次性审计桩：OpenAI 兼容的最小流式端点，仅用于验证 WS token 链路。
const enc = new TextEncoder()
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })

Bun.serve({
  port: 8099,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/v1/models') {
      return json({ object: 'list', data: [{ id: 'stub-model', object: 'model', owned_by: 'audit' }] })
    }
    if (url.pathname === '/v1/chat/completions') {
      await req.json().catch(() => ({}))
      const stream = new ReadableStream({
        start(c) {
          const frames = ['链路', '正常', '，', 'token 逐帧到达。']
          for (const piece of frames) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}\n\n`))
          }
          c.enqueue(enc.encode(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`))
          c.enqueue(enc.encode('data: [DONE]\n\n'))
          c.close()
        },
      })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
    }
    return json({ error: { message: 'not found' } }, 404)
  },
})
console.log('stub listening on 8099')