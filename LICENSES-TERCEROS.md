# Licencias de terceros (Lumen)

Lumen prioriza software **gratuito** y, cuando es posible, **código libre**. No depende de APIs de búsqueda de pago (sin Brave, sin Tavily).

## Aplicación y empaquetado

| Componente | Uso | Licencia / nota |
| --- | --- | --- |
| Next.js | UI web | MIT |
| React | UI | MIT |
| Tauri 2 | App de escritorio Windows | Apache-2.0 / MIT |
| Tailwind CSS | Estilos | MIT |
| shadcn/ui / Base UI | Componentes | MIT |

## Modelos y runtime local

| Componente | Uso | Licencia / nota |
| --- | --- | --- |
| [Ollama](https://ollama.com) | Runtime local de modelos | MIT |
| Qwen2.5 (p. ej. `qwen2.5:7b`) | Chat en español | Apache-2.0 (pesos vía Ollama) |
| Qwen2.5-VL | Visión / OCR | Apache-2.0 |
| `nomic-embed-text` | Embeddings locales | Apache-2.0 |
| deepseek-r1 (opcional, respaldo) | Chat corto | Licencia del modelo según publicación en Ollama (revisar tarjeta del modelo) |
| Whisper (local, si se usa) | Transcripción | MIT (openai-whisper / implementaciones compatibles) |
| Piper (opcional TTS) | Voz | MIT |

## Búsqueda y datos (solo gratuitos)

| Motor | Rol en Lumen | Licencia / nota |
| --- | --- | --- |
| **SearXNG** | Motor principal autoalojado | AGPL-3.0 (código libre) |
| **Wikipedia (es)** | Resúmenes / búsqueda | Contenido CC BY-SA; API gratuita |
| **Wikidata** | Datos exactos | CC0; API gratuita |
| **Marginalia** | Alternativa libre | Proyecto libre; API pública gratuita |
| **DuckDuckGo** | Respaldo gratuito | Servicio gratuito; **no es código libre** |

## Motor RAG

| Componente | Uso | Licencia / nota |
| --- | --- | --- |
| FastAPI | Motor Python | MIT |
| SQLite | Memoria local | Dominio público |
| DuckDuckGo Search (lib Python, si aplica) | Búsqueda legacy del motor | Uso gratuito; no FLOSS del servicio remoto |
| SymPy | Cálculo exacto | BSD-3-Clause |

## Compromiso

- Sin claves de API de pago en el flujo por defecto.
- Internet apagado = solo Ollama + documentos locales.
- Si un componente deja de ser gratuito, no se añade a Lumen sin documentarlo aquí.
