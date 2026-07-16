"""阶段 3.1 测试：CircuitBreaker + ErrorRecovery — 已移除，由 OMP 替代。"""
try:
    import agent.circuit_breaker
except ImportError:
    import pytest
    pytest.skip('agent.circuit_breaker module removed — OMP replaces it', allow_module_level=True)
