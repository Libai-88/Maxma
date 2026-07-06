"""Tool: manage_skills — 通过自然语言管理 Skills（技能）。"""

import base64
import json
import re
import shutil
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from pydantic import BaseModel, Field

from app_paths import ANTHROPIC_SKILLS_DIR, SKILLS_DATA_DIR
from tools.base import ToolBase, format_error, format_success, register_tool

_SAFE_ID = re.compile(r"^[a-zA-Z0-9_\-][a-zA-Z0-9_\- .]{0,63}$")


def _valid_id(value: str) -> str | None:
    """校验 ID，返回清洗后的值或 None（无效时）。"""
    v = value.strip()
    if not v or not _SAFE_ID.match(v) or ".." in v or "/" in v or "\\" in v:
        return None
    return v


class ManageSkillsInput(BaseModel):
    get_doc: bool = Field(default=False, description="设为 true 以获取使用说明")
    action: str = Field(
        default="list",
        description="操作类型: list（列出）、get（查看详情）、create（创建）、update（更新）、delete（删除）、import（从外部导入）",
    )
    skill_id: str = Field(default="", description="Skill ID（get/update/delete 时必填）")
    name: str = Field(default="", description="Skill 名称（create 时必填，小写字母+连字符）")
    description: str = Field(default="", description="Skill 描述")
    content: str = Field(default="", description="SKILL.md 完整内容（create/update 时使用）")
    source: str = Field(
        default="",
        description="import 操作的来源：GitHub 'owner/repo' 或 'owner/repo@skill-name'、"
        "raw URL 指向 SKILL.md、或本地目录绝对路径",
    )


def _parse_frontmatter(text: str) -> dict[str, str]:
    """解析 YAML frontmatter（支持多行 | 和 >），提取 name/description。"""
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    meta: dict[str, str] = {}
    lines = m.group(1).splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if ":" in line:
            key, _, val = line.partition(":")
            key = key.strip()
            val = val.strip()
            if key in ("name", "description"):
                if val in ("|", ">"):
                    parts: list[str] = []
                    i += 1
                    while i < len(lines) and (lines[i].startswith("  ") or lines[i].startswith("\t")):
                        parts.append(lines[i].strip())
                        i += 1
                    meta[key] = " ".join(parts)
                    continue
                else:
                    meta[key] = val.strip('"').strip("'")
        i += 1
    return meta


def _scan_skills_dir(base_dir, source_label: str) -> list[dict]:
    """扫描指定目录下的所有 SKILL.md。单个文件损坏不会影响其他文件。"""
    if not base_dir.is_dir():
        return []
    skills = []
    try:
        iter_paths = sorted(base_dir.rglob("SKILL.md"))
    except (OSError, RecursionError):
        return []
    for sk_path in iter_paths:
        try:
            content = sk_path.read_text(encoding="utf-8")
            meta = _parse_frontmatter(content)
        except (OSError, UnicodeDecodeError):
            continue
        rel = sk_path.relative_to(base_dir).parent
        skills.append({
            "id": str(rel),
            "name": meta.get("name", str(rel)),
            "description": meta.get("description", ""),
            "source": source_label,
            "_canon": str(sk_path.resolve()),  # 用于去重
        })
    return skills


def _find_skill(skill_id: str):
    """查找 skill，返回 (SKILL.md path, source_label) 或 None。"""
    for base, label in [(SKILLS_DATA_DIR, "user"), (ANTHROPIC_SKILLS_DIR, "builtin")]:
        p = base / skill_id / "SKILL.md"
        if p.exists():
            return p, label
    return None


def _invalidate_prompt_cache():
    """失效 system prompt 缓存，使新 Skill 出现在提示词中。"""
    try:
        from agent.prompts import invalidate_prompt_cache
        invalidate_prompt_cache()
    except Exception:
        pass


