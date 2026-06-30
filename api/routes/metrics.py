"""指标查询 API — 运行时指标快照。"""

from fastapi import APIRouter

from api.metrics import get_metrics

router = APIRouter(tags=["metrics"])


@router.get("/metrics")
async def get_metrics_snapshot():
    """返回当前运行时指标快照（JSON）。"""
    return get_metrics().get_snapshot()
