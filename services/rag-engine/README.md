# Motor RAG (Python)

| Componente | Herramienta | Función |
|---|---|---|
| Lenguaje | Python + FastAPI | IA y datos |
| Internet | DuckDuckGo (`ddgs`) | Búsqueda web en tiempo real |
| Base de datos | SQLite | Persistencia en disco |
| Embeddings | Ollama + `nomic-embed-text` | Comprensión local (fallback TF-IDF) |

```sh
pip install -r requirements.txt
# opcional:
ollama pull nomic-embed-text
python app.py
```

Escucha en `http://127.0.0.1:8765`. La app Next.js lo detecta sola (`RAG_ENGINE_URL`).
