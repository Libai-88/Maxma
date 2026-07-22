# Round 3 Blue → Round 4 Handoff

## TL;DR for Round 4 Red Team

Blue filed **5 new issues** in Round 3 Mode A: **2 MEDIUM + 3 LOW**. The two MEDIUM issues (B-011, B-012) are both in `api/routes/persona.py` and are related — fix them together. The three LOW issues are independent and low-effort fixes.

**This round is NOT empty** (2 MEDIUM filed), so `consecutive_empty_rounds` remains 0. The contest continues to Round 4.

## Priority fix order for Red Round 4

### 1. B-011 (MEDIUM) — Persona `memory: "isolated"` silent fallback
- **Root cause**: `api/routes/persona.py:212` accepts `memory in ("persona", "isolated")`, but `agent/prompts.py:352` only checks `== "persona"`.
- **Smallest fix**: In `create_new_persona`, when `body.memory == "isolated"`, write `memory: persona` to frontmatter (canonical value). The API response can still return `memory_mode: "isolated"` for UI compatibility. One-line change in `persona.py:188`.
- **Alternative**: Change `prompts.py:352` to `in ("persona", "isolated")`. Also one line.
- **Test**: Create a persona with `memory="isolated"`, call `get_persona_memory_path()`, assert it returns `memory_{persona_id}.yaml` not `memory.yaml`.

### 2. B-012 (MEDIUM) — Persona frontmatter YAML injection
- **Root cause**: F-string interpolation of unescaped user input into YAML frontmatter at `persona.py:184,186,188`. `CreatePersonaRequest` has no validators on `description`/`tools`/`memory`.
- **Fix**: Two parts —
  1. Add `memory: Literal["shared","persona","isolated"] = "shared"` to `CreatePersonaRequest` (prevents vector 3).
  2. Use `yaml.safe_dump({...}, default_flow_style=True).strip()` for frontmatter body instead of f-strings (handles `"`/`\n`/`:` in all fields). Or add a validator rejecting `\n`/`\r` in all three fields.
- **Test**: `POST /api/personas` with `description='x"\nmemory: persona'`, then `GET /api/personas` and verify the persona's `memory` meta is NOT `persona` (i.e. injection failed).

### 3. B-013 (LOW) — `_sanitize_filename` non-ASCII stripping
- **Fix**: `api/routes/upload.py:40` — change regex to `r"[^\w.\u4e00-\u9fff\-]"` with `re.UNICODE` flag. One-line change.
- **Test**: Upload `报告.pdf`, assert response `filename == "报告.pdf"`.

### 4. B-014 (LOW) — localStorage FIFO vs LRU
- **Fix option A (real)**: Maintain `maxma:turns:lru` access-log key in `saveTurnsToStorage`, sort `otherKeys` by it before `slice`.
- **Fix option B (minimum)**: Correct the misleading comment on `useChat.ts:75` from `"最近未使用策略"` to `"FIFO (插入顺序)"`. Honest documentation of the actual policy.
- **Test**: Hard to test (requires localStorage quota simulation); option B needs no test.

### 5. B-015 (LOW) — `print()` in sticker_upload
- **Fix**: `api/routes/sticker_upload.py` — add `import logging` + `logger = logging.getLogger(__name__)` at top, replace line 66 `print(...)` with `logger.exception("[sticker_upload] 图片转换失败: %s", src)`. Three-line change.
- **Test**: Upload a non-image file renamed to `.png`, assert log file contains the PIL exception (not just stdout).

## Areas Blue did NOT audit deeply this round (suggested for Round 4)

- `api/db/` (core.py, auth.py, hooks.py, metrics.py, providers.py) — only skimmed
- `agent/context_manager.py` — read but not deeply analyzed for trimming/compaction bugs
- `api/routes/workflows.py` and `deferred_runs.py` — only skimmed for parent_session scoping
- `build/` scripts (bat/ps1) — not audited (encoding/error-handling per project memory)
- `bun-sidecar/src/` beyond `session-bridge.ts` and `tools/config/` — not audited this round
- `web/src/stores/` (Pinia stores) — not audited
- `web/src/components/` beyond the three v-html usages — not audited

## Files Blue would re-verify in Round 4 if Red fixes B-011/B-012

- `api/routes/persona.py` — both fixes land here
- `agent/prompts.py:341-357` — `get_persona_memory_path()` (B-011 read-side fix if Red chooses that option)
- `agent/prompts.py:318-338` — `_parse_frontmatter` (B-012 — if Red switches to `yaml.safe_load` here, check for regressions in other callers)
- Any new test file Red adds for persona regression tests

## Score projection

- If Red fixes all 5 in Round 4: Red Δ = 2×2 + 3×1 = **+7** (B-011 +2, B-012 +2, B-013/14/15 +1 each).
- Blue Round 4 options: Mode A (find new bugs) or Mode B (challenge Red's R4 fixes). Decision will be made after seeing Red's R4 review.
- If Red produces 0 new issues AND Blue produces 0 new MEDIUM/HIGH in R4, `consecutive_empty_rounds` → 1 (one more empty round ends the contest).

## Notes for arbiter

- B-011 and B-012 are **related but distinct**. B-011 is a runtime contract mismatch (API accepts a value the runtime doesn't recognize). B-012 is an input-validation gap (no escaping/enum on user-controlled fields). They share the same file (`persona.py`) and the same code path (`create_new_persona`) but have different root causes and different fixes. They should be verified independently.
- B-012's vector 1 (description with `"`) can be triggered **unintentionally** by a normal user — it's not purely a malicious-input scenario. This strengthens its MEDIUM priority.
- B-014's impact is mitigated by the fact that turns are also stored server-side (via `persistTurns` → backend); the localStorage cache is a performance/refersh-resilience layer, not the source of truth. So eviction causes a UX degradation (empty history on refresh until backend re-streams), not data loss. This is why it's LOW not MEDIUM.
