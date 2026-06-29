"""所有 Tool 共享的 HTTP 客户端，API Key 仅加载一次。"""

import requests
from uapi import UapiClient
from todoist_api_python.api import TodoistAPI

from config.settings import get_settings


class SharedAPIClient:
    """所有 Tool 共享的 HTTP 客户端，API Key 仅加载一次。"""

    def __init__(self):
        settings = get_settings()
        self._session = requests.Session()
        self._uapi: UapiClient | None = None
        self._todoist: TodoistAPI | None = None
        self._amap_key = settings.amap_api_key
        self._uapis_key = settings.uapis_api_key
        self._todoist_token = settings.todoist_api_token

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

    def amap_request(self, endpoint: str, params: dict) -> dict:
        """发起高德地图 API 请求。"""
        params["key"] = self._amap_key
        resp = self._session.get(f"https://restapi.amap.com{endpoint}", params=params)
        resp.raise_for_status()
        return resp.json()

    def close(self):
        self._session.close()
