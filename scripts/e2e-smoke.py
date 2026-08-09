# -*- coding: utf-8 -*-
"""端到端 WS 会话冒烟：连接后端，发起真实 LLM 会话。

默认读便携版 token；可用环境变量 MAXMA_DB 指向其他实例的 maxma.db。
"""
import asyncio
import json
import os
import sqlite3
import sys
import websockets

PORT = 8000
BASE = f"127.0.0.1:{PORT}"

def get_token():
    db_path = os.environ.get(
        "MAXMA_DB",
        r"D:\Maxma\MaxmaHere-Portable\data\api\data\maxma.db",
    )
    db = sqlite3.connect(db_path)
    row = db.execute("SELECT token FROM auth_tokens LIMIT 1").fetchone()
    return row[0] if row else ""

async def main():
    token = get_token()
    session_id = "smoke-e2e-001"
    uri = f"ws://{BASE}/ws/chat/{session_id}"
    headers = {"X-Maxma-Token": token}
    print(f"[e2e] connecting {uri}")
    async with websockets.connect(uri, additional_headers=headers, open_timeout=15) as ws:
        # ping 握手
        await ws.send(json.dumps({"type": "ping", "payload": {}}))
        pong = await asyncio.wait_for(ws.recv(), timeout=10)
        print("[e2e] ping->", str(pong)[:120])

        # 发起真实会话（内置 opencode-zen 免费模型）
        msg = {
            "type": "chat",
            "payload": {
                "message": "请用一句话回答：Maxma 是什么？",
                "provider_id": "opencode-zen",
                "model_name": "deepseek-v4-flash-free",
            },
        }
        await ws.send(json.dumps(msg))
        print("[e2e] chat sent, waiting for events...")

        events = []
        answer_parts = []
        done = False
        try:
            while not done:
                raw = await asyncio.wait_for(ws.recv(), timeout=90)
                evt = json.loads(raw)
                events.append(evt.get("type"))
                etype = evt.get("type")
                if etype == "token":
                    answer_parts.append(evt.get("payload", {}).get("token", ""))
                elif etype == "answer":
                    answer_parts.append(evt.get("payload", {}).get("content", ""))
                elif etype in ("done", "error", "close"):
                    if etype == "error":
                        print(f"[e2e] ERROR EVENT: {json.dumps(evt.get('payload', {}), ensure_ascii=False)[:400]}")
                    done = True
        except asyncio.TimeoutError:
            print("[e2e] TIMEOUT waiting for completion")

        answer = "".join(answer_parts).strip()
        print(f"[e2e] event types: {events}")
        print(f"[e2e] answer length: {len(answer)}")
        print(f"[e2e] answer preview: {answer[:200]}")
        ok = any(t in events for t in ("token", "answer")) and len(answer) > 5
        print(f"[e2e] RESULT: {'PASS' if ok else 'FAIL'}")
        sys.exit(0 if ok else 1)

asyncio.run(main())
