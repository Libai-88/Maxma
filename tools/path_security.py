"""路径访问控制 — MaxmaBlocker 拒止锚 + 路径白名单 + exec() 安全 builtins。

本模块是文件系统安全防护的核心，包含：
- ``check_maxma_blocker()``  — 逐级检查目录层级中的拒止锚标记文件
- ``check_path_whitelisted()`` — 检查路径是否在白名单允许的范围内
- ``check_path_access()``     — 合并以上两项检查的统一入口
- ``get_safe_builtins()``     — 为 ``exec()`` 构造受限的 builtins 字典
"""

import os
import logging
from pathlib import Path

import yaml

from app_paths import (
    DATA_DIR, BUNDLE_DIR, UPLOADS_DIR,
    PATH_WHITELIST_YAML_PATH, MAXMA_BLOCKER_YAML_PATH,
    ANTHROPIC_SKILLS_DIR, MACROS_DIR, API_DATA_DIR,
)
from api.yaml_store import dump_yaml_atomic, load_yaml

logger = logging.getLogger(__name__)


# ── 路径常量 ────────────────────────────────────────────────

# 项目根目录：开发模式为项目根，打包模式为用户数据目录
_PROJECT_ROOT = str(DATA_DIR)

# 白名单 YAML 路径
_WHITELIST_PATH = PATH_WHITELIST_YAML_PATH

# 默认白名单条目：暴露 anthropic_skills、macros、uploads 目录 + 项目根目录
_DEFAULT_WHITELIST_PATH = str(ANTHROPIC_SKILLS_DIR)
_DEFAULT_MACROS_WHITELIST_PATH = str(MACROS_DIR)
_DEFAULT_UPLOADS_PATH = str(UPLOADS_DIR)
# 项目根目录（开发模式为项目根，打包模式为用户数据目录）
_DEFAULT_PROJECT_ROOT_PATH = str(DATA_DIR)

# MaxmaBlocker 相关常量
_BLOCKER_YAML_PATH = MAXMA_BLOCKER_YAML_PATH
_BLOCKER_FILENAME = "MaxmaBlocker"
_AUTO_BLOCKER_PATH = str(API_DATA_DIR)


# ── 统一入口 ────────────────────────────────────────────────


def check_path_access(target_path: str) -> str | None:
    """合并 MaxmaBlocker + 路径白名单检查。返回错误信息或 None。"""
    blocked = check_maxma_blocker(target_path)
    if blocked:
        return (
            "🚫 安全阻断：操作已被 MaxmaBlocker 阻断。\n"
            f"在以下目录中发现了 MaxmaBlocker 文件：\n  • {blocked}\n\n"
            "请立即停止当前任务，先说明你为什么需要访问该路径，"
            "再说明下一步打算做什么。"
        )
    blocked = check_path_whitelisted(target_path)
    if blocked:
        return f"路径不在白名单中，已拒绝访问：\n  • {target_path}"
    return None


# ── MaxmaBlocker 拒止锚 ─────────────────────────────────────


def check_maxma_blocker(target_path: str) -> str | None:
    """逐级检查路径的每一级目录是否包含 MaxmaBlocker 文件（不区分大小写，不匹配后缀名）。

    从盘符根目录开始，依次检查每一层父目录中是否存在名为 "MaxmaBlocker"
    的文件（任何扩展名均匹配）。一旦发现，返回该目录路径；否则返回 None。
    """
    if not target_path:
        return None

    abs_path = os.path.abspath(target_path)
    p = Path(abs_path)

    # 收集待检查的所有目录层级
    dirs_to_check: list[str] = []

    if p.is_dir():
        dirs_to_check.append(str(p))
    else:
        # 文件还不存在（如 write_file 写入新文件）则检查父目录
        parent = p.parent
        if parent:
            dirs_to_check.append(str(parent))

    # parents 从父目录向上直到根
    dirs_to_check.extend(str(parent) for parent in p.parents)

    # 从根向下逐级检查
    seen: set[str] = set()
    for dir_path in reversed(dirs_to_check):
        normalized = os.path.normpath(dir_path)
        if normalized in seen:
            continue
        seen.add(normalized)
        if not os.path.isdir(normalized):
            continue
        try:
            for entry in os.listdir(normalized):
                entry_name, _ = os.path.splitext(entry)
                if entry_name.lower() == "maxmablocker":
                    # 返回友好的展示形式
                    return normalized
        except (PermissionError, OSError):
            continue

    return None


