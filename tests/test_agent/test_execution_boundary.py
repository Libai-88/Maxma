# tests/test_agent/test_execution_boundary.py
import pytest
from agent.execution_boundary import create_local_execution_boundary, ExecutionBoundary

def test_boundary_is_immutable():
    """执行边界一旦创建不可修改"""
    boundary = create_local_execution_boundary(
        server_node_id="node-1",
        workbench="d:/project",
        sandbox_enabled=True,
    )
    assert boundary.server_node_id == "node-1"
    with pytest.raises((AttributeError, TypeError)):
        boundary.server_node_id = "node-2"

def test_boundary_has_required_fields():
    boundary = create_local_execution_boundary(
        server_node_id="node-1",
        workbench="d:/project",
        sandbox_enabled=False,
    )
    assert hasattr(boundary, "boundary_id")
    assert hasattr(boundary, "server_node_id")
    assert hasattr(boundary, "workbench")
    assert hasattr(boundary, "sandbox_enabled")
    assert hasattr(boundary, "filesystem_scope")
    assert hasattr(boundary, "network_enabled")
    assert boundary.network_enabled is True

def test_boundary_filesystem_scope():
    boundary = create_local_execution_boundary(
        server_node_id="node-1",
        workbench="d:/project",
        sandbox_enabled=True,
        filesystem_scope=["d:/project", "d:/data"],
    )
    assert "d:/project" in boundary.filesystem_scope
