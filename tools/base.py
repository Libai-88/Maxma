"""向后兼容的 re-export 门面。

所有符号已拆分至聚焦模块：
- ``tools.client``        — SharedAPIClient
- ``tools.tool_base``     — ToolBase
- ``tools.formatting``    — format_success / format_error
- ``tools.path_security`` — 路径访问控制、MaxmaBlocker、exec 安全 builtins

本文件保留 re-export，确保现有 ``from tools.base import X`` 继续可用。
"""

from tools.client import SharedAPIClient  # noqa: F401
from tools.tool_base import ToolBase  # noqa: F401
from tools.formatting import format_success, format_error  # noqa: F401
from tools.path_security import (  # noqa: F401
    check_path_access,
    check_maxma_blocker,
    check_path_whitelisted,
    get_safe_builtins,
)
