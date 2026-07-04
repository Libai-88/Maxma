# 生产打包设计:完全自包含 Windows 安装包

**版本**: v1.0
**日期**: 2026-07-05
**目标**: 构建无需额外安装任何工具、开箱即用的 Windows x64 安装包

## 一、设计目标

### 核心诉求
- 用户双击安装包后,无需安装任何额外运行时即可使用全部功能
- 包括:Agent 对话、工具调用、RAG 知识库、Playwright 浏览器自动化、MCP 服务器
- 目标平台:仅 Windows x64
- 安装包大小:接受 600-700MB

### 自包含范围
| 组件 | 是否嵌入 | 说明 |
|------|----------|------|
| Python 后端 + 全部依赖 | ✅ | PyInstaller onefile exe |
| 前端构建产物 | ✅ | 打包进 PyInstaller _MEIPASS |
| Tauri 桌面外壳 | ✅ | Rust 原生编译 |
| Node.js 运行时 | ✅ | 嵌入式 win-x64 zip |
| Python embeddable | ✅ | 官方 embeddable zip(供 MCP stdio 使用) |
| uv 二进制 | ✅ | GitHub releases 单文件 |
| Playwright Chromium | ✅ | 浏览器二进制 |
| ONNX 嵌入模型 | ✅ | paraphrase-multilingual-MiniLM-L12-v2 |
| MCP 模板库 | ❌ | 不做 |
| 小白友好向导 UI | ❌ | 不做 |
| 跨平台支持 | ❌ | 仅 Windows |
| 代码签名 | ❌ | 不做 |

## 二、整体架构:分层打包

### 分层结构

```
NSIS 安装包 (~600MB)
│
├── 核心层: maxma-server.exe (PyInstaller onefile, ~210MB)
│   └── Python 解释器 + 全部 Python 依赖 + 前端构建产物
│
├── 运行时层: resources/runtime/ (~80MB)
│   ├── node/           ← Node.js v20.18.1 LTS win-x64 (~40MB)
│   │   ├── node.exe
│   │   ├── npm.cmd
│   │   ├── npx.cmd
│   │   └── node_modules/npm/...
│   ├── python/         ← Python 3.13.13 embeddable (~30MB)
│   │   ├── python.exe
│   │   ├── python313.dll
│   │   ├── python313.zip
│   │   └── Lib/site-packages/  (含 pip)
│   └── uv/             ← uv 0.5.11 (~10MB)
│       └── uv.exe
│
└── 资源层: resources/assets/ (~270MB)
    ├── playwright/     ← Chromium 浏览器 (~150MB)
    │   └── chromium-XXXX/chrome-win/chrome.exe
    └── models/         ← ONNX 嵌入模型 (~120MB)
        └── paraphrase-multilingual-MiniLM-L12-v2/
            ├── config.json
            ├── tokenizer.json
            ├── tokenizer_config.json
            ├── vocab.txt
            └── onnx/model.onnx
```

### 三层路径模型

现有路径模型有 `BUNDLE_DIR`(PyInstaller _MEIPASS 只读)和 `DATA_DIR`(%APPDATA% 可写)。新增第三层 `RUNTIME_DIR`:

```
RUNTIME_DIR = Tauri 安装目录下的 resources/ 目录
  ├── 开发模式: desktop/src-tauri/resources/  (相对路径, 便于调试)
  └── 打包模式: %LOCALAPPDATA%\MaxmaHere\resources\  (currentUser 安装)
               或 C:\Program Files\MaxmaHere\resources\  (perMachine 安装)
```

**路径注入流程**:
1. Tauri main.rs 启动 sidecar 前,通过 `app.path().resource_dir()` 获取资源目录
2. 作为环境变量 `MAXMA_RESOURCES_DIR` 传给 sidecar 进程
3. Python 后端 `app_paths.py` 新增 `RUNTIME_DIR` 常量,优先读环境变量,开发模式回退到项目目录

```python
# app_paths.py 新增
RUNTIME_DIR = Path(os.environ.get("MAXMA_RESOURCES_DIR") or (BUNDLE_DIR / ".." / "resources"))
NODE_EXE = RUNTIME_DIR / "runtime" / "node" / "node.exe"
NODE_NPX_CMD = RUNTIME_DIR / "runtime" / "node" / "npx.cmd"
PYTHON_EMBED_EXE = RUNTIME_DIR / "runtime" / "python" / "python.exe"
UV_EXE = RUNTIME_DIR / "runtime" / "uv" / "uv.exe"
PLAYWRIGHT_BROWSERS_PATH = RUNTIME_DIR / "assets" / "playwright"
ONNX_MODEL_PATH = RUNTIME_DIR / "assets" / "models" / "paraphrase-multilingual-MiniLM-L12-v2"
```

