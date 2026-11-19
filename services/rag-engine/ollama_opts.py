"""Opciones Ollama para no superar ~8 GB de RAM."""

from __future__ import annotations

from typing import Any

# Liberar VRAM/RAM al terminar; contexto corto; pocos hilos.
OLLAMA_OPTIONS: dict[str, Any] = {
    "num_ctx": 4096,
    "num_thread": 4,
}

CHAT_MODEL = "deepseek-r1:1.5b"
VISION_MODEL = "qwen2.5vl:3b"
EMBED_MODEL = "nomic-embed-text"
MATH_MODEL = "deepseek-r1:1.5b"


def with_ollama_limits(payload: dict[str, Any]) -> dict[str, Any]:
    """Añade keep_alive:0 y options de memoria a cualquier llamada Ollama."""
    out = dict(payload)
    out["keep_alive"] = 0
    options = dict(OLLAMA_OPTIONS)
    if isinstance(payload.get("options"), dict):
        options.update(payload["options"])
    out["options"] = options
    return out
