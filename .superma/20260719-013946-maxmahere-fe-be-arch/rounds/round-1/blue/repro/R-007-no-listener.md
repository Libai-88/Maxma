# R-007 Challenge: No listener for `maxma:error` event — fix is cosmetic

## Issue
Red's fix dispatches a `CustomEvent('maxma:error')` from the global error handler, but **no component in the entire codebase listens for this event**. The error notification is effectively invisible to the user.

## Location of dispatch
`web/src/main.ts:16-25`

```typescript
app.config.errorHandler = (err, _instance, info) => {
  console.error('[GlobalError]', err, '\nInfo:', info)
  try {
    window.dispatchEvent(new CustomEvent('maxma:error', {
      detail: {
        message: err instanceof Error ? err.message : String(err),
        info,
        timestamp: Date.now(),
      },
    }))
  } catch {
    // 错误通知的发送本身失败时不处理，避免无限递归
  }
}
```

## Evidence
Searching the entire `web/src/` directory for `addEventListener` yields 25+ listeners, but **zero** of them listen for `'maxma:error'`:

```
web/src/main.ts:16:    window.dispatchEvent(new CustomEvent('maxma:error', {
```

That is the **only** occurrence of `maxma:error` in the source code. It is dispatched but never consumed.

The built artifact at `web/dist/assets/main-oycXm0Sn.js` also contains the dispatch but no corresponding listener.

## What this means
- The `errorHandler` catches the error and logs it to console (same as before the fix)
- The `CustomEvent` is dispatched and... nothing happens
- The user still sees no notification when a global Vue error occurs
- The "fix" is functionally identical to the original `console.error` only behavior

## Why no listener was added
The fix's comment says: "不直接操作 DOM 或 store，避免错误处理本身引发二次错误" — this is a valid concern. But dispatching an event without a listener means the fix does nothing. A proper fix would require:
- Adding a listener in a parent component (like `App.vue`) 
- Using a lightweight notification mechanism that can't trigger secondary errors
- OR using a global state store (with error boundary wrappers)

## Reproduction
1. Trigger an unhandled Vue error (e.g., throw in a render function)
2. Observe: `console.error` logs the error
3. Observe: `window.dispatchEvent(new CustomEvent('maxma:error', ...))` fires
4. **Observe: No toast, no notification, no user-visible feedback appears**
5. The user experience is identical to before the "fix"

## Verification by code search
```bash
grep -rn "maxma:error\|addEventListener.*maxma" web/src/ --include="*.ts" --include="*.vue" --include="*.js"
# Result: only main.ts:16 — the dispatch. No listeners.
```
