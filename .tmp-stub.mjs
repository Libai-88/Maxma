const enc = new TextEncoder()
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } })
const chunk = (delta, finish = null, usage = undefined) =>
  `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: 'stub-model', choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`
Bun.serve({
  port: 8099,
  async fetch(req) {
    const u = new URL(req.url)
    if (u.pathname === '/v1/models') return json({ object: 'list', data: [{ id: 'stub-model', object: 'model', owned_by: 'audit' }] })
    if (u.pathname === '/v1/chat/completions') {
      const body = await req.json().catch(() => ({}))
      const msgs = Array.isArray(body?.messages) ? body.messages : []
      const lastUser = [...msgs].reverse().find(m => m.role === 'user')
      const text = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '')
      const hasTool = msgs.some(m => m.role === 'tool')
      const wantTool = /SUB/.test(text) && !hasTool
      const frames = wantTool
        ? [
            chunk({ role: 'assistant', content: '' }),
            chunk({ tool_calls: [{ index: 0, id: 'call_sub_1', type: 'function', function: { name: 'subagent', arguments: JSON.stringify({ tasks: [{ label: '子任务A', prompt: '回报：子会话已运行' }, { label: '子任务B', prompt: '回报：子会话已运行' }] }) } }] }),
            chunk({}, 'tool_calls'),
            'data: [DONE]\n\n',
          ]
        : [
            ...['子会话', '已运行', '。'].map(p => chunk({ role: 'assistant', content: p })),
            chunk({}, 'stop', { prompt_tokens: 100, completion_tokens: 6, total_tokens: 106, prompt_tokens_details: { cached_tokens: 64 } }),
            'data: [DONE]\n\n',
          ]
      return new Response(new ReadableStream({ start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close() } }), { headers: { 'content-type': 'text/event-stream' } })
    }
    return json({ error: { message: 'nf' } }, 404)
  },
})
console.log('stub on 8099')
