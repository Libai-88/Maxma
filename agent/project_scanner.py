"""项目结构自动感知 — 扫描项目目录，生成结构化上下文摘要。"""

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

# 扫描时忽略的目录
_IGNORE_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "env",
    "dist", "build", ".next", ".nuxt", "target", ".tox", ".mypy_cache",
    ".pytest_cache", ".ruff_cache", "coverage", ".nyc_output",
    "vendor", ".gradle", ".idea", ".vs", ".vscode",
}

# 扫描时忽略的文件模式
_IGNORE_FILE_PATTERNS = [
    re.compile(r"\.(pyc|pyo|class|o|so|dll|exe|bin|dat)$"),
    re.compile(r"\.(lock|sum)$"),  # package-lock.json, go.sum 等
]

# 关键文件 — 存在即读取（按优先级排序）
_KEY_FILES = [
    "README.md",
    "README.rst",
    "README",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "requirements.txt",
    "setup.py",
    "setup.cfg",
    ".env.example",
    ".env.sample",
    "docker-compose.yml",
    "docker-compose.yaml",
    "Dockerfile",
    "Makefile",
    "tsconfig.json",
    "vite.config.ts",
    "vite.config.js",
    "next.config.js",
    "nuxt.config.ts",
    "tailwind.config.js",
    ".eslintrc.json",
    ".eslintrc.js",
]

# 技术栈检测规则：文件名 → (技术, 类别)
_STACK_RULES: list[tuple[str, str, str]] = [
    ("package.json", "Node.js", "runtime"),
    ("pyproject.toml", "Python", "runtime"),
    ("Cargo.toml", "Rust", "runtime"),
    ("go.mod", "Go", "runtime"),
    ("requirements.txt", "Python", "runtime"),
    ("setup.py", "Python", "runtime"),
    ("Gemfile", "Ruby", "runtime"),
    ("pom.xml", "Java/Maven", "runtime"),
    ("build.gradle", "Java/Gradle", "runtime"),
    ("composer.json", "PHP/Composer", "runtime"),
    # 框架
    ("vite.config.ts", "Vite", "bundler"),
    ("vite.config.js", "Vite", "bundler"),
    ("webpack.config.js", "Webpack", "bundler"),
    ("tsconfig.json", "TypeScript", "language"),
    ("tailwind.config.js", "Tailwind CSS", "css"),
    ("next.config.js", "Next.js", "framework"),
    ("nuxt.config.ts", "Nuxt.js", "framework"),
    ("Dockerfile", "Docker", "devops"),
    ("docker-compose.yml", "Docker Compose", "devops"),
    ("docker-compose.yaml", "Docker Compose", "devops"),
]

# package.json 中的依赖 → 框架检测
_PACKAGE_JSON_FRAMEWORKS = {
    "react": "React",
    "vue": "Vue",
    "svelte": "Svelte",
    "angular": "Angular",
    "@angular/core": "Angular",
    "next": "Next.js",
    "nuxt": "Nuxt.js",
    "express": "Express",
    "fastify": "Fastify",
    "tailwindcss": "Tailwind CSS",
    "electron": "Electron",
    "@tauri-apps/api": "Tauri",
    "three": "Three.js",
    "chart.js": "Chart.js",
    "recharts": "Recharts",
}

# pyproject.toml / requirements.txt 中的依赖 → 框架检测
_PYTHON_FRAMEWORKS = {
    "fastapi": "FastAPI",
    "flask": "Flask",
    "django": "Django",
    "langchain": "LangChain",
    "langgraph": "LangGraph",
    "pydantic": "Pydantic",
    "sqlalchemy": "SQLAlchemy",
    "celery": "Celery",
    "streamlit": "Streamlit",
    "gradio": "Gradio",
    "tauri": "Tauri",
}


