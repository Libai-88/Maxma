from agent.think_path import get_think_path, get_think_paths, should_offer_think_paths


def test_short_greeting_does_not_interrupt_with_think_paths():
    assert should_offer_think_paths("你好") is False
    assert get_think_paths("你好") == []


def test_multiline_request_is_offered_even_after_whitespace_normalization():
    assert should_offer_think_paths("背景\n约束\n请给出下一步") is True


def test_complex_request_has_three_stable_user_visible_choices():
    paths = get_think_paths("请分析两个迁移方案并列出风险")

    assert [path.id for path in paths] == ["light", "standard", "deep"]
    assert all(path.estimated_cost and path.depth and path.role for path in paths)


def test_path_resolution_whitelists_known_ids_only():
    assert get_think_path("DEEP").role == "analysis"
    assert get_think_path("arbitrary-role") is None
    assert get_think_path(None) is None
