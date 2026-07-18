# Plan: Fix MCP Route Empty Data Issues

## Files to modify

**`D:\Maxma\MaxmaHere\api\routes\mcp.py`**

---

## Fix 1: `POST /mcp/reload` — `_do_reload()` function (line 136-142)

**Current behavior**: Returns hardcoded `{servers: [], tool_count: 0}`.

**Change**: Instead of returning empty lists, read the YAML config via the existing `_load_raw()` function and return the actually configured servers with `status: "unknown"`.

New implementation:
```python
async def _do_reload(request: Request | None = None) -> dict:
    with yaml_file_lock(MCP_YAML_PATH):
        items = _load_raw()
    return {
        "status": "ok",
        "servers": [
            {
                "id": s.get("server_id", ""),
                "name": s.get("name", s.get("server_id", "")),
                "status": "unknown",
                "command": s.get("command", ""),
            }
            for s in items if isinstance(s, dict)
        ],
        "tool_count": 0,
    }
```

Notes:
- Uses the existing `_load_raw()` function (no need to create a `_load_servers()`).
- Reads the YAML under the file lock (`yaml_file_lock`) to be safe.
- No subprocess probing — keeps it simple with `status: "unknown"`.
- `tool_count` remains 0 since we aren't actually loading tools (that would require MCP SDK calls).

---

## Fix 2: `GET /mcp/servers/{server_id}/tools` — `list_mcp_server_tools()` function (line 173-186)

**Current behavior**: After verifying the server exists, returns `{server_id: ..., tools: []}`.

**Change**: Return a realistic stub response. Since the actual tool list requires MCP SDK connection, return a non-empty structure indicating the server was found but tools aren't pre-cached.

New implementation:
```python
@router.get("/mcp/servers/{server_id}/tools")
async def list_mcp_server_tools(server_id: str):
    with yaml_file_lock(MCP_YAML_PATH):
        entries = _load_raw()
    server_entry = None
    for e in entries:
        if e.get("server_id") == server_id:
            server_entry = e
            break
    if server_entry is None:
        raise HTTPException(status_code=404, detail=f"MCP 服务器 '{server_id}' 不存在")

    return {
        "server_id": server_id,
        "tools": [],
        "note": "工具列表需要通过 /mcp/reload 加载后才能获取",
        "transport": server_entry.get("transport"),
        "enabled": server_entry.get("enabled", True),
    }
```

Notes:
- Keeps `tools: []` but adds `note`, `transport`, and `enabled` fields so the response is informative.
- The server lookup is refactored to capture the entry dict for more detail.

---

## Verification

1. Start the API server.
2. Call `POST /mcp/reload` — should return the `filesystem` server from `mcp_servers.yaml`.
3. Call `GET /mcp/servers/filesystem/tools` — should return the server metadata + empty tools with explanation.

---

## Rollback

If needed, revert the two function blocks in `D:\Maxma\MaxmaHere\api\routes\mcp.py` to their original state (see git diff or backup).
