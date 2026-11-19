# Cómo instalar Lumen en Windows

Guía sencilla para instalar la app de escritorio **Lumen** (Taller) en un PC con Windows.

## 1. Descargar el instalador (`.exe`)

El instalador se genera con el flujo de GitHub Actions **Windows installer (Tauri)** (archivo `.github/workflows/windows-tauri.yml`). Hace falta un repositorio en **GitHub** con Actions habilitado (el repo solo en Origin no ejecuta ese workflow).

1. Entra al repositorio en **GitHub** (cuando esté enlazado o creado).
2. Abre la pestaña **Actions**.
3. Busca el flujo **Windows installer (Tauri)**.
4. Abre la ejecución **más reciente en verde** (éxito).
5. Al final de la página, en **Artifacts**, descarga **`lumen-windows-installers`**.
6. Descomprime el ZIP y usa el archivo **`.exe`** (NSIS). También puede haber un `.msi`.

> Si publican **Releases**: descarga el `.exe` más reciente y sigue en «Instalar Lumen».

> Mientras tanto, el código y esta guía están en Origin: rama `cursor/fix-overview-dark-ui-95be`, PR draft https://cursor.com/codebase/breyner-ivan-dev/taller/pull/1

## 2. Instalar Lumen

1. Haz doble clic en el `.exe` (NSIS).
2. Si Windows muestra «Windows protegió tu PC», elige **Más información** → **Ejecutar de todas formas** (solo si confías en el archivo que descargaste del repo).
3. Sigue el asistente (Siguiente → Instalar → Finalizar).
4. Abre **Lumen** desde el menú Inicio o el acceso directo del escritorio.

Aún no respondará bien hasta que instales Ollama y los modelos (siguiente sección).

## 3. Instalar Ollama (el «cerebro» local)

1. Entra a [https://ollama.com/download](https://ollama.com/download) y descarga Ollama para Windows.
2. Instálalo y déjalo corriendo (icono en la bandeja del sistema).
3. Abre **PowerShell** o **Símbolo del sistema** y ejecuta:

```bat
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

La primera descarga puede tardar varios minutos (varios GB). Cuando termine:

```bat
ollama list
```

Deberías ver `qwen2.5:7b` y `nomic-embed-text`.

## 4. Abrir Lumen y probar

1. Abre la app **Lumen**.
2. En Ajustes (engranaje), elige el modelo **qwen2.5:7b** si no está seleccionado.
3. En modo **Investigar**, deja «Sin internet» o «Auto» según quieras.
4. Escribe una pregunta corta (por ejemplo: «¿Qué es la fotosíntesis?») y pulsa Enviar.

Si ves un error de «Ollama no responde», asegúrate de que Ollama esté abierto y vuelve a intentar.

## 5. (Opcional) SearXNG con Docker — búsqueda libre en Auto

Solo si quieres que el modo **Auto / Internet** use un metabuscador libre en tu PC:

1. Instala [Docker Desktop](https://www.docker.com/products/docker-desktop/) para Windows.
2. En la carpeta del proyecto (o donde tengas `docker/searxng`), arranca SearXNG. Ejemplo:

```bat
docker compose -f docker/searxng/docker-compose.yml up -d
```

3. Comprueba en el navegador: [http://127.0.0.1:8080](http://127.0.0.1:8080)
4. En Lumen → Ajustes → motores de búsqueda, deja **SearXNG** activo con esa URL.

Sin SearXNG, Lumen puede seguir usando Wikipedia/Wikidata (gratis) cuando hay internet.

## Problemas frecuentes

| Problema | Qué hacer |
| --- | --- |
| La app no contesta | Abre Ollama; ejecuta `ollama list` y confirma los dos modelos. |
| Descarga de modelo muy lenta | Es normal la primera vez; deja la ventana abierta. |
| Windows bloquea el `.exe` | Más información → Ejecutar de todas formas (archivo del repo de confianza). |
| Quieres solo local | En Lumen elige «Sin internet». |

## Resumen rápido

1. Descargar artifact **`lumen-windows-installers`** → instalar el `.exe`  
2. Instalar Ollama  
3. `ollama pull qwen2.5:7b` y `ollama pull nomic-embed-text`  
4. Abrir Lumen y preguntar  
5. (Opcional) Docker + SearXNG para búsqueda libre  
