"""覆盖率冲刺 — api/pi_bridge/sidecar_manager.py 未覆盖分支。

针对以下未覆盖行：
- Line 20:  `sys.path.insert(0, str(_project_root))` —— 仅当项目根不在 sys.path 时执行
- Lines 222-239: `_test()` 自测函数体 —— 仅在 `__main__` 下运行
- Line 243:  `asyncio.run(_test())` —— `if __name__ == "__main__":` 入口

不修改源代码，只通过 mock + 重新执行模块源码来覆盖。
"""

import asyncio
import logging
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.pi_bridge import sidecar_manager as sm_mod
from api.pi_bridge.sidecar_manager import _test, SidecarManager

_SM_PATH = Path(sm_mod.__file__).resolve()
_PROJECT_ROOT = str(_SM_PATH.parent.parent.parent)


# ---------------------------------------------------------------------------
# Lines 222-239: _test() 函数体
# ---------------------------------------------------------------------------


class _NoOpAsyncIter:
    """立即 EOF 的 async iterator，用于 _forward_stderr 立即退出。"""

    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration


def _make_self_test_proc():
    """构造一个能通过 _test() 所有断言的 mock 子进程。"""
    proc = MagicMock()
    proc.pid = 4242
    # is_running 需要 returncode is None
    proc.returncode = None
    proc.stdin = MagicMock()
    proc.stdout = MagicMock()
    proc.stderr = _NoOpAsyncIter()
    proc.terminate = MagicMock()
    proc.kill = MagicMock()
    proc.wait = AsyncMock(return_value=0)
    return proc


class TestSelfTestFunction:
    """直接调用 _test() 覆盖 lines 222-239。"""

    async def test_test_function_runs_with_mocked_subprocess(self, monkeypatch, capsys):
        """_test() 应在 mock 子进程下完整跑完 start/assert/stop/assert。"""
        proc = _make_self_test_proc()

        async def fake_create_subprocess_exec(*args, **kwargs):
            return proc

        monkeypatch.setattr(
            sm_mod.asyncio, "create_subprocess_exec", fake_create_subprocess_exec
        )

        # 跳过 start() 里的 asyncio.sleep(0.5)
        async def fake_sleep(*a, **k):
            return None

        monkeypatch.setattr(sm_mod.asyncio, "sleep", fake_sleep)

        # mock JsonRpcClient 构造 + start_reading + stop
        mock_client = MagicMock()
        mock_client.start_reading = AsyncMock()
        mock_client.stop = AsyncMock()
        monkeypatch.setattr(
            sm_mod, "JsonRpcClient", lambda stdin, stdout: mock_client
        )

        # 抑制 logging.basicConfig 副作用 & print 噪音
        monkeypatch.setattr(logging, "basicConfig", lambda *a, **k: None)
        monkeypatch.setattr("builtins.print", lambda *a, **k: None)

        # 不应抛异常
        await _test()

        # 验证 _test() 内部确实走完了 start/stop 流程
        assert proc.terminate.called or proc.wait.await_count >= 1


# ---------------------------------------------------------------------------
# Line 20: sys.path.insert(0, str(_project_root))
# ---------------------------------------------------------------------------


class TestSysPathInsertion:
    """覆盖 line 20：当项目根不在 sys.path 时触发 insert。"""

    def test_module_path_insertion_when_root_missing(self):
        """移除项目根后重新执行模块源码，触发 sys.path.insert 分支。"""
        # 保存原始 sys.path
        original_path = sys.path.copy()
        try:
            # 移除项目根（可能出现多次或带不同大小写/分隔符）
            sys.path = [p for p in sys.path if Path(p).resolve() != Path(_PROJECT_ROOT).resolve()]

            # 重新执行模块源码
            src = _SM_PATH.read_text(encoding="utf-8")
            g = {"__name__": "test_reexec_sm", "__file__": str(_SM_PATH)}
            # 不应抛异常
            exec(compile(src, str(_SM_PATH), "exec"), g)

            # 验证 line 20 执行后，项目根被重新插入 sys.path
            resolved = {Path(p).resolve() for p in sys.path}
            assert Path(_PROJECT_ROOT).resolve() in resolved
        finally:
            sys.path = original_path


