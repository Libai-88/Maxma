"""API 路由 — 诊断与错误日志导出。

提供端点：
- GET  /api/diagnostics/error-log       返回 JSON 格式完整错误报告
- GET  /api/diagnostics/error-log/text  返回纯文本格式（便于下载/复制）
- DELETE /api/diagnostics/error-log     清空内存缓冲区
- GET  /api/diagnostics/logs            返回日志文件列表及大小
- DELETE /api/diagnostics/logs          清理旧日志轮转文件（保留当前 maxma.log / tauri.log）
"""

import logging

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from api.diagnostics import error_collector
from app_paths import LOGS_DIR

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


@router.get("/diagnostics/logs")
async def list_log_files():
    """返回日志目录中所有日志文件的信息（名称、大小、路径）。"""
    files = error_collector.get_log_files_info()
    total_bytes = sum(f.get("size_bytes", 0) for f in files)
    return {
        "status": "ok",
        "logs_dir": str(LOGS_DIR),
        "files": files,
        "count": len(files),
        "total_bytes": total_bytes,
        "total_mb": round(total_bytes / (1024 * 1024), 2),
    }


@router.delete("/diagnostics/logs")
async def cleanup_old_log_files():
    """清理旧日志轮转文件，保留当前的 maxma.log 和 tauri.log。

    删除规则：
    - 保留：maxma.log、tauri.log（当前活跃日志）
    - 删除：maxma.log.1~5、tauri.log.1~5、*.log.old 等轮转文件
    """
    deleted_files: list[dict] = []
    freed_bytes = 0

    try:
        if not LOGS_DIR.exists():
            return {
                "status": "ok",
                "deleted_count": 0,
                "freed_bytes": 0,
                "freed_mb": 0.0,
                "deleted_files": [],
                "message": "日志目录不存在",
            }

        # 受保护的当前活跃日志文件（不删除）
        protected_names = {"maxma.log", "tauri.log"}

        for entry in sorted(LOGS_DIR.iterdir(), key=lambda p: p.name):
            if not entry.is_file():
                continue
            name = entry.name
            name_lower = name.lower()

            # 跳过受保护的当前活跃日志
            if name_lower in protected_names:
                continue

            # 仅处理 maxma.log.* / tauri.log.* / *.log.old 轮转文件
            is_rotation = (
                name_lower.startswith("maxma.log.")
                or name_lower.startswith("tauri.log.")
                or name_lower.endswith(".log.old")
            )
            if not is_rotation:
                continue

            try:
                size = entry.stat().st_size
            except OSError:
                size = 0

            try:
                entry.unlink()
                deleted_files.append({
                    "name": name,
                    "size_bytes": size,
                    "path": str(entry),
                })
                freed_bytes += size
                logger.info("[diagnostics] 已删除旧日志文件: %s (%d bytes)", name, size)
            except (OSError, PermissionError) as e:
                logger.warning("[diagnostics] 删除日志文件失败 %s: %s", name, e)

        return {
            "status": "ok",
            "deleted_count": len(deleted_files),
            "freed_bytes": freed_bytes,
            "freed_mb": round(freed_bytes / (1024 * 1024), 2),
            "deleted_files": deleted_files,
        }
    except Exception as e:
        logger.error("[diagnostics] 清理旧日志文件失败: %s", e, exc_info=True)
        return {
            "status": "error",
            "error": str(e),
            "deleted_count": len(deleted_files),
            "freed_bytes": freed_bytes,
            "freed_mb": round(freed_bytes / (1024 * 1024), 2),
            "deleted_files": deleted_files,
        }
