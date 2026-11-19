# SearXNG en Windows (para Lumen)

SearXNG es un **metabuscador libre (AGPL-3.0)** que puedes autoalojar. Lumen lo usa como motor principal en modo **Auto** o **Siempre** cuando está disponible en `http://127.0.0.1:8080`.

## Requisitos

1. [Docker Desktop para Windows](https://www.docker.com/products/docker-desktop/) (gratis para uso personal).
2. WSL2 habilitado (Docker Desktop lo guía en la instalación).

## Arranque rápido

En PowerShell, desde la carpeta del proyecto:

```powershell
cd docker\searxng
docker compose up -d
```

Comprueba en el navegador: [http://127.0.0.1:8080](http://127.0.0.1:8080)

Prueba la API JSON:

```powershell
curl "http://127.0.0.1:8080/search?q=Bogota&format=json"
```

## En Lumen

1. Abre **Ajustes**.
2. En **Motores de búsqueda** deja **SearXNG** activado.
3. URL por defecto: `http://127.0.0.1:8080`
4. Pon internet en **Automático** o **Siempre**.

Con **Internet apagado**, Lumen no llama a SearXNG ni a ningún motor externo.

## Parar / borrar

```powershell
cd docker\searxng
docker compose down
```

## Notas

- No hace falta clave de API ni servicio de pago.
- Wikipedia, Wikidata y Marginalia siguen disponibles como libres/gratuitos.
- DuckDuckGo es solo un respaldo **gratuito** (no es código libre).
