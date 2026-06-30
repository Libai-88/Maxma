"""系统提示词组装（带内容哈希缓存）。"""

import hashlib
import re
from pathlib import Path

from memory.narrative import get_narrative
from memory.user_init import ensure_user_md

PERSONAS_DIR = Path(__file__).resolve().parent.parent / "config" / "personas"
ANTHROPIC_SKILLS_DIR = Path(__file__).resolve().parent.parent / "anthropic_skills"
MACROS_DIR = Path(__file__).resolve().parent.parent / "macros"


# ── 内容哈希缓存 ────────────────────────────────────────────

_cached_fingerprint: str | None = None
_cached_prompt: str = ""
_cached_parts: list[dict] = []


def _file_hash(path: Path) -> str:
    """计算文件内容的 MD5 摘要（仅 hex 前 16 位）。"""
    try:
        return hashlib.md5(path.read_bytes()).hexdigest()[:16]
    except OSError:
        return ""


def _current_fingerprint() -> str:
    """根据所有依赖文件的内容哈希生成指纹字符串。

    依赖文件包括 personas 目录下的 AGENTS/SOUL/USER/memory.yaml，
    以及 anthropic_skills/ 和 macros/ 下的所有 SKILL.md / MACRO.md。
    """
    parts: list[str] = []

    # 固定 personas 文件
    for name in ("AGENTS.md", "SOUL.md", "USER.md", "memory.yaml"):
        parts.append(f"{name}:{_file_hash(PERSONAS_DIR / name)}")

    # 动态扫描 skills / macros
    if ANTHROPIC_SKILLS_DIR.is_dir():
        for p in sorted(ANTHROPIC_SKILLS_DIR.rglob("SKILL.md")):
            parts.append(f"sk:{p.name}:{_file_hash(p)}")

    if MACROS_DIR.is_dir():
        for p in sorted(MACROS_DIR.rglob("MACRO.md")):
            parts.append(f"mc:{p.name}:{_file_hash(p)}")

    return "|".join(parts)


def _rebuild(fingerprint: str) -> None:
    """重新构建缓存的系统提示词和 parts。"""
    global _cached_fingerprint, _cached_prompt, _cached_parts

    ensure_user_md()

    # 解析用户称呼，用于替换 SOUL.md 中的 {{USER_NAME}}
    user_md_raw = _read_if_exists("USER.md")
    user_name = _parse_user_name(user_md_raw)
    soul_content = _read_persona("SOUL.md")
    if user_name:
        soul_content = soul_content.replace("{{USER_NAME}}", user_name)
    else:
        # 未配置称呼时保留占位符，但替换为通用称呼避免 LLM 困惑
        soul_content = soul_content.replace("{{USER_NAME}}", "你")

    # ── parts（用于 token 细分展示）──
    # 按变化频率从低到高排列：稳定内容在前，频繁变化的放最后。
    # 这样 Anthropic/OpenAI prompt caching 可以缓存更长的前缀，
    # 记忆变化时不会导致 skills/macros 等稳定部分的缓存失效。
    _cached_parts = [
        {"key": "behavior_rules", "label": "系统行为规则",
         "content": "## 行为规则\n" + _read_persona("AGENTS.md")},
        {"key": "personality", "label": "性格人设",
         "content": "## 性格设定\n" + soul_content},
        {"key": "user_self_report", "label": "用户自述",
         "content": "## 用户自述\n" + user_md_raw},
        {"key": "skills", "label": "Skills 清单",
         "content": _scan_anthropic_skills()},
        {"key": "macros", "label": "宏清单",
         "content": _scan_macros()},
        {"key": "long_term_memory", "label": "长期记忆",
         "content": "## 我对用户的记忆\n" + get_narrative()},
    ]

    # ── 完整 prompt ──
    # 与 _cached_parts 保持一致顺序：稳定内容在前，记忆放最后
    full_parts = [
        "## 行为规则",
        _read_persona("AGENTS.md"),
        "",
        "## 性格设定",
        soul_content,
        "",
        "## 用户自述",
        user_md_raw,
        "",
        _scan_anthropic_skills(),
        "",
        _scan_macros(),
        "",
        "## 我对用户的记忆",
        get_narrative(),
    ]
    _cached_prompt = "\n".join(full_parts)
    _cached_fingerprint = fingerprint


