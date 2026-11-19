export type CitationSource = {
  title: string;
  url: string;
};

export type CitationImage = {
  url: string;
  title?: string;
};

const IMAGES_RE = /:::taller-images\n([\s\S]*?)\n:::/;
const SOURCES_RE = /:::taller-sources\n([\s\S]*?)\n:::/;

export function encodeImagesBlock(images: CitationImage[]): string {
  const lines = images
    .filter((image) => image.url.startsWith("http"))
    .slice(0, 3)
    .map((image) => `${image.url}|${(image.title || "Imagen").replace(/[|\n]/g, " ").slice(0, 120)}`);
  if (!lines.length) return "";
  return `:::taller-images\n${lines.join("\n")}\n:::`;
}

export function encodeSourcesBlock(sources: CitationSource[]): string {
  const lines = sources
    .filter((source) => source.title.trim())
    .slice(0, 12)
    .map((source) => {
      const title = source.title.replace(/[|\n]/g, " ").slice(0, 160);
      const url = source.url.startsWith("http") ? source.url : "";
      return `${title}|${url}`;
    });
  if (!lines.length) return "";
  return `:::taller-sources\n${lines.join("\n")}\n:::`;
}

export function appendCitations(
  answer: string,
  options: { images?: CitationImage[]; sources?: CitationSource[] },
): string {
  const parts = [answer.trim()];
  const images = encodeImagesBlock(options.images ?? []);
  const sources = encodeSourcesBlock(options.sources ?? []);
  if (images) parts.push("", images);
  if (sources) parts.push("", sources);
  return parts.join("\n");
}

export function stripCitationBlocks(text: string): {
  content: string;
  images: CitationImage[];
  sources: CitationSource[];
} {
  let content = text;
  const images: CitationImage[] = [];
  const sources: CitationSource[] = [];

  const imageMatch = IMAGES_RE.exec(content);
  if (imageMatch) {
    for (const line of imageMatch[1].split("\n")) {
      const [url, ...rest] = line.split("|");
      if (url?.startsWith("http")) images.push({ url: url.trim(), title: rest.join("|").trim() || "Imagen" });
    }
    content = content.replace(imageMatch[0], "");
  }

  const sourceMatch = SOURCES_RE.exec(content);
  if (sourceMatch) {
    for (const line of sourceMatch[1].split("\n")) {
      const [title, ...rest] = line.split("|");
      if (!title?.trim()) continue;
      sources.push({ title: title.trim(), url: rest.join("|").trim() });
    }
    content = content.replace(sourceMatch[0], "");
  }

  return {
    content: content.replace(/\n{3,}/g, "\n\n").trim(),
    images: images.slice(0, 3),
    sources: sources.slice(0, 12),
  };
}

export function sourcesFromHits(
  hits: Array<{ title: string; source?: string; url?: string }>,
): CitationSource[] {
  const out: CitationSource[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const urlMatch = (hit.source || hit.url || "").match(/https?:\/\/\S+/);
    const url = hit.url || urlMatch?.[0] || "";
    const title = hit.title || hit.source || "Fuente";
    const key = `${title}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, url });
  }
  return out;
}
