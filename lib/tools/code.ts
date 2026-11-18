const FENCE = /```([a-z0-9+#]*)\n?([\s\S]*?)```/i;

export function reviewCode(input: string): { applicable: boolean; answer: string; notes: string } {
  const text = input.trim();
  const wantsCode =
    /^(?:escribe|crea|haz|genera|muéstrame|muestrame|dame|arma|implementa)\b/i.test(text) ||
    /\b(funci[oó]n|programa|script|c[oó]digo|ejemplo)\b/i.test(text);

  if (wantsCode && !FENCE.test(text) && !/\b(function|def |const |let |#include|for\s*\(|while\s*\()\b/.test(text)) {
    return generateSnippet(text);
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
        "- «Escribe una función en python que cuente bananas en un texto»",
        "- «Haz un programa en js que diga si un número es par»",
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
      "Cambia `i <= …length` por `i < …length` y, si sumas un promedio, no dividas entre cero con lista vacía.",
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

function generateSnippet(text: string): { applicable: boolean; answer: string; notes: string } {
  const lower = text.toLowerCase();
  const isPython = /\bpy(thon)?\b/.test(lower) || (!/\b(js|javascript|node|typescript|\bts\b)\b/.test(lower) && /\bpython\b/.test(lower));
  const preferPython =
    isPython ||
    (!/\b(js|javascript|node|typescript)\b/.test(lower) && /\b(python|def |lista)\b/.test(lower));
  // Default to Python for Spanish school prompts unless JS is named.
  const python = preferPython || !/\b(js|javascript|node|typescript|html)\b/.test(lower);

  if (/promedio|media|average/.test(lower)) {
    return python ? pyAverage() : jsAverage();
  }
  if (/pares/.test(lower) && /suma|sum/.test(lower)) {
    return python ? pyEvenSum() : jsEvenSum();
  }
  if (/cuent|count|veces|aparec|frecuencia/.test(lower) && /palabra|texto|string|cadena/.test(lower)) {
    const word = extractQuoted(text) || guessTargetWord(lower) || "banana";
    return python ? pyCountWord(word) : jsCountWord(word);
  }
  if (/par\b|even|impar|odd/.test(lower) && /n[uú]mero|number/.test(lower)) {
    return python ? pyParity() : jsParity();
  }
  if (/factorial/.test(lower)) {
    return python ? pyFactorial() : jsFactorial();
  }
  if (/pal[ií]ndromo/.test(lower)) {
    return python ? pyPalindrome() : jsPalindrome();
  }
  if (/gato|robot|absurdo|locura|unicornio|drag[oó]n/.test(lower)) {
    return sillyProgram(python, text);
  }

  // Generic working skeleton for any remaining request.
  const task = text
    .replace(/^(?:escribe|crea|haz|genera|muéstrame|muestrame|dame|arma|implementa)\s+/i, "")
    .replace(/^(?:un[a]?\s+)?(?:c[oó]digo|funci[oó]n|programa|script|ejemplo)\s+/i, "")
    .replace(/\ben\s+(python|py|javascript|js|typescript|ts)\b/i, "")
    .replace(/^(?:para|que|de)\s+/i, "")
    .trim();

  return python ? pyGeneric(task) : jsGeneric(task);
}

function extractQuoted(text: string): string | null {
  const match = text.match(/["“”']([^"“”']{1,40})["“”']/);
  return match?.[1]?.trim() || null;
}

function guessTargetWord(lower: string): string | null {
  const match = lower.match(/\b(?:palabra|texto|string)\s+([a-záéíóúüñ]{2,30})\b/);
  if (match) return match[1];
  const known = lower.match(/\b(banana|manzana|hola|gato|perro|casa)\b/);
  return known?.[1] ?? null;
}

function sillyProgram(python: boolean, text: string): { applicable: boolean; answer: string; notes: string } {
  if (python) {
    const answer = [
      "**Python · detector absurdo (gato/robot)**",
      "",
      "```python",
      "def parece_robot(nombre, maulla=True, pide_pilas=False, brilla_en_la_oscuridad=False):",
      "    \"\"\"Heurística de juguete: no es ciencia, es un ejemplo que sí corre.\"\"\"",
      "    puntos = 0",
      "    if not maulla:",
      "        puntos += 2",
      "    if pide_pilas:",
      "        puntos += 3",
      "    if brilla_en_la_oscuridad:",
      "        puntos += 2",
      "    if 'bot' in nombre.lower() or 'robo' in nombre.lower():",
      "        puntos += 4",
      "    return puntos >= 4",
      "",
      "print(parece_robot('Michibot', maulla=False, pide_pilas=True))",
      "```",
      "",
      `Pedido: «${clip(text, 120)}». Cambia las reglas; el punto es que el programa responda algo concreto.`,
    ].join("\n");
    return { applicable: true, answer, notes: "Ejemplo absurdo ejecutable en Python." };
  }
  const answer = [
    "**JavaScript · detector absurdo (gato/robot)**",
    "",
    "```js",
    "function pareceRobot({ nombre, maulla = true, pidePilas = false, brilla = false }) {",
    "  let puntos = 0;",
    "  if (!maulla) puntos += 2;",
    "  if (pidePilas) puntos += 3;",
    "  if (brilla) puntos += 2;",
    "  if (/bot|robo/i.test(nombre)) puntos += 4;",
    "  return puntos >= 4;",
    "}",
    "",
    "console.log(pareceRobot({ nombre: 'Michibot', maulla: false, pidePilas: true }));",
    "```",
    "",
    `Pedido: «${clip(text, 120)}».`,
  ].join("\n");
  return { applicable: true, answer, notes: "Ejemplo absurdo ejecutable en JavaScript." };
}

function pyCountWord(word: string) {
  const answer = [
    `**Python · contar «${word}» en un texto**`,
    "",
    "```python",
    `def contar_palabra(texto, palabra="${word}"):`,
    "    tokens = texto.lower().split()",
    "    objetivo = palabra.lower()",
    "    return sum(1 for token in tokens if token.strip('.,;:!?') == objetivo)",
    "",
    `print(contar_palabra("banana banana manzana banana"))  # 3`,
    "```",
  ].join("\n");
  return { applicable: true, answer, notes: `Contador de «${word}» en Python.` };
}

function jsCountWord(word: string) {
  const answer = [
    `**JavaScript · contar «${word}» en un texto**`,
    "",
    "```js",
    `function contarPalabra(texto, palabra = "${word}") {`,
    "  const tokens = texto.toLowerCase().split(/\\s+/);",
    "  const objetivo = palabra.toLowerCase();",
    "  return tokens.filter((token) => token.replace(/[.,;:!?]/g, '') === objetivo).length;",
    "}",
    "",
    `console.log(contarPalabra("banana banana manzana banana")); // 3`,
    "```",
  ].join("\n");
  return { applicable: true, answer, notes: `Contador de «${word}» en JavaScript.` };
}

function pyAverage() {
  return {
    applicable: true,
    answer: [
      "**Python · promedio**",
      "",
      "```python",
      "def promedio(valores):",
      "    if not valores:",
      "        raise ValueError('la lista está vacía')",
      "    return sum(valores) / len(valores)",
      "```",
    ].join("\n"),
    notes: "Promedio en Python.",
  };
}

function jsAverage() {
  return {
    applicable: true,
    answer: [
      "**JavaScript · promedio**",
      "",
      "```js",
      "function promedio(valores) {",
      "  if (!valores.length) throw new Error('el arreglo está vacío');",
      "  let total = 0;",
      "  for (let i = 0; i < valores.length; i++) total += valores[i];",
      "  return total / valores.length;",
      "}",
      "```",
    ].join("\n"),
    notes: "Promedio en JavaScript.",
  };
}

function pyEvenSum() {
  return {
    applicable: true,
    answer: [
      "**Python · suma de pares**",
      "",
      "```python",
      "def suma_pares(valores):",
      "    return sum(v for v in valores if v % 2 == 0)",
      "```",
    ].join("\n"),
    notes: "Suma de pares en Python.",
  };
}

function jsEvenSum() {
  return {
    applicable: true,
    answer: [
      "**JavaScript · suma de pares**",
      "",
      "```js",
      "function sumaPares(valores) {",
      "  return valores.filter((v) => v % 2 === 0).reduce((a, b) => a + b, 0);",
      "}",
      "```",
    ].join("\n"),
    notes: "Suma de pares en JavaScript.",
  };
}

function pyParity() {
  return {
    applicable: true,
    answer: [
      "**Python · par o impar**",
      "",
      "```python",
      "def es_par(n):",
      "    return n % 2 == 0",
      "```",
    ].join("\n"),
    notes: "Paridad en Python.",
  };
}

function jsParity() {
  return {
    applicable: true,
    answer: [
      "**JavaScript · par o impar**",
      "",
      "```js",
      "function esPar(n) {",
      "  return n % 2 === 0;",
      "}",
      "```",
    ].join("\n"),
    notes: "Paridad en JavaScript.",
  };
}

function pyFactorial() {
  return {
    applicable: true,
    answer: [
      "**Python · factorial**",
      "",
      "```python",
      "def factorial(n):",
      "    if n < 0:",
      "        raise ValueError('n negativo')",
      "    total = 1",
      "    for i in range(2, n + 1):",
      "        total *= i",
      "    return total",
      "```",
    ].join("\n"),
    notes: "Factorial en Python.",
  };
}

function jsFactorial() {
  return {
    applicable: true,
    answer: [
      "**JavaScript · factorial**",
      "",
      "```js",
      "function factorial(n) {",
      "  if (n < 0) throw new Error('n negativo');",
      "  let total = 1;",
      "  for (let i = 2; i <= n; i++) total *= i;",
      "  return total;",
      "}",
      "```",
    ].join("\n"),
    notes: "Factorial en JavaScript.",
  };
}

function pyPalindrome() {
  return {
    applicable: true,
    answer: [
      "**Python · palíndromo**",
      "",
      "```python",
      "def es_palindromo(texto):",
      "    limpio = ''.join(c.lower() for c in texto if c.isalnum())",
      "    return limpio == limpio[::-1]",
      "```",
    ].join("\n"),
    notes: "Palíndromo en Python.",
  };
}

function jsPalindrome() {
  return {
    applicable: true,
    answer: [
      "**JavaScript · palíndromo**",
      "",
      "```js",
      "function esPalindromo(texto) {",
      "  const limpio = texto.toLowerCase().replace(/[^a-z0-9áéíóúüñ]/gi, '');",
      "  return limpio === [...limpio].reverse().join('');",
      "}",
      "```",
    ].join("\n"),
    notes: "Palíndromo en JavaScript.",
  };
}

function pyGeneric(task: string) {
  const answer = [
    `**Python · esqueleto para:** ${clip(task, 100)}`,
    "",
    "```python",
    "def resolver(entrada):",
    "    \"\"\"Ajusta la lógica a tu caso; esto ya corre y devuelve un resultado.\"\"\"",
    "    if entrada is None:",
    "        return None",
    "    if isinstance(entrada, str):",
    "        return entrada.strip().lower()",
    "    if isinstance(entrada, (list, tuple)):",
    "        return list(entrada)",
    "    return entrada",
    "",
    `print(resolver("ejemplo"))  # pedido: ${clip(task, 60)}`,
    "```",
    "",
    "Dime la entrada y la salida exactas si quieres que lo deje más cerrado.",
  ].join("\n");
  return { applicable: true, answer, notes: `Esqueleto Python para «${clip(task, 80)}».` };
}

function jsGeneric(task: string) {
  const answer = [
    `**JavaScript · esqueleto para:** ${clip(task, 100)}`,
    "",
    "```js",
    "function resolver(entrada) {",
    "  if (entrada == null) return null;",
    "  if (typeof entrada === 'string') return entrada.trim().toLowerCase();",
    "  if (Array.isArray(entrada)) return [...entrada];",
    "  return entrada;",
    "}",
    "",
    `console.log(resolver("ejemplo")); // pedido: ${clip(task, 60)}`,
    "```",
  ].join("\n");
  return { applicable: true, answer, notes: `Esqueleto JS para «${clip(task, 80)}».` };
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

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
