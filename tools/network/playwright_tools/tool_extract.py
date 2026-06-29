"""Tool: browser_extract — 使用 Playwright 通过 CSS 选择器或 JS 提取结构化数据。"""

from pydantic import BaseModel, Field

from tools.base import ToolBase, format_success, format_error
from tools.network.playwright_tools.browser_manager import BrowserManager


class BrowserExtractInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    url: str = Field(description="目标网页 URL")
    selectors: list[str] = Field(
        default_factory=list,
        description="CSS 选择器列表，依次提取每个选择器匹配元素的文本内容",
    )
    attributes: list[str] | None = Field(
        default=None,
        description="要提取的元素属性列表（如 ['href', 'src']），None 则仅提取 textContent",
    )
    javascript: str | None = Field(
        default=None,
        description="可选 JS 表达式，在页面中执行并返回结果（优先级高于 selectors）",
    )
    wait_until: str = Field(
        default="load",
        description="等待策略: load / domcontentloaded / networkidle / commit",
    )
    timeout: int = Field(default=30, ge=5, le=120, description="页面加载超时（秒）")


class BrowserExtractTool(ToolBase):
    name: str = "browser_extract"
    description: str = (
        "使用 Playwright 无头浏览器访问网页，通过 CSS 选择器或 JavaScript 提取结构化数据。"
        "适用于需要从特定 HTML 元素中提取文本、链接、属性等结构化信息的场景。"
        "支持自定义 JS 表达式执行。[调用积极性: 可自由看情况调用] [get_doc: 仅在发生错误时 get_doc]"
    )
    args_schema: type[BaseModel] = BrowserExtractInput

    def _run(
        self,
        get_doc: bool = False,
        url: str = "",
        selectors: list[str] | None = None,
        attributes: list[str] | None = None,
        javascript: str | None = None,
        wait_until: str = "load",
        timeout: int = 30,
    ) -> str:
        if get_doc:
            return self._load_doc()
        if not url:
            return format_error("url 不能为空")
        if not url.startswith(("http://", "https://")):
            return format_error("url 必须以 http:// 或 https:// 开头")
        if not selectors and not javascript:
            return format_error("selectors 和 javascript 不能同时为空")

        ctx = None
        try:
            bm = BrowserManager()
            ctx = bm.new_context(timeout=timeout * 1000)
            page = ctx.new_page()

            # 导航到目标页面
            page.goto(url, wait_until=wait_until, timeout=timeout * 1000)

            result: dict = {"url": page.url, "title": page.title()}

            # JavaScript 模式（优先级更高）
            if javascript:
                try:
                    js_result = page.evaluate(javascript)
                    result["js_result"] = js_result
                except Exception as e:
                    result["js_error"] = f"JS 执行失败: {str(e)}"

            # CSS 选择器模式
            elif selectors:
                selector_results = {}
                attrs = attributes or []

                for selector in selectors:
                    try:
                        elements = page.query_selector_all(selector)
                        matches = []
                        for el in elements:
                            item: dict = {"text": el.inner_text()}
                            # 提取请求的属性
                            for attr in attrs:
                                item[attr] = el.get_attribute(attr)
                            matches.append(item)
                        selector_results[selector] = matches
                    except Exception as e:
                        selector_results[selector] = {"error": str(e)}

                result["results"] = selector_results

            return format_success(result)

        except Exception as e:
            return format_error(f"数据提取失败: {str(e)}")
        finally:
            if ctx is not None:
                try:
                    ctx.close()
                except Exception:
                    pass
