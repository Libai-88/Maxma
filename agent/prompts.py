"""系统提示词组装（带内容哈希缓存）。"""

import hashlib
import logging
import re
import threading
from pathlib import Path

import yaml

from app_paths import (
    MACROS_DIR,
    MACROS_DATA_DIR,
    PERSONAS_DATA_DIR,                      # 可写用户人设目录（DATA_DIR/config/personas）
    PERSONAS_DATA_DIR as PERSONAS_DIR,      # 兼容既有代码：prompts 内 PERSONAS_DIR 即用户数据目录
    PERSONAS_DIR as PERSONAS_TEMPLATES_DIR,  # 只读 bundle 模板目录（BUNDLE_DIR/config/personas），
                                             # 打包模式下位于 _MEIPASS；用于默认值兜底
    ACTIVE_PERSONA_PATH,
)
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
    """扫描所有 SOUL*.md 文件，返回人格列表。

    同时扫描：
    - PERSONAS_DIR（BUNDLE_DIR/config/personas，开发模式即项目根，只读模板）：
      内置 SOUL.example.md 等示例模板；SOUL.example.md 在 dev/conventional
      模式下供首次启动复制为 SOUL.md，打包后变成内嵌的"种子"。
    - PERSONAS_DIR（= PERSONAS_DATA_DIR，DATA_DIR/config/personas，用户运行时活跃目录）：
      用户真正编辑 / 创建的人格文件（含 ensure_personas_seed() 首次启动
      从 SOUL.example.md 拷贝出的 SOUL.md）。
    - PERSONAS_TEMPLATES_DIR（BUNDLE_DIR/config/personas，只读 bundle 模板）：
      内置 SOUL.example.md 等示例模板，作为兜底避免列表为空。
    两边同名文件按 PERSONAS_DIR 优先，避免重复条目。
    """
    personas = []
    active_file = get_active_persona_file()
    seen_files: set[str] = set()

    # 优先扫描用户运行时目录（活跃 SOUL、自建 SOUL.XXX.md），再用 bundle 模板兜底
    for scan_dir in (PERSONAS_DIR, PERSONAS_TEMPLATES_DIR):
        if not scan_dir.is_dir():
            continue
        try:
            iter_paths = sorted(scan_dir.glob("SOUL*.md"))
        except OSError:
            continue
        for p in iter_paths:
            # 同名文件只记一次（PERSONAS_DIR 已先扫过，TEMPLATES_DIR 里同名的跳过）
            if p.name in seen_files:
                continue
            if p.name == "SOUL.example.md":
                continue
            seen_files.add(p.name)
            try:
                content = p.read_text(encoding="utf-8")
            except OSError:
                continue
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
    以及 macros/ 下的所有 MACRO.md，
    以及语义记忆 JSON（4 层架构）。
    """
    parts: list[str] = []

    # 固定 personas 文件。打包/便携模式下活跃文件在 PERSONAS_DIR（= PERSONAS_DATA_DIR），
    # 默认模板可能在 PERSONAS_TEMPLATES_DIR；二者都参与指纹以便 user edit 能 invalidate 缓存。
    def _persona_hash(name: str) -> str:
        for base in (PERSONAS_DIR, PERSONAS_TEMPLATES_DIR):
            p = base / name
            if p.exists():
                return _file_hash(p)
        return ""

    active_soul = get_active_persona_file()
    for name in ("AGENTS.md", "MAXMA.md", active_soul, "USER.md", "memory.yaml"):
        parts.append(f"{name}:{_persona_hash(name)}")
    # 额外记录 active_persona.yaml 自身，切换人格时触发缓存刷新
    parts.append(f"active:{_file_hash(ACTIVE_PERSONA_PATH)}")

    # 三层人设模板（Yuan/Identity/Ishiki）——模板变化时刷新缓存
    from agent.persona_loader import PERSONA_DIR
    persona_name = _persona_name_from_soul(active_soul)
    for layer in ("identity", "yuan", "ishiki"):
        named_path = PERSONA_DIR / f"{layer}_{persona_name}.md"
        target_path = named_path if named_path.exists() else PERSONA_DIR / f"{layer}_default.md"
        parts.append(f"persona:{layer}:{_file_hash(target_path)}")

    # 动态扫描 macros（同时扫描内置目录和用户数据目录，按 canonical path 去重）
    # skills 已迁移到 OMP 原生 .omp/skills/，由 OMP 自动发现，不再计入本指纹。
    seen: set[str] = set()
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
    """若 USER.md 不存在，从模板复制到 PERSONAS_DIR（= PERSONAS_DATA_DIR，可写）。

    历史原因：早期实现写到 app_paths.PERSONAS_DIR（在 PyInstaller frozen 下是
    _MEIPASS，只读），导致便携/打包模式下 USER.md 永远起不来。ensure_personas_seed()
    在 app_paths.py 已经在首次启动时做了同样的 seed 拷贝，这里保留是为了兜底：
    万一 seed 失败（比如 bundle 里连 USER.example.md 都没带上），再尝试一次。
    """
    import shutil
    template = PERSONAS_TEMPLATES_DIR / "USER.example.md"
    target = PERSONAS_DIR / "USER.md"
    if not target.exists() and template.exists():
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(template, target)
        except OSError:
            # PERSONAS_DIR 不存在或不可写时静默失败（开发模式可能 PERSONAS_DIR == PERSONAS_TEMPLATES_DIR
            # 但 template 不存在；任何场景都不应阻塞 _rebuild）
            pass


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
    # 只调用一次 I/O 密集型函数，两处复用。
    # skills 已迁移到 OMP 原生 .omp/skills/，由 OMP 自动发现，不再注入。
    macros_content = _scan_macros()
    agents_md_content = _read_persona("AGENTS.md")

    # 拆分系统 prompt，将稳定内容（macros 等保持不变的部分）
    # 放在前面，动态内容（记忆）放在末尾，
    # 这样 Anthropic/OpenAI prompt caching 可以缓存更长的前缀，
    # 记忆变化时不会导致 macros 等稳定部分的缓存失效。
    # MAXMA.md — 产品自述（极简，帮助 Agent 了解自身能力与边界）
    maxma_content = _read_persona("MAXMA.md")

    _cached_parts = [
        {"key": "persona", "label": "三层人设",
         "content": persona_prompt},
        {"key": "maxma_identity", "label": "Maxma 自述",
         "content": maxma_content},
        {"key": "behavior_rules", "label": "系统行为规则",
         "content": "## 行为规则\n" + agents_md_content},
        {"key": "memory_instruction", "label": "记忆说明",
         "content": "## 记忆\n当用户明确要求记住某个事实、偏好或信息时，调用 remember_memory 工具把它写入长期记忆。记忆会显示在记忆页面。"},
        {"key": "personality", "label": "性格人设",
         "content": "## 性格设定\n" + soul_content},
        {"key": "user_self_report", "label": "用户自述",
         "content": "## 用户自述\n" + user_md_raw},
        {"key": "macros", "label": "宏清单",
         "content": macros_content},
    ]

    # ── 完整 prompt ──
    # 与 _cached_parts 保持一致顺序：persona 在最前（静态前缀），记忆放最后
    full_parts = [
        persona_prompt,
        "",
        maxma_content,
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
        "## 记忆",
        "当用户明确要求记住某个事实、偏好或信息时，调用 remember_memory 工具把它写入长期记忆。记忆会显示在记忆页面。",
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
    global _append_cache_fp, _append_cache_prompt
    with _cache_lock:
        _cached_fingerprint = None
        _cached_prompt = ""
        _cached_parts = []
        _append_cache_fp = None
        _append_cache_prompt = ""


def _read_persona(filename: str) -> str:
    """读取人设文件，优先用户数据目录，回落到 bundle 默认。

    读取顺序：``PERSONAS_DIR``（= ``PERSONAS_DATA_DIR``，用户运行时目录）→
    ``PERSONAS_TEMPLATES_DIR``（bundle 只读模板）→ ``""``。
    开发模式下两个目录内容基本一致；打包 / 便携模式下 PERSONAS_DATA_DIR 是
    ensure_personas_seed() 首次启动播种的活跃文件，TEMPLATES_DIR 是内置模板。
    """
    for base in (PERSONAS_DIR, PERSONAS_TEMPLATES_DIR):
        path = base / filename
        if path.exists():
            try:
                return path.read_text(encoding="utf-8")
            except OSError:
                continue
    return ""


def _read_if_exists(filename: str) -> str:
    """读取 personas 文件，不存在返回空字符串（不走缓存）。

    与 ``_read_persona`` 行为一致：先看用户数据目录，再看 bundle 模板。
    """
    for base in (PERSONAS_DIR, PERSONAS_TEMPLATES_DIR):
        path = base / filename
        if path.exists():
            try:
                return path.read_text(encoding="utf-8").strip()
            except OSError:
                continue
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
    """解析 YAML frontmatter，提取元数据字段。

    使用 ``yaml.safe_load`` 解析 ``---`` 之间的内容，正确处理 YAML 引号、
    转义和多行标量，杜绝行级独立解析带来的 frontmatter 注入风险
    （如 ``description = 'x"\\nmemory: persona'`` 通过多行单引号标量注入
    ``memory:`` 键）。

    仅保留 ``name`` / ``description`` / ``tools`` / ``memory`` 四个白名单键。
    对于 ``|`` 和 ``>`` 块标量，按历史行为将换行合并为空格（保留旧调用方
    语义）；其它标量（含带换行的引号标量）按 ``yaml.safe_load`` 原样返回。

    缺失或非法 frontmatter 返回 ``{}``，绝不抛异常。
    """
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {}
    block = m.group(1)
    try:
        data = yaml.safe_load(block)
    except yaml.YAMLError:
        return {}
    if not isinstance(data, dict):
        return {}

    # 识别使用 `|` / `>` 块标量指示符的键，按旧行为把换行合并为空格。
    # yaml.safe_load 对 `>` 已折叠为空格、对 `|` 保留换行；此处统一把
    # `|` 的换行也合并为空格，保持向后兼容。
    block_scalar_keys: set[str] = set()
    for line in block.splitlines():
        bm = re.match(r"^(\w+)\s*:\s*[|>][-+]?\s*$", line)
        if bm and bm.group(1) in ("name", "description", "tools", "memory"):
            block_scalar_keys.add(bm.group(1))

    meta: dict[str, str] = {}
    for key in ("name", "description", "tools", "memory"):
        if key not in data:
            continue
        val = data[key]
        if val is None:
            continue
        sval = str(val)
        if key in block_scalar_keys:
            sval = " ".join(sval.splitlines())
        meta[key] = sval
    return meta


def get_persona_memory_path() -> Path:
    """获取当前人格的记忆文件路径。

    如果 SOUL 文件的 frontmatter 中声明了 memory: persona（或其别名 isolated），
    则使用独立记忆文件 memory_{persona_id}.yaml；
    否则使用共享的 memory.yaml。
    """
    active_file = get_active_persona_file()
    content = _read_persona(active_file)
    meta = _parse_frontmatter(content)

    # B-011: accept both "persona" and "isolated" (legacy alias) so that
    # SOUL files written before the write-time normalization still resolve
    # to the persona-scoped memory file instead of silently falling back
    # to shared memory.yaml.
    if meta.get("memory", "").strip().lower() in ("persona", "isolated"):
        # 独立记忆：memory_{persona_stem}.yaml（写到 PERSONAS_DIR=用户数据目录，便携/打包模式才可写）
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


def _scan_macros() -> str:
    """扫描 macros/ 下所有 MACRO.md，返回元数据清单。

    同时扫描内置目录（BUNDLE_DIR/macros，只读）和用户数据目录
    （DATA_DIR/macros，可写）。用户通过 REST API
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


