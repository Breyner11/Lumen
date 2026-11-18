# Taller

Ocho oficios para el día a día — estudiar, programar, escribir, calcular, organizar, traducir, resumir e investigar — armados sobre [deepseek-recipe](https://github.com/deepseek-ai/deepseek-recipe).

Al abrir la app verás **Bienvenido** y **¿En qué te puedo ayudar hoy?** Hay seis interfaces (Brisa, Tinta, Solar, Noche, Coral, Bosque) para probar cuál te gusta más, y un historial de lo que buscaste.

Cada oficio responde con una herramienta local. **Investigar** consulta en paralelo bases verificables con enlace: Wikipedia, Wikidata, OpenAlex, Crossref, Europe PMC y Open Library. El panel **Receta** muestra el prompt con los tokens de `deepseek-recipe` 0.2.0.

Con `DEEPSEEK_API_KEY` las respuestas pasan por DeepSeek; sin clave, el modo taller sigue respondiendo con esas herramientas.

## Uso local

```sh
npm install
npm run dev
```

```sh
npm test
npm run lint
```
