import { formatNumber } from "@/lib/tools/spanish";

type Expr =
  | { type: "num"; value: number }
  | { type: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: Expr; right: Expr }
  | { type: "neg"; inner: Expr }
  | { type: "sqrt"; inner: Expr };

class ParseError extends Error {}

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  const pattern = /\s+|√|raiz(?:\s+cuadrada)?|sqrt|[0-9]+(?:[.,][0-9]+)?|[+*/^()\-]|×|÷/gi;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index !== cursor) {
      throw new ParseError("No reconozco una parte de la cuenta.");
    }
    cursor = match.index + match[0].length;
    if (!/^\s+$/.test(match[0])) tokens.push(match[0]);
  }
  if (cursor !== source.length) throw new ParseError("No reconozco una parte de la cuenta.");
  return insertImplicitMultiplication(tokens);
}

/** Turns `2sqrt(9)`, `2(3)` or `)( ` into multiplications. */
function insertImplicitMultiplication(tokens: string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index]!;
    const previous = out[out.length - 1];
    if (previous && needsImplicitMultiply(previous, current)) out.push("*");
    out.push(current);
  }
  return out;
}

function needsImplicitMultiply(left: string, right: string): boolean {
  // sqrt/raiz are prefix operators; never invent a * after them.
  if (/^raiz|^sqrt|^√/i.test(left)) return false;
  const leftEndsValue = /^[0-9]/.test(left) || left === ")";
  const rightStartsValue =
    /^[0-9]/.test(right) || right === "(" || /^raiz|^sqrt|^√/i.test(right);
  return leftEndsValue && rightStartsValue;
}