# ── 原生提示词模式的追加段 ──────────────────────────────────

_append_cache_fp: str | None = None
_append_cache_prompt: str = ""


def build_append_prompt() -> str:
    """构建原生提示词模式的追加段（append_system_prompt）。

    与 build_system_prompt 的区别：本函数返回的是**最小功能注入**，
    只包含 OMP 原生 prompt 无法自动发现、但 Maxma 集成必需的信息，
    不含任何品牌/persona 内容。OMP 通过 appendSystemPrompt 机制将其
    追加到原生 prompt 之后，原生 ROLE/工程原则/内部 URL/git 上下文
    完整保留。

    包含：
    - 中文回复指令（OMP 原生 prompt 为英文，保证中文对话体验）
    - macros 清单（OMP 无宏机制，仍由 Maxma 注入）
    skills 已迁移到 OMP 原生 `.omp/skills/`，由 OMP 自动发现并在原生
    prompt 中声明 + skill:// 加载，不再在此注入。

    缓存依赖 macros 内容指纹，与品牌模式共用 _cache_lock。
    """
    global _append_cache_fp, _append_cache_prompt
    fp = _current_fingerprint()
    if fp == _append_cache_fp:
        return _append_cache_prompt
    with _cache_lock:
        fp = _current_fingerprint()
        if fp != _append_cache_fp:
            _parts = ["始终使用中文与用户对话，除非用户明确要求使用其他语言；技术术语可保留英文原文。"]
            _macros = _scan_macros()
            if _macros:
                _parts.append(_macros)
            _append_cache_prompt = "\n\n".join(_parts)
            _append_cache_fp = fp
    return _append_cache_prompt


