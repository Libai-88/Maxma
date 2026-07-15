"""Checkpointer 工厂 — 进程级持久化 checkpointer 管理。

提供基于 SQLite 的持久化 checkpointer，替代 MemorySaver：
- 启用后所有会话状态持久化到磁盘，进程重启可恢复
- 单例模式：全局共享一个 AsyncSqliteSaver 实例（thread_id 区分会话）
- 安全回退：SQLite 不可用时回退到 MemorySaver

生命周期：
    lifespan startup → init_persistent_checkpointer()
    SessionState.checkpointer → get_persistent_checkpointer()
    lifespan shutdown → close_persistent_checkpointer()
"""

import logging
import threading
from typing import Any

from app_paths import DATA_DIR

logger = logging.getLogger(__name__)

# 全局单例（双重检查锁）
_checkpointer: Any | None = None
_checkpointer_lock = threading.Lock()
_checkpointer_db_path: str = ""


def _resolve_db_path() -> str:
    """解析 SQLite 数据库路径。

    优先使用 settings.persistence_db_path，留空时使用 DATA_DIR/checkpoints.sqlite。
    """
    try:
        from config.settings import get_settings
        custom = get_settings().persistence_db_path
        if custom:
            return custom
    except Exception:
        pass
    return str(DATA_DIR / "checkpoints.sqlite")


async def init_persistent_checkpointer() -> Any:
    """初始化持久化 checkpointer（lifespan startup 调用）。

    创建 AsyncSqliteSaver 单例并建立数据库连接。
    若 SQLite 不可用或配置禁用，回退到 MemorySaver。
    """
    global _checkpointer, _checkpointer_db_path

    if _checkpointer is not None:
        return _checkpointer

    try:
        from config.settings import get_settings
        enabled = get_settings().persistence_enabled
    except Exception:
        enabled = True

    if not enabled:
        logger.info("[checkpointer] 持久化已禁用，使用 MemorySaver")
        try:
                    from langgraph.checkpoint.memory import MemorySaver
        except ImportError:
            MemorySaver = None

        with _checkpointer_lock:
            if _checkpointer is None:
                _checkpointer = MemorySaver() if MemorySaver else None
        return _checkpointer

    db_path = _resolve_db_path()
    try:
        import aiosqlite
        try:
                    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
        except ImportError:
            MemorySaver = None


        conn = await aiosqlite.connect(db_path)
        # WAL 模式提升并发写入性能
        await conn.execute("PRAGMA journal_mode=WAL;")
        await conn.commit()
        saver = AsyncSqliteSaver(conn)
        # 触发 setup 建表
        await saver.setup()

        with _checkpointer_lock:
            if _checkpointer is None:
                _checkpointer = saver
                _checkpointer_db_path = db_path
            else:
                # 并发初始化时关闭多余连接
                await conn.close()

        logger.info("[checkpointer] SQLite 持久化已启用: %s", db_path)
        return _checkpointer
    except Exception as e:
        logger.warning(
            "[checkpointer] SQLite 初始化失败，回退到 MemorySaver: %s", e
        )
        try:
                    from langgraph.checkpoint.memory import MemorySaver
        except ImportError:
            MemorySaver = None

        with _checkpointer_lock:
            if _checkpointer is None:
                _checkpointer = MemorySaver() if MemorySaver else None
        return _checkpointer


def get_persistent_checkpointer() -> Any:
    """获取持久化 checkpointer 单例（同步，供 SessionState 默认值使用）。

    若未初始化（如测试场景），回退到 MemorySaver。
    """
    global _checkpointer
    if _checkpointer is not None:
        return _checkpointer
    # 未初始化时回退到 MemorySaver（测试/独立模块加载场景）
    with _checkpointer_lock:
        if _checkpointer is None:
            try:
                from config.settings import get_settings
                if not get_settings().persistence_enabled:
                    try:
                                            from langgraph.checkpoint.memory import MemorySaver
                    except ImportError:
                        MemorySaver = None

                    _checkpointer = MemorySaver()
                    return _checkpointer
            except Exception:
                pass
            # 默认回退：MemorySaver（init_persistent_checkpointer 尚未调用）
            try:
                            from langgraph.checkpoint.memory import MemorySaver
            except ImportError:
                MemorySaver = None

            _checkpointer = MemorySaver()
    return _checkpointer


async def close_persistent_checkpointer() -> None:
    """关闭持久化 checkpointer（lifespan shutdown 调用）。

    释放数据库连接。MemorySaver 无需关闭。
    """
    global _checkpointer, _checkpointer_db_path
    with _checkpointer_lock:
        cp = _checkpointer
        _checkpointer = None
        _checkpointer_db_path = ""

    if cp is None:
        return

    # AsyncSqliteSaver 持有 aiosqlite.Connection
    conn = getattr(cp, "conn", None)
    if conn is not None and hasattr(conn, "close"):
        try:
            await conn.close()
            logger.info("[checkpointer] SQLite 连接已关闭")
        except Exception as e:
            logger.warning("[checkpointer] 关闭 SQLite 连接失败: %s", e)


def get_checkpointer_info() -> dict:
    """返回 checkpointer 状态信息（供健康检查/前端展示）。"""
    cp = _checkpointer
    if cp is None:
        return {"type": "uninitialized"}
    cp_type = type(cp).__name__
    return {
        "type": cp_type,
        "persistent": cp_type == "AsyncSqliteSaver",
        "db_path": _checkpointer_db_path or "",
    }
