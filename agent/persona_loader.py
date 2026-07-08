"""三层人设系统：Yuan（思考模式）+ Identity（身份）+ Ishiki（人格规则）。"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

PERSONA_DIR = Path(__file__).parent / "persona"


def _read_template(name: str, layer: str) -> str:
    """读取人设模板文件，解析 frontmatter 和正文。"""
    file_path = PERSONA_DIR / f"{layer}_{name}.md"
    if not file_path.exists():
        file_path = PERSONA_DIR / f"{layer}_default.md"
    if not file_path.exists():
        return ""
    content = file_path.read_text(encoding="utf-8")
    # 去掉 frontmatter
    content = re.sub(r'^---\n.*?\n---\n', '', content, flags=re.DOTALL)
    return content.strip()


def _parse_frontmatter(name: str, layer: str) -> dict[str, str]:
    """解析 frontmatter。"""
    file_path = PERSONA_DIR / f"{layer}_{name}.md"
    if not file_path.exists():
        file_path = PERSONA_DIR / f"{layer}_default.md"
    if not file_path.exists():
        return {}
    content = file_path.read_text(encoding="utf-8")
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return {}
    result: dict[str, str] = {}
    for line in match.group(1).split('\n'):
        if ':' in line:
            key, _, val = line.partition(':')
            result[key.strip()] = val.strip()
    return result


def load_persona(name: str = "default", *, user_name: str = "用户") -> dict[str, Any]:
    """加载三层人设。

    Returns:
        {"identity": str, "yuan": str, "ishiki": str, "metadata": dict}
    """
    identity_raw = _read_template(name, "identity")
    yuan_raw = _read_template(name, "yuan")
    ishiki_raw = _read_template(name, "ishiki")

    # 替换 {{userName}} 占位符
    identity = identity_raw.replace("{{userName}}", user_name)
    yuan = yuan_raw.replace("{{userName}}", user_name)
    ishiki = ishiki_raw.replace("{{userName}}", user_name)

    metadata = {
        "identity": _parse_frontmatter(name, "identity"),
        "yuan": _parse_frontmatter(name, "yuan"),
        "ishiki": _parse_frontmatter(name, "ishiki"),
    }

    return {
        "identity": identity,
        "yuan": yuan,
        "ishiki": ishiki,
        "metadata": metadata,
    }


def build_persona_prompt(persona: dict[str, Any]) -> str:
    """组合三层人设为 system prompt。

    静态前缀顺序：identity → yuan → ishiki（cache 友好）。
    """
    parts: list[str] = []

    if persona.get("identity"):
        parts.append(f"# 身份\n{persona['identity']}")

    if persona.get("yuan"):
        parts.append(f"# 思考模式\n{persona['yuan']}")

    if persona.get("ishiki"):
        parts.append(f"# 人格规则\n{persona['ishiki']}")

    return "\n\n".join(parts)
