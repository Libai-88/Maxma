# Agent Module Coverage Boost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Increase coverage for agent/ modules (`context_manager` 0%, `prompts` 14%, `working_memory` 0%) so the `agent/` package overall reaches 50%+ (from ~11%).

**Architecture:** Read each module → identify live code vs dead code → write tests for live code → document dead code. Only create new test files; never modify source.

**Tech Stack:** Python 3.13, pytest, pytest-cov

## Baseline (measured 2026-07-17)

Run: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ --cov=agent --cov-report=term-missing -q`

| Module | Stmts | Miss | Cover |
|---|---|---|---|
| agent\context_manager.py | 329 | 329 | 0% |
| agent\memory\working_memory.py | 80 | 80 | 0% |
| agent\prompts.py | 296 | 255 | 14% |
| agent\persona_loader.py | 48 | 5 | 90% (skip) |
| **TOTAL** | **753** | **669** | **11%** |

Target: agent/ overall ≥ 50%.

## Dead-code / stub findings (from source read)

`context_manager.py`:
- `maybe_trim_checkpoint` (line 456-475) and `fresh_compact` (line 481-496) are **intentional backward-compat stubs** — oh-my-pi sidecar now manages compaction. They are NOT dead code (still importable/callable); we test that they return the documented stub dicts. No source changes.
- Everything else is live pure/async logic operating on `BaseMessage` sequences.

`prompts.py`: no dead code found; all functions are reachable. Low coverage is purely from lack of tests + filesystem-dependent helpers.

`working_memory.py`: no dead code; pure file-backed store, fully testable.

## Task 1 — Tests for `agent/memory/working_memory.py` (0% → 60%+)

**File:** `tests/test_agent/test_working_memory.py`

`WorkingMemoryStore` is a file-backed store. Use `tmp_path` for isolation. Cover:

1. `exists()` — False before create, True after.
2. `ensure_created()` — creates file + parent dirs; idempotent (second call no-op); empty file.
3. `read_content()` — empty string when missing; returns written content.
4. `write_content()` — round-trip; creates parent dirs.
5. `read_now_section()`:
   - no `# now` → `""`
   - only `# now` block (no following H1) → returns full tail
   - `# now` followed by `# History` (H1 boundary) → returns only the now block
   - passing pre-read `content=` param avoids re-IO (returns same as default)
   - empty content → `""`
6. `build_snapshot()`:
   - file missing → returns creation-guidance text mentioning path
   - small file (≤30 lines) → returns full content with `## 工作记忆` header
   - large file (>30 lines, with `# now` + `# History` + several `## ` headings) → returns now section + history outline (≤20 headings)
7. `pre_insert_history_heading()`:
   - empty content → no-op (no write)
   - no `# History` block → appends `# History` + timestamped heading
   - existing `# History` block → inserts timestamped heading right after the title line
   - timestamp format `## YYYY-MM-DD-HHMM | `

## Task 2 — Tests for `agent/context_manager.py` (0% → 60%+)

**File:** `tests/test_agent/test_context_manager.py`

Most functions are pure and operate on `langchain_core.messages` instances. Monkeypatch `agent.context_manager.count_tokens` with a deterministic fake (`len(content)//4 + 1`) for threshold-precise control, and use a fake async LLM for `_llm_summarize`.

Cover:

1. `CachePreservingCompaction` dataclass — `.messages` property = fixed_prefix + summary + retained.
2. `_message_digest(messages)` — stable for same content; differs when content changes; handles non-str content.
3. `build_cache_preserving_compaction(...)`:
   - happy path: metadata keys present (`summary_version`, `*_sha256`, `*_count`, `source_turn_boundary`), summary_message is SystemMessage with `[上下文压缩 v1]` prefix + metadata in additional_kwargs, `result_token_count` set
   - empty `summary_text` raises `ValueError`
   - token_counter called twice (source vs result)
4. `truncate_text_head_tail(text, max_bytes)`:
   - short text (≤ max_bytes) → returns `(text, "")`
   - long ASCII text → head+tail with `...(省略)...` markers, total within budget
   - multibyte (CJK) text — no broken UTF-8 (decode succeeds), head/tail split on char boundary
   - default `max_bytes=4096`