@dataclass
class ProjectContext:
    """项目扫描结果。"""
    root: str = ""
    tree: str = ""
    key_files_content: dict[str, str] = field(default_factory=dict)
    tech_stack: list[str] = field(default_factory=list)
    stats: dict[str, int] = field(default_factory=dict)

    def to_prompt_text(self, max_tokens: int = 500) -> str:
        """生成注入系统提示词的简洁文本（约 500 token）。"""
        parts = []

        if self.root:
            parts.append(f"项目路径: {self.root}")

        if self.tech_stack:
            parts.append(f"技术栈: {', '.join(self.tech_stack[:15])}")

        if self.stats:
            stat_parts = []
            if "total_files" in self.stats:
                stat_parts.append(f"{self.stats['total_files']} 个文件")
            if "total_lines" in self.stats:
                stat_parts.append(f"~{self.stats['total_lines']} 行代码")
            if stat_parts:
                parts.append(f"规模: {', '.join(stat_parts)}")

        if self.tree:
            parts.append(f"目录结构:\n{self.tree}")

        # 关键文件摘要（只取前几个，控制 token）
        key_summaries = []
        for fname, content in self.key_files_content.items():
            if fname == "package.json":
                deps = _extract_package_deps(content)
                if deps:
                    key_summaries.append(f"package.json 依赖: {deps}")
            elif fname == "pyproject.toml":
                deps = _extract_pyproject_deps(content)
                if deps:
                    key_summaries.append(f"pyproject.toml 依赖: {deps}")
            elif fname == "requirements.txt":
                deps = _extract_requirements(content)
                if deps:
                    key_summaries.append(f"requirements.txt: {deps}")
            elif fname in ("README.md", "README.rst", "README"):
                # 只取前几行作为项目描述
                desc = _extract_readme_desc(content)
                if desc:
                    key_summaries.append(f"项目描述: {desc}")
            elif fname == "Cargo.toml":
                desc = _extract_cargo_desc(content)
                if desc:
                    key_summaries.append(f"Cargo.toml: {desc}")

        if key_summaries:
            parts.append("\n".join(key_summaries[:5]))

        result = "\n".join(parts)

        # 粗略截断（1 token ≈ 2 中文字符 / 4 英文字符）
        max_chars = max_tokens * 3
        if len(result) > max_chars:
            result = result[:max_chars] + "\n...(已截断)"

        return result


def scan_project(root: str | Path) -> ProjectContext:
    """扫描项目根目录，返回结构化上下文。"""
    root = Path(root).resolve()
    if not root.is_dir():
        return ProjectContext(root=str(root))

    ctx = ProjectContext(root=str(root))

    # 1. 目录树（深度 3）
    ctx.tree = _build_tree(root, max_depth=3)

    # 2. 读取关键文件
    for fname in _KEY_FILES:
        fpath = root / fname
        if fpath.is_file():
            try:
                content = fpath.read_text(encoding="utf-8", errors="replace")
                # 限制单个文件大小
                if len(content) > 10000:
                    content = content[:10000] + "\n...(truncated)"
                ctx.key_files_content[fname] = content
            except Exception:
                pass

    # 3. 检测技术栈
    ctx.tech_stack = _detect_stack(root, ctx.key_files_content)

    # 4. 统计信息
    ctx.stats = _compute_stats(root)

    return ctx


