"""系统提示词组装（带内容哈希缓存）。"""

import hashlib
import logging
import re
import threading
from pathlib import Path

from app_paths import ANTHROPIC_SKILLS_DIR, MACROS_DIR, SKILLS_DATA_DIR, MACROS_DATA_DIR, PERSONAS_DATA_DIR as PERSONAS_DIR, ACTIVE_PERSONA_PATH
from api.yaml_store import dump_yaml_atomic, yaml_file_lock

from agent.persona_loader import load_persona, build_persona_prompt

logger = logging.getLogger(__name__)


# ── 活跃人格管理 ────────────────────────────────────────────

_DEFAULT_PERSONA_FILE = "SOUL.md"


def get_active_persona_file() -> str:
    """返回当前活跃人格文件名。未配置时默认 SOUL.md。"""
    if ACTIVE_PERSONA_PATH.exists():
        try:
            import yaml
            data = yaml.safe_load(ACTIVE_PERSONA_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict) and "file" in data:
                return data["file"]
        except Exception:
            logger.warning("failed to load active_persona.yaml", exc_info=True)
    return _DEFAULT_PERSONA_FILE


def _persona_name_from_soul(soul_file: str) -> str:
    """从活跃 SOUL 文件名推导三层人设的 name。

    "SOUL.md" → "default"；"SOUL.饱饱.md" → "饱饱"。
    persona_loader 在具名模板不存在时会回退到 *_default.md。
    """
    stem = Path(soul_file).stem  # "SOUL" or "SOUL.饱饱"
    if stem.startswith("SOUL."):
        return stem[len("SOUL."):]
    if stem == "SOUL":
        return "default"
    return stem


def set_active_persona(filename: str) -> None:
    """设置当前活跃人格文件，并失效提示词缓存。"""
    with yaml_file_lock(ACTIVE_PERSONA_PATH):
        dump_yaml_atomic(ACTIVE_PERSONA_PATH, {"file": filename})
    invalidate_prompt_cache()


def list_personas() -> list[dict]:
    """扫描 PERSONAS_DATA_DIR 下所有 SOUL*.md 文件，返回人格列表。"""
    personas = []
    active_file = get_active_persona_file()
    for p in sorted(PERSONAS_DIR.glob("SOUL*.md")):
        if p.name == "SOUL.example.md":
            continue
        content = p.read_text(encoding="utf-8")
        # 从第一个 # 标题提取显示名
        display_name = p.stem  # 默认用文件名（去掉 .md）
        for line in content.splitlines():
            line = line.strip()
            if line.startswith("# "):
                display_name = line[2:].strip()
                break
        # 提取前 1-2 行非标题内容作为描述
        desc_lines = []
        for line in content.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            desc_lines.append(line)
            if len(desc_lines) >= 1:
                break
        description = desc_lines[0] if desc_lines else ""
        # 截断过长描述
        if len(description) > 80:
            description = description[:77] + "..."
        personas.append({
            "id": p.stem,
            "file": p.name,
            "name": display_name,
            "description": description,
            "active": p.name == active_file,
        })
    return personas


# ── 内容哈希缓存 ────────────────────────────────────────────

_cached_fingerprint: str | None = None
_cached_prompt: str = ""
_cached_parts: list[dict] = []
_cache_lock = threading.Lock()


def _file_hash(path: Path) -> str:
    """计算文件内容的 MD5 摘要（仅 hex 前 16 位）。"""
    try:
        return hashlib.md5(path.read_bytes()).hexdigest()[:16]
    except OSError:
        return ""


