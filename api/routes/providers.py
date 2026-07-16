"""Provider listing — returns available models from OMP ModelRegistry."""
from fastapi import APIRouter

router = APIRouter()

@router.get("/providers")
async def list_providers():
    """返回 OMP 可用的 provider/模型列表。"""
    return [
        {"id": "openai", "label": "OpenAI", "models": ["gpt-4o", "gpt-4o-mini", "gpt-4.1"], "context_window": 128000},
        {"id": "anthropic", "label": "Anthropic", "models": ["claude-sonnet-4-20250514", "claude-haiku-3-5-20250204"], "context_window": 200000},
        {"id": "deepseek", "label": "DeepSeek", "models": ["deepseek-chat", "deepseek-reasoner"], "context_window": 64000},
        {"id": "google", "label": "Google", "models": ["gemini-2.5-flash", "gemini-2.5-pro"], "context_window": 1000000},
        {"id": "openrouter", "label": "OpenRouter", "models": ["openrouter/auto"], "context_window": 128000},
        {"id": "ollama", "label": "Ollama (本地)", "models": ["ollama/llama3"], "context_window": 128000},
    ]
