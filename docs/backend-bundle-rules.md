# Backend Bundle Rules

后端打包的真实边界以这 3 个文件为准，不再靠口头记忆：

- `build/maxma-server.spec`
- `build/build-server.bat`
- `build/smoke-test-server.ps1`

## 1. 哪些东西必须进包

### Python 代码

- 主入口：`main.py`
- 业务代码：`api/`、`agent/`、`memory/`、`tools/`
- 动态导入较多的框架：`langgraph`、`langchain_openai`

规则：

- 常规静态导入由 PyInstaller 自动分析
- 动态导入和运行时插件模块，必须在 `build/maxma-server.spec` 里补 `hiddenimports`
- 对已知动态导入框架，优先使用 `collect_submodules()` 自动收集，而不是继续手写零散子模块

### 资源文件

这些内容不是 Python 模块，但运行时必须存在：

- `web/dist`
- `config`
- `anthropic_skills`
- `macros`
- `tools/**/TOOL.md`

规则：

- 所有资源目录统一在 `build/maxma-server.spec` 的 `datas` 里声明
- 新增运行时依赖的非代码文件时，必须同步更新 `datas`

### 原生扩展 / DLL / .pyd

- `.venv/Lib/site-packages` 下的本地扩展模块
- 与扩展模块绑定的动态库

规则：

- 由 `build/maxma-server.spec` 中的本地扩展收集逻辑统一处理
- 新增依赖如果带原生扩展，打包后必须用冒烟测试验证真实启动

## 2. 哪些变更必须回头看打包

只要出现下面任一情况，就必须重新检查后端打包：

- 新增 Python 依赖
- 新增动态导入
- 新增运行时读取的模板、配置、Markdown、静态资源
- 新增 `.pyd`、`.dll`、二进制依赖
- 改动认证、中间件、启动流程、provider 初始化

## 3. 固定验证顺序

后端打包不再只看“是否产出 exe”，必须通过这个顺序：

1. `build\build-server.bat`
2. `build\smoke-test-server.ps1`
3. 确认 `dist\maxma-server.exe` 可启动
4. 确认 `/api/auth/token` 可返回
5. 确认 `/api/health` 可返回
6. 确认 `/api/providers` 可返回
7. 再进入 `build\run-desktop-dev.bat` 或 `build\build-desktop.bat`

## 4. 设计原则

- 启动探针必须使用轻量接口，不允许拿远端 provider 探活当“后端已就绪”判断
- 桌面启动优先验证“本地运行时是否起来”，再验证“远端模型是否可用”
- 如果源码能跑、打包不能跑，优先检查 `.spec` 和实际打包 Python 环境，而不是继续猜前端问题
