# Round 4 Arbiter Verification — Blue Team

## Summary
Blue Team filed 1 challenge (BC-003) + 0 new bugs. Mixed mode (Mode B primary, Mode A scan).

## BC-003 — CONFIRMED ✓ → +5

### Claim
Red's B-012 fix is incomplete: `yaml.safe_dump` correctly escapes malicious values for a real YAML parser, but the production parser `agent.prompts._parse_frontmatter` (lines 311-338) is a naive line-by-line parser that does NOT honor YAML multi-line quoting. A `description = 'x"\nmemory: persona'` value gets serialized as:
```
description: 'x"

  memory: persona'
```
and the production parser mis-parses each line independently, extracting both `description='x'` and `memory='persona'`. The injected `memory: persona` key is then honored by `get_persona_memory_path()` (line 356), bypassing the memory isolation contract.

### Verification
1. **Source inspection confirmed**:
   - `agent/prompts.py:311-338` — `_parse_frontmatter` splits frontmatter on lines, partitions each line on `:`, and accepts any line matching `key: value`. No handling of YAML multi-line scalars (single-quote `'...multi-line...'`).
   - `api/routes/persona.py:191-206` — Red's fix uses `yaml.safe_dump` which produces multi-line output for values containing newlines.

2. **Repro script executed** (exit code 1 = bug confirmed):
   ```
   .venv\Scripts\python.exe .superma\20260720-101810-maxmahere\rounds\round-4\blue\patches\repro_b012_frontmatter_injection.py
   ```
   Output:
   - yaml.safe_load (test parser): `{'description': 'x"\nmemory: persona'}` — NO `memory` key (correct)
   - `agent.prompts._parse_frontmatter` (production): `{'description': 'x', 'memory': 'persona'}` — `memory` key INJECTED (bug)

3. **Both injection vectors confirmed**:
   - `description` injection: production parser returns `memory='persona'`
   - `tools` injection: production parser returns `memory='persona'`

4. **Test-vs-production divergence confirmed**: Red's regression tests at `tests/test_persona_memory_isolation.py` use `yaml.safe_load` (or a local helper wrapping it), not the production `_parse_frontmatter`. This is why the tests pass despite the bug.

### Impact
Memory isolation contract bypassed. A user can create a persona with `description = 'x"\nmemory: persona'` (or `tools = "search\nmemory: persona"`), and the production system will:
1. Accept the request (Pydantic enum on `memory` field passes — `memory="shared"`)
2. Write a SOUL file with the injected `memory: persona` line in frontmatter
3. At read time, `get_persona_memory_path()` sees `memory: persona` and uses the persona-scoped memory file instead of shared `memory.yaml`

This defeats the entire purpose of B-012's fix.

### Score
- **+5** (confirmed challenge, medium-equivalent — original B-012 was MEDIUM)

## Mode A scan
0 new issues filed. Blue scanned 30+ files in under-reviewed areas (`api/routes/*.py`, `api/*.py`, `api/middleware/*.py`, `agent/*.py`, `app_paths.py`). Codebase has hardened over Rounds 1-3. No new medium/high bugs met the evidence bar.

## Scoring summary
- BC-003 confirmed: +5
- **Round 4 Blue Δ: +5**

## Cumulative scores after Round 4
- **Red**: 29 + 7 = **36**
- **Blue**: 37 + 5 = **42**

## State machine update
- `current_round`: 4 complete; Round 5 Red pending
- `consecutive_empty_rounds`: 0 (1 confirmed challenge = medium-equivalent — contest continues)
- Open issue for Round 5 Red: BC-003 (must fix `agent.prompts._parse_frontmatter` to honor YAML quoting, OR replace with `yaml.safe_load`)

## Notes for Round 5 Red
The minimal correct fix is to replace the body of `agent.prompts._parse_frontmatter` with a `yaml.safe_load`-based implementation. The naive line-by-line parser must be eliminated entirely, OR it must correctly handle:
1. Multi-line single-quoted scalars (`'...multi-line...'`)
2. Multi-line double-quoted scalars (`"...multi-line..."`)
3. Block scalars (`|` and `>` — currently handled but only for indented continuations)
4. Comments (`# ...`) — currently NOT stripped
5. Quoted keys (`"key": value`)

Replacing with `yaml.safe_load` is strongly preferred — it's a one-liner and eliminates the entire class of bugs.

Additionally, Red's regression test helper at `tests/test_persona_memory_isolation.py` should call the production `agent.prompts._parse_frontmatter` (or `get_persona_memory_path()` directly), not a local `yaml.safe_load` wrapper. This ensures tests catch future parser regressions.
