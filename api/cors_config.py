"""CORS 来源配置 — 独立小模块，避免被 server.py 的完整 import 链拖累测试。"""

import os

from config.settings import get_settings


def build_cors_origins() -> list[str]:
    """根据 Settings 与环境变量构建 CORS allow_origins 列表。

    开发环境仅放行 Vite 端口，生产环境额外加上后端自身 origin 与 Tauri 协议。
    """
    settings = get_settings()
    api_port = settings.maxma_api_port
    web_port = settings.maxma_web_port

    cors_origins = [
        f"http://localhost:{web_port}",
        f"http://127.0.0.1:{web_port}",
    ]
    if os.environ.get("MAXMA_ENV") == "production":
        cors_origins += [
            f"http://localhost:{api_port}",
            f"http://127.0.0.1:{api_port}",
            # Tauri v2 协议
            "tauri://localhost",
            "https://tauri.localhost",
        ]
    return cors_origins
