"""测试 SessionMap 的持久化和基本功能。"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from api.pi_bridge.session_adapter import SessionMap


def test_session_map():
    """测试 SessionMap 的 CRUD 操作。"""
    # 使用临时文件测试
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    
    try:
        sm = SessionMap(db_path)
        
        # 初始状态
        assert sm.count == 0, "New map should be empty"
        print("[PASS] Initial state: empty")
        
        # 建立映射
        sm.set_mapping("maxma-session-1", "sidecar-session-abc")
        assert sm.count == 1
        assert sm.get_sidecar_id("maxma-session-1") == "sidecar-session-abc"
        assert sm.get_maxma_id("sidecar-session-abc") == "maxma-session-1"
        print("[PASS] Set and get mapping")
        
        # 反向查找
        mid = sm.get_maxma_id("sidecar-session-abc")
        assert mid == "maxma-session-1"
        print("[PASS] Reverse lookup")
        
        # 更新映射
        sm.set_mapping("maxma-session-1", "sidecar-session-xyz")
        assert sm.get_sidecar_id("maxma-session-1") == "sidecar-session-xyz"
        print("[PASS] Update mapping")
        
        # 删除
        assert sm.remove("maxma-session-1")
        assert sm.get_sidecar_id("maxma-session-1") is None
        assert sm.count == 0
        print("[PASS] Delete mapping")
        
        # 不存在的 session
        assert sm.get_sidecar_id("nonexistent") is None
        print("[PASS] Nonexistent session returns None")
        
        # 持久化验证：关闭后重新打开，数据仍在
        sm2 = SessionMap(db_path)
        sm2.set_mapping("persist-test", "sidecar-persist-1")
        sm2.close()
        
        sm3 = SessionMap(db_path)
        assert sm3.get_sidecar_id("persist-test") == "sidecar-persist-1"
        sm3.close()
        print("[PASS] Persistence across connections")
        
    finally:
        import os
        sm.close()
        os.unlink(db_path)
    
    print("\n[PASS] All session_map tests passed!")


if __name__ == "__main__":
    test_session_map()
