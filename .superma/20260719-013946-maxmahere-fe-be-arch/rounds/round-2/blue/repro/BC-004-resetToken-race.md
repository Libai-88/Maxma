# BC-004: resetToken() race with in-flight ensureTokenLoaded()

## Summary

After `resetToken()` is called while `ensureTokenLoaded()` has an in-flight async operation, the next `ensureTokenLoaded()` call "wastes" itself on a stale already-resolved promise. The token is not actually fetched until the third call.

## Code location

`web/src/api/index.ts` lines 83-142

## Root cause

The `finally` block at line 129-132:

```typescript
finally {
  if (tokenLoadVersion === myVersion) {
    tokenLoadPromise = null
  }
}
```

Only clears `tokenLoadPromise` when the version matches. When `resetToken()` increments `tokenLoadVersion` concurrently, the version check fails, leaving a stale resolved promise in `tokenLoadPromise`.

## Step-by-step reproduction

1. **Initial state**: `tokenLoadVersion=0`, `tokenLoadPromise=null`, `tokenFetchedAtRuntime=false`

2. **Thread A** calls `ensureTokenLoaded()`:
   - `myVersion = 0`
   - `tokenLoadPromise` is null → creates new async IIFE with `capturedVersion = 0`
   - IIFE starts executing: calls `ensurePortLoaded()`, then `tauriFetch('/auth/token')`
   - `await tokenLoadPromise` — blocks on the IIFE

3. **Thread B** calls `resetToken()` (e.g., triggered by WS 4001 close at useChat.ts:362):
   - `tokenFetchedAtRuntime = false`
   - `token = ''`
   - `tokenLoadVersion++` → **now 1**
   - `tokenLoadPromise = null` ← clears the IIFE reference

4. **Thread A's IIFE** completes the fetch:
   - Checks: `tokenLoadVersion(1) !== capturedVersion(0)` → **true** → discards result, returns
   - IIFE promise resolves with `undefined`
   - `tokenLoadPromise` still points to this resolved promise (not null because the reference was cleared by resetToken, but the Promise object itself is resolved)

5. **Thread A's `finally`**: `tokenLoadVersion(1) === myVersion(0)`? **No** → does NOT clear `tokenLoadPromise`

6. **State now**: `tokenLoadVersion=1`, `tokenLoadPromise = <resolved promise>`, `tokenFetchedAtRuntime=false`, `token=''`

7. **Thread C** calls `ensureTokenLoaded()` (e.g., from `request()` or `connectSession()` after reconnection):
   - `tokenFetchedAtRuntime` is false → continues
   - `myVersion = 1`
   - `tokenLoadPromise` is NOT null → **does not create new promise**
   - `await tokenLoadPromise` → **resolves immediately** (the stale promise from step 4)
   - **Note**: No actual fetch happened! The IIFE was discarded in step 4.

8. **Thread C's `finally`**: `tokenLoadVersion(1) === myVersion(1)`? **Yes** → sets `tokenLoadPromise = null`

9. **State now**: `tokenLoadVersion=1`, `tokenLoadPromise=null`, `tokenFetchedAtRuntime=false`, `token=''`

10. **Thread D** calls `ensureTokenLoaded()`:
    - `tokenFetchedAtRuntime` is false → continues
    - `tokenLoadPromise` is null → **this time creates a new IIFE and fetches the token for real**
    - Token is fetched, `tokenFetchedAtRuntime = true`, `token = '<actual token>'`

**Result**: Two calls to `ensureTokenLoaded()` after `resetToken()` where the first returns without fetching the token.

## Impact demonstration

### On API requests (api/index.ts:144-170):

```typescript
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  if (!tokenFetchedAtRuntime) {
    await ensureTokenLoaded()  // Wasted call — returns without fetching
  }
  // token is still '' — header is not set
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) {
    headers['X-Maxma-Token'] = token  // NOT set
  }
  const res = await tauriFetch(`${BASE}${url}`, {
    headers,
    ...options,
  })
  // → 401 because no auth header
}
```

### On WebSocket reconnection (useChat.ts:355-391):

After WS 4001 close:
1. `resetToken()` at line 362
2. `onclose` schedules reconnection with `connectSession(sid)` at line 384
3. First `connectSession()` calls `ensureTokenLoaded()` — wasted call
4. `getToken()` returns '' — enters "token not available" retry branch (line 262)
5. After retry delay, second `connectSession()` call actually fetches the token
6. WS connects — one retry cycle delayed

## Fix suggestion

The `finally` block should clear `tokenLoadPromise` unconditionally when the IIFE's captured version no longer matches, because the stale promise can never produce a useful result. Alternatively, use a simpler approach: always create a new promise when `tokenFetchedAtRuntime` is false, rather than caching the promise at module level.
