# Taller

Ocho oficios para el día a día — estudiar, programar, escribir, calcular, organizar, traducir, resumir e investigar — armados sobre [deepseek-recipe](https://github.com/deepseek-ai/deepseek-recipe).

Al abrir la app verás **Bienvenido** y **¿En qué te puedo ayudar hoy?** Hay seis interfaces (Brisa, Tinta, Solar, Noche, Coral, Bosque) para probar cuál te gusta más, y un historial de lo que buscaste.

Cada oficio responde con una herramienta local. **Investigar** consulta en paralelo bases verificables con enlace: Wikipedia, Wikidata, OpenAlex, Crossref, Europe PMC y Open Library. El panel **Receta** muestra el prompt con los tokens de `deepseek-recipe` 0.2.0.

Con `DEEPSEEK_API_KEY` las respuestas pasan por DeepSeek; sin clave, el modo taller sigue respondiendo con esas herramientas.

## Aprendizaje autónomo

Si una respuesta falla, marca **Mal** y escribe la correcta, o envía «está mal, la respuesta es…». Taller guarda esa corrección en tu navegador y, la próxima vez que hagas la misma pregunta en ese oficio, usa lo aprendido.

## Arquitectura RAG

| Componente | Herramienta | Función |
|---|---|---|
| Lenguaje | **Python** (`services/rag-engine`) | Ecosistema para IA y datos; motor FastAPI aparte de la UI Next.js |
| Conexión a Internet | **DuckDuckGo Search** (gratis; Tavily opcional luego) | Busca en la web en tiempo real sin un crawler propio |
| Base de datos | **SQLite** en disco (`services/rag-engine/data/taller-rag.sqlite`) | Persiste documentos, chunks, embeddings y lecciones |
| Comprensión de texto | **Ollama + `nomic-embed-text`** (fallback TF-IDF) | Embeddings locales sin pagar nube; si Ollama no corre, usa TF-IDF |

```
Documentos / lecciones / DuckDuckGo + bases académicas
        │
        ▼
   Chunking → embeddings (Ollama o TF-IDF) → SQLite
        │
        ▼
   Retrieve top-k (similitud coseno)
        │
        ▼
   Augment → respuesta Taller / prompt DeepSeek
```

### Modo autónomo en tu PC

```sh
# 1) (opcional) embeddings locales
ollama pull nomic-embed-text

# 2) motor Python
npm run rag:install
npm run rag:engine

# 3) app
npm run dev
```

Si el motor Python no está arriba, la app sigue con el RAG TypeScript + DuckDuckGo HTML y las bases verificables.

## Uso local

```sh
npm install
npm run dev
```

```sh
npm test
npm run lint
```
