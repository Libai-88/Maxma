# Project under review — MaxmaHere

## Name
MaxmaHere

## Root path
`D:\Maxma\MaxmaHere`

## Language / framework
- **Backend**: Python 3.11+ / FastAPI + uvicorn
- **Frontend**: Vue 3 + Vite 5 + Pinia + TypeScript
- **Agent engine**: oh-my-pi v16.5.2 (Bun/TypeScript sidecar)
- **Desktop shell**: Tauri 2 + Rust

## Competition theme: Frontend-Backend Architecture Upgrade

Focus on the **communication layer** between frontend (Vue) and backend (FastAPI), ensuring stable and smooth data exchange.

### Scope

#### WebSocket Communication
- Connection lifecycle management (connect, disconnect, reconnect with exponential backoff)
- `ws://` proxy through Vite dev server — subprotocol forwarding (`handleProtocols`)
- WebSocket authentication flow (token via `Sec-WebSocket-Protocol`)
- Heartbeat/ping-pong mechanism
- Graceful degradation when WebSocket fails
- Session-based WebSocket routing (`/ws/chat/{session_id}`)
- Concurrent connection handling, registry management (`ws_registry`)
- Error categorization and user feedback (ChatInput.vue connection error UI)
- Reconnection attempt limits and backoff strategy

#### REST API Communication
- Vite proxy configuration for `/api` routes
- Auth token lifecycle (`ensureTokenLoaded`, `resetToken`, rotation)
- Error handling patterns in `api/index.ts` (request wrapper, timeout, retry)
- HTTP → WebSocket fallback strategies
- Session synchronization between frontend and backend
- API versioning and backward compatibility

#### Session & State Management
- Session creation/loading flow (`session.ts` store)
- Stale session cleanup (localStorage vs backend state)
- Cross-tab session handling
- Activity tracking and connection state visual feedback (`activity.ts`)
- Three-state connection UI: connecting → online → offline

#### Build & Dev Proxy Configuration
- Vite dev server proxy settings for both `/api` and `/ws`
- CORS and CSP configuration in production vs dev mode
- Tauri desktop → backend communication path resolution
- Environment variable resolution (`MAXMA_API_PORT`, `MAXMA_WEB_PORT`)

#### Error Handling & Resilience
- Backend error propagation to frontend via WebSocket events
- Frontend global error handler (`main.ts:12`)
- Retry logic with exponential backoff
- Graceful degradation when backend is unavailable
- Offline detection and recovery
- Connection stability under backend restart

### Out of scope
- Agent engine (oh-my-pi) internal logic
- Frontend UI/UX design changes (unless related to connection feedback)
- Backend business logic (specific API route handlers)
- Database/storage layer
