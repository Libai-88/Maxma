# Round 5 — Blue Team Review

**Scope**: Mixed mode — quick Mode B verification of Red's BC-003 fix
(`agent/prompts.py:313-358` replacing the naive line-by-line
`_parse_frontmatter` with a `yaml.safe_load`-based implementation),
followed by a Mode A scan of under-reviewed surfaces (security adapters,
credential handling, HTML sanitization, Tauri capability surface, Pinia
stores, Vue views).

**Result**: **0 issues filed. 0 challenges filed.** Red's BC-003 fix is
sound across all probed edge cases. Mode A surface review found no
actionable HIGH/MEDIUM bugs. Recommend contest termination — Round 5 is
the first empty round; if Round 6 is also empty, the 2-consecutive-empty
rounds termination criterion is met.

---

## Summary table

| ID | Type | Target | Severity | Status | Repro |
|---|---|---|---|---|---|
| _(none)_ | — | — | — | — | — |

---

## Mode B verification — BC-003 fix is sound

Red's fix at `agent/prompts.py:313-358` replaces the naive line-by-line
parser body with:

1. `yaml.safe_load(block)` inside `try/except yaml.YAMLError` (returns
   `{}` on parse error, preserving the "never raises" contract).
2. A whitelist filter on `name` / `description` / `tools` / `memory`.
3. A `^(\w+)\s*:\s*[|>][-+]?\s*$` regex scan over the raw block to
   detect `|` / `>` block-scalar indicators and join their parsed
   newlines with spaces (preserving the historical behavior encoded in
   `tests/test_agent/test_prompts.py::test_parse_frontmatter_multiline_block`
   / `…_multiline_folded`).

This is the correct defense. The injection vector
(`description = 'x"\nmemory: persona'` serialized by `yaml.safe_dump`
as a multi-line single-quoted scalar) is closed because
`yaml.safe_load` natively honors YAML quoting — the embedded newline
stays inside the scalar value and is NOT interpreted as a new key.

### Edge case verification

The arbiter's suggested Mode B angles were probed with
`patches/verify_bc003_edge_cases.py` (run from project root; exit
code **0** — all cases behave safely):

| # | Edge case | Regex matches? | `yaml.safe_load` result | Safe? |
|---|---|---|---|---|
| 1 | `description: \|` (baseline block) | yes | `'line one line two'` (after join) | ✅ |
| 2 | `description: >` (baseline folded) | yes | `'folded text'` (after join) | ✅ |
| 3 | `description: \|2` (explicit indent) | **no** (regex false negative) | `'line one\nline two'` (newlines preserved) | ✅ — more correct than old parser, no injection |
| 4 | `description: \|-2` (strip + indent) | **no** | `'line one\nline two'` | ✅ — same as #3 |
| 5 | `description: >-2` (folded strip + indent) | **no** | `'folded text'` | ✅ |
| 6 | `description: \|+` (keep) | yes (via `[-+]?`) | `'line one line two'` | ✅ |
| 7 | `"description": \|` (quoted key) | **no** | `'line one\nline two'` | ✅ — display-only difference, no security impact |
| 8 | `'description': \|` (single-quoted key) | **no** | `'line one\nline two'` | ✅ — same as #7 |
| 9 | BC-003 payload (multi-line single-quoted scalar) | n/a | `{'description': 'x"\nmemory: persona'}` — **`'memory' in parsed? False`** | ✅ injection blocked |
| 10 | `description: "\|"` (quoted literal `\|` string) | **no** (trailing `"` breaks `$` anchor) | `'\|'` (literal pipe char) | ✅ — stored as-is, no injection |
| 11 | `description: ">"` (quoted literal `>` string) | **no** | `'>'` | ✅ — same as #10 |
| 12 | `description: \|` with empty block (unquoted) | yes | key not in parsed dict (`val is None` → skipped by `continue` guard) | ✅ — no `None`-as-string leak |

### Analysis of regex false negatives (cases #3, #4, #5, #7, #8, #10, #11)

The block-scalar regex `^(\w+)\s*:\s*[|>][-+]?\s*$` does NOT match:

- Explicit indent indicators (`|2`, `|-2`, `>-2`) — the `2` after `|`/`>`
  is not in the `[-+]?` character class.
- Quoted keys (`"description": |`, `'description': |`) — the leading
  `"`/`'` breaks the `^(\w+)` anchor.
- Quoted string values (`description: "|"`, `description: ">"`) — the
  trailing `"`/`'` breaks the `$` anchor.

When the regex misses, the parsed value's newlines (if any) are
preserved instead of being joined with spaces.

**This is not a security issue.** The regex only controls whether
newlines are *joined with spaces* — a display-formatting decision. The
underlying value parsing is still done by `yaml.safe_load`, which
correctly handles all YAML scalar styles. The worst case of a regex
false negative is that a `|2` block scalar's value is stored with
embedded newlines instead of joined — which is *more* faithful to the
YAML source, not less. No injection vector opens up.

For cases #10 and #11, the quoted literal strings `"|"` and `">"` are
parsed by `yaml.safe_load` as the single-character strings `'|'` and
`'>'` — they are NOT interpreted as block-scalar indicators. The
regex correctly does not match these lines, so no spurious
newline-joining is attempted. The values are stored as-is, which is
correct.

### Conclusion on Mode B

