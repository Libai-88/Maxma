"""Activity Hub REST + SSE 路由。

提供端点：
- GET    /api/activity/recent  获取最近的活动记录
- GET    /api/activity/stats    获取活动统计信息
- DELETE /api/activity          清空活动缓冲区
- GET    /api/activity/stream   SSE 流式推送活动事件
"""
from __future__ import annotations

import asyncio
import json
import time

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from api.activity_hub import activity_hub

router = APIRouter()


@router.get("/activity/recent")
async def get_recent(limit: int = 100, category: str | None = None) -> dict:
    """获取最近的活动记录。"""
    records = activity_hub.recent(limit=limit, category=category)
    return {
        "records": [r.to_dict() for r in records],
        "total": len(records),
    }


@router.get("/activity/stats")
async def get_stats() -> dict:
    """获取活动统计信息。"""
    return activity_hub.stats()


@router.delete("/activity")
async def clear_activity() -> dict:
    """清空活动缓冲区。"""
    count = activity_hub.clear()
    return {"cleared": count}


@router.get("/activity/stream")
async def stream_activity(request: Request):
    """SSE 流式推送活动事件。

    客户端通过 EventSource 连接，实时接收新活动。
    使用轮询 deque 的方式（每 1s 检查一次），避免复杂的发布订阅机制。
    """
    async def event_generator():
        # 用时间戳做游标，避免 deque 满后 len 索引错位
        last_ts = time.time()
        while True:
            if await request.is_disconnected():
                break
            records = activity_hub.recent(limit=10000)
            new_records = [r for r in records if r.timestamp > last_ts]
            for record in new_records:
                data = json.dumps(record.to_dict(), ensure_ascii=False)
                yield f"event: activity\ndata: {data}\n\n"
            if new_records:
                last_ts = new_records[-1].timestamp
            await asyncio.sleep(1.0)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