def _build_tree(root: Path, max_depth: int = 3) -> str:
    """构建目录树文本（类似 tree 命令输出）。"""
    lines: list[str] = [root.name + "/"]

    def _walk(dir_path: Path, prefix: str, depth: int):
        if depth > max_depth:
            return
        try:
            entries = sorted(dir_path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        except PermissionError:
            return

        # 过滤忽略目录
        entries = [
            e for e in entries
            if not (e.is_dir() and e.name in _IGNORE_DIRS)
            and not (e.is_dir() and e.name.startswith("."))
            and not _should_ignore_file(e)
        ]

        # 限制每层最多显示 30 项
        if len(entries) > 30:
            entries = entries[:30]
            truncated = True
        else:
            truncated = False

        for i, entry in enumerate(entries):
            is_last = (i == len(entries) - 1) and not truncated
            connector = "└── " if is_last else "├── "

            if entry.is_dir():
                lines.append(f"{prefix}{connector}{entry.name}/")
                extension = "    " if is_last else "│   "
                _walk(entry, prefix + extension, depth + 1)
            else:
                lines.append(f"{prefix}{connector}{entry.name}")

        if truncated:
            lines.append(f"{prefix}└── ... ({len(entries)}+ items)")

    _walk(root, "", 1)
    return "\n".join(lines)


def _should_ignore_file(path: Path) -> bool:
    """检查文件是否应该被忽略。"""
    if path.is_file():
        name = path.name.lower()
        for pattern in _IGNORE_FILE_PATTERNS:
            if pattern.search(name):
                return True
    return False


def _detect_stack(root: Path, key_files: dict[str, str]) -> list[str]:
    """根据文件检测技术栈。"""
    stack: list[str] = []
    seen: set[str] = set()

    # 基于文件存在检测
    for fname, tech, category in _STACK_RULES:
        if fname in key_files and tech not in seen:
            stack.append(tech)
            seen.add(tech)

    # 解析 package.json 依赖
    if "package.json" in key_files:
        for dep, framework in _PACKAGE_JSON_FRAMEWORKS.items():
            if dep in key_files["package.json"] and framework not in seen:
                stack.append(framework)
                seen.add(framework)

    # 解析 Python 依赖
    for fname in ("pyproject.toml", "requirements.txt"):
        if fname in key_files:
            content = key_files[fname]
            for dep, framework in _PYTHON_FRAMEWORKS.items():
                if dep.lower() in content.lower() and framework not in seen:
                    stack.append(framework)
                    seen.add(framework)

    # 检测 Tauri（Cargo.toml 中有 tauri 依赖）
    if "Cargo.toml" in key_files:
        content = key_files["Cargo.toml"]
        if "tauri" in content.lower() and "Tauri" not in seen:
            stack.append("Tauri")
            seen.add("Tauri")

    return stack


def _compute_stats(root: Path) -> dict[str, int]:
    """计算项目统计信息。"""
    total_files = 0
    total_lines = 0
    extensions: dict[str, int] = {}

    code_extensions = {
        ".py", ".js", ".ts", ".tsx", ".jsx", ".vue", ".svelte",
        ".rs", ".go", ".java", ".c", ".cpp", ".h", ".hpp",
        ".css", ".scss", ".less", ".html", ".sql", ".sh", ".bat",
        ".yaml", ".yml", ".toml", ".json", ".xml",
    }

    for dirpath, dirnames, filenames in os.walk(root):
        # 过滤忽略目录
        dirnames[:] = [d for d in dirnames if d not in _IGNORE_DIRS and not d.startswith(".")]

        for fname in filenames:
            fpath = Path(dirpath) / fname
            if _should_ignore_file(fpath):
                continue

            total_files += 1
            ext = fpath.suffix.lower()
            if ext:
                extensions[ext] = extensions.get(ext, 0) + 1

            # 只统计代码文件行数
            if ext in code_extensions:
                try:
                    with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                        total_lines += sum(1 for _ in f)
                except Exception:
                    pass

    return {
        "total_files": total_files,
        "total_lines": total_lines,
    }


# ── 关键文件内容提取辅助 ────────────────────────────────────────


def _extract_package_deps(content: str) -> str:
    """从 package.json 提取主要依赖名。"""
    import json as _json
    try:
        pkg = _json.loads(content)
    except Exception:
        return ""
    deps = list(pkg.get("dependencies", {}).keys())
    dev_deps = list(pkg.get("devDependencies", {}).keys())
    all_deps = deps + dev_deps
    # 只返回知名框架/库
    known = [d for d in all_deps if d in _PACKAGE_JSON_FRAMEWORKS]
    if known:
        return ", ".join(_PACKAGE_JSON_FRAMEWORKS[d] for d in known[:10])
    # 否则返回前 8 个依赖
    return ", ".join(all_deps[:8]) if all_deps else ""


def _extract_pyproject_deps(content: str) -> str:
    """从 pyproject.toml 提取主要依赖名。"""
    known = []
    for dep, framework in _PYTHON_FRAMEWORKS.items():
        if dep.lower() in content.lower():
            known.append(framework)
    return ", ".join(known[:10]) if known else ""


def _extract_requirements(content: str) -> str:
    """从 requirements.txt 提取包名。"""
    lines = content.splitlines()
    packages = []
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        # 提取包名（去掉版本约束）
        pkg = re.split(r"[>=<~!]", line)[0].strip()
        if pkg:
            packages.append(pkg)
    # 映射已知框架
    known = []
    for pkg in packages:
        fw = _PYTHON_FRAMEWORKS.get(pkg.lower())
        if fw:
            known.append(fw)
    if known:
        return ", ".join(known[:10])
    return ", ".join(packages[:8]) if packages else ""


def _extract_readme_desc(content: str) -> str:
    """从 README 提取项目描述（第一个非标题段落）。"""
    lines = content.splitlines()
    desc_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if desc_lines:
                break
            continue
        if stripped.startswith("#"):
            continue
        if stripped.startswith("![") or stripped.startswith("["):
            continue
        desc_lines.append(stripped)
        if len(desc_lines) >= 2:
            break
    result = " ".join(desc_lines)
    if len(result) > 200:
        result = result[:200] + "..."
    return result


def _extract_cargo_desc(content: str) -> str:
    """从 Cargo.toml 提取项目名和描述。"""
    name = ""
    desc = ""
    for line in content.splitlines():
        line = line.strip()
        if line.startswith("name"):
            parts = line.split("=", 1)
            if len(parts) == 2:
                name = parts[1].strip().strip('"')
        if line.startswith("description"):
            parts = line.split("=", 1)
            if len(parts) == 2:
                desc = parts[1].strip().strip('"')
    if name and desc:
        return f"{name}: {desc}"
    return name or desc or ""