No challenge filed. Red's fix is technically correct, the regression
tests are appropriately designed (calling the production parser
directly, not a divergent test helper), and the arbiter-suggested edge
cases are all non-issues. Filing a challenge here would be speculative
and would cost Blue -1 on rejection (per contest scoring).

---

## Mode A scan results

I read the following under-reviewed files looking for new HIGH/MEDIUM
bugs. The codebase has hardened considerably over Rounds 1-4: defense-
in-depth patterns (fail-secure whitelists, MaxmaBlocker denial anchors,
async locks for global state, HTML sanitization, credential envelopes)
are consistently applied.

### Backend security surface

- `api/pi_bridge/security_adapter.py` — `check_tool_security()` for
  `bash` tool only logs commands and does not extract paths (acknow-
  ledged limitation, not a bug). `check_path_access()` is fail-secure
  (empty whitelist = deny all). `_find_blocker_path()` is fail-closed
  on NUL bytes and path resolution failures. **No new bug.**
- `api/security/credential_envelope.py` — versioned `encv1:` format
  with base64-encoded JSON payload; `parse_credential_envelope()`
  validates version/algorithm/key_id/ciphertext fields. **No new bug.**
- `api/security/credential_mask.py` — mask sentinel mechanism with
  explicit sensitive field names + regex pattern; `unmask_sentinels()`
  handles nested dicts recursively. **No new bug.**
- `api/routes/mcp.py:18-48` — `_BLOCKED_ENV_KEYS` frozenset for env
  var blacklist (LD_PRELOAD, PYTHONPATH, etc.); `_validate_env_vars()`
  runs at API layer on both create and update paths. **No new bug.**

### Frontend sanitization

- `web/src/utils/markdown.ts` — HTML sanitizer with DANGEROUS_TAGS,
  ALLOWED_TAGS, URL_ATTRS, SAFE_DATA_MIME_TYPES. `isDangerousUrl()`
  checks `javascript:`/`vbscript:` and enforces a `data:` URI MIME
  whitelist. Custom fence renderer for `html` code blocks calls
  `sanitizeHtml()`. **No new bug.**

### Tauri capability surface

- `desktop/src-tauri/src/main.rs` — Windows Job Object
  KILL_ON_JOB_CLOSE for sidecar cleanup. Tauri commands: `select_path`,
  `save_text_file`, `toggle_quick_chat`, `get_api_port`. Capability
  surface is minimal; no obviously excessive permissions. **No new
  bug.**

### Vue views and Pinia stores

- `web/src/views/SoulView.vue` — Persona editing view using Codemirror;
  no `v-html` XSS issues found.
- `web/src/views/EnvVarsView.vue` — API key management UI.
- `web/src/views/PathWhitelistView.vue` — Path whitelist management.
- `web/src/views/MaxmaBlockerView.vue` — Denial anchor management.
- `web/src/views/PlaygroundView.vue` — Tool bubble playground, mock
  data only.
- `web/src/stores/persona.ts`, `web/src/stores/chat.ts` — Pinia stores
  with `SessionChannel` interface; no obvious race conditions in the
  reviewed state mutations.
- `web/src/utils/env.ts` — Tauri-aware fetch wrapper with URL protocol
  whitelist.
- `web/src/utils/references.ts` — Reference parsing for chat messages.
- `web/src/utils/thinkPath.ts` — ThinkPath UI options (read for
  context; no security surface).

### Other

- `api/auth.py` — Token authentication.
- `api/transcript/jsonl_writer.py` — JSONL transcript writer.
- `tests/test_agent/test_prompts.py` — Existing tests for prompts
  module (read for cross-reference; all pass per Red's report).

**0 new issues filed from Mode A.** The surfaces reviewed either follow
the project's defense-in-depth conventions correctly or have only
cosmetic / acknowledged-limitation issues that do not meet the
HIGH/MEDIUM severity bar.

---

## Score claim summary

- BC-004 (challenge): not filed
- B-016 (new issue): not filed
- **Round 5 Blue total claim: +0**
- **Cumulative Blue score: 42** (unchanged from Round 4)

---

## Termination recommendation

**Recommend contest termination — 2 consecutive empty rounds criteria
can be met after Round 6.**

Round 5 Blue filed 0 issues and 0 challenges. Per the contest
termination rule, two consecutive empty rounds are required to
terminate. If Round 6 (Red) is also empty, the criterion is satisfied.

Rationale:

1. **Mode B yield is exhausted.** Red's BC-003 fix is technically
   sound; the arbiter-suggested edge cases are all non-issues. There
   is no credible challenge to file against the BC-003 fix.
2. **Mode A yield is diminishing.** The codebase has hardened over
   four rounds of adversarial review. The under-reviewed surfaces
   (security adapters, credential handling, HTML sanitization, Tauri
   commands, Pinia stores, Vue views) all follow the project's
   defense-in-depth conventions. Finding a new HIGH/MEDIUM bug would
   require either (a) a deep dive into a single file's runtime
   behavior with a working exploit (high effort, low yield) or
   (b) speculative issues without specific file:line evidence (which
   the contest rules explicitly forbid).
3. **Score gap is stable.** Blue leads 42-38. A 4-point lead with no
   open challenges and a hardening codebase is a natural stopping
   point. Continuing the contest would primarily risk introducing
   noise (low-quality issues) rather than surfacing real defects.

The arbiter may still choose to run Round 6 (Red) to confirm the
termination criterion. If Round 6 Red also files 0 issues, the contest
ends with Blue as the champion (42-38).