三层路径各司其职:
- `BUNDLE_DIR` — PyInstaller 内置资源(前端、配置模板)
- `RUNTIME_DIR` — Tauri resources(嵌入式运行时、大文件)
- `DATA_DIR` — 用户可写数据(SQLite、向量库、上传文件)

## 三、嵌入式运行时获取与构建脚本

### prepare-runtime.ps1

新增 `build/prepare-runtime.ps1`,在 `build-desktop.bat` 流程中 PyInstaller 之后、Tauri 构建之前执行。

**版本固定**:
| 运行时 | 版本 | 来源 | 目标路径 |
|--------|------|------|----------|
| Node.js | v20.18.1 LTS | `https://nodejs.org/dist/v20.18.1/node-v20.18.1-win-x64.zip` | `resources/runtime/node/` |
| Python embeddable | 3.13.13 | `https://www.python.org/ftp/python/3.13.13/python-3.13.13-embed-amd64.zip` | `resources/runtime/python/` |
| uv | 0.5.11 | `https://github.com/astral-sh/uv/releases/download/0.5.11/uv-x86_64-pc-windows-msvc.zip` | `resources/runtime/uv/` |

**Python embeddable 特殊处理**:
1. 解压 `python313._pth` 文件,取消 `import site` 注释(启用 site-packages)
2. 下载 `get-pip.py` 并执行 `python.exe get-pip.py`(安装 pip)
3. 创建 `Lib/site-packages/` 目录

**缓存机制**:下载前检查 `%LOCALAPPDATA%\MaxmaBuildCache\` 是否已有对应版本的 zip,有则跳过下载。

### prepare-assets.ps1

新增 `build/prepare-assets.ps1`,下载 Playwright Chromium 和 ONNX 模型。

| 资源 | 来源 | 目标路径 |
|------|------|----------|
| Playwright Chromium | `python -m playwright install chromium` | `resources/assets/playwright/chromium-XXXX/` |
| ONNX 模型 | `huggingface_hub.snapshot_download` | `resources/assets/models/paraphrase-multilingual-MiniLM-L12-v2/` |

**Playwright 浏览器路径控制**:
- 构建时设置 `PLAYWRIGHT_BROWSERS_PATH=desktop/src-tauri/resources/assets/playwright` 再执行 `playwright install chromium`
- 运行时 `browser_manager.py` 通过 `RUNTIME_DIR / "assets" / "playwright"` 解析浏览器路径

**ONNX 模型获取**:
- 构建时用项目 venv 执行 `huggingface_hub.snapshot_download`,把模型下载到 `resources/assets/models/`
- 运行时 `config/settings.py` 的 `embedding_model_local_path` 默认值改为 `str(ONNX_MODEL_PATH)`

### build-desktop.bat 新流程

```
[1/5] 端口清理 (port-guard.ps1)
[2/5] 前端构建 (cd web && npm run build)
[3/5] 后端打包 (pyinstaller maxma-server.spec)        ← 现有
[4/5] 准备运行时和资源 (prepare-runtime.ps1 + prepare-assets.ps1)  ← 新增
      └─ 下载/缓存 Node + Python embeddable + uv
      └─ 下载 Playwright Chromium + ONNX 模型
      └─ 释放到 desktop/src-tauri/resources/
[5/5] Tauri 构建 (cargo tauri build)
      └─ tauri.conf.json 的 resources 配置自动打包 resources/ 目录
```

### tauri.conf.json 修改

```json
{
  "bundle": {
    "resources": [
      "resources/default-config/*",
      "resources/runtime/**/*",
      "resources/assets/**/*"
    ],
    "publisher": "MaxmaHere"
  }
}
```

### .gitignore 配置

`desktop/src-tauri/resources/runtime/` 和 `resources/assets/` 加入 .gitignore,这些是构建时下载的二进制,不进 git。

## 四、MCP 命令解析重写

### 问题

当前 `tools/mcp_security.py` 白名单是 `{"npx", "node", "python", "python3", "uvx"}`,依赖系统 PATH 查找。用户机器上没有这些命令时 MCP 服务器无法启动。

### 新增 tools/mcp_runtime.py

负责把白名单命令解析为 `RUNTIME_DIR` 下的绝对路径。

```python
def resolve_mcp_command(command: str) -> str:
    """把 MCP 配置中的命令名解析为嵌入式运行时的绝对路径。
    
    打包模式: 优先使用 RUNTIME_DIR 下的二进制
    开发模式: 回退到系统 PATH 查找(保持开发体验)
    """
    runtime_map = {
        "node": NODE_EXE,
        "npx": NODE_NPX_CMD,
        "python": PYTHON_EMBED_EXE,
        "python3": PYTHON_EMBED_EXE,
        "uvx": UV_EXE,
    }
    
    # 打包模式: 直接用绝对路径
    if IS_FROZEN and command in runtime_map:
        resolved = runtime_map[command]
        if resolved.exists():
            return str(resolved)
        # 回退到系统 PATH(嵌入式运行时缺失时降级)
    
    # 开发模式或回退: 系统 PATH 查找
    return shutil.which(command) or command
