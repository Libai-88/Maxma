"""所有 Tool 共享的 HTTP 客户端，API Key 仅加载一次。

连接池与重试策略：
- requests.Session 挂载 HTTPAdapter，pool_connections / pool_maxsize 控制连接复用
- Retry 策略：总计 3 次重试，仅对 5xx 和连接错误生效，指数退避 (0.5s → 1s → 2s)
- 默认超时 30 秒，amap_request 可单独覆盖
"""

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from uapi import UapiClient
from todoist_api_python.api import TodoistAPI

from config.settings import get_settings

_DEFAULT_TIMEOUT = 30  # 秒


def _make_retry_strategy() -> Retry:
    """构造指数退避重试策略。"""
    return Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=[500, 502, 503, 504],
        allowed_methods=["GET", "POST"],
        raise_on_status=False,
    )


def _make_adapter() -> HTTPAdapter:
    """创建带连接池 + 重试的 HTTPAdapter。"""
    return HTTPAdapter(
        pool_connections=10,
        pool_maxsize=20,
        max_retries=_make_retry_strategy(),
    )


class SharedAPIClient:
    """所有 Tool 共享的 HTTP 客户端，API Key 仅加载一次。"""

    def __init__(self):
        settings = get_settings()

        self._session = requests.Session()
        adapter = _make_adapter()
        self._session.mount("http://", adapter)
        self._session.mount("https://", adapter)
        self._session.headers.update({"User-Agent": "MaxmaHere/1.0"})

        self._uapi: UapiClient | None = None
        self._todoist: TodoistAPI | None = None
        self._amap_key = settings.amap_api_key
        self._uapis_key = settings.uapis_api_key
        self._todoist_token = settings.todoist_api_token

    @property
    def session(self) -> requests.Session:
        """暴露底层 Session，供需要直接发 HTTP 请求的工具使用。"""
        return self._session

    @property
    def uapi(self) -> UapiClient:
        if self._uapi is None:
            self._uapi = UapiClient("https://uapis.cn", token=self._uapis_key)
        return self._uapi

    @property
    def todoist(self) -> TodoistAPI:
        if self._todoist is None:
            self._todoist = TodoistAPI(self._todoist_token)
        return self._todoist

    @property
    def amap_key(self) -> str:
        return self._amap_key

    def amap_request(self, endpoint: str, params: dict, timeout: int = _DEFAULT_TIMEOUT) -> dict:
        """发起高德地图 API 请求。"""
        params["key"] = self._amap_key
        resp = self._session.get(
            f"https://restapi.amap.com{endpoint}",
            params=params,
            timeout=timeout,
        )
        resp.raise_for_status()
        return dict(resp.json())

    def http_get(self, url: str, **kwargs) -> requests.Response:
        """通用 GET 请求，自动注入超时和重试。"""
        kwargs.setdefault("timeout", _DEFAULT_TIMEOUT)
        return self._session.get(url, **kwargs)

    def close(self):
        self._session.close()