5. `_calc_min_turns(messages)`:
   - 0 turns (no HumanMessage) → `MIN_RECENT_TURNS_DEFAULT`
   - tool-heavy (avg ≥3 tools/turn) → `MIN_RECENT_TURNS_MIN`
   - normal (1 ≤ avg < 3) → `MIN_RECENT_TURNS_DEFAULT`
   - text-only (avg 0) → `MIN_RECENT_TURNS_MAX`
6. `_count_turns(messages)` — counts HumanMessage only.
7. `_find_trim_boundary(messages, min_turns)`:
   - len ≤1 → 0
   - fewer HumanMessages than min_turns → 0
   - returns index of the min_turns-th HumanMessage from the end
8. `_extract_entities(messages)`:
   - extracts file paths (with `/` or `\`) and URLs
   - dedups; filters short/word-like matches
   - empty content / non-str content handled
   - caps paths at 20, URLs at 10 (sorted)
   - returns `""` when none found
9. `_summarize_old_messages(messages)` — header counts (human/ai/tool) + recent 3 user msgs + appended entities.
10. `_llm_summarize(messages, llm, raise_on_error=...)` (async):
    - happy path: llm.ainvoke returns response → structured summary + entities appended
    - per_msg_limit tiers (>30, >15, else) exercised by message count
    - no conversation_parts (only ToolMessage) → falls back to `_summarize_old_messages`
    - llm raises, `raise_on_error=False` → fallback extraction summary returned
    - llm raises, `raise_on_error=True` → exception re-raised
11. `should_trim_context(messages, system_prompt_tokens, max_tokens)`:
    - too few messages (< min_turns*2) → False
    - over threshold → True
    - under threshold → False
    - max_tokens=0 → ratio 0 → False
12. `trim_messages(messages, system_prompt_tokens, max_tokens)`:
    - no trim needed → returns copy of list (identity)
    - trim needed: keeps SystemMessage at front, inserts `[上下文压缩]` summary SystemMessage, keeps recent turns
    - boundary==0 → returns copy unchanged
13. `maybe_trim_checkpoint(...)` (async stub) → `{"compressed": False}` regardless of args.
14. `fresh_compact(...)` (async stub) → `{"refreshed": False, "reason": "oh-my-pi sidecar mode"}`.
15. `_build_summary_prompt(messages)` — contains all 5 section headers and role-tagged content (truncated to 500 chars).
16. `extract_file_operations(messages)`:
    - extracts read/write/edit/delete from tool_calls
    - maps `tool_file_*` names too
    - dedups (path, op)
    - skips non-dict tool_calls, unknown names, missing path
    - reads `path` or `file_path` arg
17. `append_file_ops_to_summary(summary, file_ops)`:
    - empty file_ops → returns summary unchanged
    - non-empty → appends `## 本次会话文件操作` section with localized labels (读取/写入/编辑/删除), unknown op falls back to raw op
18. `format_structured_summary(summary)`:
    - full fields → 5 sections with bullets
    - empty fields → each section shows `(无)`, goal shows `(未明确)`
19. `_parse_bullet_section(text)` — parses `- ` bullets; keeps non-empty non-placeholder lines.
20. `parse_structured_summary(text)`:
    - well-formed 5-section text → StructuredSummary with parsed fields
    - `(未明确)`/`(无)` goal normalized to `""`
    - no match → fallback StructuredSummary(goal=text[:200]) (or `""` when empty)

## Task 3 — Tests for `agent/prompts.py` (14% → 50%+)

**File:** `tests/test_agent/test_prompts.py`

Strategy: monkeypatch module-level path constants in `agent.prompts` to `tmp_path`-based dirs so no real config files are touched. Persona templates (`agent/persona/*_default.md`) remain real via `persona_loader.PERSONA_DIR`. Use a session/module fixture `_isolated_prompt_env` that sets `PERSONAS_DIR`, `ACTIVE_PERSONA_PATH`, `ANTHROPIC_SKILLS_DIR`, `SKILLS_DATA_DIR`, `MACROS_DIR`, `MACROS_DATA_DIR` to tmp dirs and seeds minimal SOUL.md/AGENTS.md/USER.md, then calls `invalidate_prompt_cache()`.

Cover:

1. `get_active_persona_file()`:
   - ACTIVE_PERSONA_PATH missing → `SOUL.md` (default)
   - valid yaml `{"file": "SOUL.x.md"}` → returns it
   - corrupt yaml → falls back to default + logs warning
2. `_persona_name_from_soul(soul_file)`:
   - `"SOUL.md"` → `"default"`
   - `"SOUL.饱饱.md"` → `"饱饱"`
   - other stem → returns stem
3. `set_active_persona(filename)` — writes yaml to ACTIVE_PERSONA_PATH and invalidates cache (subsequent `build_system_prompt` reflects new persona).
4. `list_personas()`:
   - scans `SOUL*.md`, skips `SOUL.example.md`
   - display name from first `# ` heading; falls back to stem
   - description = first non-heading non-empty line, truncated to 77 chars + `...` when >80
   - `active` flag matches active file
5. `_file_hash(path)` — returns 16-char hex for existing file; `""` on OSError (monkeypatch read_bytes to raise).
6. `_current_fingerprint()` — returns a `|`-joined string containing `AGENTS.md:`, `active:`, `persona:identity:`, `sk:`/`mc:` entries when skills/macros dirs populated; deterministic for same content; changes when active persona file changes.
7. `_ensure_user_md()` — copies `USER.example.md` → `USER.md` when missing; no-op when exists.
8. `build_system_prompt()` / `get_system_prompt_parts()` / `_ensure_cache()` / `_rebuild()`:
   - returns non-empty string containing persona, behavior rules, personality, skills, macros markers
   - `get_system_prompt_parts()` returns list of dicts with `key`/`label`/`content`
   - second call hits cache (same content, no re-scan) — verify via spy on `_current_fingerprint` or by asserting stable output
   - `invalidate_prompt_cache()` then changed file → rebuild picks up new content
   - `{{USER_NAME}}` replaced with user name when configured, else `你`
9. `_read_persona(filename)` — returns content when exists, `""` otherwise.
10. `_read_if_exists(filename)` — returns stripped content when exists, `""` otherwise.
11. `_parse_user_name(user_md_content)`:
    - matches `**称呼**：xxx` / `**称呼**: xxx`
    - placeholder `(提示)` / `（提示）` → `""`
    - no match → `""`
12. `_parse_frontmatter(text)`:
    - no frontmatter → `{}`
    - simple `key: value` → dict (strips quotes)
    - multiline `|` / `>` → joined parts
    - only keeps `name`/`description`/`tools`/`memory` keys
13. `get_persona_memory_path()`:
    - frontmatter `memory: persona` → `memory_{stem}.yaml`
    - otherwise → `memory.yaml`
14. `get_persona_allowed_tools()`:
    - no `tools` → `None`
    - `tools: a, b, c` → `{"a","b","c"}`
    - empty tools → `None`
15. `_scan_anthropic_skills()`:
    - empty dirs → `""`
    - valid SKILL.md with frontmatter → entry with name/desc/path
    - SKILL.md without description → entry without desc
    - corrupt file (bad utf-8) → skipped, others still listed
    - dedup when ANTHROPIC_SKILLS_DIR == SKILLS_DATA_DIR (same canonical path)
16. `_scan_macros()` — same matrix as skills, uses `MACRO.md`.
17. `build_coordinator_prompt(persona_context)` — with empty → no persona clause; with context → includes `当前人设上下文`. Always includes route targets JSON spec.
18. `build_verifier_prompt()` — includes `sufficient`/`insufficient` + JSON spec.
19. `build_rag_grader_prompt()` — includes `relevant` boolean spec.

## Task 4 — Re-measure & commit

1. Run full suite: `cd d:\Maxma\MaxmaHere && .venv\Scripts\python.exe -m pytest tests/ --cov=agent --cov-report=term-missing -q`
2. Run ruff: `.venv\Scripts\python.exe -m ruff check --select=E9,F63,F7,F821 tests`
3. Verify agent/ overall ≥ 50%.
4. Commit per task above (3 commits total, one per module test file).

## Commit cadence

- Commit 1 (after Task 1): `test: cover agent working_memory store`
- Commit 2 (after Task 2): `test: cover agent context_manager compaction & trimming`
- Commit 3 (after Task 3+4): `test: cover agent prompts assembly & scanning`

## Constraints

- Only create new test files under `tests/test_agent/`.
- Do not modify any source in `agent/`, `api/`, `bun-sidecar/`, `web/`, `pyproject.toml`, `requirements-lock.txt`, `.github/workflows/`, or existing tests.
- If a real bug is found, record it in this plan + final report; do NOT fix in tests.
