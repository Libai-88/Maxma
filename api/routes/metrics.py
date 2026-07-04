"""指标查询 API — 运行时指标快照与历史。"""

from fastapi import APIRouter, Query

from api.metrics import get_metrics

router = APIRouter(tags=["metrics"])


@router.get("/metrics")
async def get_metrics_snapshot():
    """返回当前运行时指标快照（JSON）。"""
    return get_metrics().get_snapshot()


@router.get("/metrics/history")
async def get_metrics_history(
    window: int = Query(3600, ge=1, description="回溯窗口（秒）"),
):
    """返回持久化的历史快照列表（按时间升序）。"""
    snapshots = get_metrics().get_history(window)
    return {"window_seconds": window, "snapshots": snapshots}