def invalidate_append_cache() -> None:
    """强制清空原生模式追加段缓存。"""
    global _append_cache_fp, _append_cache_prompt
    with _cache_lock:
        _append_cache_fp = None
        _append_cache_prompt = ""


# ── 品牌增强块 ───────────────────────────────────────────────

# 情绪词表与 web/src/composables/stickerUtils.ts 的 EMOTION_MAP 严格对齐：
# 开心/委屈/害羞/尴尬/生气/惊讶/撒娇/悲伤/得意/爱心/日常/无语（12 类，
# 与 config/stickers/ 目录一一对应）。模型写出的情绪词必须能命中贴纸系统。
_BRAND_EMOTIONS = "开心、爱心、委屈、撒娇、害羞、尴尬、生气、惊讶、悲伤、得意、无语、日常"

_BRAND_PROMPT = (
    "# 品牌风格\n"
    "- 产品叫 Maxma，本地 AI 助手。回复用中文，技术术语保留英文。\n"
    "- 语气克制但有温度：先给结论再给细节，不寒暄、不推销、不堆感叹号；"
    "判断有分量但不喧哗（品牌取意「墨色」）。\n"
    "- 情感表达：每条回复尽量带 1 处 [表情包:情绪] 点缀（纯技术/指令内容除外），"
    f"情绪词限：{_BRAND_EMOTIONS}。\n"
)


def build_brand_prompt() -> str:
    """构建品牌增强块。

    仅含轻量风格引导 + 表情指令，**不定义 AI 身份**（避免与 OMP 原生
    ROLE "helpful assistant in Oh My Pi harness" 冲突），只做锦上添花。
    由调用方在功能注入（build_append_prompt）之后按 brand_enhancement
    开关拼接；静态内容，直接返回常量。
    """
    return _BRAND_PROMPT


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
