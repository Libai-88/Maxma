def test_load_three_layer_persona():
    """三层人设应分别返回正文和 frontmatter 元数据。"""
    from agent.persona_loader import load_persona

    persona = load_persona("default", user_name="测试用户")

    assert set(persona) == {"identity", "yuan", "ishiki", "metadata"}
    assert "测试用户" in persona["identity"]
    assert "高效执行伙伴" in persona["identity"]
    assert "方法论" in persona["yuan"]
    assert "亲近但不啰嗦" in persona["ishiki"]

    metadata = persona["metadata"]
    assert metadata["identity"] == {
        "name": "default",
        "display_name": "Maxma",
        "tone": "action-warm",
    }
    assert metadata["yuan"] == {
        "name": "default",
        "output_format": "structure",
    }
    assert metadata["ishiki"] == {
        "name": "default",
        "tone": "action-warm",
    }

    # Frontmatter is metadata, not part of the prompt body.
    assert "output_format: structure" not in persona["yuan"]


def test_build_system_prompt_combines_three_layers():
    """system prompt 应按 identity -> yuan -> ishiki 组合三层正文。"""
    from agent.persona_loader import load_persona, build_persona_prompt

    persona = load_persona("default", user_name="测试用户")
    prompt = build_persona_prompt(persona)

    identity_start = prompt.index("# 身份")
    yuan_start = prompt.index("# 思考模式")
    ishiki_start = prompt.index("# 人格规则")

    assert identity_start < yuan_start < ishiki_start
    assert "测试用户" in prompt
    assert "高效执行伙伴" in prompt
    assert "方法论" in prompt
    assert "语气" in prompt
    assert "output_format: structure" not in prompt