def _ensure_cache() -> None:
    """检查指纹，若依赖文件有变化则重建缓存。"""
    fp = _current_fingerprint()
    if fp != _cached_fingerprint:
        _rebuild(fp)


def invalidate_prompt_cache() -> None:
    """强制清空缓存（供外部调用，例如记忆更新后）。"""
    global _cached_fingerprint, _cached_prompt, _cached_parts
    _cached_fingerprint = None
    _cached_prompt = ""
    _cached_parts = []


def _read_persona(filename: str) -> str:
    path = PERSONAS_DIR / filename
    if path.exists():
        return path.read_text(encoding="utf-8")
    return ""


def _read_if_exists(filename: str) -> str:
    """读取 personas 文件，不存在返回空字符串（不走缓存）。"""
    path = PERSONAS_DIR / filename
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    return ""


def _parse_user_name(user_md_content: str) -> str:
    """从 USER.md 结构化模板中提取称呼。

    匹配格式：``**称呼**：xxx`` 或 ``**称呼**: xxx``
    若未填写或格式不匹配，返回空字符串。
    """
    m = re.search(r"\*\*称呼\*\*\s*[：:]\s*(.+)", user_md_content)
    if not m:
        return ""
    name = m.group(1).strip()
    # 过滤掉占位符文本（括号内的提示文字）
    if not name or name.startswith("（") or name.startswith("("):
        return ""
    return name


def _parse_frontmatter(text: str) -> dict[str, str]:
    """简易解析 YAML frontmatter，提取 name 和 description。"""
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key in ("name", "description"):
                meta[key] = val
    return meta


def _scan_anthropic_skills() -> str:
    """扫描 anthropic_skills/ 下所有 SKILL.md，返回元数据清单。"""
    if not ANTHROPIC_SKILLS_DIR.is_dir():
        return ""
    entries: list[str] = []
    for sk_path in sorted(ANTHROPIC_SKILLS_DIR.rglob("SKILL.md")):
        rel = sk_path.relative_to(ANTHROPIC_SKILLS_DIR).parent
        meta = _parse_frontmatter(sk_path.read_text(encoding="utf-8"))
        name = meta.get("name", rel.name)
        desc = meta.get("description", "")
        path_str = str(sk_path).replace("\\", "/")
        if desc:
            entries.append(f"- [{name}]({path_str}): {desc}")
        else:
            entries.append(f"- [{name}]({path_str})")
    if not entries:
        return ""
    lines = [
        "## 可用 Anthropic Skills",
        "以下 skill 文件存放在 `anthropic_skills/` 目录中，包含完整的任务指令和流程。",
        "当你需要执行符合上述描述的任务时，应使用文件读取工具按需读取对应 SKILL.md 的完整内容。",
        "",
        *entries,
    ]
    return "\n".join(lines)


def _scan_macros() -> str:
    """扫描 macros/ 下所有 MACRO.md，返回元数据清单。"""
    if not MACROS_DIR.is_dir():
        return ""
    entries: list[str] = []
    for mp_path in sorted(MACROS_DIR.rglob("MACRO.md")):
        rel = mp_path.relative_to(MACROS_DIR).parent
        meta = _parse_frontmatter(mp_path.read_text(encoding="utf-8"))
        name = meta.get("name", rel.name)
        desc = meta.get("description", "")
        path_str = str(mp_path).replace("\\", "/")
        if desc:
            entries.append(f"- [{name}]({path_str}): {desc}")
        else:
            entries.append(f"- [{name}]({path_str})")
    if not entries:
        return ""
    lines = [
        "## 可用宏",
        "以下宏文件存放在 `macros/` 目录中，包含可复用的指令片段。",
        "当你需要执行符合上述描述的任务时，应使用文件读取工具按需读取对应 MACRO.md 的完整内容。",
        "",
        *entries,
    ]
    return "\n".join(lines)


def get_system_prompt_parts() -> list[dict]:
    """返回系统提示词的各组成部分（含标题+内容），用于 token 细分展示。

    每个元素::
        {"key": str, "label": str, "content": str}
    """
    _ensure_cache()
    return list(_cached_parts)


def build_system_prompt() -> str:
    """组装完整系统提示词，依赖文件未变化时直接返回缓存。"""
    _ensure_cache()
    return _cached_prompt