```

### mcp_security.py 改动

- 白名单保持不变(仍允许 `npx`/`node`/`python`/`python3`/`uvx`)
- 新增 `resolve_command()` 钩子,在 `validate_mcp_config()` 之后、`spawn` 之前调用
- 子进程环境变量注入 `PLAYWRIGHT_BROWSERS_PATH`、`NODE_PATH`,PATH 前置嵌入式运行时目录

```python
def build_mcp_env(base_env: dict) -> dict:
    """构造 MCP 子进程环境变量。"""
    env = base_env.copy()
    if IS_FROZEN:
        env["PLAYWRIGHT_BROWSERS_PATH"] = str(PLAYWRIGHT_BROWSERS_PATH)
        env["NODE_PATH"] = str(NODE_GLOBAL_MODULES)
        env["PYTHONPATH"] = str(PYTHON_SITE_PACKAGES)
        env["PATH"] = f"{RUNTIME_DIR / 'runtime' / 'node'};{RUNTIME_DIR / 'runtime' / 'python'};{RUNTIME_DIR / 'runtime' / 'uv'};{env.get('PATH', '')}"
    return env
```

## 五、MCP 测试连接功能

### 后端接口

新增 `api/routes/mcp_templates.py`(或复用现有 mcp 路由模块):

```
POST /api/mcp/test-connection
```

**请求体**:
```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users"],
  "env": {}
}
```

**响应**:
```json
{
  "success": true,
  "error": null,
  "resolved_command": "C:\\Users\\...\\resources\\runtime\\node\\npx.cmd"
}
```

**实现逻辑**:
1. 用 `resolve_mcp_command()` 解析命令路径
2. 用 `build_mcp_env()` 构造子进程环境变量
3. 启动子进程,5 秒内未崩溃视为成功
4. 超时后终止子进程,返回结果

### 前端改造

在现有 MCP 配置页面新增"测试连接"按钮:
- 用户填完 command/args/env 后点击按钮
- 调用 `POST /api/mcp/test-connection`
- 显示成功/失败状态和错误信息
- 成功后才允许保存(可选,不强制)

## 六、其他改动

### Playwright 浏览器路径

`tools/network/playwright_tools/browser_manager.py`:
- 在 `chromium.launch()` 前设置 `PLAYWRIGHT_BROWSERS_PATH` 环境变量指向 `RUNTIME_DIR / "assets" / "playwright"`
- 或直接传 `executable_path` 参数(优先用环境变量,更通用)

### ONNX 模型路径

`config/settings.py`:
- `embedding_model_local_path` 默认值改为打包路径
- 打包模式: `str(ONNX_MODEL_PATH)`
- 开发模式: 空字符串(触发在线下载,保持开发体验)

### Tauri main.rs 改动

启动 sidecar 前注入 `MAXMA_RESOURCES_DIR` 环境变量:

```rust
let resource_dir = app.path().resource_dir()?;
let mut env = CommandEnv::default();
env.insert("MAXMA_RESOURCES_DIR", resource_dir.to_string_lossy());
// ... 其他环境变量
sidecar.env(env);
```

## 七、不做的事项

以下事项明确不在本次设计范围内:

| 不做项 | 原因 |
|--------|------|
| MCP 模板库 | 用户需求简化,不做小白向导 |
| 小白友好向导 UI | 同上 |
| 跨平台支持(macOS/Linux) | 仅 Windows x64 |
| 代码签名 | 不做,Windows SmartScreen 会警告但可放行 |
| MSI 安装包 | 仅 NSIS |
| 自动更新 | 不做,手动下载新版安装包覆盖 |
| PyInstaller onedir 模式 | 保持 onefile,启动时解压到 _MEIPASS |

## 八、验证标准

构建完成后,在纯净 Windows 机器(无 Node.js/Python/uv)上验证:

1. **安装**:双击 NSIS 安装包,完成安装
2. **启动**:桌面快捷方式启动应用,窗口正常显示
3. **Agent 对话**:发送消息,LLM 正常响应
4. **工具调用**:调用内置工具(如文件操作、搜索)
5. **RAG 知识库**:上传文档,向量化成功,检索正常
6. **Playwright 浏览器**:调用浏览器自动化工具,Chromium 正常启动
7. **MCP 服务器**:配置一个 npx 类 MCP 服务器,点击"测试连接"成功,Agent 能调用其工具
8. **持久化**:重启应用,会话历史和 SQLite checkpoint 正常恢复
