"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlignLeft,
  ArrowUp,
  BookOpen,
  Calculator,
  Code2,
  Languages,
  ListChecks,
  PanelRight,
  PenLine,
  Plus,
  Search,
  Square,
} from "lucide-react";
import { ACTIVITIES, ACTIVITY_MAP, MODEL_LABEL } from "@/lib/activities";
import { composeConversation } from "@/lib/compose";
import type { ActivityId, Effort, ModelId, StoredMessage } from "@/lib/types";
import { MarkdownView } from "@/components/markdown-view";
import { PromptView } from "@/components/prompt-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

const STORAGE_KEY = "taller-receta-v1";
const EMPTY_THREAD: StoredMessage[] = [];
const ICONS = {
  estudiar: BookOpen,
  programar: Code2,
  escribir: PenLine,
  calcular: Calculator,
  organizar: ListChecks,
  traducir: Languages,
  resumir: AlignLeft,
  investigar: Search,
} as const;

type Threads = Partial<Record<ActivityId, StoredMessage[]>>;
type Status = "loading" | "taller" | "model";

export function TallerApp() {
  const [activity, setActivity] = useState<ActivityId>("estudiar");
  const [model, setModel] = useState<ModelId>("flash");
  const [effort, setEffort] = useState<Effort>("high");
  const [thinking, setThinking] = useState(true);
  const [threads, setThreads] = useState<Threads>({});
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [activitiesOpen, setActivitiesOpen] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ready, setReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const current = ACTIVITY_MAP[activity];
  const thread = useMemo(() => threads[activity] ?? EMPTY_THREAD, [threads, activity]);

  // localStorage is read after hydration so the first client render matches the server HTML.
  /* eslint-disable react-hooks/set-state-in-effect -- restoring a saved oficio cannot happen during SSR */
  useEffect(() => {
    const stored = readStorage();
    if (stored) {
      setActivity(stored.activity);
      setModel(stored.model);
      setEffort(stored.effort);
      setThinking(stored.thinking);
      setThreads(stored.threads);
    }
    setReady(true);
    void fetch("/api/status")
      .then((response) => response.json())
      .then((body: { modelReady?: boolean }) => setStatus(body.modelReady ? "model" : "taller"))
      .catch(() => setStatus("taller"));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ activity, model, effort, thinking, threads }),
    );
  }, [activity, model, effort, thinking, threads, ready]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [thread, streaming, activity]);

  const preview = useMemo(() => {
    const history = thread.map((message) => ({ role: message.role, content: message.content }));
    const pending = draft.trim();
    const messages = pending ? [...history, { role: "user" as const, content: pending }] : history;
    return composeConversation({ activity, model, effort, thinking, messages });
  }, [activity, model, effort, thinking, thread, draft]);

  function chooseActivity(next: ActivityId) {
    if (streaming) return;
    setActivity(next);
    setError("");
    setActivitiesOpen(false);
  }

  function clearThread() {
    if (streaming) return;
    setThreads((currentThreads) => ({ ...currentThreads, [activity]: [] }));
    setError("");
  }

  async function send(text = draft) {
    const content = text.trim();
    if (!content || streaming) return;
    setError("");
    const history = [...thread, { role: "user" as const, content }];
    const placeholder: StoredMessage = { role: "assistant", content: "", reasoning: "", mode: "taller" };
    setThreads((currentThreads) => ({ ...currentThreads, [activity]: [...history, placeholder] }));
    setDraft("");
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const target = activity;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activity: target,
          model,
          effort,
          thinking,
          messages: history.map((message) => ({ role: message.role, content: message.content })),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "No pude completar la petición.");
      }
      if (!response.body) throw new Error("La respuesta llegó vacía.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = JSON.parse(trimmed.slice(5)) as {
            type?: string;
            text?: string;
            mode?: "model" | "taller";
            message?: string;
          };
          if (payload.type === "error") {
            setError(payload.message || "Algo falló al responder.");
          } else if (payload.type === "content" || payload.type === "reasoning" || payload.type === "done") {
            setThreads((currentThreads) => {
              const list = currentThreads[target] ?? [];
              const last = list[list.length - 1];
              if (!last || last.role !== "assistant") return currentThreads;
              const next = [...list];
              next[next.length - 1] = {
                ...last,
                content: payload.type === "content" ? last.content + (payload.text ?? "") : last.content,
                reasoning:
                  payload.type === "reasoning" ? `${last.reasoning ?? ""}${payload.text ?? ""}` : last.reasoning,
                mode: payload.type === "done" ? payload.mode ?? last.mode : last.mode,
              };
              return { ...currentThreads, [target]: next };
            });
          }
        }
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      const message = caught instanceof Error ? caught.message : "No pude completar la petición.";
      setError(message);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  const recipe = (
    <RecipePanel
      prompt={preview.prompt}
      modelTitle={MODEL_LABEL[model].recipe}
      copied={copied}
      onCopy={() => {
        void navigator.clipboard.writeText(preview.prompt).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    />
  );

  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card/70 md:flex">
        <div className="px-5 pt-6 pb-4">
          <p className="font-heading text-2xl tracking-tight">Taller</p>
          <p className="mt-1 text-sm text-muted-foreground">Ocho oficios, una receta de DeepSeek.</p>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3" aria-label="Oficios">
          {ACTIVITIES.map((item) => (
            <ActivityButton
              key={item.id}
              id={item.id}
              selected={item.id === activity}
              disabled={streaming}
              onSelect={chooseActivity}
            />
          ))}
        </nav>
        <p className="px-5 py-4 text-xs leading-5 text-muted-foreground">
          Formato de deepseek-recipe 0.2.0, la biblioteca abierta de DeepSeek.
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-3 py-3 md:px-5">
          <Button variant="outline" className="md:hidden" onClick={() => setActivitiesOpen(true)}>
            Oficios
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-lg leading-none">{current.label}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{current.blurb}</p>
          </div>
          <StatusBadge status={status} />
          <Button variant="ghost" size="icon" className="xl:hidden" onClick={() => setRecipeOpen(true)} aria-label="Ver la receta">
            <PanelRight />
          </Button>
          <HowItWorks />
        </header>

        <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-3 py-2 md:px-5">
          <Segment
            label="Modelo"
            current={model}
            options={[
              { id: "flash", label: "Flash" },
              { id: "pro", label: "Pro" },
            ]}
            onChange={(id) => setModel(id as ModelId)}
          />
          <Segment
            label="Esfuerzo"
            current={effort}
            options={[
              { id: "low", label: "Bajo" },
              { id: "high", label: "Alto" },
              { id: "max", label: "Máximo" },
            ]}
            onChange={(id) => setEffort(id as Effort)}
            disabled={!thinking}
          />
          <Button
            variant={thinking ? "secondary" : "outline"}
            size="sm"
            aria-pressed={thinking}
            onClick={() => setThinking((value) => !value)}
          >
            {thinking ? "Pensando" : "Directo"}
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={clearThread} disabled={streaming || thread.length === 0}>
            <Plus />
            Nueva
          </Button>
        </div>

        {status === "taller" && (
          <p className="border-b border-border bg-accent/60 px-3 py-2 text-sm text-accent-foreground md:px-5">
            Modo taller: responde la herramienta de este oficio. Con la app en privado y la clave{" "}
            <span className="font-mono text-xs">DEEPSEEK_API_KEY</span>, la misma conversación la responde DeepSeek.
          </p>
        )}
        {error && (
          <p className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive md:px-5" role="alert">
            {error}
          </p>
        )}

        <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-6 md:px-8">
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {thread.length === 0 ? (
              <EmptyState activityLabel={current.label} blurb={current.blurb} starters={current.starters} onPick={(starter) => void send(starter)} />
            ) : (
              thread.map((message, index) => (
                <MessageBubble key={`${message.role}-${index}`} message={message} pending={streaming && index === thread.length - 1} />
              ))
            )}
          </div>
        </div>

        <form
          className="border-t border-border px-3 py-3 md:px-5"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <label className="sr-only" htmlFor="mensaje">
              Mensaje para {current.label}
            </label>
            <Textarea
              id="mensaje"
              value={draft}
              placeholder={current.placeholder}
              disabled={streaming}
              rows={2}
              className="max-h-40 min-h-16 bg-card"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            {streaming ? (
              <Button type="button" variant="outline" size="icon-lg" aria-label="Detener" onClick={() => abortRef.current?.abort()}>
                <Square />
              </Button>
            ) : (
              <Button type="submit" size="icon-lg" aria-label="Enviar" disabled={!draft.trim()}>
                <ArrowUp />
              </Button>
            )}
          </div>
        </form>
      </div>

      <aside className="hidden w-[22rem] shrink-0 border-l border-border xl:flex xl:flex-col">{recipe}</aside>

      <Sheet open={activitiesOpen} onOpenChange={setActivitiesOpen}>
        <SheetContent side="left" className="w-72">
          <SheetHeader>
            <SheetTitle>Oficios</SheetTitle>
          </SheetHeader>
          <div className="space-y-1 px-3">
            {ACTIVITIES.map((item) => (
              <ActivityButton key={item.id} id={item.id} selected={item.id === activity} disabled={streaming} onSelect={chooseActivity} />
            ))}
          </div>
        </SheetContent>
      </Sheet>
      <Sheet open={recipeOpen} onOpenChange={setRecipeOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Receta</SheetTitle>
          </SheetHeader>
          {recipe}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ActivityButton({
  id,
  selected,
  disabled,
  onSelect,
}: {
  id: ActivityId;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: ActivityId) => void;
}) {
  const item = ACTIVITY_MAP[id];
  const Icon = ICONS[id];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(id)}
      className={`flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors disabled:opacity-50 ${
        selected ? "bg-primary/10 text-foreground" : "hover:bg-muted"
      }`}
      aria-current={selected ? "page" : undefined}
    >
      <span className="mt-0.5 font-mono text-[11px] text-muted-foreground">{item.number}</span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Icon className="size-3.5" />
          {item.label}
        </span>
        <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{item.blurb}</span>
      </span>
    </button>
  );
}

