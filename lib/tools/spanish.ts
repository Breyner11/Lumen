export const STOPWORDS = new Set(
  `a al algo algunas algunos ante aquel aquella aquellas aquellos como con contra cual cuales cuando de del desde donde dos el ella ellas ellos en entre era erais eran eres es esa esas ese eso esos esta estas este esto estos fue fui ha han hasta hay la las le les lo los mas más me mi mis mucho muy no nos o para pero poco por porque que quien se ser si sin sobre su sus te tiene ti tu tus un una uno y ya the of and to in is it that for on with as this was at by from be are or an`.split(
    /\s+/,
  ),
);

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .match(/[a-z0-9áéíóúüñ]+/giu)
    ?.map((word) => word) ?? [];
}

export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "indefinido";
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  if (Object.is(rounded, -0)) return "0";
  return rounded.toLocaleString("es-CO", { maximumFractionDigits: 6 });
}
