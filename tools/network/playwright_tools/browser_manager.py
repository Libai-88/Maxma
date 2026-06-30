"""Playwright 浏览器生命周期管理 — 单例模式，headless Chromium。"""

import threading
from pathlib import Path

from playwright.sync_api import sync_playwright, Playwright, Browser, BrowserContext, ViewportSize


class BrowserManager:
    """线程安全的单例浏览器管理器。

    生命周期：
    - 浏览器在首次调用 new_context() 时懒加载创建
    - 每次工具调用创建独立的 BrowserContext（隔离 cookies/storage）
    - shutdown() 在应用关闭时清理浏览器资源
    """

    _instance: "BrowserManager | None" = None
    _lock = threading.Lock()
    _initialized: bool = False

    def __new__(cls) -> "BrowserManager":
        with cls._lock:
            if cls._instance is None:
                cls._instance = super().__new__(cls)
            return cls._instance

    def __init__(self) -> None:
        if BrowserManager._initialized:
            return
        BrowserManager._initialized = True
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._browser_lock = threading.Lock()

    def _ensure_browser(self) -> Browser:
        """懒加载初始化 Playwright + Chromium。线程安全。"""
        with self._browser_lock:
            if self._browser is None:
                self._playwright = sync_playwright().start()
                self._browser = self._playwright.chromium.launch(
                    headless=True,
                )
            return self._browser

    def new_context(
        self,
        viewport: ViewportSize | None = None,
        user_agent: str | None = None,
        timeout: int = 30000,
    ) -> BrowserContext:
        """创建隔离的浏览器上下文（每次调用独立）。

        Args:
            viewport: 视口尺寸，默认 1280x720
            user_agent: 自定义 User-Agent
            timeout: 默认超时（毫秒）
        """
        browser = self._ensure_browser()
        ctx = browser.new_context(
            viewport=viewport or {"width": 1280, "height": 720},
            user_agent=(
                user_agent
                or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        ctx.set_default_timeout(timeout)
        return ctx

    def shutdown(self) -> None:
        """清理浏览器和 Playwright 资源。应用关闭时调用。"""
        with self._browser_lock:
            if self._browser is not None:
                try:
                    self._browser.close()
                except Exception:
                    pass
                self._browser = None
            if self._playwright is not None:
                try:
                    self._playwright.stop()
                except Exception:
                    pass
                self._playwright = None
