"""Tests for ``agent.memory.working_memory.WorkingMemoryStore``.

The store is a thin file-backed wrapper around a ``memory.md`` file with a
``# now`` working block and a ``# History`` append-only timeline.  All tests
use ``tmp_path`` for isolation so no real config files are touched.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from agent.memory.working_memory import WorkingMemoryStore


@pytest.fixture
def store(tmp_path: Path) -> WorkingMemoryStore:
    return WorkingMemoryStore(tmp_path / "memory.md")


def test_exists_false_before_creation(store: WorkingMemoryStore) -> None:
    assert store.exists() is False


def test_ensure_created_creates_empty_file_and_dirs(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "deep" / "memory.md"
    s = WorkingMemoryStore(path)

    assert not path.exists()
    s.ensure_created()

    assert path.exists()
    assert path.read_text(encoding="utf-8") == ""
    # idempotent: second call is a no-op (still empty)
    s.ensure_created()
    assert path.read_text(encoding="utf-8") == ""


def test_ensure_created_makes_exist_true(store: WorkingMemoryStore) -> None:
    assert store.exists() is False
    store.ensure_created()
    assert store.exists() is True


def test_read_content_missing_returns_empty(store: WorkingMemoryStore) -> None:
    assert store.read_content() == ""


def test_write_and_read_round_trip(store: WorkingMemoryStore) -> None:
    store.write_content("# now\nhello")
    assert store.read_content() == "# now\nhello"


def test_write_content_creates_parent_dirs(tmp_path: Path) -> None:
    path = tmp_path / "a" / "b" / "memory.md"
    WorkingMemoryStore(path).write_content("data")
    assert path.read_text(encoding="utf-8") == "data"


# ── read_now_section ───────────────────────────────────────────


def test_read_now_section_empty_content(store: WorkingMemoryStore) -> None:
    assert store.read_now_section("") == ""
    assert store.read_now_section(None) == ""  # type: ignore[arg-type]


def test_read_now_section_no_now_block(store: WorkingMemoryStore) -> None:
    store.write_content("# History\n## 2026-01-01-0000 | x\n")
    assert store.read_now_section() == ""


def test_read_now_section_only_now_block(store: WorkingMemoryStore) -> None:
    content = "# now\n## State\n正在做事\n## Patterns\n- x\n"
    store.write_content(content)
    # no following H1 -> returns whole tail from "# now" (unstripped in this branch)
    result = store.read_now_section()
    assert result == content
    assert result.startswith("# now")
    assert "## Patterns" in result
    assert "正在做事" in result


def test_read_now_section_stops_at_next_h1(store: WorkingMemoryStore) -> None:
    content = (
        "# now\n"
        "## State\nworking\n"
        "\n"
        "# History\n"
        "## 2026-01-01-0000 | started\n"
    )
    store.write_content(content)
    result = store.read_now_section()
    assert result.startswith("# now")
    assert "## State" in result
    assert "working" in result
    # must not bleed into History
    assert "# History" not in result
    assert "started" not in result


def test_read_now_section_accepts_pre_read_content(store: WorkingMemoryStore) -> None:
    content = "# now\n## State\nhi\n\n# History\n## x | y\n"
    store.write_content(content)
    # passing content explicitly avoids re-reading the file
    direct = store.read_now_section(content)
    indirect = store.read_now_section()
    assert direct == indirect


def test_read_now_section_does_not_match_now_inside_text(store: WorkingMemoryStore) -> None:
    # the regex anchors on ^# now at line start, so inline mentions must not match
    store.write_content("some text about # now here\nmore\n")
    assert store.read_now_section() == ""


# ── build_snapshot ─────────────────────────────────────────────


def test_build_snapshot_missing_file_guidance(tmp_path: Path) -> None:
    path = tmp_path / "absent.md"
    s = WorkingMemoryStore(path)
    snap = s.build_snapshot()
    assert "工作记忆" in snap
    assert str(path) in snap
    assert "不存在" in snap


def test_build_snapshot_small_file_returns_full_content(store: WorkingMemoryStore) -> None:
    body = "# now\n## State\nshort memory\n"
    store.write_content(body)
    snap = store.build_snapshot()
    assert snap.startswith("## 工作记忆")
    assert body in snap


def test_build_snapshot_large_file_returns_now_plus_outline(store: WorkingMemoryStore) -> None:
    # build a file with > 30 lines (line_count = newlines+1 must exceed threshold 30),
    # a # now block and many history headings
    lines = ["# now", "## State", "doing work", ""]
    lines.append("# History")
    for i in range(26):
        lines.append(f"## 2026-01-01-00{i:02d} | entry {i}")
    content = "\n".join(lines)
    store.write_content(content)

    snap = store.build_snapshot()
    assert snap.startswith("## 工作记忆")
    assert "Current State (auto-loaded):" in snap
    assert "doing work" in snap
    assert "History outline:" in snap
    # outline capped at 20 headings
    outline_section = snap.split("History outline:")[1]
    assert outline_section.count("## 2026") <= 20
    # now section content must not include the history entries
    assert "entry 24" not in snap.split("History outline:")[0]


def test_build_snapshot_large_file_history_stops_at_next_h1(store: WorkingMemoryStore) -> None:
    lines = ["# now", "## State", "x", "", "# History", "## 2026-01-01-0000 | a", "# Other", "## stray"]
    # pad to > 30 lines
    lines.extend(["filler"] * 30)
    store.write_content("\n".join(lines))
    snap = store.build_snapshot()
    outline = snap.split("History outline:")[1]
    assert "stray" not in outline
    assert "## 2026-01-01-0000 | a" in outline


# ── pre_insert_history_heading ─────────────────────────────────


def test_pre_insert_history_heading_empty_content_noop(store: WorkingMemoryStore) -> None:
    store.ensure_created()
    store.pre_insert_history_heading()
    assert store.read_content() == ""


def test_pre_insert_history_heading_appends_history_block(store: WorkingMemoryStore) -> None:
    store.write_content("# now\n## State\nbusy\n")
    store.pre_insert_history_heading()
    content = store.read_content()
    assert "# History" in content
    # timestamped heading format
    assert re.search(r"## \d{4}-\d{2}-\d{2}-\d{4} \| \n", content)
    # original content preserved
    assert "# now" in content
    assert "busy" in content


def test_pre_insert_history_heading_inserts_into_existing_history(store: WorkingMemoryStore) -> None:
    content = "# now\n## State\nbusy\n\n# History\n## 2026-01-01-0000 | old\n"
    store.write_content(content)
    store.pre_insert_history_heading()
    new_content = store.read_content()
    # the new heading is inserted right after the # History title line
    history_idx = new_content.index("# History")
    after_title = new_content[history_idx:]
    # first heading after the title should be the freshly inserted timestamp
    headings_after = re.findall(r"^## .*$", after_title, re.MULTILINE)
    assert re.match(r"## \d{4}-\d{2}-\d{2}-\d{4} \| $", headings_after[0])
    # old entry still present below
    assert "## 2026-01-01-0000 | old" in new_content


def test_pre_insert_history_heading_idempotent_format(store: WorkingMemoryStore) -> None:
    store.write_content("# now\n## State\nx\n\n# History\n")
    store.pre_insert_history_heading()
    store.pre_insert_history_heading()
    content = store.read_content()
    # two timestamps inserted (both valid format); # History title appears once
    assert content.count("# History") == 1
    assert len(re.findall(r"## \d{4}-\d{2}-\d{2}-\d{4} \| \n", content)) == 2


def test_pre_insert_history_heading_history_without_trailing_newline(
    store: WorkingMemoryStore,
) -> None:
    # `# History` is the final line with no newline after it — exercises the
    # `line_end == -1` fallback path.
    store.write_content("# now\n## State\nx\n\n# History")
    store.pre_insert_history_heading()
    content = store.read_content()
    assert content.count("# History") == 1
    assert re.search(r"## \d{4}-\d{2}-\d{2}-\d{4} \| \n", content)
