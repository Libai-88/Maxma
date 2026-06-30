"""Tool: browser_screenshot — 使用 Playwright 无头浏览器对网页截图。"""

import time
import uuid
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_success, format_error
from tools.network.playwright_tools.browser_manager import BrowserManager

# 上传目录（与 api/routes/upload.py 一致）
_UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent.parent / "uploads"
_UPLOAD_DIR.mkdir(exist_ok=True)


class BrowserScreenshotInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    url: str = Field(description="要截图的网页 URL")
    full_page: bool = Field(
        default=False, description="是否截取完整页面（包括滚动区域）"
    )
    wait_until: Literal["load", "domcontentloaded", "networkidle", "commit"] = Field(
        default="load",
        description="等待策略: load / domcontentloaded / networkidle / commit",
    )
    wait_for_selector: str | None = Field(
        default=None,
        description="可选 CSS 选择器，等待该元素出现后再截图",
    )
    viewport_width: int = Field(
        default=1280, ge=320, le=3840, description="视口宽度（像素）"
    )
    viewport_height: int = Field(
        default=720, ge=240, le=2160, description="视口高度（像素）"
    )
    timeout: int = Field(default=30, ge=5, le=120, description="页面加载超时（秒）")


class BrowserScreenshotTool(ToolBase):
    name: str = "browser_screenshot"
    description: str = (
        "使用 Playwright 无头浏览器对网页截图，保存为 PNG 文件并返回路径。"
        "截图保存到 uploads/ 目录，可通过 analyze_image 工具进一步分析。"
        "[调用积极性: 可自由看情况调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = BrowserScreenshotInput

    def _run(
        self,
        get_doc: bool = False,
        url: str = "",
        full_page: bool = False,
        wait_until: Literal["load", "domcontentloaded", "networkidle", "commit"] = "load",
        wait_for_selector: str | None = None,
        viewport_width: int = 1280,
        viewport_height: int = 720,
        timeout: int = 30,
    ) -> str:
        if get_doc:
            return self._load_doc()
        if not url:
            return format_error("url 不能为空")
        if not url.startswith(("http://", "https://")):
            return format_error("url 必须以 http:// 或 https:// 开头")

        ctx = None
        try:
            bm = BrowserManager()
            ctx = bm.new_context(
                viewport={"width": viewport_width, "height": viewport_height},
                timeout=timeout * 1000,
            )
            page = ctx.new_page()

            # 导航到目标页面
            page.goto(url, wait_until=wait_until, timeout=timeout * 1000)

            # 可选：等待特定元素
            if wait_for_selector:
                page.wait_for_selector(wait_for_selector, timeout=timeout * 1000)

            # 生成文件名
            file_id = uuid.uuid4().hex[:8]
            timestamp = int(time.time())
            filename = f"screenshot_{file_id}_{timestamp}.png"
            save_path = _UPLOAD_DIR / filename

            # 截图
            page.screenshot(path=str(save_path), full_page=full_page)

            file_size = save_path.stat().st_size

            return format_success(
                {
                    "path": str(save_path),
                    "local_path": f"local:{save_path}",
                    "filename": filename,
                    "size_bytes": file_size,
                    "viewport": {"width": viewport_width, "height": viewport_height},
                    "full_page": full_page,
                    "message": f"截图已保存，可通过 analyze_image 工具使用 local:{save_path} 分析",
                }
            )

        except Exception as e:
            return format_error(f"网页截图失败: {str(e)}")
        finally:
            if ctx is not None:
                try:
                    ctx.close()
                except Exception:
                    pass
