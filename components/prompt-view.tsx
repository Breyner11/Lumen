"use client";

import { PROMPT_TOKENS } from "@/lib/recipe-prompt";

const pattern = new RegExp(`(${PROMPT_TOKENS.map(escapeRegExp).join("|")})`, "g");

export function PromptView({ prompt }: { prompt: string }) {
  const parts = prompt.split(pattern);
  return (
    <pre className="font-mono text-[12.5px] leading-5 whitespace-pre-wrap break-words text-foreground">
      {parts.map((part, index) =>
        PROMPT_TOKENS.includes(part as (typeof PROMPT_TOKENS)[number]) ? (
          <mark key={`${part}-${index}`} className="rounded bg-copper/15 px-0.5 text-copper-ink">
            {part}
          </mark>
        ) : (
          <span key={`${index}-${part.slice(0, 12)}`}>{part}</span>
        ),
      )}
    </pre>
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
