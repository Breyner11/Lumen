# Taller

Asistente todoterreno en un solo chat (**Preguntar**): calcula, investiga, estudia, programa, escribe, organiza, traduce, resume, atiende emergencias/vida diaria/proyectos, lee fotos, transcribe audio y analiza YouTube/GitHub/DOI. Aprende de internet en local (máx. ~8 GB RAM con Ollama). Armado sobre [deepseek-recipe](https://github.com/deepseek-ai/deepseek-recipe).

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

### Adjuntos, imágenes web y estilo

- Botón **+**: adjunta `.pdf`, `.docx`, `.xlsx`/`.xls`, `.csv`, `.txt`/`.md`, imágenes o audio. Verás el nombre del archivo antes de enviar; el motor extrae texto (`/documents/extract`) y lo indexa en RAG.
- Con internet, DuckDuckGo (`region=es-es`) aporta resultados e **1–3 imágenes**; la UI muestra la galería arriba y un recuadro **Fuentes** al final.
- Debajo de cada respuesta: **Más corto**, **Más informativo**, **Más natural**. DeepSeek R1 redacta limpio (sin volcar RAG crudo) y obedece el estilo del historial reciente.
- Idioma: **siempre español**, salvo el oficio **Traducir**.

### Flujo imagen → solución

1. Adjunta una foto con **+** (o envíala sola).
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
# 1) modelos locales (≤8 GB RAM)
ollama pull nomic-embed-text
ollama pull qwen2.5vl:3b
ollama pull deepseek-r1:1.5b

# 2) motor Python
npm run rag:install
npm run rag:engine

# 3) app
npm run dev
```

Comando rápido de prueba (con Ollama ya instalado):

```sh
npm run rag:install && npm run rag:engine & npm run dev
```

Luego abre `http://127.0.0.1:3847`. Ollama usa `http://127.0.0.1:11434`, chat con `keep_alive: "5m"`, `num_ctx: 4096` y `num_thread: 4` (timeout 120 s). La visión libera el modelo con `keep_alive: 0` tras analizar.

## Uso local

```sh
npm install
npm run dev
```

```sh
npm test
npm run lint
```
