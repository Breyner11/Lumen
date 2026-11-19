"""
Motor RAG local de Taller.

Stack:
- Python + FastAPI
- DuckDuckGo Search (web en tiempo real)
- SQLite (documentos, lecciones, imágenes, memoria matemática)
- Ollama + nomic-embed-text / Qwen2.5-VL / Qwen2.5-Math
- SymPy (cálculo exacto)
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
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from audio_transcribe import transcribe_audio_bytes
from documents_extract import extract_document
from images import (
    ensure_image_tables,
    find_similar_math,
    index_image,
    remember_math,
    save_image_file,
    search_images,
)
from learn import (
    DEFAULT_TOPICS,
    build_learning_document,
    internet_ok,
    load_interest_topics,
    remember_user_query_topic,
    save_interest_topics,
    search_snippets,
)
from links import analyze_link
from math_solver import solve_math_text
from ollama_opts import with_ollama_limits
from vision import list_ollama_models, pick_vision_model, read_image

DATA_DIR = Path(os.environ.get("TALLER_RAG_DATA", Path(__file__).resolve().parent / "data"))
DB_PATH = DATA_DIR / "taller-rag.sqlite"
IMAGES_DIR = DATA_DIR / "images"
TOPICS_PATH = DATA_DIR / "interest-topics.json"
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
EMBED_MODEL = os.environ.get("OLLAMA_EMBED_MODEL", "nomic-embed-text")
VISION_MODEL = os.environ.get("OLLAMA_VISION_MODEL", "qwen2.5vl:3b")
CHAT_MODEL = os.environ.get("OLLAMA_CHAT_MODEL", "deepseek-r1:1.5b")
MATH_MODEL = os.environ.get("OLLAMA_MATH_MODEL", "deepseek-r1:1.5b")
ENGINE_PORT = int(os.environ.get("RAG_ENGINE_PORT", "8765"))
LEARN_INTERVAL_SEC = int(os.environ.get("TALLER_LEARN_INTERVAL_SEC", str(30 * 60)))

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
    ensure_image_tables(conn)
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
                    json=with_ollama_limits({"model": EMBED_MODEL, "prompt": text}),
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


async def index_learning_doc(doc: dict[str, Any]) -> dict[str, Any]:
    body = IndexRequest(
        id=doc["id"],
        title=doc["title"],
        text=doc["text"],
        source=doc.get("source") or "aprendizaje-web",
    )
    return await index_document(body)


async def learn_topics(topics: list[str], max_topics: int = 3) -> dict[str, Any]:
    if not internet_ok():
        return {"ok": False, "error": "Sin internet: no aprendo ahora.", "indexed": []}
    indexed: list[str] = []
    for topic in topics[:max_topics]:
        try:
            hits = search_snippets(topic, 4)
            if not hits:
                continue
            doc = build_learning_document(topic, hits)
            await index_learning_doc(doc)
            indexed.append(doc["id"])
            remember_user_query_topic(TOPICS_PATH, topic)
        except Exception:
            continue
    return {"ok": True, "indexed": indexed, "count": len(indexed)}


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
    models = await list_ollama_models(OLLAMA_URL) if ollama else []
    vision = pick_vision_model(models, VISION_MODEL) if ollama else None
    return {
        "ok": True,
        "engine": "taller-rag-python",
        "db": str(DB_PATH),
        "ollama": ollama,
        "embed_model": EMBED_MODEL if ollama else "tfidf-fallback",
        "vision_model": vision,
        "chat_model": CHAT_MODEL if ollama else None,
        "math_model": MATH_MODEL if ollama else None,
        "sympy": True,
        "search": "duckduckgo",
        "internet": internet_ok(),
        "learn_interval_sec": LEARN_INTERVAL_SEC,
        "models": models[:20],
    }


class MathRequest(BaseModel):
    problem: str = Field(min_length=1, max_length=4000)
    web_context: bool = False


@app.post("/math/solve")
async def math_solve(body: MathRequest) -> dict[str, Any]:
    with connect() as conn:
        remembered = find_similar_math(conn, body.problem)
    if remembered and remembered.get("score", 0) >= 0.75:
        return {
            "ok": True,
            "remembered": True,
            "latex": remembered.get("latex"),
            "result": remembered["result"],
            "code": remembered.get("code"),
            "steps": [
                "Recordé un problema parecido en la memoria matemática.",
                *remembered.get("steps", []),
            ],
            "backend": "math-memory",
            "memory_id": remembered["id"],
        }

    context_bits: list[str] = []
    if body.web_context:
        try:
            for item in ddg_text(body.problem[:120], 3):
                if item.get("snippet"):
                    context_bits.append(f"{item['title']}: {item['snippet']}")
        except Exception:
            context_bits = []

    problem = body.problem
    if context_bits:
        problem = f"{body.problem}\n\nContexto web:\n" + "\n".join(context_bits)

    ollama = OLLAMA_URL if await ollama_available() else ""
    solved = solve_math_text(problem, ollama_url=ollama, math_model=MATH_MODEL)
    if not solved.get("ok"):
        raise HTTPException(status_code=422, detail=solved.get("error") or "No resolví el problema.")

    with connect() as conn:
        memory_id = remember_math(
            conn,
            problem=body.problem,
            result=str(solved.get("result")),
            latex=solved.get("latex"),
            code=solved.get("code"),
            steps=solved.get("steps") or [],
        )
    solved["memory_id"] = memory_id
    solved["remembered"] = False
    return solved


@app.post("/vision/read")
async def vision_read(
    file: UploadFile = File(...),
    prompt: str | None = Form(default=None),
) -> dict[str, Any]:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Imagen vacía.")
    if len(raw) > 8_000_000:
        raise HTTPException(status_code=413, detail="La imagen supera 8 MB.")
    mime = file.content_type or "image/png"
    result = await read_image(raw, mime, OLLAMA_URL, VISION_MODEL, prompt)
    if not result.get("ok"):
        raise HTTPException(status_code=503, detail=result.get("error") or "Visión no disponible.")

    image_id, path = save_image_file(IMAGES_DIR, raw, mime)
    with connect() as conn:
        indexed = index_image(
            conn,
            image_id=image_id,
            path=path,
            mime=mime,
            title=file.filename or image_id,
            caption=result.get("caption") or result.get("text"),
            latex=result.get("latex"),
        )
    result["image_id"] = image_id
    result["index_backend"] = indexed.get("backend")
    return result


@app.post("/vision/solve")
async def vision_solve(
    file: UploadFile = File(...),
    web_context: bool = Form(default=True),
) -> dict[str, Any]:
    """Full pipeline: image → VLM/LaTeX → SymPy → memory."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Imagen vacía.")
    if len(raw) > 8_000_000:
        raise HTTPException(status_code=413, detail="La imagen supera 8 MB.")
    mime = file.content_type or "image/png"

    vision = await read_image(
        raw,
        mime,
        OLLAMA_URL,
        VISION_MODEL,
        prompt=(
            "Lee el problema matemático o la fórmula de la imagen. "
            "Transcribe la fórmula exacta en LaTeX entre $$ ... $$. "
            "Si hay enunciado, inclúyelo. Español."
        ),
    )

    image_id, path = save_image_file(IMAGES_DIR, raw, mime)
    caption = (vision.get("caption") or vision.get("text") or file.filename or image_id) if vision.get("ok") else (file.filename or image_id)
    latex = vision.get("latex") if vision.get("ok") else None
    with connect() as conn:
        index_image(
            conn,
            image_id=image_id,
            path=path,
            mime=mime,
            title=file.filename or image_id,
            caption=caption,
            latex=latex,
        )

    if not vision.get("ok"):
        return {
            "ok": False,
            "image_id": image_id,
            "error": vision.get("error"),
            "hint": "Sin Ollama visión no puedo leer la foto. Puedes pegar la fórmula en texto/LaTeX en Calcular.",
        }

    problem = latex or vision.get("text") or ""
    if web_context and problem:
        try:
            snippets = [f"{item['title']}: {item['snippet']}" for item in ddg_text(problem[:100], 2) if item.get("snippet")]
            if snippets:
                problem = f"{problem}\n\nContexto:\n" + "\n".join(snippets)
        except Exception:
            pass

    ollama = OLLAMA_URL if await ollama_available() else ""
    solved = solve_math_text(problem, ollama_url=ollama, math_model=MATH_MODEL)
    if not solved.get("ok"):
        return {
            "ok": False,
            "image_id": image_id,
            "vision": vision,
            "error": solved.get("error") or "Leí la imagen pero no pude calcularla con SymPy.",
            "latex": latex,
            "text": vision.get("text"),
        }

    with connect() as conn:
        memory_id = remember_math(
            conn,
            problem=vision.get("text") or latex or caption,
            result=str(solved.get("result")),
            latex=latex or solved.get("latex"),
            code=solved.get("code"),
            steps=solved.get("steps") or [],
            image_id=image_id,
        )

    return {
        "ok": True,
        "image_id": image_id,
        "memory_id": memory_id,
        "vision_model": vision.get("model"),
        "text": vision.get("text"),
        "latex": latex or solved.get("latex"),
        "result": solved.get("result"),
        "result_latex": solved.get("result_latex"),
        "code": solved.get("code"),
        "steps": [
            f"1. Visión ({vision.get('model')}): leí la imagen.",
            f"2. LaTeX: `{latex or solved.get('latex')}`",
            *([step for step in (solved.get("steps") or [])]),
            "3. Guardé imagen + código + solución en la memoria local.",
        ],
        "backend": solved.get("backend"),
    }


class ImageSearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=300)
    top_k: int = Field(default=5, ge=1, le=20)


@app.post("/images/search")
async def images_search(body: ImageSearchRequest) -> dict[str, Any]:
    with connect() as conn:
        hits = search_images(conn, body.query, body.top_k)
    return {"query": body.query, "hits": hits}


class LearnRequest(BaseModel):
    topics: list[str] | None = None
    max_topics: int = Field(default=3, ge=1, le=8)


@app.post("/learn/now")
async def learn_now(body: LearnRequest) -> dict[str, Any]:
    topics = body.topics or load_interest_topics(TOPICS_PATH) or list(DEFAULT_TOPICS)
    result = await learn_topics(topics, body.max_topics)
    return result


@app.get("/learn/topics")
async def get_learn_topics() -> dict[str, Any]:
    return {"topics": load_interest_topics(TOPICS_PATH)}


class TopicsRequest(BaseModel):
    topics: list[str] = Field(default_factory=list)


@app.post("/learn/topics")
async def set_learn_topics(body: TopicsRequest) -> dict[str, Any]:
    save_interest_topics(TOPICS_PATH, body.topics or list(DEFAULT_TOPICS))
    return {"topics": load_interest_topics(TOPICS_PATH)}


class LinkRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2000)
    learn: bool = True


