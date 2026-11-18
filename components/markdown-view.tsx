import type { ReactNode } from "react";

export function MarkdownView({ text }: { text: string }) {
  return <div className="md-body space-y-3">{renderBlocks(text)}</div>;
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
