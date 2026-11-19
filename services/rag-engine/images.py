"""Image memory: store files + captions; search by text (CLIP if available, else caption TF)."""

from __future__ import annotations

import json
import math
import re
import sqlite3
import time
import unicodedata
import uuid
from pathlib import Path
from typing import Any

STOPWORDS = {
    "a", "al", "de", "del", "el", "la", "los", "las", "un", "una", "y", "o", "en", "por", "para",
    "con", "sin", "que", "se", "su", "the", "of", "and", "to", "in", "is",
}


def ensure_image_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        create table if not exists images (
          id text primary key,
          path text not null,
          mime text not null,
          title text,
          caption text,
          latex text,
          embedding text,
          created_at integer not null
        )
        """
    )
    conn.execute(
        """
        create table if not exists math_memory (
          id text primary key,
          image_id text,
          problem text not null,
          latex text,
          code text,
          result text not null,
          steps text,
          created_at integer not null
        )
        """
    )


def save_image_file(images_dir: Path, image_bytes: bytes, mime: str) -> tuple[str, Path]:
    images_dir.mkdir(parents=True, exist_ok=True)
    image_id = f"img-{uuid.uuid4().hex[:12]}"
    ext = "png" if "png" in mime else "jpg" if "jpeg" in mime or "jpg" in mime else "webp" if "webp" in mime else "bin"
    path = images_dir / f"{image_id}.{ext}"
    path.write_bytes(image_bytes)
    return image_id, path


def tokenize(text: str) -> list[str]:
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return [token for token in re.findall(r"[a-z0-9áéíóúüñ]+", text) if len(token) >= 2 and token not in STOPWORDS]


def tf_vector(text: str) -> dict[str, float]:
    tokens = tokenize(text)
    counts: dict[str, int] = {}
    for token in tokens:
        counts[token] = counts.get(token, 0) + 1
    total = max(1, len(tokens))
    return {token: count / total for token, count in counts.items()}


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(a[k] * b[k] for k in a if k in b)
    norm_a = math.sqrt(sum(v * v for v in a.values()))
    norm_b = math.sqrt(sum(v * v for v in b.values()))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def try_clip_embed(image_path: Path | None = None, text: str | None = None) -> list[float] | None:
    """Optional CLIP via open_clip / sentence-transformers. Returns None if unavailable."""
    try:
        import torch
        from PIL import Image
        import open_clip
    except Exception:
        return None

    try:
        model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained="openai")
        tokenizer = open_clip.get_tokenizer("ViT-B-32")
        model.eval()
        with torch.no_grad():
            if text is not None:
                tokens = tokenizer([text])
                features = model.encode_text(tokens)
            elif image_path is not None:
                image = preprocess(Image.open(image_path).convert("RGB")).unsqueeze(0)
                features = model.encode_image(image)
            else:
                return None
            features = features / features.norm(dim=-1, keepdim=True)
            return features[0].tolist()
    except Exception:
        return None


def index_image(
    conn: sqlite3.Connection,
    *,
    image_id: str,
    path: Path,
    mime: str,
    title: str | None,
    caption: str | None,
    latex: str | None,
) -> dict[str, Any]:
    ensure_image_tables(conn)
    clip = try_clip_embed(image_path=path)
    embedding: Any
    backend: str
    if clip is not None:
        embedding = clip
        backend = "clip"
    else:
        embedding = tf_vector(" ".join(filter(None, [title, caption, latex])))
        backend = "caption-tfidf"
    now = int(time.time() * 1000)
    conn.execute(
        """
        insert or replace into images(id, path, mime, title, caption, latex, embedding, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            image_id,
            str(path),
            mime,
            title,
            caption,
            latex,
            json.dumps(embedding),
            now,
        ),
    )
    conn.commit()
    return {"id": image_id, "backend": backend}


def search_images(conn: sqlite3.Connection, query: str, top_k: int = 5) -> list[dict[str, Any]]:
    ensure_image_tables(conn)
    rows = conn.execute(
        "select id, path, mime, title, caption, latex, embedding, created_at from images"
    ).fetchall()
    clip_query = try_clip_embed(text=query)
    query_tf = tf_vector(query)
    hits: list[dict[str, Any]] = []
    for row in rows:
        stored = json.loads(row["embedding"] or "{}")
        score = 0.0
        if clip_query is not None and isinstance(stored, list):
            score = dense_cosine(clip_query, stored)
        elif isinstance(stored, dict):
            score = cosine(query_tf, stored)
        else:
            blob = " ".join(filter(None, [row["title"], row["caption"], row["latex"]]))
            score = cosine(query_tf, tf_vector(blob))
        if score < 0.05:
            continue
        hits.append(
            {
                "id": row["id"],
                "title": row["title"] or row["id"],
                "caption": row["caption"],
                "latex": row["latex"],
                "path": row["path"],
                "score": round(score, 4),
                "createdAt": row["created_at"],
            }
        )
    hits.sort(key=lambda item: item["score"], reverse=True)
    return hits[:top_k]


def dense_cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def remember_math(
    conn: sqlite3.Connection,
    *,
    problem: str,
    result: str,
    latex: str | None = None,
    code: str | None = None,
    steps: list[str] | None = None,
    image_id: str | None = None,
) -> str:
    ensure_image_tables(conn)
    memory_id = f"math-{uuid.uuid4().hex[:12]}"
    now = int(time.time() * 1000)
    conn.execute(
        """
        insert into math_memory(id, image_id, problem, latex, code, result, steps, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            memory_id,
            image_id,
            problem,
            latex,
            code,
            result,
            json.dumps(steps or [], ensure_ascii=False),
            now,
        ),
    )
    conn.commit()
    return memory_id


def find_similar_math(conn: sqlite3.Connection, problem: str) -> dict[str, Any] | None:
    ensure_image_tables(conn)
    rows = conn.execute(
        "select id, problem, latex, code, result, steps, created_at from math_memory order by created_at desc limit 200"
    ).fetchall()
    query = tf_vector(problem)
    best = None
    best_score = 0.0
    for row in rows:
        score = cosine(query, tf_vector(row["problem"] or ""))
        if score > best_score:
            best_score = score
            best = row
    if not best or best_score < 0.55:
        return None
    return {
        "id": best["id"],
        "problem": best["problem"],
        "latex": best["latex"],
        "code": best["code"],
        "result": best["result"],
        "steps": json.loads(best["steps"] or "[]"),
        "score": round(best_score, 4),
    }
