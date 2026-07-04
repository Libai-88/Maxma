"""工具注册表 — 去中心化注册 + 目录扫描自动发现。

使用方式：
    from tools.registry import register_tool

    @register_tool
    class MyTool(ToolBase):
        name: str = "my_tool"
        ...

设计要点：
- ``_REGISTRY`` 全局表存储类对象（非实例），按 name 去重
- ``@register_tool`` 装饰器在类定义时把类追加到注册表
- ``discover_tools()`` 扫描 ``tools`` 包下所有子模块，导入 ``tool_*`` 模块让装饰器执行
- ``instantiate_tools(client)`` 实例化所有已注册类

PyInstaller 兼容性：使用 ``pkgutil.iter_modules`` 而非 ``Path.rglob`` 扫描模块，
因为打包后 ``.py`` 文件位于 PYZ 归档内，磁盘上不可见。
"""

from __future__ import annotations

import importlib
import logging
import pkgutil
from typing import TYPE_CHECKING

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from langchain_core.tools import BaseTool

    from tools.client import SharedAPIClient

# 全局注册表：tool_name -> ToolBase 子类
_REGISTRY: dict[str, type["BaseTool"]] = {}

# 已扫描标记，避免重复导入
_discovered: bool = False


class ToolRegistryError(RuntimeError):
    """工具注册表错误。"""


def _get_tool_name(cls: type) -> str | None:
    """从 pydantic v2 BaseTool 子类提取 name 字段默认值。

    Pydantic v2 中字段默认值不在类属性中，需从 ``model_fields`` 读取。
    """
    # Pydantic v2: 从 model_fields 读取默认值
    model_fields = getattr(cls, "model_fields", None)
    if model_fields and "name" in model_fields:
        field_info = model_fields["name"]
        default = getattr(field_info, "default", None)
        if default is not None:
            return str(default)
    # 回退：类属性直接访问（非 pydantic 模型或 pydantic v1）
    name = getattr(cls, "name", None)
    if name:
        return str(name)
    return None


def register_tool(cls: type["BaseTool"]) -> type["BaseTool"]:
    """类装饰器：把 ToolBase 子类注册到全局 ``_REGISTRY``。

    以类的 ``name`` 字段作为唯一键，重复注册同名工具抛错。
    """
    tool_name = _get_tool_name(cls)
    if not tool_name:
        raise ToolRegistryError(
            f"@register_tool: {cls.__module__}.{cls.__qualname__} 缺少 name 属性"
        )
    if tool_name in _REGISTRY:
        existing = _REGISTRY[tool_name]
        if existing is cls:
            return cls
        raise ToolRegistryError(
            f"@register_tool: 工具名 '{tool_name}' 已被 "
            f"{existing.__module__}.{existing.__qualname__} 注册，"
            f"无法重复注册为 {cls.__module__}.{cls.__qualname__}"
        )
    _REGISTRY[tool_name] = cls
    logger.debug(
        "[registry] registered %s -> %s.%s",
        tool_name,
        cls.__module__,
        cls.__qualname__,
    )
    return cls


def get_registered_classes() -> dict[str, type["BaseTool"]]:
    """返回已注册工具类字典（name -> class）。"""
    return dict(_REGISTRY)


def discover_tools() -> None:
    """递归扫描 ``tools`` 包下所有 ``tool_*`` 模块并导入，触发 ``@register_tool`` 注册。

    幂等：已扫描过则直接返回。
    使用 ``pkgutil.iter_modules`` 扫描，兼容开发模式和 PyInstaller 打包模式
    （打包后 .py 文件在 PYZ 归档内，Path.rglob 无法找到）。
    """
    global _discovered
    if _discovered:
        return

    import tools as _tools_pkg

    # pkgutil.iter_modules 遍历包的所有子模块（递归），包括 PYZ 内的模块
    for finder, modname, ispkg in pkgutil.walk_packages(
        _tools_pkg.__path__,
        prefix=_tools_pkg.__name__ + ".",
    ):
        # 仅导入 tool_* 模块（跳过 __init__、辅助模块等）
        if not modname.rsplit(".", 1)[-1].startswith("tool_"):
            continue
        try:
            importlib.import_module(modname)
        except Exception as e:
            logger.error("[registry] import %s failed: %s", modname, e, exc_info=True)

    _discovered = True
    logger.info("[registry] discovered %d tool(s)", len(_REGISTRY))


def clear_registry() -> None:
    """清空注册表（仅用于测试）。"""
    global _discovered
    _REGISTRY.clear()
    _discovered = False


def instantiate_tools(client: "SharedAPIClient | None") -> list["BaseTool"]:
    """发现并实例化所有已注册的工具类。

    Args:
        client: SharedAPIClient 实例，传给每个工具构造函数

    Returns:
        工具实例列表
    """
    discover_tools()
    instances: list["BaseTool"] = []
    for tool_name, cls in _REGISTRY.items():
        try:
            instance = cls(client=client)
            instances.append(instance)
        except Exception as e:
            logger.error(
                "[registry] instantiate %s (%s) failed: %s",
                tool_name,
                cls.__qualname__,
                e,
                exc_info=True,
            )
    return instances
