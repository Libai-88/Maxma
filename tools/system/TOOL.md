# 系统工具领域知识

## time_skill
获取当前日期和时间。直接调用即可，无需参数。

## run_python
在沙箱进程中执行 Python 代码。代码在独立子进程中运行，与主进程隔离。

**沙箱特性（阶段 3.4 + 3.5 加固）：**
- 独立进程执行，不会影响主进程
- 默认超时 30 秒，可通过 `timeout` 参数调整（最大 120 秒）
- 内存限制 512MB（阶段 3.4 SandboxRunner 落地真正生效）
- 在系统临时目录中启动，不以项目目录作为工作目录
- 环境变量中的 API_KEY、SECRET、TOKEN 等敏感变量会被移除（白名单过滤）
- **白名单 builtins**：仅暴露纯计算/数据结构函数（`print`/`len`/`range`/`sum`/`sorted`/`max`/`min`/`int`/`str`/`dict`/`list` 等），不暴露 `open`/`eval`/`exec`/`compile`/`__import__`/`type`/`getattr`/`globals` 等
- **元编程逃逸拦截（双层）**：
  - 主进程 AST 预检：阻断 `__subclasses__`/`__globals__`/`__class__`/`__bases__`/`__mro__`/`__builtins__`/`__dict__`/`__code__`/`__getattribute__` 等 dunder 属性访问
  - 子进程 AST 变换 + 运行时拦截：将 `obj.attr` 重写为 `_safe_getattr(obj, 'attr')`，运行时阻断所有 `__*__` dunder 属性（`__name__`/`__doc__` 除外）
- **模块导入禁用**：`import os`、`import subprocess` 等会被拦截并报 `ImportError: 沙箱中已禁用模块导入`
- **OS 级隔离（阶段 3.4 SandboxRunner）**：
  - 能力探测 + 优雅降级链：firejail (Linux) → setrlimit (Unix) → Job Object (Windows) → 纯 subprocess
  - Linux：firejail 包装 + profile 白名单路径 + `--net=none` 网络隔离 + rlimit-as 内存限制
  - Unix：`resource.setrlimit(RLIMIT_AS)` 限制虚拟内存地址空间，超限触发 MemoryError
  - Windows：Job Object (`JOB_OBJECT_LIMIT_PROCESS_MEMORY` + 关闭时清理子进程树) via ctypes
  - macOS：RLIMIT_AS 不稳定，降级到纯 subprocess（无内存限制，仅依赖超时）
  - 配置项见 `config/settings.py`：`sandbox_memory_mb`（默认 512）、`sandbox_network_isolation`（默认 True）、`sandbox_isolation_level`（默认 auto）

**参数：**
- `code`：要执行的 Python 代码（支持多行）
- `timeout`：执行超时秒数（默认 30，最大 120）

**使用场景：**
- 数学计算、数据处理
- 文本转换、格式处理
- 列表/字典/字符串操作

**注意事项：**
- 代码无法访问项目目录（工作目录为临时目录）
- 无法导入任何模块（包括标准库 `os`/`sys`/`subprocess`/`json` 等）
- 禁止文件 I/O（`open` 不可用）
- 禁止元编程/反射（`type`/`getattr`/`globals`/`__class__` 等不可用）
- 超时代码会被强制终止
- Windows Job Object 不是受限令牌、网络防火墙或文件系统 ACL 沙箱；运行时会将这些缺失能力报告为降级状态
