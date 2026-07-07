"""API 路由 — 诊断与错误日志导出。

提供端点：
- GET  /api/diagnostics/error-log       返回 JSON 格式完整错误报告
- GET  /api/diagnostics/error-log/text  返回纯文本格式（便于下载/复制）
- DELETE /api/diagnostics/error-log     清空内存缓冲区
"""

import logging

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from api.diagnostics import error_collector

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/diagnostics/error-log")
async def export_error_log():
    """导出完整错误报告（JSON 格式）。

    包含内存缓冲区错误 + 日志文件扫描错误 + 系统信息。
    """
    return error_collector.export_report()


@router.get("/diagnostics/error-log/text")
async def export_error_log_text():
    """导出纯文本错误报告（便于下载或复制粘贴）。"""
    text = error_collector.export_text_report()
    return PlainTextResponse(
        content=text,
        media_type="text/plain; charset=utf-8",
        headers={
            "Content-Disposition": (
                'attachment; filename="maxma-error-report.txt"'
            )
        },
    )


@router.delete("/diagnostics/error-log")
async def clear_error_log():
    """清空内存缓冲区中的错误记录（不影响日志文件）。"""
    deleted = error_collector.clear()
    logger.info("[diagnostics] 错误收集器内存缓冲区已清空，删除 %d 条记录", deleted)
    return {"status": "ok", "deleted": deleted}