@register_tool
class ManageSkillsTool(ToolBase):
    name: str = "manage_skills"
    description: str = (
        "管理 Skills（技能）：列出、查看、创建、更新、删除 Skill。"
        "Skill 是可复用的任务指令模板，Maxma 在需要时自动读取并遵循。"
        "[调用积极性: 当用户要求创建/管理技能、任务模板、或标准化流程时主动调用]"
    )
    args_schema: type[BaseModel] = ManageSkillsInput

    def _run(
        self,
        get_doc: bool = False,
        action: str = "list",
        skill_id: str = "",
        name: str = "",
        description: str = "",
        content: str = "",
        source: str = "",
    ) -> str:
        if get_doc:
            return self._load_doc()

        action = action.strip().lower()

        if action == "list":
            # 开发模式下 ANTHROPIC_SKILLS_DIR 与 SKILLS_DATA_DIR 可能指向同一目录，
            # 按 canonical path 去重（与 agent/prompts.py 策略一致）
            all_skills = _scan_skills_dir(ANTHROPIC_SKILLS_DIR, "builtin")
            all_skills += _scan_skills_dir(SKILLS_DATA_DIR, "user")
            # 按 _canon 去重：同一物理文件只保留首次出现（builtin 优先）
            seen: set[str] = set()
            deduped: list[dict] = []
            for s in all_skills:
                canon = s.pop("_canon", "")
                if canon and canon in seen:
                    continue
                if canon:
                    seen.add(canon)
                deduped.append(s)
            skills = deduped
            if not skills:
                return format_success({"message": "当前没有任何 Skill", "skills": []})
            summary = []
            for s in skills:
                tag = "内置" if s["source"] == "builtin" else "自定义"
                summary.append(f"- [{tag}] {s['id']}: {s['description'] or '(无描述)'}")
            return format_success({
                "message": f"共 {len(skills)} 个 Skill",
                "skills": skills,
                "summary": "\n".join(summary),
            })

        if action == "get":
            if not skill_id:
                return format_error("skill_id 不能为空")
            skill_id = _valid_id(skill_id)
            if skill_id is None:
                return format_error("skill_id 格式不合法，仅允许字母、数字、连字符、下划线")
            result = _find_skill(skill_id)
            if result is None:
                return format_error(f"Skill '{skill_id}' 不存在")
            sk_path, source = result
            full_content = sk_path.read_text(encoding="utf-8")
            meta = _parse_frontmatter(full_content)
            return format_success({
                "id": skill_id,
                "name": meta.get("name", skill_id),
                "description": meta.get("description", ""),
                "source": source,
                "content": full_content,
            })

        if action == "create":
            target_name = name or skill_id
            if not target_name:
                return format_error("name 不能为空，请指定 Skill 名称")
            target_name = _valid_id(target_name)
            if target_name is None:
                return format_error("名称格式不合法，仅允许字母、数字、连字符、下划线（1-64 字符）")
            skill_dir = SKILLS_DATA_DIR / target_name
            if skill_dir.exists():
                return format_error(f"Skill '{target_name}' 已存在")
            # 检查与内置 skill 的命名冲突（避免用户 skill 被静默遮蔽）
            builtin_path = ANTHROPIC_SKILLS_DIR / target_name / "SKILL.md"
            if builtin_path.exists():
                return format_error(
                    f"内置 Skill '{target_name}' 已存在，请使用其他名称以避免冲突"
                )
            skill_dir.mkdir(parents=True, exist_ok=True)

            if content:
                final_content = content
            else:
                final_content = f"""---
name: {target_name}
description: {description}
---

# {target_name}

{description}

## 使用场景
- 当用户需要...

## 步骤
1. ...
2. ...

## 注意事项
- ...
"""
            sk_path = skill_dir / "SKILL.md"
            sk_path.write_text(final_content, encoding="utf-8")
            _invalidate_prompt_cache()
            return format_success({
                "message": f"已创建 Skill '{target_name}'",
                "id": target_name,
            })

        if action == "update":
            if not skill_id:
                return format_error("skill_id 不能为空")
            skill_id = _valid_id(skill_id)
            if skill_id is None:
                return format_error("skill_id 格式不合法")
            result = _find_skill(skill_id)
            if result is None:
                return format_error(f"Skill '{skill_id}' 不存在")
            sk_path, source = result
            if source == "builtin":
                return format_error("内置 Skill 不可编辑，请创建一个新的自定义 Skill")
            if content:
                sk_path.write_text(content, encoding="utf-8")
            elif description:
                old_content = sk_path.read_text(encoding="utf-8")
                meta = _parse_frontmatter(old_content)
                meta["description"] = description
                fm_lines = [f"{k}: {v}" for k, v in meta.items()]
                new_content = re.sub(
                    r"^---\s*\n.*?\n---",
                    "---\n" + "\n".join(fm_lines) + "\n---",
                    old_content,
                    count=1,
                    flags=re.DOTALL,
                )
                sk_path.write_text(new_content, encoding="utf-8")
            _invalidate_prompt_cache()
            return format_success({
                "message": f"已更新 Skill '{skill_id}'",
                "id": skill_id,
            })

        if action == "delete":
            if not skill_id:
                return format_error("skill_id 不能为空")
            skill_id = _valid_id(skill_id)
            if skill_id is None:
                return format_error("skill_id 格式不合法")
            result = _find_skill(skill_id)
            if result is None:
                return format_error(f"Skill '{skill_id}' 不存在")
            sk_path, source = result
            if source == "builtin":
                return format_error("内置 Skill 不可删除")
            skill_dir = sk_path.parent
            try:
                shutil.rmtree(skill_dir)
            except OSError as exc:
                return format_error(f"删除失败: {exc}")
            _invalidate_prompt_cache()
            return format_success({
                "message": f"已删除 Skill '{skill_id}'",
                "id": skill_id,
            })

        if action == "import":
            return self._handle_import(source, skill_id)

        return format_error(f"未知操作: {action}，支持 list/get/create/update/delete/import")

    # ── import 实现 ─────────────────────────────────────────────

    def _handle_import(self, source: str, skill_id_override: str) -> str:
        """从外部来源导入 Skill。

        支持三种来源：
        1. GitHub: 'owner/repo' 或 'owner/repo@skill-name'
        2. URL: 指向 SKILL.md 的 raw URL（https://raw.githubusercontent.com/...）
        3. 本地路径: 包含 SKILL.md 的目录绝对路径
        """
        if not source:
            return format_error("source 不能为空，请提供 GitHub owner/repo、URL 或本地路径")

        source = source.strip()

        # 判断来源类型
        if source.startswith(("http://", "https://")):
            return self._import_from_url(source, skill_id_override)
        elif Path(source).exists() and Path(source).is_dir():
            return self._import_from_local(source, skill_id_override)
        elif re.match(r"^[\w.-]+/[\w.-]+(@[\w.-]+)?$", source):
            return self._import_from_github(source, skill_id_override)
        else:
            return format_error(
                f"无法识别 source 格式: {source}\n"
                "支持：GitHub 'owner/repo'、'owner/repo@skill'、URL、本地目录路径"
            )

    def _import_from_local(self, local_path: str, skill_id_override: str) -> str:
        """从本地目录导入 Skill。"""
        src_dir = Path(local_path).resolve()
        sk_file = src_dir / "SKILL.md"
        if not sk_file.exists():
            return format_error(f"目录中未找到 SKILL.md: {src_dir}")

        try:
            content = sk_file.read_text(encoding="utf-8")
        except OSError as e:
            return format_error(f"读取 SKILL.md 失败: {e}")

        meta = _parse_frontmatter(content)
        skill_name = skill_id_override or meta.get("name", src_dir.name)
        skill_name = _valid_id(skill_name)
        if skill_name is None:
            return format_error(f"从 frontmatter 解析的 name 不合法: {meta.get('name')}")

        target_dir = SKILLS_DATA_DIR / skill_name
        if target_dir.exists():
            return format_error(f"Skill '{skill_name}' 已存在，如需覆盖请先 delete")
        # 检查与内置 skill 的命名冲突
        builtin_path = ANTHROPIC_SKILLS_DIR / skill_name / "SKILL.md"
        if builtin_path.exists():
            return format_error(
                f"内置 Skill '{skill_name}' 已存在，请使用其他名称以避免冲突"
            )

        target_dir.mkdir(parents=True, exist_ok=True)
        # 复制整个目录（包含 scripts/ references/ 等子目录）
        # 安全防护：拒绝跟随指向源目录外的符号链接，防止路径穿越攻击
        src_resolved = src_dir.resolve()
        try:
            for item in src_dir.rglob("*"):
                # 符号链接防护：检查真实路径是否仍在 src_dir 内
                if item.is_symlink():
                    try:
                        real = item.resolve()
                        real.relative_to(src_resolved)
                    except ValueError:
                        # 符号链接指向源目录外，跳过
                        continue
                if item.is_file():
                    rel = item.relative_to(src_dir)
                    # 安全检查：防止路径穿越
                    rel_str = str(rel).replace("\\", "/")
                    if ".." in rel_str or rel_str.startswith("/"):
                        continue
                    target_file = target_dir / rel
                    target_file.parent.mkdir(parents=True, exist_ok=True)
                    # 不跟随符号链接：copy2 默认会跟随，这里用 follow_symlinks=False
                    shutil.copy2(str(item), str(target_file), follow_symlinks=False)
        except OSError as e:
            shutil.rmtree(target_dir, ignore_errors=True)
            return format_error(f"复制文件失败: {e}")

        _invalidate_prompt_cache()
        return format_success({
            "message": f"已从本地导入 Skill '{skill_name}'（来源: {src_dir}）",
            "id": skill_name,
            "source": f"local:{src_dir}",
            "files_copied": sum(1 for _ in target_dir.rglob("*") if _.is_file()),
        })

    def _import_from_url(self, url: str, skill_id_override: str) -> str:
        """从 URL 导入单个 SKILL.md 文件。"""
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Maxma/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status != 200:
                    return format_error(f"HTTP {resp.status}: {url}")
                content = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            return format_error(f"HTTP 错误 {e.code}: {e.reason}")
        except urllib.error.URLError as e:
            return format_error(f"URL 错误: {e.reason}")
        except Exception as e:
            return format_error(f"获取失败: {e}")

        meta = _parse_frontmatter(content)
        if not meta.get("name"):
            return format_error("URL 内容缺少有效的 frontmatter（name 字段必填）")

        skill_name = skill_id_override or meta["name"]
        skill_name = _valid_id(skill_name)
        if skill_name is None:
            return format_error(f"name 不合法: {meta.get('name')}")

        target_dir = SKILLS_DATA_DIR / skill_name
        if target_dir.exists():
            return format_error(f"Skill '{skill_name}' 已存在，如需覆盖请先 delete")
        # 检查与内置 skill 的命名冲突
        builtin_path = ANTHROPIC_SKILLS_DIR / skill_name / "SKILL.md"
        if builtin_path.exists():
            return format_error(
                f"内置 Skill '{skill_name}' 已存在，请使用其他名称以避免冲突"
            )

        target_dir.mkdir(parents=True, exist_ok=True)
        (target_dir / "SKILL.md").write_text(content, encoding="utf-8")
        _invalidate_prompt_cache()
        return format_success({
            "message": f"已从 URL 导入 Skill '{skill_name}'",
            "id": skill_name,
            "source": url,
        })

    def _import_from_github(self, repo_spec: str, skill_id_override: str) -> str:
        """从 GitHub 仓库导入 Skill。

        支持格式：
        - 'owner/repo' → 搜索仓库根目录和常见目录（skills/、anthropic_skills/）下的 SKILL.md
        - 'owner/repo@skill-name' → 导入特定 skill 子目录
        """
        if "@" in repo_spec:
            repo_part, skill_part = repo_spec.split("@", 1)
            skill_to_find = skill_part
        else:
            repo_part = repo_spec
            skill_to_find = None

        # 验证 owner/repo 格式
        if not re.match(r"^[\w.-]+/[\w.-]+$", repo_part):
            return format_error(f"GitHub 仓库格式不合法: {repo_part}，应为 owner/repo")

        owner, repo = repo_part.split("/", 1)

        # 尝试通过 GitHub API 列出仓库内容
        # 先尝试 main 分支，失败再试 master
        candidates = []
        for branch in ("main", "master"):
            listing = self._github_list_dir(owner, repo, "", branch)
            if listing is not None:
                candidates = listing
                break

        if candidates is None:
            return format_error(
                f"无法访问 GitHub 仓库 {owner}/{repo}（可能是私有仓库或不存在）"
            )

        # 找到含 SKILL.md 的目录
        # 策略：先看根目录有没有 SKILL.md，再看 skills/ 和 anthropic_skills/ 子目录
        skill_dirs = []

        # 1. 根目录直接有 SKILL.md
        if any(item.get("name") == "SKILL.md" and item.get("type") == "file" for item in candidates):
            skill_dirs.append(("", ""))  # (dir_path, skill_name_from_dir)

        # 2. 检查常见子目录
        for subdir_name in ("skills", "anthropic_skills"):
            subdir_items = self._github_list_dir(owner, repo, subdir_name, branch)
            if subdir_items is None:
                continue
            for item in subdir_items:
                if item.get("type") == "dir":
                    # 检查这个子目录里有没有 SKILL.md
                    sub_items = self._github_list_dir(owner, repo, f"{subdir_name}/{item['name']}", branch)
                    if sub_items and any(i.get("name") == "SKILL.md" for i in sub_items):
                        skill_dirs.append((f"{subdir_name}/{item['name']}", item["name"]))

        # 3. 根目录下的子目录
        for item in candidates:
            if item.get("type") == "dir" and item["name"] not in (".git", ".github", "docs", "scripts"):
                sub_items = self._github_list_dir(owner, repo, item["name"], branch)
                if sub_items and any(i.get("name") == "SKILL.md" for i in sub_items):
                    skill_dirs.append((item["name"], item["name"]))

        if not skill_dirs:
            return format_error(f"在 {owner}/{repo} 中未找到任何含 SKILL.md 的目录")

        # 如果指定了 skill-name，过滤
        if skill_to_find:
            filtered = [(p, n) for p, n in skill_dirs if n == skill_to_find]
            if not filtered:
                available = ", ".join(n for _, n in skill_dirs)
                return format_error(
                    f"未找到 skill '{skill_to_find}'，可用: {available}"
                )
            skill_dirs = filtered

        # 如果有多个，全部导入
        imported = []
        errors = []
        for dir_path, dir_name in skill_dirs:
            result = self._github_fetch_and_install(
                owner, repo, branch, dir_path, dir_name, skill_id_override
            )
            if result.get("ok"):
                imported.append(result["id"])
            else:
                errors.append(f"{dir_name}: {result.get('error')}")

        if not imported:
            return format_error(f"导入失败: {'; '.join(errors)}")

        msg = f"已从 GitHub {owner}/{repo} 导入 {len(imported)} 个 Skill: {', '.join(imported)}"
        if errors:
            msg += f"\n部分失败: {'; '.join(errors)}"

        return format_success({
            "message": msg,
            "imported": imported,
            "errors": errors,
            "source": f"github:{owner}/{repo}@{branch}",
        })

    def _github_list_dir(self, owner: str, repo: str, path: str, branch: str) -> list[dict] | None:
        """通过 GitHub API 列出目录内容。返回 None 表示失败。"""
        url = f"https://api.github.com/repos/{owner}/{repo}/contents/{urllib.parse.quote(path)}?ref={branch}"
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Maxma/1.0",
                "Accept": "application/vnd.github.v3+json",
            })
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status != 200:
                    return None
                data = json.loads(resp.read().decode("utf-8"))
                if isinstance(data, list):
                    return data
                return None
        except Exception:
            return None

    def _github_fetch_and_install(
        self, owner: str, repo: str, branch: str, dir_path: str,
        dir_name: str, skill_id_override: str,
    ) -> dict:
        """从 GitHub 抓取 skill 目录并安装。"""
        # 先抓 SKILL.md
        skill_md_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{dir_path}/SKILL.md"
        try:
            req = urllib.request.Request(skill_md_url, headers={"User-Agent": "Maxma/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                if resp.status != 200:
                    return {"ok": False, "error": f"HTTP {resp.status}"}
                content = resp.read().decode("utf-8", errors="replace")
        except Exception as e:
            return {"ok": False, "error": str(e)}

        meta = _parse_frontmatter(content)
        skill_name = skill_id_override or meta.get("name", dir_name)
        skill_name = _valid_id(skill_name)
        if skill_name is None:
            return {"ok": False, "error": f"name 不合法: {meta.get('name', dir_name)}"}

        target_dir = SKILLS_DATA_DIR / skill_name
        if target_dir.exists():
            return {"ok": False, "error": f"已存在（如需覆盖请先 delete）"}
        # 检查与内置 skill 的命名冲突
        builtin_path = ANTHROPIC_SKILLS_DIR / skill_name / "SKILL.md"
        if builtin_path.exists():
            return {"ok": False, "error": f"内置 Skill '{skill_name}' 已存在，请使用其他名称"}

        target_dir.mkdir(parents=True, exist_ok=True)
        (target_dir / "SKILL.md").write_text(content, encoding="utf-8")

        # 尝试抓取 scripts/ 和 references/ 子目录（如果有）
        for subdir in ("scripts", "references", "assets", "templates"):
            sub_items = self._github_list_dir(owner, repo, f"{dir_path}/{subdir}" if dir_path else subdir, branch)
            if not sub_items:
                continue
            local_subdir = target_dir / subdir
            local_subdir.mkdir(exist_ok=True)
            for item in sub_items:
                if item.get("type") == "file" and item.get("download_url"):
                    try:
                        file_req = urllib.request.Request(
                            item["download_url"],
                            headers={"User-Agent": "Maxma/1.0"},
                        )
                        with urllib.request.urlopen(file_req, timeout=30) as resp:
                            file_content = resp.read()
                        (local_subdir / item["name"]).write_bytes(file_content)
                    except Exception:
                        pass  # 子文件失败不阻塞主流程

        _invalidate_prompt_cache()
        return {"ok": True, "id": skill_name}
