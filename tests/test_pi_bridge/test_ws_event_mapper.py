"""Tests for api/pi_bridge/ws_event_mapper.py — event validation/enrichment helpers."""

from api.pi_bridge.ws_event_mapper import (
    EVENT_TYPES,
    enrich_event,
    make_context_usage_event,
    make_done_event,
    make_error_event,
    validate_event,
)


class TestValidateEvent:
    def test_non_mapping_returns_false(self):
        assert validate_event(["not", "a", "dict"]) is False  # type: ignore[arg-type]

    def test_missing_type_returns_false(self):
        assert validate_event({"payload": {}}) is False

    def test_non_string_type_returns_false(self):
        assert validate_event({"type": 123, "payload": {}}) is False

    def test_unknown_type_returns_false(self):
        assert validate_event({"type": "nope", "payload": {}}) is False

    def test_missing_payload_returns_false(self):
        assert validate_event({"type": "token"}) is False

    def test_non_dict_payload_returns_false(self):
        assert validate_event({"type": "token", "payload": "str"}) is False

    def test_valid_event_returns_true(self):
        assert validate_event({"type": "token", "payload": {"v": 1}}) is True

    def test_all_known_types_valid(self):
        for t in EVENT_TYPES:
            assert validate_event({"type": t, "payload": {}}) is True


class TestEnrichEvent:
    def test_done_event_attaches_turn_id(self):
        ev = {"type": "done", "payload": {}}
        result = enrich_event(ev, turn_id="turn-1")
        assert result["payload"]["turn_id"] == "turn-1"
        assert result is ev  # modified in place

    def test_done_event_creates_payload_if_missing(self):
        ev = {"type": "done"}
        result = enrich_event(ev, turn_id="turn-2")
        assert result["payload"] == {"turn_id": "turn-2"}

    def test_done_event_no_turn_id_unchanged(self):
        ev = {"type": "done", "payload": {"x": 1}}
        result = enrich_event(ev, turn_id=None)
        assert result == {"type": "done", "payload": {"x": 1}}

    def test_non_done_event_unchanged(self):
        ev = {"type": "token", "payload": {}}
        result = enrich_event(ev, turn_id="turn-3")
        assert result == {"type": "token", "payload": {}}

    def test_done_event_non_dict_payload_skipped(self):
        ev = {"type": "done", "payload": "str"}
        result = enrich_event(ev, turn_id="turn-4")
        assert result == {"type": "done", "payload": "str"}


class TestMakeDoneEvent:
    def test_without_turn_id(self):
        assert make_done_event() == {"type": "done", "payload": {}}

    def test_with_turn_id(self):
        assert make_done_event("turn-x") == {
            "type": "done",
            "payload": {"turn_id": "turn-x"},
        }


class TestMakeErrorEvent:
    def test_minimal(self):
        ev = make_error_event("boom")
        assert ev["type"] == "error"
        assert ev["payload"] == {"code": "AGENT_ERROR", "message": "boom"}

    def test_custom_code(self):
        ev = make_error_event("boom", code="TIMEOUT")
        assert ev["payload"]["code"] == "TIMEOUT"

    def test_with_trace_id(self):
        ev = make_error_event("boom", trace_id="trace-1")
        assert ev["payload"]["trace_id"] == "trace-1"


class TestMakeContextUsageEvent:
    def test_basic(self):
        usage = {"used": 100, "total": 1000}
        assert make_context_usage_event(usage) == {
            "type": "context_usage",
            "payload": usage,
        }


def test_event_types_is_frozenset():
    assert isinstance(EVENT_TYPES, frozenset)
    assert "done" in EVENT_TYPES
