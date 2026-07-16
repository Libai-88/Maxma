"""Runner 纯函数单元测试 — 已移除，由 OMP 替代。"""
try:
    import agent.autonomy.runner
except ImportError:
    import pytest
    pytest.skip('agent.autonomy.runner module removed — OMP replaces it', allow_module_level=True)
