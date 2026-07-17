"""Macros API — manage macros/ directory.

宏是可复用的指令片段，存储为 macros/{name}/MACRO.md。
- builtin 宏位于 MACROS_DIR（只读，打包内置）
- user 宏位于 MACROS_DATA_DIR（可写，用户自定义）

合并扫描时 user 优先于 builtin（同名覆盖）。PUT 内置宏会将其提升到 user 目录。
"""
import re
import shutil

from fastapi import APIRouter, HTTPException

from app_paths import MACROS_DATA_DIR, MACROS_DIR

router = APIRouter()

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n?(.*)$", re.DOTALL)


def _parse_frontmatter_fields(fm_text: str) -> dict[str, str]:
    """解析 frontmatter 键值对（name: "x" / description: "y"）。"""
    fields: dict[str, str] = {}
    for line in fm_text.split("\n"):
        if ":" in line:
            key, _, val = line.partition(":")
            fields[key.strip()] = val.strip().strip("\"'")
    return fields


def _parse_macro_file(path) -> tuple[str, str]:
    """解析 MACRO.md，返回 (description, content)。

    兼容两种格式：
    1. frontmatter（TS sidecar 创建）：---\\nname: "x"\\ndescription: "y"\\n---\\n\\ncontent
    2. 首行标题/纯文本：# description\\ncontent
    """
    text = path.read_text("utf-8")
    if text.startswith("---"):
        match = _FRONTMATTER_RE.match(text)
        if match:
            fm_text, content = match.group(1), match.group(2)
            desc = _parse_frontmatter_fields(fm_text).get("description", "")
            return desc, content.lstrip("\n")
    lines = text.split("\n", 1)
    desc = lines[0].lstrip("# ").strip() if lines else ""
    content = lines[1] if len(lines) > 1 else ""
    return desc, content


def _scan_macros(d, source: str) -> list[dict]:
    """扫描目录下所有 {name}/MACRO.md，返回 MacroInfo 列表。"""
    if not d.exists() or not d.is_dir():
        return []
    result: list[dict] = []
    for entry in sorted(d.iterdir()):
        if not entry.is_dir():
            continue
        macro_file = entry / "MACRO.md"
        if not macro_file.exists():
            continue
        desc, _ = _parse_macro_file(macro_file)
        result.append(
            {
                "id": entry.name,
                "name": entry.name,
                "description": desc,
                "path": str(macro_file),
                "source": source,
            }
        )
    return result


def _find_macro(macro_id: str) -> tuple[object, str] | None:
    """查找 macro 文件，user 优先。返回 (path, source) 或 None。"""
    for d, source in [(MACROS_DATA_DIR, "user"), (MACROS_DIR, "builtin")]:
        macro_file = d / macro_id / "MACRO.md"
        if macro_file.exists():
            return macro_file, source
    return None


@router.get("/macros")
async def list_macros():
    """列出所有宏，合并 builtin + user，按 id 去重（user 优先）。"""
    # user 在前：去重保留首次出现，确保 user 覆盖 builtin
    macros = _scan_macros(MACROS_DATA_DIR, "user") + _scan_macros(
        MACROS_DIR, "builtin"
    )
    seen: set[str] = set()
    result: list[dict] = []
    for m in macros:
        if m["id"] not in seen:
            seen.add(m["id"])
            result.append(m)
    return {"macros": result}


@router.get("/macros/{macro_id}")
async def get_macro(macro_id: str):
    """获取单个宏详情（含 content），user 优先于 builtin。"""
    found = _find_macro(macro_id)
    if not found:
        raise HTTPException(404, f"Macro '{macro_id}' not found")
    macro_file, source = found
    desc, content = _parse_macro_file(macro_file)
    return {
        "id": macro_id,
        "name": macro_id,
        "description": desc,
        "content": content,
        "source": source,
    }


@router.post("/macros")
async def create_macro(body: dict):
    """创建新宏到 user 目录。user 已存在则 409；允许覆盖 builtin 同名宏。"""
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    macro_dir = MACROS_DATA_DIR / name
    macro_file = macro_dir / "MACRO.md"
    if macro_file.exists():
        raise HTTPException(409, f"Macro '{name}' already exists")
    macro_dir.mkdir(parents=True, exist_ok=True)
    desc = body.get("description") or name
    content = body.get("content") or ""
    macro_file.write_text(f"# {desc}\n{content}", "utf-8")
    return {
        "id": name,
        "name": name,
        "description": desc,
        "content": content,
        "source": "user",
    }


@router.put("/macros/{macro_id}")
async def update_macro(macro_id: str, body: dict):
    """更新宏。部分字段更新，未提供则保留原值。builtin 宏提升到 user 目录。"""
    found = _find_macro(macro_id)
    if not found:
        raise HTTPException(404, f"Macro '{macro_id}' not found")
    found_path, found_source = found

    old_desc, old_content = _parse_macro_file(found_path)
    new_desc = body.get("description", old_desc)
    new_content = body.get("content", old_content)

    # builtin 宏提升到 user 目录（不修改只读的 builtin）
    write_path = found_path
    if found_source == "builtin":
        write_dir = MACROS_DATA_DIR / macro_id
        write_dir.mkdir(parents=True, exist_ok=True)
        write_path = write_dir / "MACRO.md"

    write_path.write_text(f"# {new_desc}\n{new_content}", "utf-8")
    return {"id": macro_id, "status": "ok"}


@router.delete("/macros/{macro_id}")
async def delete_macro(macro_id: str):
    """删除 user 宏。builtin 宏不可删除（403）。"""
    macro_dir = MACROS_DATA_DIR / macro_id
    macro_file = macro_dir / "MACRO.md"
    if macro_file.exists():
        shutil.rmtree(macro_dir, ignore_errors=True)
        return {"id": macro_id, "status": "ok"}
    builtin_file = MACROS_DIR / macro_id / "MACRO.md"
    if builtin_file.exists():
        raise HTTPException(403, f"Cannot delete builtin macro '{macro_id}'")
    raise HTTPException(404, f"Macro '{macro_id}' not found")
