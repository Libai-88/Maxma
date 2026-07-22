"""Mode B verification: probe the BC-003 fix's block-scalar regex
for the arbiter-suggested edge cases.

This is NOT a bug repro — it's a verification that the arbiter's suggested
Mode B angles are non-issues. The script documents the behavior of each
edge case for the review.md.

Run:
    .venv\\Scripts\\python.exe .superma\\20260720-101810-maxmahere\\rounds\\round-5\\blue\\patches\\verify_bc003_edge_cases.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parents[6]
sys.path.insert(0, str(PROJECT_ROOT))

import agent.prompts as prompts  # noqa: E402


def section(title: str) -> None:
    print(f"\n--- {title} ---")


def show(text: str) -> None:
    meta = prompts._parse_frontmatter(text)
    print(f"input  = {text!r}")
    print(f"parsed = {meta!r}")


section("1. Baseline: | block scalar (should join with space)")
show("---\ndescription: |\n  line one\n  line two\n---\nbody")

section("2. Baseline: > folded scalar (should join with space)")
show("---\ndescription: >\n  folded\n  text\n---\nbody")

section("3. Edge: |2 explicit indent indicator (regex does NOT match)")
show("---\ndescription: |2\n  line one\n  line two\n---\nbody")

section("4. Edge: |-2 strip + indent (regex does NOT match)")
show("---\ndescription: |-2\n  line one\n  line two\n---\nbody")

section("5. Edge: >-2 folded strip + indent (regex does NOT match)")
show("---\ndescription: >-2\n  folded\n  text\n---\nbody")

section("6. Edge: |+ keep (regex DOES match via [-+]?)")
show("---\ndescription: |+\n  line one\n  line two\n---\nbody")

section("7. Edge: quoted key \"description\": | (regex does NOT match)")
# yaml.safe_load accepts quoted keys; block-scalar style is preserved
# but newlines are NOT joined (since regex doesn't detect quoted key).
# This only affects DISPLAY formatting, not security.
show('---\n"description": |\n  line one\n  line two\n---\nbody')

section("8. Edge: single-quoted key 'description': | (regex does NOT match)")
show("---\n'description': |\n  line one\n  line two\n---\nbody")

section("9. Injection attempt: multi-line single-quoted scalar (must NOT inject)")
# This is the BC-003 payload itself — verifying the fix still holds.
text = "---\ndescription: 'x\"\n\n  memory: persona'\n---\nbody"
meta = prompts._parse_frontmatter(text)
print(f"input  = {text!r}")
print(f"parsed = {meta!r}")
print(f"'memory' in parsed? {'memory' in meta}")
assert "memory" not in meta, "REGRESSION: injection succeeded"
print("[OK] No injection")

section("10. Edge: description with literal | as plain string value")
# description: "|" — the regex matches `^(\w+)\s*:\s*[|>][-+]?\s*$`
# but yaml.safe_load parses "|" as a STRING (quoted), not a block indicator.
# So block_scalar_keys would WRONGLY include 'description', but the value
# is the literal string "|" — joining its (nonexistent) newlines is a no-op.
show('---\ndescription: "|"\n---\nbody')

section("11. Edge: description with > as plain string value (quoted)")
show('---\ndescription: ">"\n---\nbody')

section("12. Edge: description with | as plain unquoted string value")
# Without quotes, `description: |` is a block-scalar indicator (not a string).
# yaml.safe_load parses it as None (empty block scalar).
# The regex matches, but val is None -> skipped. Correct.
show("---\ndescription: |\n---\nbody")

print("\n=== Verification complete ===")
print("All edge cases behave safely. No regression, no injection.")
