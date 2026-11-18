"""
Motor RAG local de Taller.

Stack:
- Python + FastAPI
- DuckDuckGo Search (web en tiempo real)
- SQLite (memoria persistente de lo aprendido / documentos)
- Ollama + nomic-embed-text (embeddings locales; fallback TF-IDF si no hay Ollama)
"""

from __future__ import annotations

import json
import math
import os
import re
import sqlite3
import time
import unicodedata
from pathlib import Path
from typing import Any

import httpx
from ddgs import DDGS
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

DATA_DIR = Path(os.environ.get("TALLER_RAG_DATA", Path(__file__).resolve().parent / "data"))
DB_PATH = DATA_DIR / "taller-rag.sqlite"
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
EMBED_MODEL = os.environ.get("OLLAMA_EMBED_MODEL", "nomic-embed-text")
ENGINE_PORT = int(os.environ.get("RAG_ENGINE_PORT", "8765"))

STOPWORDS = {
    "a", "al", "de", "del", "el", "la", "los", "las", "un", "una", "y", "o", "en", "por", "para",
    "con", "sin", "que", "se", "su", "sus", "es", "son", "the", "of", "and", "to", "in", "is",
}

app = FastAPI(title="Taller RAG Engine", version="1.0.0")


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=300)
    max_results: int = Field(default=5, ge=1, le=10)


class IndexRequest(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=20, max_length=80_000)
    source: str = Field(default="usuario", max_length=200)


class QueryRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    top_k: int = Field(default=4, ge=1, le=12)
    web: bool = True


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        create table if not exists documents (
          id text primary key,
          title text not null,
          text text not null,
          source text,
          created_at integer not null
        )
        """
    )
    conn.execute(
        """
        create table if not exists chunks (
          id text primary key,
          document_id text not null,
          title text not null,
          source text,
          text text not null,
          embedding text not null,
          created_at integer not null,
          foreign key(document_id) references documents(id) on delete cascade
        )
        """
    )
    conn.execute(
        """
        create table if not exists lessons (
          id text primary key,
          activity text not null,
          question text not null,
          answer text not null,
          reason text,
          created_at integer not null,
          hits integer not null default 0
        )
        """
    )
    return conn


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", text).strip()


def tokenize(text: str) -> list[str]:
    return [
        token
        for token in re.findall(r"[a-z0-9áéíóúüñ]+", normalize(text))
        if len(token) >= 2 and token not in STOPWORDS
    ]


def chunk_text(text: str, size: int = 500, overlap: int = 80) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= size:
        return [text]
    parts: list[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + size)
        parts.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return [part for part in parts if len(part) >= 20]


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
    dot = 0.0
    for key, value in a.items():
        if key in b:
            dot += value * b[key]
    norm_a = math.sqrt(sum(v * v for v in a.values()))
    norm_b = math.sqrt(sum(v * v for v in b.values()))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


async def ollama_available() -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"{OLLAMA_URL}/api/tags")
            return response.status_code == 200
    except Exception:
        return False


async def embed_texts(texts: list[str]) -> tuple[list[list[float]] | list[dict[str, float]], str]:
    """Returns dense vectors from Ollama, or sparse TF fallback."""
    if await ollama_available():
        vectors: list[list[float]] = []
        async with httpx.AsyncClient(timeout=60.0) as client:
            for text in texts:
                response = await client.post(
                    f"{OLLAMA_URL}/api/embeddings",
                    json={"model": EMBED_MODEL, "prompt": text},
                )
                if response.status_code != 200:
                    break
                payload = response.json()
                embedding = payload.get("embedding")
                if not isinstance(embedding, list):
                    break
                vectors.append([float(x) for x in embedding])
            else:
                return vectors, f"ollama:{EMBED_MODEL}"
    return [tf_vector(text) for text in texts], "tfidf-fallback"


def dense_cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def dump_embedding(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def load_embedding(raw: str) -> Any:
    return json.loads(raw)


@app.get("/health")
async def health() -> dict[str, Any]:
    ollama = await ollama_available()
    return {
        "ok": True,
        "engine": "taller-rag-python",
        "db": str(DB_PATH),
        "ollama": ollama,
        "embed_model": EMBED_MODEL if ollama else "tfidf-fallback",
        "search": "duckduckgo",
    }


def ddg_text(query: str, max_results: int) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    with DDGS() as ddgs:
        for item in ddgs.text(query, max_results=max_results):
            results.append(
                {
                    "title": item.get("title") or "Resultado",
                    "url": item.get("href") or item.get("link") or "",
                    "snippet": item.get("body") or item.get("snippet") or "",
                    "source": "DuckDuckGo",
                }
            )
    return results


@app.post("/search")
async def search_web(body: SearchRequest) -> dict[str, Any]:
    try:
        results = ddg_text(body.query, body.max_results)
        if not results:
            # Soft retry with a simpler query.
            results = ddg_text(body.query.split("?")[0].strip(), body.max_results)
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"DuckDuckGo no respondió: {error}") from error
    return {"query": body.query, "results": results}


@app.post("/index")
async def index_document(body: IndexRequest) -> dict[str, Any]:
    chunks = chunk_text(body.text)
    embeddings, backend = await embed_texts([f"{body.title}\n{chunk}" for chunk in chunks])
    now = int(time.time() * 1000)
    with connect() as conn:
        conn.execute("delete from chunks where document_id = ?", (body.id,))
        conn.execute("delete from documents where id = ?", (body.id,))
        conn.execute(
            "insert into documents(id, title, text, source, created_at) values (?, ?, ?, ?, ?)",
            (body.id, body.title, body.text, body.source, now),
        )
        for index, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            chunk_id = f"{body.id}#{index}"
            conn.execute(
                """
                insert into chunks(id, document_id, title, source, text, embedding, created_at)
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                (chunk_id, body.id, body.title, body.source, chunk, dump_embedding(embedding), now),
            )
        conn.commit()
    return {"id": body.id, "chunks": len(chunks), "embed_backend": backend}


