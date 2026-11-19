"""Aprendizaje autónomo: indexa resúmenes web cuando hay internet."""

from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from ddgs import DDGS

DEFAULT_TOPICS = [
    "noticias actuales del mundo",
    "tecnología e inteligencia artificial",
    "salud básica y prevención",
    "primeros auxilios paso a paso",
]


def internet_ok(timeout: float = 3.0) -> bool:
    try:
        import httpx

        with httpx.Client(timeout=timeout) as client:
            response = client.get("https://duckduckgo.com")
            return response.status_code < 500
    except Exception:
        return False


def search_snippets(query: str, max_results: int = 4) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    with DDGS() as ddgs:
        for item in ddgs.text(query, max_results=max_results):
            results.append(
                {
                    "title": item.get("title") or "Resultado",
                    "url": item.get("href") or item.get("link") or "",
                    "snippet": item.get("body") or item.get("snippet") or "",
                }
            )
    return results


def build_learning_document(topic: str, hits: list[dict[str, str]]) -> dict[str, Any]:
    now = datetime.now(ZoneInfo("America/Bogota"))
    lines = [
        f"# Aprendizaje web: {topic}",
        f"Fecha (America/Bogota): {now.strftime('%Y-%m-%d %H:%M')}",
        "",
        "## Hechos clave",
    ]
    for hit in hits:
        snippet = (hit.get("snippet") or "").strip()
        title = (hit.get("title") or "").strip()
        url = (hit.get("url") or "").strip()
        if not snippet and not title:
            continue
        lines.append(f"- {title}: {snippet} ({url})")
    text = "\n".join(lines)
    doc_id = f"learn-{uuid.uuid4().hex[:12]}"
    return {
        "id": doc_id,
        "title": f"Web · {topic[:80]}",
        "text": text,
        "source": f"aprendizaje-web:{now.date().isoformat()}",
        "topic": topic,
        "created_at": int(time.time() * 1000),
    }


def load_interest_topics(path) -> list[str]:
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
        topics = data.get("topics") if isinstance(data, dict) else data
        if isinstance(topics, list):
            cleaned = [str(item).strip() for item in topics if str(item).strip()]
            return cleaned[:30] or list(DEFAULT_TOPICS)
    except Exception:
        pass
    return list(DEFAULT_TOPICS)


def save_interest_topics(path, topics: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    unique: list[str] = []
    for topic in topics:
        clean = topic.strip()
        if clean and clean not in unique:
            unique.append(clean)
    path.write_text(json.dumps({"topics": unique[:40]}, ensure_ascii=False, indent=2), encoding="utf-8")


def remember_user_query_topic(path, query: str) -> None:
    q = query.strip()
    if len(q) < 4 or len(q) > 120:
        return
    topics = load_interest_topics(path)
    topics = [q, *topics]
    save_interest_topics(path, topics)