# ── 路径白名单 ──────────────────────────────────────────────


def _ensure_whitelist() -> None:
    """确保白名单文件存在且包含当前工程的 anthropic_skills 和 macros 目录。

    在模块导入时（即应用启动时）调用一次：
    - 文件不存在 → 自动创建，写入 anthropic_skills + macros 路径
    - 工程被移动（自动条目路径不匹配当前路径） → 更新文件，
      保留用户添加的额外条目，仅替换/添加自动生成条目
    - 文件已存在且自动条目匹配 → 不做任何操作
    """
    if not _WHITELIST_PATH.parent.exists():
        _WHITELIST_PATH.parent.mkdir(parents=True)

    _defaults = _default_entries()

    if not _WHITELIST_PATH.exists():
        _write_whitelist(_defaults)
        return

    # 文件已存在，检查默认路径是否已在白名单中
    try:
        raw = load_yaml(_WHITELIST_PATH, default={}) or {}
        entries = raw.get("whitelist", [])
        if not isinstance(entries, list):
            _write_whitelist(_defaults)
            return

        changed = False
        for default_entry in _defaults:
            target_path = os.path.normpath(os.path.abspath(default_entry["path"]))
            target_desc = default_entry["description"]
            has_current = False
            auto_entry_idx = -1

            for i, entry in enumerate(entries):
                if not isinstance(entry, dict) or "path" not in entry:
                    continue
                entry_path = os.path.normpath(os.path.abspath(entry["path"]))
                if entry_path == target_path:
                    has_current = True
                    break
                if entry.get("description") == target_desc:
                    auto_entry_idx = i

            if has_current:
                continue

            # 工程移动了：更新旧的自动条目，或在开头插入新条目
            if auto_entry_idx >= 0:
                entries[auto_entry_idx]["path"] = str(target_path)
            else:
                entries.insert(0, default_entry)
            changed = True

        if changed:
            dump_yaml_atomic(_WHITELIST_PATH, {"whitelist": entries})

    except (yaml.YAMLError, OSError, ValueError):
        # 文件损坏 → 重写
        _write_whitelist(_defaults)


def _default_entry() -> dict:
    return {
        "path": os.path.normpath(str(_DEFAULT_WHITELIST_PATH)),
        "description": "技能目录（自动生成）",
        "recursive": True,
    }


def _default_macros_entry() -> dict:
    return {
        "path": os.path.normpath(str(_DEFAULT_MACROS_WHITELIST_PATH)),
        "description": "宏目录（自动生成）",
        "recursive": True,
    }


def _default_uploads_entry() -> dict:
    return {
        "path": os.path.normpath(str(_DEFAULT_UPLOADS_PATH)),
        "description": "用户上传文件目录（自动生成）",
        "recursive": True,
    }


def _default_project_root_entry() -> dict:
    return {
        "path": os.path.normpath(str(_DEFAULT_PROJECT_ROOT_PATH)),
        "description": "项目数据目录（自动生成）",
        "recursive": True,
    }


def _default_entries() -> list[dict]:
    """返回所有自动生成的默认白名单条目。"""
    return [
        _default_entry(),
        _default_macros_entry(),
        _default_uploads_entry(),
        _default_project_root_entry(),
    ]


def _write_whitelist(entries: list) -> None:
    content = {
        "whitelist": entries,
    }
    dump_yaml_atomic(_WHITELIST_PATH, content)


def _ensure_blocker() -> None:
    """确保 api/data/ 目录受 MaxmaBlocker 保护。

    在模块导入时自动运行：
    - 如果 api/data/ 下没有 MaxmaBlocker 标记文件 → 创建
    - 如果 maxma_blocker.yaml 中没有对应条目 → 添加
    """
    marker = Path(_AUTO_BLOCKER_PATH) / _BLOCKER_FILENAME
    if not marker.exists():
        try:
            marker.write_text("", encoding="utf-8")
        except OSError:
            return

    if not _BLOCKER_YAML_PATH.exists():
        return

    try:
        raw = load_yaml(_BLOCKER_YAML_PATH, default={}) or {}
        entries = raw.get("blockers", [])
        if not isinstance(entries, list):
            return

        normalized = os.path.normpath(_AUTO_BLOCKER_PATH)
        has_entry = any(
            isinstance(e, dict)
            and os.path.normpath(os.path.abspath(e.get("path", ""))) == normalized
            for e in entries
        )
        if not has_entry:
            entries.insert(
                0,
                {
                    "path": _AUTO_BLOCKER_PATH,
                    "description": "API 数据目录（自动生成）",
                },
            )
            dump_yaml_atomic(_BLOCKER_YAML_PATH, {"blockers": entries})
    except (yaml.YAMLError, OSError):
        logger.warning("failed to ensure blocker metadata", exc_info=True)


