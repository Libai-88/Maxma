import pytest
from pathlib import Path

def test_load_three_layer_persona():
    """三层人设加载器应返回 identity + yuan + ishiki"""
    from agent.persona_loader import load_persona

    persona = load_persona("default", user_name="测试用户")

    assert "identity" in persona
    assert "yuan" in persona
    assert "ishiki" in persona
    assert "测试用户" in persona["identity"]
    assert "mood" in persona["yuan"].lower() or "心境" in persona["yuan"]

def test_build_system_prompt_combines_three_layers():
    """system prompt 应包含三层内容"""
    from agent.persona_loader import load_persona, build_persona_prompt

    persona = load_persona("default", user_name="测试用户")
    prompt = build_persona_prompt(persona)

    assert "测试用户" in prompt
    assert "mood" in prompt.lower() or "心境" in prompt
    assert "语气" in prompt or "tone" in prompt.lower()