@app.post("/links/analyze")
async def links_analyze(body: LinkRequest) -> dict[str, Any]:
    result = await analyze_link(body.url.strip())
    if result.get("ok") and body.learn and result.get("text"):
        doc = {
            "id": f"link-{int(time.time())}-{abs(hash(body.url)) % 10_000}",
            "title": result.get("title") or body.url,
            "text": result["text"],
            "source": f"enlace:{result.get('kind')}",
        }
        indexed = await index_learning_doc(doc)
        result["indexed"] = True
        result["document_id"] = indexed.get("id")
    return result


@app.post("/audio/transcribe")
async def audio_transcribe(file: UploadFile = File(...)) -> dict[str, Any]:
    raw = await file.read()
    result = transcribe_audio_bytes(raw, file.filename or "audio.webm")
    if not result.get("ok"):
        raise HTTPException(status_code=422, detail=result.get("error") or "No transcribí el audio.")
    return result


@app.post("/documents/extract")
async def documents_extract(
    file: UploadFile = File(...),
    learn: bool = Form(default=True),
) -> dict[str, Any]:
    raw = await file.read()
    extracted = extract_document(raw, file.filename or "documento.txt")
    if not extracted.get("ok"):
        raise HTTPException(status_code=422, detail=extracted.get("error") or "No extraje el documento.")
    indexed = None
    if learn:
        doc_id = f"doc-{int(time.time())}-{abs(hash(file.filename or 'x')) % 10_000}"
        indexed = await index_learning_doc(
            {
                "id": doc_id,
                "title": extracted["title"],
                "text": extracted["text"],
                "source": f"adjunto:{file.filename or 'documento'}",
            }
        )
    return {
        **extracted,
        "indexed": bool(indexed),
        "document_id": (indexed or {}).get("id"),
    }


