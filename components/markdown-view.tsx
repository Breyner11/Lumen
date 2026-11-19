"use client";

import { useState, type ReactNode } from "react";
import { ExternalLink, Link2, X } from "lucide-react";
import { stripCitationBlocks } from "@/lib/rag/citations";

export function MarkdownView({
  text,
  images: imagesProp,
  sources: sourcesProp,
}: {
  text: string;
  images?: Array<{ url: string; title?: string }>;
  sources?: Array<{ title: string; url: string }>;
}) {
  const { thinking, content: afterThink } = splitThinking(text);
  const stripped = stripCitationBlocks(afterThink);
  const content = stripped.content;
  const images = imagesProp?.length ? imagesProp : stripped.images;
  const sources = sourcesProp?.length ? sourcesProp : stripped.sources;
  const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(null);

  return (
    <div className="md-body space-y-3">
      {thinking ? (
        <details className="rounded-xl border border-border/80 bg-muted/40 px-3 py-2">
          <summary className="cursor-pointer select-none text-sm font-medium text-muted-foreground">
            Pensando…
          </summary>
          <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{thinking}</div>
        </details>
      ) : null}

      {images.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((image) => (
            <button
              key={image.url}
              type="button"
              className="group relative h-24 w-32 shrink-0 overflow-hidden rounded-xl border border-border bg-muted/40"
              onClick={() => setLightbox({ url: image.url, title: image.title || "Imagen" })}
              aria-label={`Ver imagen: ${image.title || "resultado"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={image.title || "Imagen de la web"}
                className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={(event) => {
                  (event.currentTarget.parentElement as HTMLElement | null)?.style.setProperty("display", "none");
                }}
              />
            </button>
          ))}
        </div>
      ) : null}

      {renderBlocks(content)}

      {sources.length > 0 ? (
        <details className="rounded-xl border border-border/80 bg-card/70 px-3 py-2 shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-foreground">
            <Link2 className="size-3.5 text-muted-foreground" />
            Fuentes ({sources.length})
          </summary>
          <ul className="mt-2 space-y-2 border-t border-border/60 pt-2">
            {sources.map((source, index) => (
              <li key={`${source.title}-${index}`} className="text-sm leading-5">
                {source.url ? (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-start gap-1.5 text-foreground underline-offset-2 hover:underline"
                  >
                    <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span>{source.title}</span>
                  </a>
                ) : (
                  <span className="text-muted-foreground">{source.title}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {lightbox ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.title}
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-black"
            aria-label="Cerrar imagen"
            onClick={() => setLightbox(null)}
          >
            <X className="size-4" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox.url}
            alt={lightbox.title}
            className="max-h-[85vh] max-w-[92vw] rounded-2xl object-contain shadow-2xl"
            referrerPolicy="no-referrer"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}

function splitThinking(source: string): { thinking?: string; content: string } {
  const match = /<think>([\s\S]*?)<\/think>/i.exec(source);
  if (!match) return { content: source };
  return {
    thinking: match[1]?.trim() || undefined,
    content: source.replace(match[0], "").trim(),
  };
}

function renderBlocks(source: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const chunks = source.split(/```/);
  chunks.forEach((chunk, index) => {
    if (index % 2 === 1) {
      const newline = chunk.indexOf("\n");
      const code = newline === -1 ? chunk : chunk.slice(newline + 1);
      nodes.push(
        <pre key={`code-${index}`} className="overflow-x-auto rounded-lg bg-ink/5 px-3 py-2 font-mono text-[13px] leading-5">
          <code>{code.replace(/\n$/, "")}</code>
        </pre>,
      );
      return;
    }
    nodes.push(...renderText(chunk, index));
  });
  return nodes;
}

function renderText(source: string, keyBase: number): ReactNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let quote: string[] = [];
  let paragraph: string[] = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (!text) return;
    nodes.push(<p key={`p-${keyBase}-${nodes.length}`}>{inline(text)}</p>);
  }
  function flushList() {
    if (!list) return;
    const current = list;
    list = null;
    const Tag = current.ordered ? "ol" : "ul";
    nodes.push(
      <Tag key={`l-${keyBase}-${nodes.length}`} className={current.ordered ? "list-decimal pl-5" : "list-disc pl-5"}>
        {current.items.map((item, itemIndex) => (
          <li key={itemIndex} className="pl-1">
            {inline(item)}
          </li>
        ))}
      </Tag>,
    );
  }
  function flushQuote() {
    if (!quote.length) return;
    const text = quote.join(" ");
    quote = [];
    nodes.push(
      <blockquote key={`q-${keyBase}-${nodes.length}`} className="border-l-2 border-copper/50 pl-3 text-muted-foreground">
        {inline(text)}
      </blockquote>,
    );
  }

  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    const quoted = /^>\s?(.*)$/.exec(line);
    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushQuote();
      continue;
    }
    if (heading) {
      flushParagraph();
      flushList();
      flushQuote();
      const level = heading[1].length;
      const Tag = level === 1 ? "h3" : level === 2 ? "h4" : "h5";
      nodes.push(
        <Tag key={`h-${keyBase}-${nodes.length}`} className="font-heading text-base font-semibold tracking-tight">
          {inline(heading[2])}
        </Tag>,
      );
      continue;
    }
    if (bullet || numbered) {
      flushParagraph();
      flushQuote();
      const ordered = Boolean(numbered);
      const item = (bullet ?? numbered)![1];
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [item] };
      } else {
        list.items.push(item);
      }
      continue;
    }
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  flushQuote();
  return nodes;
}

function inline(source: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(escapeText(source.slice(last, index)));
    const token = match[0];
    if (token.startsWith("**")) nodes.push(<strong key={index}>{escapeText(token.slice(2, -2))}</strong>);
    else if (token.startsWith("`")) {
      nodes.push(
        <code key={index} className="rounded bg-ink/5 px-1 py-0.5 font-mono text-[0.92em]">
          {escapeText(token.slice(1, -1))}
        </code>,
      );
    } else if (token.startsWith("*")) nodes.push(<em key={index}>{escapeText(token.slice(1, -1))}</em>);
    else {
      const linked = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
      if (linked) {
        nodes.push(
          <a key={index} href={linked[2]} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {escapeText(linked[1])}
          </a>,
        );
      }
    }
    last = index + token.length;
  }
  if (last < source.length) nodes.push(escapeText(source.slice(last)));
  return nodes;
}

function escapeText(value: string): string {
  return value;
}
