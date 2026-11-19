"""Opciones Ollama para no superar ~8 GB de RAM."""

from __future__ import annotations

from typing import Any

# Contexto corto y pocos hilos.
OLLAMA_OPTIONS: dict[str, Any] = {
    "num_ctx": 4096,
    "num_thread": 4,
}

# Chat 1.5B (~1.1 GB): mantener caliente 5 minutos para respuestas rápidas.
CHAT_KEEP_ALIVE: str | int = "5m"
# Visión: liberar tras analizar (se pasa keep_alive=0 explícitamente).
VISION_KEEP_ALIVE: int = 0

CHAT_MODEL = "deepseek-r1:1.5b"
VISION_MODEL = "qwen2.5vl:3b"
EMBED_MODEL = "nomic-embed-text"
MATH_MODEL = "deepseek-r1:1.5b"


def with_ollama_limits(
    payload: dict[str, Any],
    keep_alive: str | int = CHAT_KEEP_ALIVE,
) -> dict[str, Any]:
    """Añade keep_alive y options de memoria a cualquier llamada Ollama."""
    out = dict(payload)
    out["keep_alive"] = keep_alive
    options = dict(OLLAMA_OPTIONS)
    if isinstance(payload.get("options"), dict):
        options.update(payload["options"])
    out["options"] = options
    return out
