import { sentences, STOPWORDS, words } from "@/lib/tools/spanish";

const ENGLISH = new Set("the of and to in is it that for on with as this was at by from be are or an you your we they a".split(" "));

export function prepareTranslation(input: string): { applicable: boolean; answer: string; notes: string } {
  const text = input.trim();
  if (words(text).length < 4) {
    return {
      applicable: false,
      answer: "Pega el párrafo que quieres traducir. Preparo el idioma probable, los nombres que no se tocan y las oraciones numeradas para trabajarlas una a una.",
      notes: "",
    };
  }
  const tokens = words(text);
  let spanish = 0;
  let english = 0;
  for (const token of tokens) {
    if (STOPWORDS.has(token) && !"the of and to in is it that for on with as this was at by from be are or an you your we they a".split(" ").includes(token)) {
      spanish += 1;
    }
    if (ENGLISH.has(token)) english += 1;
  }
  const language = english > spanish ? "inglés" : "español";
  const target = language === "inglés" ? "español" : "inglés";
  const names = properNouns(text);
  const lines = sentences(text).map((sentence, index) => `${index + 1}. ${sentence}`);
  const answer = [
    `El texto parece **${language}**. La otra columna sería **${target}**.`,
    "",
    names.length
      ? `Nombres o siglas para dejar igual, salvo que tengan una forma ya usada: ${names.map((name) => `\`${name}\``).join(", ")}.`
      : "No vi nombres propios claros. Si hay uno (una persona, una universidad, un producto), no lo traduzcas.",
    "",
    "Oraciones separadas para traducir sin perder el orden:",
    "",
    ...lines,
    "",
    "En modo taller no invento la traducción. Con DeepSeek conectado, esta misma estación la escribe completa y conserva esos nombres.",
  ].join("\n");
  return {
    applicable: true,
    answer,
    notes: `Idioma probable: ${language}. Traducir hacia ${target}. Conservar: ${names.join(", ") || "sin nombres detectados"}.`,
  };
}

function properNouns(text: string): string[] {
  const found = text.match(/\b[A-ZÁÉÍÓÚÑ][\p{L}\d]{2,}(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}\d]{2,})?/gu) ?? [];
  const unique = [...new Set(found.map((name) => name.trim()))];
  return unique.filter((name) => !/^(El|La|Los|Las|Un|Una|The|This|Para|Como|Cuando|Hoy|Mañana)$/.test(name)).slice(0, 8);
}
