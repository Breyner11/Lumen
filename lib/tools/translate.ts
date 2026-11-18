import { sentences, STOPWORDS, words } from "@/lib/tools/spanish";

const ENGLISH = new Set(
  "the of and to in is it that for on with as this was at by from be are or an you your we they a he she his her their my our not have has had will can would should could did do does were been being into about after before over under again further then once here there when where why how all any both each few more most other some such no nor only own same so than too very just".split(
    " ",
  ),
);

export async function prepareTranslation(input: string): Promise<{
  applicable: boolean;
  answer: string;
  notes: string;
}> {
  const text = input.trim();
  if (words(text).length < 2) {
    return {
      applicable: false,
      answer:
        "Pega el texto que quieres traducir entre español e inglés. Te lo traduzco y marco los nombres que conviene dejar igual.",
      notes: "",
    };
  }

  const tokens = words(text);
  let spanish = 0;
  let english = 0;
  for (const token of tokens) {
    if (STOPWORDS.has(token) && !ENGLISH.has(token)) spanish += 1;
    if (ENGLISH.has(token)) english += 1;
  }
  const language = english > spanish ? "en" : "es";
  const target = language === "en" ? "es" : "en";
  const languageLabel = language === "en" ? "inglés" : "español";
  const targetLabel = target === "en" ? "inglés" : "español";
  const names = properNouns(text);

  const translated = await translateText(text, language, target);
  if (!translated) {
    const lines = sentences(text).map((sentence, index) => `${index + 1}. ${sentence}`);
    return {
      applicable: false,
      answer: [
        `Detecté **${languageLabel}** → **${targetLabel}**, pero no pude completar la traducción ahora.`,
        "",
        names.length
          ? `Conserva estos nombres: ${names.map((name) => `\`${name}\``).join(", ")}.`
          : "Si hay nombres propios, déjalos igual.",
        "",
        "Oraciones a traducir:",
        "",
        ...lines,
      ].join("\n"),
      notes: "",
    };
  }

  const answer = [
    `**${languageLabel} → ${targetLabel}**`,
    "",
    translated,
    "",
    names.length
      ? `Nombres que conviene revisar y dejar iguales si no tienen forma oficial: ${names.map((name) => `\`${name}\``).join(", ")}.`
      : "No vi nombres propios claros; si hay alguno, comprueba que no se haya traducido de más.",
  ].join("\n");

  return {
    applicable: true,
    answer,
    notes: `Traducción ${language}→${target}. Conservar: ${names.join(", ") || "sin nombres detectados"}.`,
  };
}

async function translateText(text: string, source: "es" | "en", target: "es" | "en"): Promise<string | null> {
  try {
    // MyMemory accepts chunks; keep requests short for reliability.
    const chunks = splitChunks(text, 450);
    const parts: string[] = [];
    for (const chunk of chunks) {
      const url = new URL("https://api.mymemory.translated.net/get");
      url.searchParams.set("q", chunk);
      url.searchParams.set("langpair", `${source}|${target}`);
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        responseStatus?: number;
        responseData?: { translatedText?: string };
      };
      const translated = data.responseData?.translatedText?.trim();
      if (!translated || data.responseStatus !== 200) return null;
      if (/^MYMEMORY WARNING/i.test(translated)) return null;
      parts.push(translated);
    }
    return parts.join("\n\n");
  } catch {
    return null;
  }
}

function splitChunks(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts = sentences(text);
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    if (!current) {
      current = part;
      continue;
    }
    if (`${current} ${part}`.length <= max) current = `${current} ${part}`;
    else {
      chunks.push(current);
      current = part;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text.slice(0, max)];
}

function properNouns(text: string): string[] {
  const found = text.match(/\b[A-ZÁÉÍÓÚÑ][\p{L}\d]{2,}(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}\d]{2,})?/gu) ?? [];
  const unique = [...new Set(found.map((name) => name.trim()))];
  return unique
    .filter((name) => !/^(El|La|Los|Las|Un|Una|The|This|Para|Como|Cuando|Hoy|Mañana)$/.test(name))
    .slice(0, 8);
}
