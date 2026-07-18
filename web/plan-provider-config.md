# Plan: Enhance Maxma Provider Frontend Configuration

## Current State Summary

### Backend (Python/FastAPI) — `api/routes/providers.py`

Supported fields (from `ProviderCreateBody` / `ProviderUpdateBody`):
- `id`, `provider_type`, `label`, `api_key`, `base_url`, `models`, `enabled`, `context_window`

The backend uses Pydantic v2 `model_dump(exclude_unset=True)` for updates, which means **extra fields not in the model are silently dropped**.

### Frontend Types — `web/src/types/provider.ts`

```typescript
export interface ProviderConfig {
  id: string
  provider_type: string
  label: string
  api_key: string
  base_url: string
  models: string[]
  enabled: boolean
  context_window?: number
  priority?: number
  // health fields...
}
```

### Frontend UI — `web/src/views/ProvidersView.vue`

Current form has:
| Field | Control | Present? |
|-------|---------|----------|
| provider_type | `<select>` | Yes |
| label | `<input>` | Yes |
| api_key | `<input type="password">` | Yes |
| base_url | `<input>` | Yes |
| context_window | `<input type="number">` | Yes |
| models | Checkbox group (after discover) | Yes |

## Findings: Missing Fields

Compared to OMP's full provider capability, these fields are **absent** from both backend models and frontend:

| Field | Purpose | Backend | Frontend Type | Frontend UI |
|-------|---------|---------|---------------|-------------|
| `max_tokens` | Per-call max output tokens | Missing | Missing | Missing |
| `temperature` | Default temperature | Missing | Missing | Missing |
| `top_p` | Nucleus sampling default | Missing | Missing | Missing |
| `extra_headers` | Custom HTTP headers map | Missing | Missing | Missing |
| `timeout` | Request timeout seconds | Missing | Missing | Missing |

Additionally:
- The card badge hardcodes `OPENAI` instead of showing `p.provider_type`
- The `provider_type` field in `handleSave()` is hardcoded to `'openai'` instead of using `form.value.provider_type`
- No `max_tokens` display on provider cards

## Proposed Changes

### Phase 1: Backend Pydantic models (`api/routes/providers.py`)

Add these fields to both `ProviderCreateBody` and `ProviderUpdateBody`:

```python
max_tokens: int | None = Field(None, description="单次调用最大输出 token 数")
temperature: float | None = Field(None, ge=0, le=2, description="默认温度参数")
top_p: float | None = Field(None, ge=0, le=1, description="默认 top_p 参数")
extra_headers: dict[str, str] | None = Field(None, description="自定义 HTTP 请求头")
timeout: int | None = Field(None, ge=1, description="HTTP 请求超时（秒）")
```

Replace `list[dict[str, Any]]` dict access with `.get()` in default providers.

### Phase 2: Frontend types (`web/src/types/provider.ts`)

Add matching fields to `ProviderConfig`:

```typescript
max_tokens?: number
temperature?: number
top_p?: number
extra_headers?: Record<string, string>
timeout?: number
```

### Phase 3: Frontend UI (`web/src/views/ProvidersView.vue`)

1. **Form additions** (in the `<form>` section):
   - `max_tokens` — `<input type="number">` after context_window
   - `temperature` — `<input type="number" step="0.1" min="0" max="2">` after max_tokens
   - `top_p` — `<input type="number" step="0.1" min="0" max="1">` after temperature
   - `timeout` — `<input type="number">` after top_p
   - `extra_headers` — key-value pair inputs (one text + one text, repeatable via add/remove buttons)

2. **Card display additions** (in the card-grid `<div>`):
   - Show `max_tokens` when set
   - Show `temperature` when set
   - Fix card type badge to show `p.provider_type` instead of hardcoded `OPENAI`

3. **Form data & save logic**:
   - Update `form` ref to include new fields with defaults
   - Update `handleSave()` to include new fields in create/update body
   - Update `startEdit()` / `startAdd()` to populate/reset new fields

### Phase 4: Verification

- Run `npx vue-tsc --noEmit` to check for TS errors
- Visual review of the changes

## Backward Compatibility

- All new fields are optional (`?` / `None`), existing providers continue to work
- Backend `ProviderUpdateBody` uses `exclude_unset=True`, so absent fields aren't overwritten
- Empty `extra_headers` should serialize as `{}` or be omitted
