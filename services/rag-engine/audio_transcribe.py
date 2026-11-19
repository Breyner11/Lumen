"""Transcripción de audio con faster-whisper (base, int8) y liberación de memoria."""

from __future__ import annotations

import gc
import tempfile
from pathlib import Path
from typing import Any


def transcribe_audio_bytes(data: bytes, filename: str = "audio.webm") -> dict[str, Any]:
    if not data:
        return {"ok": False, "error": "Audio vacío."}
    if len(data) > 25_000_000:
        return {"ok": False, "error": "El audio supera 25 MB."}

    try:
        from faster_whisper import WhisperModel
    except Exception:
        return {
            "ok": False,
            "error": "Falta faster-whisper. Instálalo con: pip install faster-whisper",
        }

    suffix = Path(filename).suffix or ".webm"
    model = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
            tmp.write(data)
            tmp.flush()
            model = WhisperModel("base", device="cpu", compute_type="int8")
            segments, info = model.transcribe(tmp.name, language="es", vad_filter=True)
            parts = [segment.text.strip() for segment in segments if segment.text.strip()]
            text = " ".join(parts).strip()
            return {
                "ok": Boolean_ok(text),
                "text": text,
                "language": getattr(info, "language", "es"),
                "duration": getattr(info, "duration", None),
            }
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "error": str(error)}
    finally:
        model = None
        gc.collect()


def Boolean_ok(text: str) -> bool:
    return bool(text)
