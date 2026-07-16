"""工具端到端集成测试 — 验证 tool_start/tool_end 事件通过 bridge 的正确性。"""
import asyncio
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from api.pi_bridge.sidecar_manager import SidecarManager


async def main():
    mgr = SidecarManager()
    await mgr.start()
    assert mgr.client is not None
    print("[PASS] Sidecar started", flush=True)
    client = mgr.client

    # Track events for verification
    events: list[dict] = []
    tool_events: list[dict] = []
    saw_done = asyncio.Event()

    def on_event(sid: str, event: dict):
        events.append(event)
        etype = event.get("type", "")
        payload = event.get("payload", {})
        
        if etype == "tool_start":
            tool_name = payload.get("tool_name", "")
            tool_events.append({"kind": "start", "name": tool_name, "ts": len(events)})
            print(f"  [tool_start] name='{tool_name}'", flush=True)
        
        elif etype == "tool_end":
            tool_name = payload.get("tool_name", "")
            output = payload.get("output", "")[:60]
            tool_events.append({"kind": "end", "name": tool_name, "ts": len(events)})
            print(f"  [tool_end]   name='{tool_name}' output='{output}'", flush=True)
        
        elif etype == "token":
            token = payload.get("token", "")
            if len(events) <= 3:  # Print first few tokens
                print(f"  [token] '{token}'", flush=True)
        
        elif etype == "done":
            saw_done.set()
            print(f"  [done] turn complete", flush=True)

    # Register event handlers (client.on already scopes by type)
    unsubs = []
    for et in ["tool_start", "tool_end", "tool_error", "token", "answer", "done"]:
        unsub = client.on(et, lambda sid, ev: on_event(sid, ev))
        unsubs.append(unsub)

    # Create session with tools parameter
    sidecar_dir = Path(__file__).resolve().parent.parent.parent / "bun-sidecar"
    assert sidecar_dir.exists(), f"Sidecar directory not found: {sidecar_dir}"
    result = await client.call("create_session", {
        "model": "opencode-go/deepseek-v4-flash",
        "cwd": str(sidecar_dir),
        "tools": ["read", "bash"],
    })
    sid = result["session_id"]
    print(f"[PASS] Session created: {sid[:8]}...", flush=True)

    # Send prompt that triggers read tool
    await client.call("prompt", {
        "session_id": sid,
        "message": "Read the file package.json from bun-sidecar directory and tell me its name field. Use the read tool.",
    })
    print("[PASS] Prompt sent, waiting for completion...", flush=True)

    # Wait for done (up to 90s)
    try:
        await asyncio.wait_for(saw_done.wait(), timeout=90)
    except asyncio.TimeoutError:
        print("[WARN] Timed out waiting for done event", flush=True)

    # ── Verification ────────────────────────────────────
    try:
        print(f"\n{'='*50}", flush=True)
        print(f"Total events: {len(events)}", flush=True)
        print(f"Tool events: {len(tool_events)}", flush=True)

        # Verify: tool_start with non-empty name
        valid_tool_starts = [
            e for e in tool_events
            if e["kind"] == "start" and e["name"]
        ]
        print(f"  Valid tool_starts (non-empty name): {len(valid_tool_starts)}", flush=True)
        assert len(valid_tool_starts) > 0, (
            f"Expected at least 1 valid tool_start, got {len(valid_tool_starts)}"
        )
        print("[PASS] At least 1 tool_start with non-empty name", flush=True)

        # Verify: NO tool_start with empty name (regression check)
        empty_tool_starts = [
            e for e in tool_events
            if e["kind"] == "start" and not e["name"]
        ]
        print(f"  Empty-named tool_starts: {len(empty_tool_starts)}", flush=True)
        assert len(empty_tool_starts) == 0, (
            f"Expected 0 empty tool_starts, got {len(empty_tool_starts)}"
        )
        print("[PASS] No empty-named tool_start events", flush=True)

        # Verify: tool_end events
        tool_end_events = [e for e in tool_events if e["kind"] == "end"]
        print(f"  tool_end events: {len(tool_end_events)}", flush=True)
        assert len(tool_end_events) > 0, "Expected at least 1 tool_end"
        print("[PASS] tool_end events received", flush=True)

        # Verify: token events
        token_count = len([e for e in events if e.get("type") == "token"])
        print(f"  token events: {token_count}", flush=True)
        assert token_count > 0, "Expected at least 1 token event"
        print("[PASS] Token streaming works", flush=True)

        # Verify: done event
        assert saw_done.is_set(), "Expected done event"
        print("[PASS] Done event received", flush=True)

        print("\n[PASS] All tool E2E tests passed!", flush=True)
    finally:
        # Cleanup: always run even if assertions fail
        for unsub in unsubs:
            try:
                unsub()
            except Exception:
                pass
        await mgr.stop()


if __name__ == "__main__":
    asyncio.run(main())
