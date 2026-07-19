# BC-005: Quick Chat entry point lacks global error handler

## Summary

The Quick Chat window (`quick-chat/main.ts`) creates the Vue application without setting `app.config.errorHandler`, unlike the main entry point which dispatches `maxma:error` events and shows user-visible toasts.

## Code location

- `web/src/quick-chat/main.ts` — lines 14-16
- `web/src/main.ts` — lines 11-26 (reference implementation)

## Evidence

### Main entry point (`web/src/main.ts:11-26`):
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
app.mount('#app')
```

### Quick Chat entry point (`web/src/quick-chat/main.ts:14-16`):
```typescript
const app = createApp(QuickChatApp)
app.use(createPinia())
app.mount('#app')
```

No `app.config.errorHandler` assignment. No `maxma:error` dispatch. No toast notification.

## Reproduction

1. Run the application and open the Quick Chat window (Ctrl+Shift+Space)
2. Force an unhandled Vue error, e.g., by injecting into the Quick Chat's template a component that throws on mount:
   ```typescript
   // Hypothetical malicious component or a real bug
   throw new Error('Quick Chat test error')
   ```
3. Observe: No toast appears. The error is only logged to console (which is stripped in production builds — see `vite.config.ts:44` `drop: ['console']`)
4. Compare with main window: same error triggers a DsToast (error type, 6s duration) at bottom-right

## Impact

- Users interacting with Quick Chat receive zero visual feedback for runtime errors
- The "quick" interaction window, designed for interruption-free work, can silently malfunction
- Production builds strip console output (`vite.config.ts:44`), making errors entirely invisible to both users and developers

## Fix suggestion

Add the same error handler pattern from `main.ts` to `quick-chat/main.ts`:

```typescript
const app = createApp(QuickChatApp)
app.config.errorHandler = (err, _instance, info) => {
  // Reuse the same maxma:error dispatching logic
  try {
    window.dispatchEvent(new CustomEvent('maxma:error', {
      detail: {
        message: err instanceof Error ? err.message : String(err),
        info,
        timestamp: Date.now(),
      },
    }))
  } catch {}
}
app.use(createPinia())
app.mount('#app')
```

Note: `QuickChatApp.vue` would also need a `maxma:error` listener similar to the one in `App.vue` (BC-003 fix), or the Quick Chat entry could render its own inline toast.
