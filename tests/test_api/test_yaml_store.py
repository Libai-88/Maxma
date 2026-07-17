"""测试 — api/yaml_store.py YAML 原子读写与文件锁。"""

import threading

import pytest
import yaml as yaml_lib

from api.yaml_store import (
    _get_inproc_lock,
    _lock_path,
    dump_yaml_atomic,
    dump_yaml_backup_once,
    load_yaml,
    yaml_file_lock,
)


class TestLockPath:
    def test_lock_path_appends_lock_suffix(self, tmp_path):
        p = _lock_path(tmp_path / "data.yaml")
        assert str(p).endswith("data.yaml.lock")
        assert p.name == "data.yaml.lock"


class TestGetInprocLock:
    def test_same_path_returns_same_lock(self):
        lock1 = _get_inproc_lock("/tmp/same.yaml")
        lock2 = _get_inproc_lock("/tmp/same.yaml")
        assert lock1 is lock2

    def test_different_path_returns_different_lock(self):
        lock1 = _get_inproc_lock("/tmp/a.yaml")
        lock2 = _get_inproc_lock("/tmp/b.yaml")
        assert lock1 is not lock2

    def test_inproc_lock_is_threading_lock(self):
        lock = _get_inproc_lock("/tmp/check.yaml")
        assert isinstance(lock, type(threading.Lock()))


class TestYamlFileLock:
    def test_lock_acquires_and_releases(self, tmp_path):
        target = tmp_path / "nested" / "file.yaml"
        with yaml_file_lock(target):
            # lock 文件应被创建（parent 也应被创建）
            assert _lock_path(target).parent.exists()
        # 退出后 lock 文件可被再次获取（无死锁）
        with yaml_file_lock(target):
            pass

    def test_lock_creates_parent_dirs(self, tmp_path):
        target = tmp_path / "deep" / "nested" / "dir" / "file.yaml"
        assert not target.parent.exists()
        with yaml_file_lock(target):
            assert _lock_path(target).parent.exists()

    def test_lock_is_reentrant_in_same_thread(self, tmp_path):
        """同进程内 portalocker 可重入；叠加的 threading.Lock 在同线程内也可重入？
        实际 threading.Lock 不可重入。这里只验证单次获取正常释放。"""
        target = tmp_path / "f.yaml"
        with yaml_file_lock(target):
            pass
        # 能再次获取说明已释放
        with yaml_file_lock(target):
            pass


class TestLoadYaml:
    def test_missing_file_returns_default(self, tmp_path):
        assert load_yaml(tmp_path / "nope.yaml", default={"a": 1}) == {"a": 1}

    def test_missing_file_default_none(self, tmp_path):
        assert load_yaml(tmp_path / "nope.yaml") is None

    def test_empty_file_returns_default(self, tmp_path):
        p = tmp_path / "empty.yaml"
        p.write_text("", encoding="utf-8")
        assert load_yaml(p, default={"x": 2}) == {"x": 2}

    def test_invalid_yaml_returns_default(self, tmp_path):
        p = tmp_path / "bad.yaml"
        p.write_text(": : : invalid :::", encoding="utf-8")
        assert load_yaml(p, default="fallback") == "fallback"

    def test_valid_yaml_returned(self, tmp_path):
        p = tmp_path / "ok.yaml"
        p.write_text("key: value\nlist:\n  - 1\n  - 2\n", encoding="utf-8")
        data = load_yaml(p)
        assert data == {"key": "value", "list": [1, 2]}


class TestDumpYamlAtomic:
    def test_writes_and_replaces(self, tmp_path):
        target = tmp_path / "out.yaml"
        dump_yaml_atomic(target, {"name": "测试", "n": 3})
        assert target.exists()
        loaded = yaml_lib.safe_load(target.read_text(encoding="utf-8"))
        assert loaded == {"name": "测试", "n": 3}

    def test_creates_parent_dirs(self, tmp_path):
        target = tmp_path / "sub" / "deep" / "out.yaml"
        dump_yaml_atomic(target, {"a": 1})
        assert target.exists()

    def test_overwrites_existing(self, tmp_path):
        target = tmp_path / "out.yaml"
        target.write_text("old: data", encoding="utf-8")
        dump_yaml_atomic(target, {"new": "data"})
        loaded = yaml_lib.safe_load(target.read_text(encoding="utf-8"))
        assert loaded == {"new": "data"}

    def test_no_tmp_file_left(self, tmp_path):
        target = tmp_path / "out.yaml"
        dump_yaml_atomic(target, {"a": 1})
        tmps = list(tmp_path.glob(".*.tmp"))
        assert tmps == []


class TestDumpYamlBackupOnce:
    def test_first_call_succeeds(self, tmp_path):
        backup = tmp_path / "backup.yaml"
        result = dump_yaml_backup_once(backup, {"v": 1})
        assert result is True
        assert backup.exists()
        loaded = yaml_lib.safe_load(backup.read_text(encoding="utf-8"))
        assert loaded == {"v": 1}

    def test_second_call_returns_false_without_overwriting(self, tmp_path):
        backup = tmp_path / "backup.yaml"
        assert dump_yaml_backup_once(backup, {"v": 1}) is True
        # 第二次：已存在 → False，且内容不变
        result = dump_yaml_backup_once(backup, {"v": 999})
        assert result is False
        loaded = yaml_lib.safe_load(backup.read_text(encoding="utf-8"))
        assert loaded == {"v": 1}

    def test_creates_parent_dirs(self, tmp_path):
        backup = tmp_path / "backups" / "nested" / "b.yaml"
        assert dump_yaml_backup_once(backup, {"a": 1}) is True
        assert backup.exists()