def _current_fingerprint() -> str:
    """根据所有依赖文件的内容哈希生成指纹字符串。

    依赖文件包括 personas 目录下的 AGENTS/活跃人格/USER/memory.yaml，
    以及 anthropic_skills/ 和 macros/ 下的所有 SKILL.md / MACRO.md，
    以及语义记忆 JSON（4 层架构）。
    """
    parts: list[str] = []

    # 固定 personas 文件
    active_soul = get_active_persona_file()
    for name in ("AGENTS.md", active_soul, "USER.md", "memory.yaml"):
        parts.append(f"{name}:{_file_hash(PERSONAS_DIR / name)}")
    # 额外记录 active_persona.yaml 自身，切换人格时触发缓存刷新
    parts.append(f"active:{_file_hash(ACTIVE_PERSONA_PATH)}")

    # 三层人设模板（Yuan/Identity/Ishiki）——模板变化时刷新缓存
    from agent.persona_loader import PERSONA_DIR
    persona_name = _persona_name_from_soul(active_soul)
    for layer in ("identity", "yuan", "ishiki"):
        named_path = PERSONA_DIR / f"{layer}_{persona_name}.md"
        target_path = named_path if named_path.exists() else PERSONA_DIR / f"{layer}_default.md"
        parts.append(f"persona:{layer}:{_file_hash(target_path)}")

    # 动态扫描 skills / macros（同时扫描内置目录和用户数据目录，按 canonical path 去重）
    seen: set[str] = set()
    for skills_dir in (ANTHROPIC_SKILLS_DIR, SKILLS_DATA_DIR):
        if skills_dir.is_dir():
            try:
                iter_paths = sorted(skills_dir.rglob("SKILL.md"))
            except (OSError, RecursionError):
                iter_paths = []
            for p in iter_paths:
                try:
                    canon = str(p.resolve())
                except OSError:
                    continue
                if canon in seen:
                    continue
                seen.add(canon)
                parts.append(f"sk:{p.name}:{_file_hash(p)}")

    for macros_dir in (MACROS_DIR, MACROS_DATA_DIR):
        if macros_dir.is_dir():
            try:
                iter_paths = sorted(macros_dir.rglob("MACRO.md"))
            except (OSError, RecursionError):
                iter_paths = []
            for p in iter_paths:
                try:
                    canon = str(p.resolve())
                except OSError:
                    continue
                if canon in seen:
                    continue
                seen.add(canon)
                parts.append(f"mc:{p.name}:{_file_hash(p)}")

    return "|".join(parts)


def _ensure_user_md() -> None:
    """若 USER.md 不存在，从模板复制。"""
    import shutil
    template = PERSONAS_DIR / "USER.example.md"
    target = PERSONAS_DIR / "USER.md"
    if not target.exists() and template.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(template, target)


def _rebuild(fingerprint: str) -> None:
    """重新构建缓存的系统提示词和 parts。"""
    global _cached_fingerprint, _cached_prompt, _cached_parts

    _ensure_user_md()

    # 解析用户称呼，用于替换 SOUL.md 中的 {{USER_NAME}}
    user_md_raw = _read_if_exists("USER.md")
    user_name = _parse_user_name(user_md_raw)
    active_soul_file = get_active_persona_file()
    soul_content = _read_persona(active_soul_file)
    if user_name:
        soul_content = soul_content.replace("{{USER_NAME}}", user_name)
    else:
        # 未配置称呼时保留占位符，但替换为通用称呼避免 LLM 困惑
        soul_content = soul_content.replace("{{USER_NAME}}", "你")

    # ── 三层人设（Yuan/Identity/Ishiki）──
    # 静态前缀，放在 system prompt 最前面（cache 友好）。
    # persona_loader 在具名模板不存在时回退到 *_default.md。
    persona_name = _persona_name_from_soul(active_soul_file)
    persona = load_persona(persona_name, user_name=user_name or "用户")
    persona_prompt = build_persona_prompt(persona)

    # ── parts（用于 token 细分展示）──
    # 按变化频率从低到高排列：稳定内容在前，频繁变化的放最后。
    # 只调用一次 I/O 密集型函数，两处复用
    skills_content = _scan_anthropic_skills()
    macros_content = _scan_macros()
    agents_md_content = _read_persona("AGENTS.md")

    # 拆分系统 prompt，将稳定内容（skills/macros 等保持不变的部分）
    # 放在前面，动态内容（记忆）放在末尾，
    # 这样 Anthropic/OpenAI prompt caching 可以缓存更长的前缀，
    # 记忆变化时不会导致 skills/macros 等稳定部分的缓存失效。
    _cached_parts = [
        {"key": "persona", "label": "三层人设",
         "content": persona_prompt},
        {"key": "behavior_rules", "label": "系统行为规则",
         "content": "## 行为规则\n" + agents_md_content},
        {"key": "personality", "label": "性格人设",
         "content": "## 性格设定\n" + soul_content},
        {"key": "user_self_report", "label": "用户自述",
         "content": "## 用户自述\n" + user_md_raw},
        {"key": "skills", "label": "Skills 清单",
         "content": skills_content},
        {"key": "macros", "label": "宏清单",
         "content": macros_content},
    ]

    # ── 完整 prompt ──
    # 与 _cached_parts 保持一致顺序：persona 在最前（静态前缀），记忆放最后
    full_parts = [
        persona_prompt,
        "",
        "## 行为规则",
        agents_md_content,
        "",
        "## 性格设定",
        soul_content,
        "",
        "## 用户自述",
        user_md_raw,
        "",
        skills_content,
        "",
        macros_content,
    ]
    _cached_prompt = "\n".join(full_parts)
    _cached_fingerprint = fingerprint


