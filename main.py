"""MaxmaHere — LangGraph ReAct AI Agent Web 入口。"""

import sys

import uvicorn
from version import __version__

from api.logging_config import setup_logging
from api.server import create_app
from memory.user_init import ensure_all


def main():
    # 初始化日志系统（在其他模块导入之前）
    setup_logging()

    # CLI：轮换 Token
    if "--rotate-token" in sys.argv:
        from api.auth import rotate_token

        rotated = rotate_token()
        print(f"[auth] Token rotated: {rotated}")
        return

    import logging
    logger = logging.getLogger(__name__)
    logger.info("MaxmaHere %s starting", __version__)

    ensure_all()

    app = create_app()
    uvicorn.run(app, host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
