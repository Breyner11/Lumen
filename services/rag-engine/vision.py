"""Vision via Ollama VLMs (Qwen2.5-VL / Llama-3.2-Vision / Pixtral)."""

from __future__ import annotations

import base64
import re
from typing import Any

import httpx

DEFAULT_VISION_MODELS = [
    "qwen2.5-vl:3b",
    "qwen2.5-vl",
    "llama3.2-vision",
    "llama3.2-vision:11b",
    "pixtral",
    "llava",
]


async def list_ollama_models(ollama_url: str) -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{ollama_url.rstrip('/')}/api/tags")
            if response.status_code != 200:
                return []
            models = response.json().get("models") or []
            return [str(item.get("name") or "") for item in models if item.get("name")]
    except Exception:
        return []


def pick_vision_model(available: list[str], preferred: str | None = None) -> str | None:
    if preferred and any(preferred in name or name.startswith(preferred) for name in available):
        return next(name for name in available if preferred in name or name.startswith(preferred))
    for candidate in DEFAULT_VISION_MODELS:
        for name in available:
            if candidate.split(":")[0] in name:
                return name
    return None


async def read_image(
    image_bytes: bytes,
    mime: str,
    ollama_url: str,
    vision_model: str | None = None,
    prompt: str | None = None,
) -> dict[str, Any]:
    available = await list_ollama_models(ollama_url)
    model = pick_vision_model(available, vision_model)
    if not model:
        return {
            "ok": False,
            "error": (
                "No hay un modelo de visión en Ollama. Instala uno, por ejemplo: "
                "`ollama pull qwen2.5-vl:3b` o `ollama pull llama3.2-vision`."
            ),
            "available_models": available,
        }

    instruction = prompt or (
        "Eres un lector de apuntes y fórmulas. Describe la imagen y, si hay matemáticas, "
        "transcribe la fórmula exacta en LaTeX entre $$ ... $$. "
        "Si hay un enunciado, cópialo. Responde en español."
    )
    b64 = base64.b64encode(image_bytes).decode("ascii")

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{ollama_url.rstrip('/')}/api/chat",
                json={
                    "model": model,
                    "stream": False,
                    "messages": [
                        {
                            "role": "user",
                            "content": instruction,
                            "images": [b64],
                        }
                    ],
                },
            )
            if response.status_code != 200:
                return {
                    "ok": False,
                    "error": f"Ollama visión falló ({response.status_code}).",
                    "model": model,
                }
            payload = response.json()
            content = (
                (payload.get("message") or {}).get("content")
                or payload.get("response")
                or ""
            ).strip()
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "error": f"No pude hablar con Ollama: {error}"}

    latex = extract_latex_block(content)
    return {
        "ok": True,
        "model": model,
        "mime": mime,
        "text": content,
        "latex": latex,
        "caption": content[:500],
    }


def extract_latex_block(text: str) -> str | None:
    patterns = [
        r"\$\$(.+?)\$\$",
        r"\\\[(.+?)\\\]",
        r"\\\((.+?)\\\)",
        r"\$(.+?)\$",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.S)
        if match:
            return match.group(1).strip()
    # Common bare latex commands
    if "\\int" in text or "\\frac" in text or "\\sum" in text:
        line = next((row.strip() for row in text.splitlines() if "\\" in row), None)
        return line
    return None
