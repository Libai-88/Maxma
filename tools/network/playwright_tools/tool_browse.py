"""Tool: browser_browse — 使用 Playwright 无头浏览器访问网页并提取文本内容。"""

from typing import Literal

from pydantic import BaseModel, Field
from bs4 import BeautifulSoup

from tools.base import ToolBase, format_success, format_error
from tools.network.playwright_tools.browser_manager import BrowserManager


class BrowserBrowseInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    url: str = Field(description="要访问的网页 URL（必须包含 http:// 或 https://）")
    wait_until: Literal["load", "domcontentloaded", "networkidle", "commit"] = Field(
        default="load",
        description="等待策略: load / domcontentloaded / networkidle / commit",
    )
    wait_for_selector: str | None = Field(
        default=None,
        description="可选 CSS 选择器，等待该元素出现后再提取内容",
    )
    timeout: int = Field(default=30, ge=5, le=120, description="页面加载超时（秒）")
    max_length: int = Field(
        default=8000,
        ge=500,
        le=50000,
        description="返回文本最大字符数，超出部分截断",
    )


class BrowserBrowseTool(ToolBase):
    name: str = "browser_browse"
    description: str = (
        "使用 Playwright 无头浏览器访问网页并提取页面内容（纯文本）。"
        "适用于需要 JavaScript 渲染的动态页面（SPA、Vue/React 站点）。"
        "对于静态页面，优先使用 tavily_extract 以节省资源。"
        "[调用积极性: 仅在 tavily_extract 无法获取内容时使用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = BrowserBrowseInput

    def _run(
        self,
        get_doc: bool = False,
        url: str = "",
        wait_until: Literal["load", "domcontentloaded", "networkidle", "commit"] = "load",
        wait_for_selector: str | None = None,
        timeout: int = 30,
        max_length: int = 8000,
    ) -> str:
        if get_doc:
            return self._load_doc()
        if not url:
            return format_error("url 不能为空")

        # 校验 URL 格式
        if not url.startswith(("http://", "https://")):
            return format_error("url 必须以 http:// 或 https:// 开头")

        ctx = None
        try:
            bm = BrowserManager()
            ctx = bm.new_context(timeout=timeout * 1000)
            page = ctx.new_page()

            # 导航到目标页面
            page.goto(url, wait_until=wait_until, timeout=timeout * 1000)

            # 可选：等待特定元素出现
            if wait_for_selector:
                page.wait_for_selector(wait_for_selector, timeout=timeout * 1000)

            # 提取页面内容
            title = page.title()
            final_url = page.url
            html = page.content()

            # 使用 BeautifulSoup 提取干净的文本
            soup = BeautifulSoup(html, "html.parser")

            # 移除不需要的标签
            for tag in soup.find_all(
                ["script", "style", "nav", "footer", "header", "noscript", "svg"]
            ):
                tag.decompose()

            # 优先提取 main/article 区域，否则用 body
            main_content = soup.find("main") or soup.find("article") or soup.find("body")
            if main_content:
                text = main_content.get_text(separator="\n", strip=True)
            else:
                text = soup.get_text(separator="\n", strip=True)

            # 清理多余空行
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            text = "\n".join(lines)

            # 截断处理
            truncated = False
            if len(text) > max_length:
                text = text[:max_length] + "\n\n...(内容已截断)"
                truncated = True

            return format_success(
                {
                    "url": final_url,
                    "title": title,
                    "content": text,
                    "content_length": len(text),
                    "truncated": truncated,
                }
            )

        except Exception as e:
            return format_error(f"网页浏览失败: {str(e)}")
        finally:
            if ctx is not None:
                try:
                    ctx.close()
                except Exception:
                    pass
