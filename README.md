# Taller

Ocho oficios para el día a día — estudiar, programar, escribir, calcular, organizar, traducir, resumir e investigar — armados sobre [deepseek-recipe](https://github.com/deepseek-ai/deepseek-recipe), la biblioteca abierta de DeepSeek que convierte una conversación al prompt de los modelos V4 y V4.1.

Cada oficio responde con una herramienta local, sin clave y sin inventar una traducción ni una cita. El panel **Receta** muestra el prompt con los tokens especiales de `deepseek-recipe` 0.2.0 (esfuerzo de razonamiento, `<think>` y los marcadores de turno).

Si publicas la app en privado y agregas el secreto `DEEPSEEK_API_KEY`, quien inició sesión recibe la respuesta de `deepseek-flash` o `deepseek-v4-pro`. La clave se lee en el servidor y no llega al navegador.

## Uso local

```sh
npm install
npm run dev
```

Abre la dirección que imprime el servidor. Sin `DEEPSEEK_API_KEY` queda en modo taller.

```sh
npm test
npm run lint
```

## Secreto

La app lee `DEEPSEEK_API_KEY` del entorno. En local puedes exportarla en la terminal antes de `npm run dev`. No la pongas en el código ni en un archivo que se suba al repositorio.