def _ensure_cache() -> None:
    """检查指纹，若依赖文件有变化则重建缓存。

    使用 _cache_lock 保护：避免并发请求时多个线程同时重建缓存，
    或在 _rebuild 写入过程中读到不一致的中间状态。
    """
    global _cached_fingerprint, _cached_prompt, _cached_parts
    # 双重检查锁定：先无锁读指纹，命中则直接返回；未命中再加锁重建
    fp = _current_fingerprint()
    if fp == _cached_fingerprint:
        return
    with _cache_lock:
        # 再次检查，防止前一个持锁线程已经完成了重建
        fp = _current_fingerprint()
        if fp != _cached_fingerprint:
            _rebuild(fp)


def invalidate_prompt_cache() -> None:
    """强制清空缓存（供外部调用，例如记忆更新后）。"""
    global _cached_fingerprint, _cached_prompt, _cached_parts
    with _cache_lock:
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
    """简易解析 YAML frontmatter，提取元数据字段（支持多行 | 和 >）。"""
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
            if key in ("name", "description", "tools", "memory"):
                if val in ("|", ">"):
                    # 多行值：合并后续缩进行
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


def get_persona_memory_path() -> Path:
    """获取当前人格的记忆文件路径。

    如果 SOUL 文件的 frontmatter 中声明了 memory: persona，
    则使用独立记忆文件 memory_{persona_id}.yaml；
    否则使用共享的 memory.yaml。
    """
    active_file = get_active_persona_file()
    content = _read_persona(active_file)
    meta = _parse_frontmatter(content)

    if meta.get("memory", "").strip().lower() == "persona":
        # 独立记忆：memory_{persona_stem}.yaml
        persona_id = Path(active_file).stem  # e.g. "SOUL.饱饱"
        return PERSONAS_DIR / f"memory_{persona_id}.yaml"
    # 共享记忆
    return PERSONAS_DIR / "memory.yaml"


def get_persona_allowed_tools() -> set[str] | None:
    """获取当前人格允许使用的工具集。

    如果 SOUL 文件的 frontmatter 中声明了 tools 列表，
    返回允许的工具名集合；否则返回 None（表示不限制）。

    tools 格式示例：
        tools: file_read, file_write, run_python, ask_user_qa
    """
    active_file = get_active_persona_file()
    content = _read_persona(active_file)
    meta = _parse_frontmatter(content)

    tools_str = meta.get("tools", "").strip()
    if not tools_str:
        return None  # 未声明 = 不限制

    allowed = {t.strip() for t in tools_str.split(",") if t.strip()}
    return allowed if allowed else None


def _scan_anthropic_skills() -> str:
    """扫描内置 + 用户自定义 anthropic_skills/ 下所有 SKILL.md，返回元数据清单。

    开发模式下 ANTHROPIC_SKILLS_DIR 与 SKILLS_DATA_DIR 可能指向同一目录，
    按 canonical path 去重避免清单里出现重复条目。
    单个 SKILL.md 损坏不会影响其他 skill 的展示。
    """
    entries: list[str] = []
    seen_paths: set[str] = set()
    for base_dir in (ANTHROPIC_SKILLS_DIR, SKILLS_DATA_DIR):
        if not base_dir.is_dir():
            continue
        try:
            iter_paths = sorted(base_dir.rglob("SKILL.md"))
        except (OSError, RecursionError) as e:
            logger.warning("[prompts] 扫描 skills 目录失败 %s: %s", base_dir, e)
            continue
        for sk_path in iter_paths:
            try:
                canonical = str(sk_path.resolve())
            except OSError:
                continue
            if canonical in seen_paths:
                continue
            seen_paths.add(canonical)
            try:
                content = sk_path.read_text(encoding="utf-8")
                meta = _parse_frontmatter(content)
            except (OSError, UnicodeDecodeError) as e:
                # 错误隔离：跳过损坏文件，不阻断整个系统提示词构建
                logger.warning("[prompts] 跳过损坏的 SKILL.md %s: %s", sk_path, e)
                continue
            rel = sk_path.relative_to(base_dir).parent
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
    """扫描 macros/ 下所有 MACRO.md，返回元数据清单。

    同时扫描内置目录（BUNDLE_DIR/macros，只读）和用户数据目录
    （DATA_DIR/macros，可写）。用户通过 manage_macros 工具或 REST API
    创建的宏保存在用户数据目录，必须扫描此目录才能让 LLM 感知。
    单个 MACRO.md 损坏不会影响其他 macro 的展示。
    """
    entries: list[str] = []
    seen_paths: set[str] = set()
    for base_dir in (MACROS_DIR, MACROS_DATA_DIR):
        if not base_dir.is_dir():
            continue
        try:
            iter_paths = sorted(base_dir.rglob("MACRO.md"))
        except (OSError, RecursionError) as e:
            logger.warning("[prompts] 扫描 macros 目录失败 %s: %s", base_dir, e)
            continue
        for mp_path in iter_paths:
            try:
                canonical = str(mp_path.resolve())
            except OSError:
                continue
            if canonical in seen_paths:
                continue
            seen_paths.add(canonical)
            try:
                content = mp_path.read_text(encoding="utf-8")
                meta = _parse_frontmatter(content)
            except (OSError, UnicodeDecodeError) as e:
                logger.warning("[prompts] 跳过损坏的 MACRO.md %s: %s", mp_path, e)
                continue
            rel = mp_path.relative_to(base_dir).parent
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
    with _cache_lock:
        return list(_cached_parts)


