# Security Responsibility Contract: Maxma ↔ oh-my-pi

> **Status:** Active. This document defines the security boundary between Maxma and the oh-my-pi sidecar. Any change to path-security behavior must update this contract.

## 1. Scope

This contract governs **filesystem path security** for all AI tool calls executed through the oh-my-pi sidecar.

## 2. Responsibility Boundary

### Maxma owns (enforced in `api/pi_bridge/security_adapter.py`):

| Responsibility | Implementation | Failure Mode |
|---|---|---|
| Path whitelist loading | `_load_whitelist()` reads `path_whitelist.yaml` | Empty/missing file → block all (fail-secure) |
| Path whitelist enforcement | `check_path_access(path)` checks resolved path against whitelist | Non-whitelisted → block |
| MaxmaBlocker detection | `_find_blocker_path(path)` walks ancestors for `.maxma_blocker` | Resolve error → block (fail-closed) |
| Tool-call security gate | `check_tool_security(tool_name, tool_args)` orchestrates both checks | Any block → return reason string |
| Frontend path-check API | `GET /check-path-blocked` exposes both checks for UI bubble display | Returns `blocked: true` with reason |

### oh-my-pi owns (enforced in sidecar):

| Responsibility | Implementation |
|---|---|
| Tool execution sandbox | Bun runtime process isolation |
| Command approval levels | `approval_adapter.py` maps Maxma approval → OMP approval |
| Session lifecycle | `session-bridge.ts` manages create/prompt/cancel/destroy |

### Neither side delegates to the other for path security.

The previous comment `# OMP sidecar handles path security` in `security_adapter.py` was **incorrect** and has been removed. Maxma enforces path security because only Maxma has access to `path_whitelist.yaml` (user-managed via REST API).

## 3. Fail-Secure Principles

1. **Empty whitelist = block all.** No implicit allow.
2. **Path resolve failure = block.** Fail-closed, never fail-open.
3. **Blocker check exception = block.** `except Exception: pass` is forbidden in security-critical paths.
4. **Symlink resolution.** `Path.resolve()` follows symlinks; a symlink under an allowed dir pointing outside is blocked because the resolved path won't match.
5. **NUL byte rejection.** Paths containing NUL bytes (`\x00`) are rejected explicitly before `resolve()`, since `pathlib.resolve(strict=False)` may silently preserve them on some Python versions.

## 4. Testing Requirements

Any change to `security_adapter.py` or `path_whitelist.py` must:
- Run `pytest tests/test_pi_bridge/test_security_adapter.py tests/test_api/test_path_whitelist_check.py -v`
- All tests must pass with no skips (except the Windows symlink test which skips without admin privileges).

## 5. Change Protocol

When upgrading oh-my-pi to a new major version:
1. Re-verify this contract against OMP's changelog.
2. Run the security test suite.
3. Confirm `check_tool_security` is still invoked at the correct hook point in the sidecar bridge.
