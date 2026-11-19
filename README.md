# Lumen

Asistente todoterreno **local** en un solo chat (**Preguntar**): calcula, investiga, estudia, programa, escribe, organiza, traduce, resume, modo **Asistente** (tareas y PC con confirmación), lee fotos, transcribe audio y trabaja con tus PDF/DOCX/TXT. Por defecto **no usa internet**: responde con Ollama + documentos locales y marca *Respondido sin internet*. La búsqueda web es un interruptor opcional en Ajustes.

El nombre visible vive en `lib/brand.ts` (`APP_NAME`). UI en español, modo claro/oscuro e interfaces opcionales.

## App de escritorio Windows (Tauri)

Lumen se empaqueta como aplicación nativa (ventana propia, icono en la barra de tareas y Alt+Tab, bandeja, una sola instancia, atajo Ctrl+Espacio, inicio con Windows opcional). **No es una PWA.**

- Código nativo: `src-tauri/`
- Sidecar: `scripts/windows/start-lumen-sidecar.ps1` (arranca Next standalone y comprueba Ollama)
- Instaladores NSIS (`.exe`) y MSI: workflow [Windows installer (Tauri)](.github/workflows/windows-tauri.yml)

### Cómo descargar el instalador

1. En GitHub → pestaña **Actions** → workflow **Windows installer (Tauri)**.
2. Elige un run en verde (o **Run workflow**).
3. En **Artifacts** descarga `lumen-windows-installers` (contiene `.exe` NSIS y/o `.msi`).
4. Instálalo: crea accesos en Escritorio y Menú Inicio, aparece en «Agregar o quitar programas» y trae desinstalador.

En este entorno Linux no se compila el MSI; el artifact lo genera `windows-latest`.

### Modelos Ollama recomendados (Asus TUF A15 / 16 GB)

| Modelo | Uso |
|---|---|
| `qwen2.5:7b` | **Por defecto** si hay ≥14 GB RAM o ≥6 GB VRAM — mejor español |
| `deepseek-r1:7b` / `llama3.1:8b` | Alternativas 7–8B |
| `deepseek-r1:1.5b` | Respaldo rápido |

El selector está en **Ajustes**; el default se elige según RAM/VRAM detectadas (`/api/ollama/models`).

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