@app.delete("/documents/{document_id}")
async def delete_document(document_id: str) -> dict[str, str]:
    with connect() as conn:
        conn.execute("delete from chunks where document_id = ?", (document_id,))
        conn.execute("delete from documents where id = ?", (document_id,))
        conn.commit()
    return {"status": "deleted", "id": document_id}


@app.get("/documents")
async def list_documents() -> dict[str, Any]:
    with connect() as conn:
        rows = conn.execute(
            "select id, title, source, created_at, length(text) as chars from documents order by created_at desc"
        ).fetchall()
    return {
        "documents": [
            {
                "id": row["id"],
                "title": row["title"],
                "source": row["source"],
                "createdAt": row["created_at"],
                "chars": row["chars"],
            }
            for row in rows
        ]
    }


class LessonRequest(BaseModel):
    id: str
    activity: str
    question: str
    answer: str
    reason: str | None = None


@app.post("/lessons")
async def upsert_lesson(body: LessonRequest) -> dict[str, Any]:
    now = int(time.time() * 1000)
    with connect() as conn:
        conn.execute(
            """
            insert into lessons(id, activity, question, answer, reason, created_at, hits)
            values (?, ?, ?, ?, ?, ?, 0)
            on conflict(id) do update set
              activity=excluded.activity,
              question=excluded.question,
              answer=excluded.answer,
              reason=excluded.reason,
              created_at=excluded.created_at
            """,
            (body.id, body.activity, body.question, body.answer, body.reason, now),
        )
        # Also index the lesson as a document for RAG retrieval.
        doc_id = f"lesson-{body.id}"
        text = f"{body.question}\n\n{body.answer}"
        chunks = chunk_text(text)
        embeddings, backend = await embed_texts([f"{body.activity}\n{chunk}" for chunk in chunks])
        conn.execute("delete from chunks where document_id = ?", (doc_id,))
        conn.execute("delete from documents where id = ?", (doc_id,))
        conn.execute(
            "insert into documents(id, title, text, source, created_at) values (?, ?, ?, ?, ?)",
            (doc_id, f"Lección · {body.activity}", text, "lección aprendida", now),
        )
        for index, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            conn.execute(
                """
                insert into chunks(id, document_id, title, source, text, embedding, created_at)
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"{doc_id}#{index}",
                    doc_id,
                    f"Lección · {body.activity}",
                    "lección aprendida",
                    chunk,
                    dump_embedding(embedding),
                    now,
                ),
            )
        conn.commit()
    return {"id": body.id, "indexed": True, "embed_backend": backend}


@app.post("/query")
async def query_rag(body: QueryRequest) -> dict[str, Any]:
    query_embeddings, backend = await embed_texts([body.query])
    query_vec = query_embeddings[0]
    hits: list[dict[str, Any]] = []

    with connect() as conn:
        rows = conn.execute("select id, title, source, text, embedding from chunks").fetchall()

    for row in rows:
        stored = load_embedding(row["embedding"])
        if isinstance(query_vec, list) and isinstance(stored, list):
            score = dense_cosine(query_vec, stored)
        elif isinstance(query_vec, dict) and isinstance(stored, dict):
            score = cosine(query_vec, stored)
        else:
            # Mixed backends: compare with TF of chunk text.
            score = cosine(tf_vector(body.query), tf_vector(row["text"]))
        if score < 0.08:
            continue
        hits.append(
            {
                "id": row["id"],
                "title": row["title"],
                "source": row["source"],
                "text": row["text"],
                "score": round(score, 4),
            }
        )
    hits.sort(key=lambda item: item["score"], reverse=True)
    hits = hits[: body.top_k]

    web_results: list[dict[str, str]] = []
    if body.web:
        try:
            web_results = ddg_text(body.query, 4)
        except Exception:
            web_results = []

    return {
        "query": body.query,
        "embed_backend": backend,
        "hits": hits,
        "web": web_results,
    }


def main() -> None:
    import uvicorn

    connect().close()
    uvicorn.run("app:app", host="127.0.0.1", port=ENGINE_PORT, reload=False)


if __name__ == "__main__":
    main()