# ---------------------------------------------------------------------------
# Line 243: asyncio.run(_test()) under if __name__ == "__main__":
# ---------------------------------------------------------------------------


class _ProtectedGlobals(dict):
    """dict 子类：对指定 key 已存在时禁止覆盖。

    用于在重新执行模块源码时，保护我们预先注入的 mock（如 _test），
    防止源码里的 `async def _test()` 重定义覆盖掉 mock。
    """

    def __init__(self, *args, protected=(), **kwargs):
        super().__init__(*args, **kwargs)
        self._protected = set(protected)

    def __setitem__(self, key, value):
        if key in self._protected and key in self:
            return  # 阻止覆盖
        super().__setitem__(key, value)


class TestMainBlock:
    """覆盖 line 243：`if __name__ == "__main__": asyncio.run(_test())`。"""

    def test_main_block_invokes_asyncio_run_with_test(self, monkeypatch):
        """重新执行模块源码为 __main__，验证 asyncio.run(_test()) 被调用。"""
        # 准备一个 no-op async fake _test —— 返回 coroutine
        async def fake_test():
            return None

        # 捕获 asyncio.run 调用
        run_calls = {"count": 0, "coro": None}

        def fake_asyncio_run(coro):
            run_calls["count"] += 1
            run_calls["coro"] = coro
            # 关闭 coroutine 避免警告
            coro.close()

        # 关键：monkeypatch 真实 asyncio 模块的 run，
        # 因为源码 `import asyncio` 会拿到同一个真实模块对象
        monkeypatch.setattr(asyncio, "run", fake_asyncio_run)

        # 构造受保护的全局命名空间
        g = _ProtectedGlobals(protected=("_test",))
        g["__name__"] = "__main__"
        g["__file__"] = str(_SM_PATH)
        g["_test"] = fake_test

        # 重新执行模块源码 —— 触发 `if __name__ == "__main__":` 分支
        src = _SM_PATH.read_text(encoding="utf-8")
        exec(compile(src, str(_SM_PATH), "exec"), g)

        # 验证 asyncio.run 被调用一次，且参数是 fake_test() coroutine
        assert run_calls["count"] == 1
        assert run_calls["coro"] is not None


# ---------------------------------------------------------------------------
# 额外回归测试：验证 _ProtectedGlobals 行为正确
# ---------------------------------------------------------------------------


class TestProtectedGlobalsHelper:
    """确保 _ProtectedGlobals 工具类按预期工作。"""

    def test_protected_key_not_overwritten(self):
        async def original():
            return "original"

        g = _ProtectedGlobals(protected=("_test",))
        g["_test"] = original

        # 模拟源码里的 `async def _test(): ...` 重定义
        async def redefined():
            return "redefined"

        g["_test"] = redefined  # 应被阻止

        assert g["_test"] is original

    def test_non_protected_key_can_be_overwritten(self):
        g = _ProtectedGlobals(protected=("_test",))
        g["other"] = "v1"
        g["other"] = "v2"
        assert g["other"] == "v2"

    def test_protected_key_can_be_set_first_time(self):
        g = _ProtectedGlobals(protected=("_test",))
        g["_test"] = "first"
        assert g["_test"] == "first"


# ---------------------------------------------------------------------------
# 回归：SidecarManager 仍可正常实例化（确保上面的 exec 没污染模块）
# ---------------------------------------------------------------------------


def test_sidecar_manager_still_importable_and_usable():
    """确保上面的 exec 不会污染已导入的 sm_mod 模块状态。"""
    mgr = SidecarManager()
    assert mgr._process is None
    assert mgr._client is None
    assert mgr.is_running is False