function EmptyState({
  activityLabel,
  blurb,
  starters,
  onPick,
}: {
  activityLabel: string;
  blurb: string;
  starters: string[];
  onPick: (starter: string) => void;
}) {
  return (
    <div className="pt-8">
      <p className="font-heading text-4xl tracking-tight">{activityLabel}</p>
      <p className="mt-3 max-w-md text-base leading-7 text-muted-foreground">{blurb}</p>
      <div className="mt-6 flex flex-col gap-2">
        {starters.map((starter) => (
          <button
            key={starter}
            type="button"
            onClick={() => onPick(starter)}
            className="rounded-xl border border-border bg-card px-4 py-3 text-left text-sm leading-6 hover:border-primary/40"
          >
            {starter.replace(/```[a-z]*\n?|```/g, "").trim()}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message, pending }: { message: StoredMessage; pending: boolean }) {
  const mine = message.role === "user";
  return (
    <article className={mine ? "ml-8" : "mr-8"} aria-live={pending ? "polite" : undefined}>
      <div className={mine ? "rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground" : "rounded-2xl rounded-bl-md border border-border bg-card px-4 py-3"}>
        {!mine && (
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline">{message.mode === "model" ? "DeepSeek" : "Taller"}</Badge>
            {pending && !message.content && <span className="text-xs text-muted-foreground">Preparando la respuesta…</span>}
          </div>
        )}
        {message.reasoning && (
          <details className="mb-3 rounded-lg bg-muted/70 px-3 py-2 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Razonamiento</summary>
            <p className="mt-2 whitespace-pre-wrap">{message.reasoning}</p>
          </details>
        )}
        {mine ? <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p> : <MarkdownView text={message.content || (pending ? "" : "…")} />}
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "loading") return null;
  return <Badge variant={status === "model" ? "default" : "secondary"}>{status === "model" ? "DeepSeek" : "Modo taller"}</Badge>;
}

function Segment({
  label,
  current,
  options,
  onChange,
  disabled,
}: {
  label: string;
  current: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option.id}
          type="button"
          size="sm"
          variant={option.id === current ? "secondary" : "outline"}
          aria-pressed={option.id === current}
          disabled={disabled}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function RecipePanel({
  prompt,
  modelTitle,
  copied,
  onCopy,
}: {
  prompt: string;
  modelTitle: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div>
          <p className="font-heading text-lg">Receta</p>
          <p className="text-xs text-muted-foreground">{modelTitle}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onCopy}>
          {copied ? "Copiada" : "Copiar"}
        </Button>
      </div>
      <p className="px-4 pb-3 text-xs leading-5 text-muted-foreground">
        Así convierte deepseek-recipe la conversación en el prompt del modelo. Los tokens marcados son especiales. Al enviar, el servidor agrega la fecha de Bogotá.
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <PromptView prompt={prompt} />
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Cómo funciona</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>De la conversación al prompt</DialogTitle>
          <DialogDescription>
            DeepSeek publicó deepseek-recipe para que un servicio convierta peticiones de chat al formato de sus modelos V4 y V4.1. Taller usa ese formato.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm leading-6">
          <p>Cada oficio tiene una herramienta local: cuentas, lectura de código, resumen, plan de estudio, pendientes, preparación de una traducción o un esquema de investigación.</p>
          <p>El panel Receta muestra el prompt con los tokens que inserta la versión 0.2.0 de la biblioteca, incluido el esfuerzo de razonamiento.</p>
          <p>Si publicas la app en privado y agregas la clave DEEPSEEK_API_KEY, solo quien inició sesión puede gastar esa clave. El navegador nunca la ve.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function readStorage(): {
  activity: ActivityId;
  model: ModelId;
  effort: Effort;
  thinking: boolean;
  threads: Threads;
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      activity?: ActivityId;
      model?: ModelId;
      effort?: Effort;
      thinking?: boolean;
      threads?: Threads;
    };
    if (!parsed.activity || !(parsed.activity in ACTIVITY_MAP)) return null;
    if (parsed.model !== "flash" && parsed.model !== "pro") return null;
    if (parsed.effort !== "low" && parsed.effort !== "high" && parsed.effort !== "max") return null;
    return {
      activity: parsed.activity,
      model: parsed.model,
      effort: parsed.effort,
      thinking: Boolean(parsed.thinking),
      threads: sanitizeThreads(parsed.threads ?? {}),
    };
  } catch {
    return null;
  }
}

function sanitizeThreads(threads: Threads): Threads {
  const clean: Threads = {};
  for (const activity of Object.keys(ACTIVITY_MAP) as ActivityId[]) {
    const list = threads[activity];
    if (!Array.isArray(list)) continue;
    clean[activity] = list
      .filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
      .slice(-16)
      .map((message) => ({
        role: message.role,
        content: message.content.slice(0, 12_000),
        reasoning: typeof message.reasoning === "string" ? message.reasoning.slice(0, 20_000) : undefined,
        mode: message.mode === "model" ? "model" : message.mode === "taller" ? "taller" : undefined,
      }));
  }
  return clean;
}
