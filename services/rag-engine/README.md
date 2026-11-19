# Motor RAG + Visión + SymPy (Python)

| Nueva función | Herramienta | Por qué |
|---|---|---|
| Leer imágenes y fórmulas | Ollama + Qwen2.5-VL / Llama-3.2-Vision | Entiende apuntes y símbolos sin internet |
| Cálculo matemático exacto | SymPy | Álgebra y cálculo sin errores de IA |
| Especialista en matemáticas | Qwen2.5-Math (Ollama) | Ayuda a traducir enunciados difíciles a SymPy |
| Guardar imágenes | SQLite + caption (CLIP opcional) | Busca fotos por contenido (“gráfica de parábola”) |
| Web | DuckDuckGo | Contexto teórico en tiempo real |

## Arranque

```sh
pip install -r requirements.txt
ollama pull qwen2.5-vl:3b
ollama pull qwen2.5-math:1.5b
ollama pull nomic-embed-text
python app.py
```

API útil:

- `POST /math/solve` — problema en texto/LaTeX → SymPy
- `POST /vision/read` — imagen → texto + LaTeX
- `POST /vision/solve` — imagen → LaTeX → SymPy → memoria
- `POST /images/search` — busca imágenes por texto
