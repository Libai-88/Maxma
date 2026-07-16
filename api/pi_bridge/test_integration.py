"""Integration test: SidecarManager + JsonRpcClient end-to-end."""

import asyncio
import logging
import sys
from pathlib import Path

# Add project root to path so `api.pi_bridge` can be imported
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from api.pi_bridge.sidecar_manager import SidecarManager

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


async def main() -> None:
    mgr = SidecarManager()

    # 1. Start sidecar
    await mgr.start()
    assert mgr.is_running, "Expected sidecar to be running"
    assert mgr.client is not None, "Expected client to be created"
    print("[PASS] Sidecar started, client created")

    # 2. Call create_session
    result = await mgr.client.call("create_session", {
        "model": "opencode-go/deepseek-v4-flash",
        "cwd": str(
            Path(__file__).resolve().parent.parent.parent / "bun-sidecar"
        ),
    })
    sid = result["session_id"]
    assert sid and len(sid) > 0, f"Expected non-empty session_id, got {sid!r}"
    print(f"[PASS] Session created: {sid[:8]}...")

    # 3. Register event handler and track events
    received_events: list[dict] = []

    def on_event(_sid: str, event: dict) -> None:
        received_events.append(event)

    unsub = mgr.client.on("token", on_event)

    # 4. Send prompt — this returns immediately; events arrive asynchronously
    await mgr.client.call("prompt", {
        "session_id": sid,
        "message": "What is 2+2? Answer in one word.",
    })
    print("[....] Waiting for token events...")

    # Wait for at least one token event or up to 30 seconds
    deadline = asyncio.get_event_loop().time() + 30.0
    while asyncio.get_event_loop().time() < deadline:
        if len(received_events) > 0:
            break
        await asyncio.sleep(0.5)

    print(
        f"[PASS] Prompt completed, token events received: "
        f"{len(received_events)}"
    )

    # 5. Verify token events
    assert len(received_events) > 0, (
        f"Expected at least one token event, got {len(received_events)}"
    )
    full_text = "".join(
        e["payload"]["token"]
        for e in received_events
        if e.get("type") == "token" and "payload" in e
    )
    print(f"[PASS] Response: {full_text}")

    unsub()

    # 6. Stop
    await mgr.stop()
    assert not mgr.is_running, "Expected sidecar to be stopped"
    assert mgr.client is None, "Expected client to be cleared"
    print("[PASS] Sidecar stopped")

    print("\n[PASS] All integration tests passed!")


if __name__ == "__main__":
    asyncio.run(main())
