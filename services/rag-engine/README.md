# Motor RAG + Visión + SymPy + Aprendizaje (Python)

Límite de RAM (~8 GB): chat/embeddings con `keep_alive: "5m"`, `num_ctx: 4096`, `num_thread: 4`. Visión usa `keep_alive: 0` tras analizar la imagen.

| Función | Herramienta |
|---|---|
| Chat / razonamiento | `deepseek-r1:1.5b` |
| Visión | `qwen2.5vl:3b` |
| Embeddings | `nomic-embed-text` |
| Cálculo exacto | SymPy |
| Audio | faster-whisper `base` int8 |
| YouTube / GitHub / DOI | youtube-transcript-api, GitHub API, Crossref/ArXiv/pypdf |
| Web | DuckDuckGo |

## Arranque

```sh
pip install -r requirements.txt
ollama pull nomic-embed-text
ollama pull qwen2.5vl:3b
ollama pull deepseek-r1:1.5b
python app.py
```

API útil:

- `POST /math/solve`, `/vision/solve`, `/audio/transcribe`
- `POST /links/analyze`, `/learn/now`, `/images/search`
- `POST /query` (también indexa resúmenes web bajo demanda)