# 模块加载时自动执行：确保白名单存在 + api/data/ 拒止锚存在（首次 import 时运行一次）
_ensure_whitelist()
_ensure_blocker()


def _load_path_whitelist() -> list[tuple[str, bool]]:
    """从 YAML 文件加载白名单条目列表。

    每个条目返回 (normalized_path, recursive) 元组。
    recursive=True 时该路径下所有子目录继承访问权限；
    recursive=False 时仅允许访问该确切路径。

    文件格式:
        whitelist:
          - path: "/some/allowed/dir"
            description: ...
            recursive: true
    读取失败时返回空列表（会触发 fail-secure 全阻断）。
    """
    try:
        with open(_WHITELIST_PATH, encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        entries = raw.get("whitelist", [])
        if not isinstance(entries, list):
            return []
        result: list[tuple[str, bool]] = []
        for entry in entries:
            if isinstance(entry, dict) and "path" in entry:
                normalized = os.path.normpath(os.path.abspath(entry["path"]))
                recursive = entry.get("recursive", True)
                if isinstance(recursive, bool):
                    result.append((normalized, recursive))
                else:
                    result.append((normalized, True))
        return result
    except (yaml.YAMLError, OSError, ValueError):
        return []


def check_path_whitelisted(target_path: str) -> str | None:
    """检查 *target_path* 是否位于白名单设置的任一前缀下。

    参数:
        target_path: 待验证的文件或目录路径（相对或绝对均可）。

    返回:
        None      — 允许访问（路径在白名单内）。
        str       — 阻断原因描述，调用方应将其传给 format_error() 返回给 LLM。

    算法行为（按优先级排列）:

        1) 精确匹配
           目标路径与任何条目的路径完全一致 → 放行。这是最高优先级，
           不受该条目或任何父目录条目的 recursive 标志影响。

        2) 非递归阻断
           匹配到某个 non-recursive 条目的子路径 → 阻断。
           non-recursive 的含义是"仅当前目录"——该条目的所有子路径
           均被拒绝，即使更深层另有一个 recursive 子条目也无法覆盖。
           父目录 non-recursive 的阻断强于子目录 recursive 的放行。

        3) 递归放行
           没有任何 non-recursive 父目录阻断，且匹配到某个 recursive
           条目的子路径 → 放行。recursive 的含义是该路径及以下所有
           目录均允许访问。

        4) 无匹配
           没有任何条目匹配 → 阻断。

    Windows 大小写不敏感：Windows 文件系统大小写不敏感，路径比较
    统一转小写后再比较，避免 D:\\ 和 d:\\ 误判为不同路径。
    """
    if not target_path:
        return None

    abs_target = os.path.normpath(os.path.abspath(target_path))
    whitelist = _load_path_whitelist()

    if not whitelist:
        return f"路径不在白名单中: {target_path}（白名单为空或未配置）"

    # Windows 文件系统大小写不敏感，统一转小写比较
    is_windows = os.name == "nt"
    if is_windows:
        abs_target_cmp = abs_target.lower()
    else:
        abs_target_cmp = abs_target

    has_recursive_parent = False

    for allowed_prefix, recursive in whitelist:
        # 去掉末尾分隔符，避免 root 路径（如 T:\）拼接 os.sep 产生双分隔符
        prefix_stripped = allowed_prefix.rstrip(os.sep)
        separator = prefix_stripped + os.sep

        # Windows 大小写不敏感比较
        if is_windows:
            prefix_cmp = prefix_stripped.lower()
            separator_cmp = separator.lower()
            allowed_cmp = allowed_prefix.lower()
        else:
            prefix_cmp = prefix_stripped
            separator_cmp = separator
            allowed_cmp = allowed_prefix

        # 优先级 1: 精确匹配 → 不受 recursive 标志影响
        if abs_target_cmp in (allowed_cmp, prefix_cmp):
            return None

        # 目标不在当前条目的路径树下 → 跳过，检查下一项
        if not abs_target_cmp.startswith(separator_cmp):
            continue

        # 目标在当前条目的子目录中
        if not recursive:
            # 优先级 2: non-recursive → 阻断一切子路径（即使另有 recursive 子条目）
            return f"路径受限: {target_path}（白名单条目 '{allowed_prefix}' 限定仅当前目录）"
        # 优先级 3 候选: recursive 父目录匹配 → 标记，继续检查后续非递归条目
        has_recursive_parent = True

    if has_recursive_parent:
        return None

    return f"路径不在白名单中: {target_path}"


# ── exec() 安全 builtins（维持日常功能，仅拦截 open） ──────


def _whitelisted_open(
    file,
    mode: str = "r",
    buffering: int = -1,
    encoding: str | None = None,
    errors: str | None = None,
    newline: str | None = None,
    closefd: bool = True,
    opener=None,
):
    """``open()`` 的包装版本，在打开文件前先检查 MaxmaBlocker，再检查白名单。

    完全兼容内置 ``open()`` 的全部参数签名。检查顺序：
    1. ``check_maxma_blocker()`` — 若阻断则抛出 ``PermissionError``（Blocker 优先）
    2. ``check_path_whitelisted()`` — 若不在白名单则抛出 ``PermissionError``
    """
    import builtins as _real_builtins

    # 仅对字符串路径进行检查，跳过已打开的文件描述符
    file_str = file
    if isinstance(file, os.PathLike):
        file_str = os.fspath(file)
    if isinstance(file_str, str):
        # 1. MaxmaBlocker 优先
        blocked = check_maxma_blocker(file_str)
        if blocked:
            raise PermissionError(
                "🚫 安全阻断：操作已被 MaxmaBlocker 阻断。\n"
                f"MaxmaBlocker 文件位于: {blocked}\n"
                "请立即停止当前任务。"
            )
        # 2. 白名单次之
        blocked = check_path_whitelisted(file_str)
        if blocked:
            raise PermissionError(blocked)

    return _real_builtins.open(
        file, mode, buffering, encoding, errors, newline, closefd, opener
    )


# 允许在受限 exec 环境中保留的安全内置名称。
# 仅包含纯计算/数据结构/基本 I/O（print）相关的内置函数；
# 任何可能导致代码执行、文件系统访问或进程控制的内置函数均被排除。
# 阶段 3.5 收紧：移除元编程逃逸入口（globals/locals/vars/dir/type/getattr/
# setattr/delattr/super/classmethod/staticmethod/property/memoryview）。
# 这些函数可访问对象内部状态、构造新类型、动态查/改属性，是 Python 沙箱逃逸的
# 标准起点（如 ``().__class__.__bases__[0].__subclasses__()``、``type(...)``、
# ``getattr(obj, '__class__')`` 等）。
_SAFE_BUILTIN_NAMES: frozenset[str] = frozenset({
    "abs", "aiter", "all", "anext", "any", "ascii", "bin", "bool", "bytearray",
    "bytes", "callable", "chr", "complex", "dict",
    "divmod", "enumerate", "filter", "float", "format", "frozenset",
    "hasattr", "hash", "hex", "id", "int",
    "isinstance", "issubclass", "iter", "len", "list", "map", "max",
    "min", "next", "object", "oct", "ord", "pow", "print",
    "range", "repr", "reversed", "round", "set", "slice", "sorted",
    "str", "sum", "tuple", "zip",
})

# 明确禁止在受限 exec 中使用的危险内置函数。
_DANGEROUS_BUILTIN_NAMES: frozenset[str] = frozenset({
    "__import__", "breakpoint", "compile", "copyright", "credits", "eval",
    "exec", "exit", "input", "license", "open", "quit",
})

# 受限 exec 环境中明令阻断的 dunder 属性名（阶段 3.5 新增）。
# 这些属性是 Python 元编程逃逸链路的关键节点，禁止在 exec 代码中通过
# ``obj.__subclasses__``/``obj.__globals__``/``obj.__class__`` 等访问。
# AST 预检 + 沙箱 builtins 双层拦截。
# 阶段 3.5 增强：新增 __getattribute__/__getattr__/__reduce__/__reduce_ex__/__closure__
# 等"元 dunder"——它们可绕过属性访问拦截器本身，是已知的二级逃逸向量。
_BLOCKED_DUNDER_ATTRIBUTES: frozenset[str] = frozenset({
    "__subclasses__",      # type.__subclasses__() → 找到 subprocess.Popen 等危险类型
    "__bases__",           # 类的基类元组 → 顺链找到 object
    "__mro__",             # 方法解析顺序 → 顺链找到 object
    "__class__",           # 实例 → 类型 → 顺链逃逸
    "__globals__",         # 函数对象 → 全局命名空间 → __builtins__
    "__builtins__",        # 模块/帧 → 内置命名空间 → __import__
    "__dict__",            # 任意对象的属性字典 → 内部状态
    "__code__",            # 函数对象 → code object → exec/eval
    "__func__",            # bound method → 原函数 → __globals__
    "__self__",            # bound method → 实例 → __class__
    "__module__",          # 类/函数 → 模块名 → import
    "__loader__",          # 模块 → loader → import 系统
    "__spec__",            # 模块 → ModuleSpec → import 系统
    "__import_subclasses__",  # 防御性变体
    "__getattribute__",    # 元 dunder → 可绕过 _safe_getattr 拦截器
    "__getattr__",         # 元 dunder → 可绕过 _safe_getattr 拦截器
    "__reduce__",          # pickle 协议 → 可能泄露类型信息
    "__reduce_ex__",       # pickle 协议 → 可能泄露类型信息
    "__closure__",         # 函数闭包 → 可能访问外部变量
    "__init_subclass__",   # 类创建钩子 → 可能触发意外代码
    "__subclasshook__",    # ABC 钩子 → 可能触发意外代码
})

# 沙箱专用（tool_python）的安全内置名称 — 比 _SAFE_BUILTIN_NAMES 更严格：
# 不含 open（沙箱内文件 I/O 一律禁用）、不含 hasattr（仍可触发 __getattr__ 链）。
# 实际沙箱 builtins 由 tool_python._SANDBOX_WRAPPER 内联维护（子进程无法 import），
# 此常量供主进程 AST 预检与文档参考。
_SANDBOX_BUILTIN_NAMES: frozenset[str] = _SAFE_BUILTIN_NAMES - {"hasattr"}


def get_safe_builtins() -> dict:
    """构造用于 ``exec()`` 的受限 builtins 字典。

    仅保留常见计算/数据结构相关的内置函数，移除所有可能导致代码执行、
    文件系统访问或进程控制的内置函数（如 ``__import__``、``eval``、``exec``、
    ``compile``、``breakpoint``、``open`` 等）。``open()`` 被替换为经过
    ``check_path_whitelisted()`` 审查的白名单包装版本。

    注意：阶段 3.5 已收紧白名单，移除了 ``globals``/``locals``/``vars``/``dir``/
    ``type``/``getattr``/``setattr``/``delattr``/``super`` 等元编程入口。
    """
    # 在非 __main__ 模块中，__builtins__ 是模块对象而非 dict
    if isinstance(__builtins__, dict):  # type: ignore[name-defined]
        source: dict = __builtins__  # type: ignore[name-defined,assignment]
    else:
        source = __builtins__.__dict__  # type: ignore[name-defined]

    safe: dict = {
        name: value
        for name, value in source.items()  # type: ignore[arg-type]
        if name in _SAFE_BUILTIN_NAMES and name not in _DANGEROUS_BUILTIN_NAMES
    }
    safe["open"] = _whitelisted_open
    safe["__builtins__"] = safe
    return safe


def get_sandbox_builtins() -> dict:
    """构造 run_python 沙箱专用的受限 builtins 字典（阶段 3.5 新增）。

    比 ``get_safe_builtins()`` 更严格：
    - 不含 ``open``（沙箱内文件 I/O 一律禁用）
    - 不含 ``hasattr``（可触发 ``__getattr__`` 链导致元编程逃逸）
    - 不含任何元编程入口（同 ``_SAFE_BUILTIN_NAMES`` 已收紧名单）

    Returns:
        受限 builtins 字典，``__builtins__`` 自引用以供 ``exec`` 使用。
    """
    if isinstance(__builtins__, dict):  # type: ignore[name-defined]
        source: dict = __builtins__  # type: ignore[name-defined,assignment]
    else:
        source = __builtins__.__dict__  # type: ignore[name-defined]

    safe: dict = {
        name: value
        for name, value in source.items()  # type: ignore[arg-type]
        if name in _SANDBOX_BUILTIN_NAMES and name not in _DANGEROUS_BUILTIN_NAMES
    }
    # 沙箱内 __builtins__ 自引用（不提供 open）
    safe["__builtins__"] = safe
    return safe
