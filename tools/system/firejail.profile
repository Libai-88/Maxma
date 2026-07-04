# firejail profile for MaxmaHere Python sandbox (阶段 3.4)
# 白名单策略：仅允许 Python 运行必需的路径，禁网络，禁 /tmp 之外写入

# ── 网络隔离 ──────────────────────────────────────────────────
# --net=none 在命令行指定，这里不重复

# ── 文件系统白名单 ────────────────────────────────────────────
# Python 解释器与标准库
whitelist /usr/bin/python*
whitelist /usr/lib/python*
whitelist /usr/local/lib/python*
whitelist /usr/local/bin/python*

# 临时目录（沙箱工作目录）
whitelist /tmp

# 用户主目录下的 Python 虚拟环境（常见路径）
whitelist ${HOME}/.venv
whitelist ${HOME}/.local/lib/python*

# ── 禁止访问的路径 ────────────────────────────────────────────
# 防止沙箱代码读取项目配置/凭据
deny /etc/shadow
deny /etc/ssh
deny ${HOME}/.ssh
deny ${HOME}/.gnupg

# ── 内核安全 ──────────────────────────────────────────────────
# 禁止 ptrace（防止进程注入）
noroot

# 禁止 d-bus
nodbus

# 禁止访问 /dev 中的危险设备
private-dev

# ── 资源限制 ──────────────────────────────────────────────────
# 内存限制（MB）— 与 MAX_MEMORY_MB 一致
rlimit-as 512

# CPU 时间限制（秒）— 防止死循环消耗 CPU
rlimit-cpu 60

# 文件大小限制（MB）— 防止写入大文件
rlimit-fsize 64

# ── 命名空间隔离 ──────────────────────────────────────────────
# 独立的 IPC 命名空间
ipc-namespace

# 不共享挂载命名空间
private-mnt
