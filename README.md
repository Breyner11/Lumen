# Taller

Un solo chat (**Preguntar**) que enruta solo: calcula, investiga, estudia, programa, escribe, organiza, traduce o resume según lo que digas. Los ocho oficios siguen disponibles como especialidades. Armado sobre [deepseek-recipe](https://github.com/deepseek-ai/deepseek-recipe).

Al abrir la app verás **Bienvenido** y **¿En qué te puedo ayudar hoy?** Hay seis interfaces (Brisa, Tinta, Solar, Noche, Coral, Bosque) y un historial de lo que buscaste.

**Investigar** (y las preguntas abiertas en Preguntar) consulta bases verificables: Wikipedia, Wikidata, OpenAlex, Crossref, Europe PMC y Open Library. El panel **Receta** muestra el prompt con los tokens de `deepseek-recipe` 0.2.0.

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
| Leer imágenes / fórmulas | **Ollama + Qwen2.5-VL** (o Llama-3.2-Vision) | Visiona apuntes y pasa fórmulas a LaTeX |
| Cálculo exacto | **SymPy** (+ Qwen2.5-Math opcional) | Derivadas, integrales y ecuaciones sin alucinaciones numéricas |
| Memoria de imágenes | **SQLite + caption/CLIP** | Guarda fotos y las recupera por texto (“gráfica de parábola”) |

### Flujo imagen → solución

1. Subes una foto en **Calcular** (botón de imagen).
2. Qwen2.5-VL (Ollama) la lee y saca LaTeX.
3. Si hace falta, DuckDuckGo aporta contexto teórico.
4. **SymPy** calcula el resultado exacto y muestra pasos + código.
5. Se guarda imagen + LaTeX + código + solución en SQLite para la próxima vez.

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
# 1) modelos locales (opcional pero recomendado)
ollama pull nomic-embed-text
ollama pull qwen2.5-vl:3b
ollama pull qwen2.5-math:1.5b

# 2) motor Python
npm run rag:install
npm run rag:engine

# 3) app
npm run dev
```

Si el motor Python no está arriba, la app sigue con el RAG TypeScript + DuckDuckGo y las bases verificables. Sin Ollama visión no podrá leer fotos, pero SymPy sí resuelve problemas escritos.

## Uso local

```sh
npm install
npm run dev
```

```sh
npm test
npm run lint
```
