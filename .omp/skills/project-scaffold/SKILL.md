---
name: project-scaffold
description: 项目脚手架工作流——根据需求生成项目骨架（目录结构、入口文件、配置、依赖清单、README、git 初始化），开箱可跑。当用户说"建个项目"、"搭个脚手架"、"初始化一个 XX 项目"时使用。
---

# 项目脚手架工作流

根据用户需求生成一个**开箱可跑**的项目骨架。不是只生成目录树，而是让用户 `cd` 进去就能 `run` 起来。

## 适用场景

- 用户说"帮我搭一个 Python / Node / Rust 项目"
- 用户说"初始化一个 FastAPI / Express / Tauri 项目"
- 用户想开始一个新项目但不想自己处理脚手架细节

## 工作流程

### 1. 澄清需求

用 `ask_user_qa` 一次问清（用 `multi_choice` 让用户选）：

1. **技术栈**：语言 + 框架（Python+FastAPI / Node+Express / Rust+Tauri / 纯 Python 脚本 …）
2. **项目类型**：CLI 工具 / Web 服务 / 桌面应用 / 库 / 数据分析脚本
3. **项目名 + 目录**：叫什么名字？建在哪个目录下？（默认 `D:\Users\<user>\Documents\projects\<name>`）
4. **是否要可选项**：测试框架 / CI 配置 / Dockerfile / pre-commit hooks / 类型检查

> 不要问太多细节（依赖版本、ESLint 规则），用项目主流默认值即可。问太多用户会烦。

### 2. 设计目录结构

根据技术栈给出目录树，让用户过目确认：

```
my-project/
├── src/
│   └── __init__.py
├── tests/
│   └── test_smoke.py
├── .gitignore
├── pyproject.toml        # 或 package.json / Cargo.toml
├── README.md
└── main.py               # 入口，含 hello world
```

确认后再动手，**不要写完一堆文件才让用户看**。

### 3. 生成文件

按"配置 → 入口 → 测试 → 文档"顺序：

1. **配置文件**：用 `file_write` 生成 `pyproject.toml` / `package.json` / `Cargo.toml`，包含最小依赖（FastAPI + uvicorn / express / …）。
2. **`.gitignore`**：按技术栈生成（Python: `__pycache__/ .venv/ *.pyc`；Node: `node_modules/ dist/`）。
3. **入口文件**：`main.py` / `index.ts` / `src/main.rs`，写一个"hello world"级别的可运行示例。
4. **测试**：`tests/test_smoke.py`，一个能通过的 smoke test。
5. **README.md**：包含"安装 / 运行 / 测试"三段，命令可复制即用。

### 4. 验证可跑

**这一步不能省**——脚手架的价值就是"开箱可跑"：

- Python 项目：用 `run_python` 在新目录跑 `python main.py`，确认无 ImportError、能输出预期结果。
- Node 项目：用 `run_python` 跑 `subprocess.run(["npm", "install"], cwd=...)`，再 `npm test`。
- Rust 项目：`cargo check`（不跑 `cargo build`，太慢）。

如果验证失败，用 `file_edit` 修，**不要让用户自己去 debug 脚手架**。

### 5. Git 初始化（可选）

询问用户是否要 `git init`：

- 用 `run_python` 跑 `git init && git add . && git commit -m "Initial commit"`。
- 不要配置 `user.name` / `user.email`（那是用户的全局配置）。
- 不要创建分支策略（main / master 由用户决定）。

### 6. 交付清单

回复用户时给出：

```
项目已创建：D:\...\my-project

目录结构：
[树形展示]

快速开始：
  cd D:\...\my-project
  python -m venv .venv
  .venv\Scripts\activate
  pip install -e .
  python main.py

已验证：
  ✅ python main.py 输出 "Hello, my-project"
  ✅ pytest tests/ 通过 1 个测试
```

## 各技术栈默认配置

### Python + FastAPI

```toml
# pyproject.toml
[project]
name = "my-project"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["fastapi>=0.110", "uvicorn[standard]"]

[project.optional-dependencies]
dev = ["pytest>=8.0", "httpx>=0.27"]
```

```python
# main.py
from fastapi import FastAPI
app = FastAPI(title="my-project")

@app.get("/")
def root():
    return {"message": "Hello, my-project"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
```

### Node + Express

```json
// package.json
{
  "name": "my-project",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node index.js",
    "test": "node --test"
  },
  "dependencies": { "express": "^4.19.0" }
}
```

```js
// index.js
import express from "express";
const app = express();
app.get("/", (req, res) => res.json({ message: "Hello, my-project" }));
app.listen(3000, () => console.log("Server on http://localhost:3000"));
```

### 纯 Python 脚本

```
my-project/
├── src/
│   └── __init__.py
├── tests/
│   └── test_smoke.py
├── .gitignore
├── pyproject.toml
├── README.md
└── main.py
```

## 注意事项

- **开箱可跑是底线**：如果生成的脚手架用户 `cd` 进去跑不起来，等于没生成。务必用 `run_python` 验证。
- **用主流默认值**：不要装冷门依赖、不要配非主流 lint 规则。用户要的是"标准起点"，不是"个性化定制"。
- **`.gitignore` 要全**：至少覆盖该技术栈常见的临时文件 / 构建产物 / 虚拟环境。
- **README 命令可复制**：不要写 `python main.py`（用户不知道在哪个目录），要写 `cd my-project && python main.py`。
- **不要创建虚拟环境**：只生成 `pyproject.toml`，让用户自己 `python -m venv .venv`。虚拟环境路径因人而异。
- **不要装 pre-commit / lint 工具除非用户要**：默认脚手架保持精简。
- **保留扩展性**：目录结构留出 `src/` 和 `tests/`，方便后续扩展，但不要预先建一堆空目录。

## 推荐工具组合

| 阶段 | 主用工具 |
|------|---------|
| 澄清需求 | `ask_user_qa` |
| 建目录 | `file_manage`（mkdir） |
| 写文件 | `file_write` |
| 验证可跑 | `run_python` |
| Git 初始化 | `run_python`（subprocess） |