def ddg_text(query: str, max_results: int) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    with DDGS() as ddgs:
        for item in ddgs.text(query, max_results=max_results, region="es-es"):
            results.append(
                {
                    "title": item.get("title") or "Resultado",
                    "url": item.get("href") or item.get("link") or "",
                    "snippet": item.get("body") or item.get("snippet") or "",
                    "source": "DuckDuckGo",
                }
            )
    return results


def ddg_images(query: str, max_results: int = 3) -> list[dict[str, str]]:
    """Hasta 3 imágenes relevantes vía DuckDuckGo Images."""
    results: list[dict[str, str]] = []
    try:
        with DDGS() as ddgs:
            for item in ddgs.images(query, max_results=max_results):
                image_url = item.get("image") or item.get("thumbnail") or item.get("url") or ""
                if not image_url.startswith("http"):
                    continue
                results.append(
                    {
                        "title": item.get("title") or query,
                        "url": image_url,
                        "thumbnail": item.get("thumbnail") or image_url,
                        "source": item.get("url") or item.get("source") or "",
                    }
                )
                if len(results) >= max_results:
                    break
    except Exception:
        return []
    return results


@app.post("/search")
async def search_web(body: SearchRequest) -> dict[str, Any]:
    try:
        results = ddg_text(body.query, body.max_results)
        if not results:
            # Soft retry with a simpler query.
            results = ddg_text(body.query.split("?")[0].strip(), body.max_results)
        images = ddg_images(body.query, 3) if internet_ok() else []
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"DuckDuckGo no respondió: {error}") from error
    return {"query": body.query, "results": results, "images": images}


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
    images: list[dict[str, str]] = []
    if body.web:
        try:
            web_results = ddg_text(body.query, 4)
            images = ddg_images(body.query, 3) if internet_ok() else []
            # Aprendizaje bajo demanda: indexa resumen limpio si hay internet.
            if web_results and internet_ok():
                remember_user_query_topic(TOPICS_PATH, body.query)
                doc = build_learning_document(body.query[:120], web_results)
                try:
                    await index_learning_doc(doc)
                except Exception:
                    pass
        except Exception:
            web_results = []
            images = []

    return {
        "query": body.query,
        "embed_backend": backend,
        "hits": hits,
        "web": web_results,
        "images": images,
    }


@app.on_event("startup")
async def start_background_learning() -> None:
    import asyncio

    async def loop() -> None:
        # Espera inicial para no saturar el arranque.
        await asyncio.sleep(45)
        while True:
            try:
                if internet_ok():
                    topics = load_interest_topics(TOPICS_PATH) or list(DEFAULT_TOPICS)
                    await learn_topics(topics, max_topics=2)
            except Exception:
                pass
            await asyncio.sleep(LEARN_INTERVAL_SEC)

    asyncio.create_task(loop())


def main() -> None:
    import uvicorn

    connect().close()
    uvicorn.run("app:app", host="127.0.0.1", port=ENGINE_PORT, reload=False)


if __name__ == "__main__":
    main()