def build_system_prompt() -> str:
    """组装完整系统提示词，依赖文件未变化时直接返回缓存。"""
    _ensure_cache()
    with _cache_lock:
        return _cached_prompt


def build_coordinator_prompt(persona_context: str = "") -> str:
    """构建 coordinator 路由分类提示词。

    职责：取用户消息，分类为 direct / specialist / main 三种路由之一。
    返回严格 JSON，无多余文本。

    Args:
        persona_context: 当前人设上下文（影响 specialist 选择）

    Returns:
        系统提示词字符串
    """
    persona_clause = f"\n当前人设上下文：{persona_context}" if persona_context else ""
    return f"""你是 Maxma 的意图路由协调者（Coordinator）。你的唯一任务是分类用户消息的路由目标。

路由目标（三选一）：
- "direct"：简单问候、确认、闲聊（如"你好"、"谢谢"、"好的"）。无需工具，直接简短回复。
- "specialist"：需要特定领域专家处理的任务。specialist 字段填专家名：
  - "research"：深度研究、调研、多源搜索综合
  - "coding"：代码编写、调试、重构、git 操作
  - "analysis"：数据分析、文档分析、结构化提取
  - "writing"：长文写作、报告、邮件、会议纪要
- "main"：通用任务（文件操作、天气查询、待办、地图等日常工具调用）。不匹配上述 specialist 时使用。

输出格式：严格 JSON，无多余文本、无 markdown 代码块标记。
{{"target":"<direct|specialist|main>","specialist":"<专家名或省略>","rationale":"<简短理由>"}}
{persona_clause}

注意：
- 只输出 JSON，不要任何解释或前后缀
- specialist 路由必须填 specialist 字段
- direct 和 main 路由省略 specialist 字段
- 不确定时选 "main"（更安全）"""


def build_verifier_prompt() -> str:
    """构建 verifier 答案充分性评分提示词。

    职责：取用户问题 + agent 答案 + 检索证据，判定答案是否充分回答了问题。
    返回严格 JSON。

    Returns:
        系统提示词字符串
    """
    return """你是 Maxma 的答案验证者（Verifier）。你的任务是判定 Agent 的答案是否充分回答了用户的问题。

判定标准：
- "sufficient"：答案直接回答了用户问题，关键信息完整，无明显遗漏或矛盾
- "insufficient"：答案遗漏了问题的关键部分、答非所问、或包含无法从证据支撑的断言

判定原则：
- 宽容为主：只要答案合理地回应了问题的核心，就判 sufficient
- 仅在明确遗漏关键信息时才判 insufficient
- gaps 字段列出具体缺失点（如"未回答价格部分"），供 agent 补充

输出格式：严格 JSON，无多余文本、无 markdown 代码块标记。
{"verdict":"<sufficient|insufficient>","gaps":["<缺失点1>","<缺失点2>"],"rationale":"<简短理由>"}

注意：
- 只输出 JSON，不要任何解释或前后缀
- sufficient 时 gaps 为空数组 []
- insufficient 时 gaps 至少包含一个具体缺失点
- 无法判断时判 sufficient（不阻塞用户）"""


def build_rag_grader_prompt() -> str:
    """构建 RAG 文档相关性评分提示词。

    职责：取查询 + 文档，判定文档是否与查询相关。
    返回严格 JSON。

    Returns:
        系统提示词字符串
    """
    return """你是 Maxma 的 RAG 文档相关性评分者。你的任务是判定给定文档是否与用户查询相关。

判定标准：
- true：文档包含与查询直接相关的信息，能帮助回答问题
- false：文档与查询无关，或内容不足以回答问题

判定原则：
- 宽容为主：只要文档包含可能相关的信息就判 true
- 仅在文档明显与查询无关时才判 false
- 无法判断时判 true（不丢弃可能有用的文档）

输出格式：严格 JSON，无多余文本、无 markdown 代码块标记。
{"relevant":<true|false>,"reasoning":"<简短理由>"}

注意：
- 只输出 JSON，不要任何解释或前后缀
- relevant 必须是布尔值 true 或 false（不是字符串）"""
