const FENCE = /```([a-z0-9+#]*)\n?([\s\S]*?)```/i;

export function reviewCode(input: string): { applicable: boolean; answer: string; notes: string } {
  const fenced = input.match(FENCE);
  const body = (fenced?.[2] ?? input).replace(/\r\n/g, "\n");
  const languageHint = fenced?.[1]?.trim().toLowerCase() ?? "";
  const looksLikeCode =
    Boolean(fenced) ||
    /\b(function|def |class |const |let |var |import |#include|public |fn |SELECT |return )\b/.test(body);
  if (!looksLikeCode) {
    const traceback = /Traceback \(most recent call last\)|Error:|Exception|SyntaxError|TypeError/.test(input);
    if (traceback) {
      const lines = input.trim().split("\n").filter(Boolean);
      const answer = [
        "Esto parece un mensaje de error, no un archivo.",
        "",
        `- La pista principal suele estar en la última línea: \`${lines[lines.length - 1]?.slice(0, 180) ?? ""}\`.`,
        "- Si hay un traceback, la última ruta que es tuya (no de una librería) es el lugar donde se rompe.",
        "- Pega también la función que rodea esa línea y te marco la estructura.",
      ].join("\n");
      return { applicable: true, answer, notes: "El mensaje parece un error. La última línea suele nombrar la falla." };
    }
    return {
      applicable: false,
      answer: [
        "Pega una función, un archivo corto o un mensaje de error.",
        "",
        "Reviso la estructura: lenguaje probable, funciones y señales concretas (`<= …length`, capturas vacías, `var`, `console.log`, líneas muy largas, TODO).",
      ].join("\n"),
      notes: "",
    };
  }

  const lines = body.split("\n");
  const language = guessLanguage(languageHint, body);
  const functions = [...body.matchAll(/\b(?:function|def|fn)\s+([A-Za-z_]\w*)|([A-Za-z_]\w*)\s*(?:=|:)\s*(?:async\s*)?\([^)]*\)\s*(?:=>|\{)/g)]
    .map((match) => match[1] || match[2])
    .filter(Boolean);
  const warnings: string[] = [];
  if (/<=\s*[\w.]+\.length/.test(body)) {
    warnings.push("Hay un `<= …length`. En listas y arreglos el último índice válido es `length - 1`; ese `<=` suele salirse por uno.");
  }
  if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(body) || /except[^:\n]*:\s*(?:pass)?\s*(?:\n|$)/.test(body)) {
    warnings.push("Hay una captura de error vacía o un `except` que no muestra el fallo. El programa sigue como si nada hubiera pasado.");
  }
  if (/console\.log\(/.test(body) || /\bprint\(/.test(body)) {
    warnings.push("Quedan llamadas de impresión (`console.log` o `print`). Útiles para probar, ruidosas si se quedan.");
  }
  if (/\bvar\s+/.test(body)) {
    warnings.push("Usa `var`. En JavaScript moderno `const` o `let` dejan más claro el alcance.");
  }
  if (/\b(TODO|FIXME)\b/.test(body)) {
    warnings.push("Hay un TODO o FIXME pendiente.");
  }
  const longLine = lines.find((line) => line.length > 100);
  if (longLine) warnings.push("Hay una línea de más de 100 caracteres. Cuesta leerla y revisarla.");
  if (lines.length > 40 && functions.length <= 1) {
    warnings.push("El fragmento es largo y casi no está partido en funciones. Un nombre por responsabilidad lo hace más fácil de probar.");
  }

  const warningBlock = warnings.length
    ? warnings.map((warning) => `- ${warning}`).join("\n")
    : "- No vi las señales que busco (índice fuera por uno, captura vacía, `var`, impresiones, TODO, líneas enormes).";
  const functionBlock = functions.length ? functions.map((name) => `\`${name}\``).join(", ") : "no reconocí nombres de función";
  const answer = [
    `**${language}** · ${lines.length} líneas · ${functions.length} función${functions.length === 1 ? "" : "es"}`,
    "",
    `Funciones: ${functionBlock}.`,
    "",
    warningBlock,
    "",
    "Esto es una lectura estática. No ejecuté el código.",
  ].join("\n");
  return {
    applicable: true,
    answer,
    notes: `Lectura estática (${language}, ${lines.length} líneas). Funciones: ${functionBlock}.\n${warningBlock}`,
  };
}

function guessLanguage(hint: string, body: string): string {
  if (hint) return hint;
  if (/\bdef\s+\w+/.test(body) || /\bimport\s+\w+/.test(body) && /:\n/.test(body)) return "python";
  if (/\bfunction\b|=>|const |let /.test(body)) return "javascript";
  if (/#include|std::/.test(body)) return "c++";
  if (/\bpublic\s+class\b/.test(body)) return "java";
  if (/\bSELECT\b/i.test(body) && /\bFROM\b/i.test(body)) return "sql";
  return "texto con pinta de código";
}