function parseExpression(source: string): number {
  const tokens = tokenize(source);
  let index = 0;

  function peek(): string | undefined {
    return tokens[index];
  }
  function take(): string {
    const token = tokens[index];
    if (token === undefined) throw new ParseError("La cuenta se corta antes de tiempo.");
    index += 1;
    return token;
  }

  function parseExpr(): Expr {
    let left = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = take() as "+" | "-";
      const right = parseTerm();
      left = { type: "bin", op, left, right };
    }
    return left;
  }

  function parseTerm(): Expr {
    let left = parsePow();
    while (peek() === "*" || peek() === "/" || peek() === "×" || peek() === "÷") {
      const raw = take();
      const op = raw === "×" ? "*" : raw === "÷" ? "/" : (raw as "*" | "/");
      left = { type: "bin", op, left, right: parsePow() };
    }
    return left;
  }

  function parsePow(): Expr {
    const left = parseUnary();
    if (peek() === "^") {
      take();
      return { type: "bin", op: "^", left, right: parsePow() };
    }
    return left;
  }

  function parseUnary(): Expr {
    if (peek() === "-") {
      take();
      return { type: "neg", inner: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary(): Expr {
    const token = peek();
    if (token === undefined) throw new ParseError("Falta un número.");
    if (/^raiz|^sqrt|^√/i.test(token)) {
      take();
      if (peek() === "(") {
        take();
        const inner = parseExpr();
        if (take() !== ")") throw new ParseError("Falta cerrar el paréntesis de la raíz.");
        return { type: "sqrt", inner };
      }
      return { type: "sqrt", inner: parseUnary() };
    }
    if (token === "(") {
      take();
      const inner = parseExpr();
      if (take() !== ")") throw new ParseError("Falta cerrar un paréntesis.");
      return inner;
    }
    if (/^[0-9]/.test(token)) {
      take();
      return { type: "num", value: Number(token.replace(",", ".")) };
    }
    throw new ParseError("No reconozco una parte de la cuenta.");
  }

  const tree = parseExpr();
  if (index !== tokens.length) throw new ParseError("Sobran símbolos al final de la cuenta.");
  return evaluate(tree);
}

function evaluate(expr: Expr): number {
  if (expr.type === "num") return expr.value;
  if (expr.type === "neg") return -evaluate(expr.inner);
  if (expr.type === "sqrt") {
    const value = evaluate(expr.inner);
    if (value < 0) throw new ParseError("No saco la raíz cuadrada de un número negativo.");
    return Math.sqrt(value);
  }
  const left = evaluate(expr.left);
  const right = evaluate(expr.right);
  if (expr.op === "+") return left + right;
  if (expr.op === "-") return left - right;
  if (expr.op === "*") return left * right;
  if (expr.op === "^") return left ** right;
  if (right === 0) throw new ParseError("No se puede dividir entre cero.");
  return left / right;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

function percentage(percent: number, whole: number): string {
  const value = (percent / 100) * whole;
  return [
    `**${formatNumber(value)}**`,
    "",
    `El ${formatNumber(percent)}% de ${formatNumber(whole)} es ${formatNumber(whole)} × ${formatNumber(percent / 100)}.`,
    "",
    `1. ${formatNumber(percent)}% = ${formatNumber(percent)}/100 = ${formatNumber(percent / 100)}`,
    `2. ${formatNumber(whole)} × ${formatNumber(percent / 100)} = **${formatNumber(value)}**`,
  ].join("\n");
}

function linearEquation(raw: string): string | null {
  const match = raw.match(
    /^\s*(?:resuelve\s+)?(-?\d*(?:[.,]\d+)?)?\s*x\s*(?:([+-])\s*(\d+(?:[.,]\d+)?))?\s*=\s*(-?\d+(?:[.,]\d+)?)\s*\??\s*$/i,
  );
  if (!match) return null;
  const coefRaw = match[1];
  const coefficient = coefRaw === undefined || coefRaw === "" || coefRaw === "-" || coefRaw === "+"
    ? (coefRaw === "-" ? -1 : 1)
    : Number(coefRaw.replace(",", "."));
  const sign = match[2];
  const constant = match[3] ? Number(match[3].replace(",", ".")) : 0;
  const right = Number((match[4] ?? "0").replace(",", "."));
  const signedConstant = sign === "-" ? -constant : constant;
  if (coefficient === 0) {
    return "El término con x tiene coeficiente 0, así que no hay una incógnita que despejar.";
  }
  const isolated = right - signedConstant;
  const solution = isolated / coefficient;
  const check = coefficient * solution + signedConstant;
  return [
    `**x = ${formatNumber(solution)}**`,
    "",
    `1. ${formatNumber(coefficient)}x ${signedConstant < 0 ? "−" : "+"} ${formatNumber(Math.abs(signedConstant))} = ${formatNumber(right)}`,
    `2. ${formatNumber(coefficient)}x = ${formatNumber(right)} − (${formatNumber(signedConstant)}) = ${formatNumber(isolated)}`,
    `3. x = ${formatNumber(isolated)} / ${formatNumber(coefficient)} = **${formatNumber(solution)}**`,
    `4. Comprobación: ${formatNumber(coefficient)}(${formatNumber(solution)}) ${signedConstant < 0 ? "−" : "+"} ${formatNumber(Math.abs(signedConstant))} = ${formatNumber(check)}`,
  ].join("\n");
}

function normalizeExpression(source: string): string {
  return source
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/√/g, "sqrt")
    .replace(/ra[ií]z(?:\s+cuadrada)?(?:\s+de)?/gi, "sqrt")
    .replace(/(\d)\s*(sqrt)/gi, "$1*$2")
    .replace(/(sqrt)\s*\(/gi, "sqrt(")
    .trim();
}

function looksLikeExpression(source: string): boolean {
  const compact = source.replace(/\s+/g, "");
  if (!/\d/.test(compact)) return false;
  if (!/^[0-9+\-*/^().,sqrt×÷√]+$/i.test(compact)) return false;
  return /[+\-*/^×÷]|sqrt|√/i.test(compact);
}

function formatExpressionAnswer(original: string, value: number): string {
  return [
    `**${formatNumber(value)}**`,
    "",
    `\`${original}\` = **${formatNumber(value)}**`,
    "",
    "Prioridad: potencias y raíces, luego × y ÷, después + y − (de izquierda a derecha).",
  ].join("\n");
}

export function solveMath(input: string): { applicable: boolean; answer: string } {
  const text = input.trim();
  if (!text) {
    return { applicable: false, answer: mathHelp() };
  }

  const percent = text.match(
    /(-?\d+(?:[.,]\d+)?)\s*%\s*(?:de|del|sobre)\s*(-?\d+(?:[.,]\d+)?)/i,
  );
  if (percent) {
    return {
      applicable: true,
      answer: percentage(Number(percent[1].replace(",", ".")), Number(percent[2].replace(",", "."))),
    };
  }

  const bump = text.match(
    /(aumenta|incrementa|sube|descuenta|resta|disminuye)\s+(-?\d+(?:[.,]\d+)?)\s*(?:en\s+)?(?:un\s+)?(-?\d+(?:[.,]\d+)?)\s*%/i,
  );
  if (bump) {
    const base = Number(bump[2].replace(",", "."));
    const percentValue = Number(bump[3].replace(",", "."));
    const increase = /aumenta|incrementa|sube/i.test(bump[1]);
    const delta = (base * percentValue) / 100;
    const result = increase ? base + delta : base - delta;
    return {
      applicable: true,
      answer: [
        `**${formatNumber(result)}**`,
        "",
        `${increase ? "Aumento" : "Descuento"} del ${formatNumber(percentValue)}% sobre ${formatNumber(base)}.`,
        "",
        `1. El ${formatNumber(percentValue)}% de ${formatNumber(base)} es ${formatNumber(delta)}`,
        `2. ${formatNumber(base)} ${increase ? "+" : "−"} ${formatNumber(delta)} = **${formatNumber(result)}**`,
      ].join("\n"),
    };
  }

  const factors = text.match(/\b(mcd|mcm)\b(?:\s+de)?\s+(-?\d+)\s*(?:y|,)\s*(-?\d+)/i);
  if (factors) {
    const left = Number(factors[2]);
    const right = Number(factors[3]);
    const divisor = gcd(left, right);
    if (/mcd/i.test(factors[1])) {
      return {
        applicable: true,
        answer: [
          `**${formatNumber(divisor)}**`,
          "",
          `El máximo común divisor de ${formatNumber(left)} y ${formatNumber(right)} se obtiene con el algoritmo de Euclides.`,
          "",
          `1. Se divide el mayor entre el menor y se conserva el residuo.`,
          `2. Cuando el residuo es 0, el divisor anterior es el mcd: **${formatNumber(divisor)}**.`,
        ].join("\n"),
      };
    }
    const multiple = divisor === 0 ? 0 : Math.abs(left * right) / divisor;
    return {
      applicable: true,
      answer: [
        `**${formatNumber(multiple)}**`,
        "",
        `mcm(${formatNumber(left)}, ${formatNumber(right)}) = |${formatNumber(left)} × ${formatNumber(right)}| / mcd(${formatNumber(left)}, ${formatNumber(right)}).`,
        "",
        `1. mcd = ${formatNumber(divisor)}`,
        `2. |${formatNumber(left * right)}| / ${formatNumber(divisor)} = **${formatNumber(multiple)}**`,
      ].join("\n"),
    };
  }

  const equation = linearEquation(
    text.replace(/^(?:resuelve|calcula|cu[aá]nto es|cu[aá]l es)\s+/i, ""),
  );
  if (equation) return { applicable: true, answer: equation };

  const stripped = text
    .replace(/^(?:cu[aá]nto es|calcula|calcule|resuelve|cu[aá]l es(?: el resultado de)?)\s+/i, "")
    .replace(/[?¿]/g, "")
    .trim();
  const normalized = normalizeExpression(stripped);

  // Full arithmetic expressions must win over word-helpers like "50+20…".
  if (looksLikeExpression(normalized)) {
    try {
      const value = parseExpression(normalized);
      return { applicable: true, answer: formatExpressionAnswer(stripped, value) };
    } catch (error) {
      const message = error instanceof ParseError ? error.message : "No pude resolver esa cuenta.";
      return { applicable: false, answer: `${message}\n\n${mathHelp()}` };
    }
  }

  const wordProblem = solveWordProblem(text);
  if (wordProblem) return wordProblem;

  if (!/^[\d\s+\-*/^().,a-z]+$/i.test(normalized) || !/\d/.test(normalized)) {
    return { applicable: false, answer: mathHelp() };
  }
  try {
    const value = parseExpression(normalized);
    return { applicable: true, answer: formatExpressionAnswer(stripped, value) };
  } catch (error) {
    const message = error instanceof ParseError ? error.message : "No pude resolver esa cuenta.";
    return { applicable: false, answer: `${message}\n\n${mathHelp()}` };
  }
}

function solveWordProblem(text: string): { applicable: boolean; answer: string } | null {
  const lower = text.toLowerCase();

  // "cuántas patas tienen 3 elefantes y 2 mesas"
  if (/patas?|piernas?|ruedas?|ojos?|manos?/.test(lower)) {
    const unit = /patas?/.test(lower)
      ? "pata"
      : /piernas?/.test(lower)
        ? "pierna"
        : /ruedas?/.test(lower)
          ? "rueda"
          : /ojos?/.test(lower)
            ? "ojo"
            : "mano";
    const legsPer: Record<string, number> = {
      elefante: 4,
      elefantes: 4,
      perro: 4,
      perros: 4,
      gato: 4,
      gatos: 4,
      caballo: 4,
      caballos: 4,
      vaca: 4,
      vacas: 4,
      mesa: 4,
      mesas: 4,
      silla: 4,
      sillas: 4,
      persona: 2,
      personas: 2,
      humano: 2,
      humanos: 2,
      pajaro: 2,
      pajaros: 2,
      pájaro: 2,
      pájaros: 2,
      bicicleta: 2,
      bicicletas: 2,
      auto: 4,
      autos: 4,
      carro: 4,
      carros: 4,
      coche: 4,
      coches: 4,
      triciclo: 3,
      triciclos: 3,
    };
    const parts = [...lower.matchAll(/(\d+)\s+([a-záéíóúüñ]+)/gi)];
    const lines: string[] = [];
    let total = 0;
    for (const part of parts) {
      const count = Number(part[1]);
      const noun = part[2];
      const per = legsPer[noun];
      if (!per) continue;
      const subtotal = count * per;
      total += subtotal;
      lines.push(`${formatNumber(count)} ${noun} × ${formatNumber(per)} = ${formatNumber(subtotal)}`);
    }
    if (lines.length) {
      return {
        applicable: true,
        answer: [
          `**${formatNumber(total)} ${unit}${total === 1 ? "" : "s"}**`,
          "",
          ...lines.map((line, index) => `${index + 1}. ${line}`),
          `Total: **${formatNumber(total)}**`,
        ].join("\n"),
      };
    }
  }

  // "si tengo 3 manzanas y compro 5"
  const haveBuy = lower.match(
    /(?:tengo|hay)\s+(\d+)\s+\w+\s+y\s+(?:compro|agrego|sumo|añado|anado)\s+(\d+)/i,
  );
  if (haveBuy) {
    const a = Number(haveBuy[1]);
    const b = Number(haveBuy[2]);
    return {
      applicable: true,
      answer: [
        `**${formatNumber(a + b)}**`,
        "",
        `1. Empiezas con ${formatNumber(a)}`,
        `2. Sumas ${formatNumber(b)}`,
        `3. ${formatNumber(a)} + ${formatNumber(b)} = **${formatNumber(a + b)}**`,
      ].join("\n"),
    };
  }

  // "la mitad de 48" / "el doble de 7" / "el triple de 9"
  const half = lower.match(/(?:la\s+)?mitad\s+de\s+(-?\d+(?:[.,]\d+)?)/i);
  if (half) {
    const value = Number(half[1].replace(",", ".")) / 2;
    return {
      applicable: true,
      answer: `**${formatNumber(value)}**\n\nLa mitad de ${half[1]} es ${half[1]} ÷ 2 = **${formatNumber(value)}**.`,
    };
  }
  const double = lower.match(/(?:el\s+)?doble\s+de\s+(-?\d+(?:[.,]\d+)?)/i);
  if (double) {
    const value = Number(double[1].replace(",", ".")) * 2;
    return {
      applicable: true,
      answer: `**${formatNumber(value)}**\n\nEl doble de ${double[1]} es ${double[1]} × 2 = **${formatNumber(value)}**.`,
    };
  }
  const triple = lower.match(/(?:el\s+)?triple\s+de\s+(-?\d+(?:[.,]\d+)?)/i);
  if (triple) {
    const value = Number(triple[1].replace(",", ".")) * 3;
    return {
      applicable: true,
      answer: `**${formatNumber(value)}**\n\nEl triple de ${triple[1]} es ${triple[1]} × 3 = **${formatNumber(value)}**.`,
    };
  }

  // Only when the whole phrase is a simple product/sum in words — never a longer formula.
  const product = lower.match(
    /^(?:cu[aá]nto\s+(?:es|da)\s+)?(-?\d+(?:[.,]\d+)?)\s*(?:por|×)\s*(-?\d+(?:[.,]\d+)?)\s*$/i,
  );
  if (product && !/%/.test(lower)) {
    const a = Number(product[1].replace(",", "."));
    const b = Number(product[2].replace(",", "."));
    return {
      applicable: true,
      answer: `**${formatNumber(a * b)}**\n\n${formatNumber(a)} × ${formatNumber(b)} = **${formatNumber(a * b)}**.`,
    };
  }
  const sum = lower.match(
    /^(?:cu[aá]nto\s+(?:es|da)\s+)?(-?\d+(?:[.,]\d+)?)\s*(?:mas|más|\+)\s*(-?\d+(?:[.,]\d+)?)\s*$/i,
  );
  if (sum) {
    const a = Number(sum[1].replace(",", "."));
    const b = Number(sum[2].replace(",", "."));
    return {
      applicable: true,
      answer: `**${formatNumber(a + b)}**\n\n${formatNumber(a)} + ${formatNumber(b)} = **${formatNumber(a + b)}**.`,
    };
  }

  return null;
}

function mathHelp(): string {
  return [
    "Puedo resolver la cuenta aquí mismo, sin el modelo:",
    "",
    "- un porcentaje: «15% de 240» o «aumenta 240 en un 15%»",
    "- una operación: «(3 + 5) × 2» o «2^10»",
    "- una ecuación lineal: «2x + 5 = 17»",
    "- mcd o mcm: «mcd de 48 y 18»",
    "- una raíz: «raíz cuadrada de 144»",
    "- un problema en palabras: «cuántas patas tienen 3 elefantes y 2 mesas»",
    "",
    "Escribe una de esas formas y la desarrollo paso a paso.",
  ].join("\n");
}
