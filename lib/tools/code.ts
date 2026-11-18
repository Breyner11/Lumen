const FENCE = /```([a-z0-9+#]*)\n?([\s\S]*?)```/i;

export function reviewCode(input: string): { applicable: boolean; answer: string; notes: string } {
  const text = input.trim();
  const generate = text.match(
    /^(?:escribe|crea|haz|genera|muéstrame|muestrame|dame)\s+(?:un[a]?\s+)?(?:c[oó]digo|funci[oó]n|programa|script|ejemplo)?\s*(?:en\s+(\w+))?\s*(?:para\s+|de\s+|que\s+)?(.+)/i,
  );
  if (generate && !FENCE.test(text) && !/\b(function|def |const |let |#include)\b/.test(text)) {
    return generateSnippet(generate[1] || "javascript", generate[2] || text);
  }

  const fenced = text.match(FENCE);
  const body = (fenced?.[2] ?? text).replace(/\r\n/g, "\n");
  const languageHint = fenced?.[1]?.trim().toLowerCase() ?? "";
  const looksLikeCode =
    Boolean(fenced) ||
    /\b(function|def |class |const |let |var |import |#include|public |fn |SELECT |return )\b/.test(body);
  if (!looksLikeCode) {
    const traceback = /Traceback \(most recent call last\)|Error:|Exception|SyntaxError|TypeError/.test(text);
    if (traceback) {
      const lines = text.trim().split("\n").filter(Boolean);
      const answer = [
        "Esto parece un mensaje de error.",
        "",
        `- Pista principal (última línea): \`${lines[lines.length - 1]?.slice(0, 180) ?? ""}\`.`,
        "- La última ruta tuya (no de una librería) suele ser donde se rompe.",
        "- Pega la función que rodea esa línea y te marco la causa probable.",
      ].join("\n");
      return { applicable: true, answer, notes: "Mensaje de error: la última línea nombra la falla." };
    }
    return {
      applicable: false,
      answer: [
        "Pega una función, un error, o pide un ejemplo:",
        "",
        "- «Escribe una función en python para el promedio de una lista»",
        "- «Crea un ejemplo en js que sume los pares de un arreglo»",
      ].join("\n"),
      notes: "",
    };
  }

  const lines = body.split("\n");
  const language = guessLanguage(languageHint, body);
  const functions = [
    ...body.matchAll(
      /\b(?:function|def|fn)\s+([A-Za-z_]\w*)|([A-Za-z_]\w*)\s*(?:=|:)\s*(?:async\s*)?\([^)]*\)\s*(?:=>|\{)/g,
    ),
  ]
    .map((match) => match[1] || match[2])
    .filter(Boolean);
  const warnings: string[] = [];
  if (/<=\s*[\w.]+\.length/.test(body)) {
    warnings.push(
      "Hay un `<= …length`. El último índice válido es `length - 1`; ese `<=` suele salirse por uno.",
    );
  }
  if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(body) || /except[^:\n]*:\s*(?:pass)?\s*(?:\n|$)/.test(body)) {
    warnings.push("Hay una captura de error vacía. El programa sigue como si nada hubiera pasado.");
  }
  if (/console\.log\(/.test(body) || /\bprint\(/.test(body)) {
    warnings.push("Quedan impresiones (`console.log` o `print`). Útiles al probar; ruidosas si se quedan.");
  }
  if (/\bvar\s+/.test(body)) {
    warnings.push("Usa `var`. En JavaScript moderno conviene `const` o `let`.");
  }
  if (/\b(TODO|FIXME)\b/.test(body)) warnings.push("Hay un TODO o FIXME pendiente.");
  if (lines.find((line) => line.length > 100)) {
    warnings.push("Hay una línea de más de 100 caracteres.");
  }
  if (lines.length > 40 && functions.length <= 1) {
    warnings.push("El fragmento es largo y casi no está partido en funciones.");
  }

  const warningBlock = warnings.length
    ? warnings.map((warning) => `- ${warning}`).join("\n")
    : "- No vi las señales habituales (índice fuera por uno, captura vacía, `var`, impresiones, TODO).";
  const functionBlock = functions.length
    ? functions.map((name) => `\`${name}\``).join(", ")
    : "no reconocí nombres de función";

  let fixHint = "";
  if (/<=\s*[\w.]+\.length/.test(body) && /for\s*\(/.test(body)) {
    fixHint = [
      "",
      "**Cambio sugerido**",
      "",
      "Cambia `i <= …length` por `i < …length` y, si sumas un promedio, asegúrate de no dividir entre cero cuando la lista esté vacía.",
    ].join("\n");
  }

  const answer = [
    `**${language}** · ${lines.length} líneas · ${functions.length} función${functions.length === 1 ? "" : "es"}`,
    "",
    `Funciones: ${functionBlock}.`,
    "",
    warningBlock,
    fixHint,
    "",
    "Lectura estática: no ejecuté el código.",
  ].join("\n");
  return {
    applicable: true,
    answer,
    notes: `Lectura estática (${language}, ${lines.length} líneas).\n${warningBlock}`,
  };
}

function generateSnippet(
  languageRaw: string,
  task: string,
): { applicable: boolean; answer: string; notes: string } {
  const language = languageRaw.toLowerCase();
  const lower = task.toLowerCase();
  const isPython = /py|python/.test(language) || /python/.test(lower);
  const isJs = /js|javascript|node|typescript|ts/.test(language) || !isPython;

  if (/promedio|media|average/.test(lower)) {
    if (isPython) {
      const answer = [
        "**Python · promedio de una lista**",
        "",
        "```python",
        "def promedio(valores):",
        "    if not valores:",
        "        raise ValueError('la lista está vacía')",
        "    return sum(valores) / len(valores)",
        "",
        "print(promedio([4, 5, 3]))  # 4.0",
        "```",
        "",
        "Si la lista puede venir vacía, decide si lanzar error o devolver `None`.",
      ].join("\n");
      return { applicable: true, answer, notes: "Ejemplo de promedio en Python." };
    }
    const answer = [
      "**JavaScript · promedio de un arreglo**",
      "",
      "```js",
      "function promedio(valores) {",
      "  if (!valores.length) throw new Error('el arreglo está vacío');",
      "  let total = 0;",
      "  for (let i = 0; i < valores.length; i++) {",
      "    total += valores[i];",
      "  }",
      "  return total / valores.length;",
      "}",
      "",
      "console.log(promedio([4, 5, 3])); // 4",
      "```",
      "",
      "Ojo con `i <= valores.length`: ese `<=` se sale por uno.",
    ].join("\n");
    return { applicable: true, answer, notes: "Ejemplo de promedio en JavaScript." };
  }

  if (/pares|even/.test(lower) && /suma|sum/.test(lower)) {
    const answer = isPython
      ? [
          "**Python · suma de pares**",
          "",
          "```python",
          "def suma_pares(valores):",
          "    return sum(v for v in valores if v % 2 == 0)",
          "```",
        ].join("\n")
      : [
          "**JavaScript · suma de pares**",
          "",
          "```js",
          "function sumaPares(valores) {",
          "  return valores.filter((v) => v % 2 === 0).reduce((a, b) => a + b, 0);",
          "}",
          "```",
        ].join("\n");
    return { applicable: true, answer, notes: "Ejemplo de suma de pares." };
  }

  const lang = isPython ? "python" : "javascript";
  const answer = [
    `Puedo armarte un ejemplo corto en **${lang}**.`,
    "",
    "Prueba una petición concreta, por ejemplo:",
    "- «Escribe una función en python para el promedio de una lista»",
    "- «Crea un ejemplo en js que sume los pares de un arreglo»",
    "",
    `Pedido recibido: «${task}»`,
  ].join("\n");
  return { applicable: false, answer, notes: "" };
}

function guessLanguage(hint: string, body: string): string {
  if (hint) return hint;
  if (/\bdef\s+\w+/.test(body) || (/\bimport\s+\w+/.test(body) && /:\n/.test(body))) return "python";
  if (/\bfunction\b|=>|const |let /.test(body)) return "javascript";
  if (/#include|std::/.test(body)) return "c++";
  if (/\bpublic\s+class\b/.test(body)) return "java";
  if (/\bSELECT\b/i.test(body) && /\bFROM\b/i.test(body)) return "sql";
  return "texto con pinta de código";
}
