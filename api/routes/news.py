"""REST API — 系统更新动态。"""

import yaml
from fastapi import APIRouter
from pydantic import BaseModel, field_validator

from app_paths import NEWS_YAML_PATH

router = APIRouter()

NEWS_PATH = NEWS_YAML_PATH


# ── Pydantic 模型 ──


class NewsEntry(BaseModel):
    id: str
    en_title: str | None = None
    title: str
    description: str
    type: str
    date: str
    tags: list[str] = []
    version: str
    pr_number: int | None = None

    @field_validator("pr_number", mode="before")
    @classmethod
    def _blank_pr_number_to_none(cls, v: object) -> object:
        """容错：yaml 中空字符串（''）视为无 PR 号，避免整页加载失败。"""
        if isinstance(v, str) and v.strip() == "":
            return None
        return v


class ListNewsResponse(BaseModel):
    news: list[NewsEntry]


# ── 读取 ──


def _load_news() -> list[NewsEntry]:
    if not NEWS_PATH.exists():
        return []
    with open(NEWS_PATH, encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    entries = [NewsEntry(**item) for item in raw.get("news", [])]
    # 按日期降序排列（最新的在前）
    entries.sort(key=lambda e: e.date, reverse=True)
    return entries


# ── 路由 ──


@router.get("/news", response_model=ListNewsResponse)
def list_news():
    """返回所有更新动态，按日期降序排列。"""
    return ListNewsResponse(news=_load_news())
