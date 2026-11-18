"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlignLeft,
  ArrowUp,
  BookOpen,
  Calculator,
  Clock3,
  Code2,
  History,
  Languages,
  ListChecks,
  Palette,
  PanelRight,
  PenLine,
  Plus,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import { ACTIVITIES, ACTIVITY_MAP, MODEL_LABEL } from "@/lib/activities";
import { composeConversation } from "@/lib/compose";
import { formatHistoryTime, pushHistory, sanitizeHistory, type HistoryEntry } from "@/lib/history";
import { isSkinId, SKINS, type SkinId } from "@/lib/skins";
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

const STORAGE_KEY = "taller-receta-v2";
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
  const [skin, setSkin] = useState<SkinId>("brisa");
  const [threads, setThreads] = useState<Threads>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [activitiesOpen, setActivitiesOpen] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [skinsOpen, setSkinsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ready, setReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const current = ACTIVITY_MAP[activity];
  const thread = useMemo(() => threads[activity] ?? EMPTY_THREAD, [threads, activity]);

  /* eslint-disable react-hooks/set-state-in-effect -- restore localStorage after hydration */
  useEffect(() => {
    const stored = readStorage();
    if (stored) {
      setActivity(stored.activity);
      setModel(stored.model);
      setEffort(stored.effort);
      setThinking(stored.thinking);
      setSkin(stored.skin);
      setThreads(stored.threads);
      setHistory(stored.history);
      document.documentElement.dataset.skin = stored.skin;
    } else {
      document.documentElement.dataset.skin = "brisa";
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
    document.documentElement.dataset.skin = skin;
  }, [skin, ready]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ activity, model, effort, thinking, skin, threads, history }),
    );
  }, [activity, model, effort, thinking, skin, threads, history, ready]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [thread, streaming, activity]);

  const preview = useMemo(() => {
    const historyTurns = thread.map((message) => ({ role: message.role, content: message.content }));
    const pending = draft.trim();
    const messages = pending ? [...historyTurns, { role: "user" as const, content: pending }] : historyTurns;
    return composeConversation({ activity, model, effort, thinking, messages });
  }, [activity, model, effort, thinking, thread, draft]);

  function chooseActivity(next: ActivityId) {
    if (streaming) return;
    setActivity(next);
    setError("");
    setActivitiesOpen(false);
  }

  function chooseSkin(next: SkinId) {
    setSkin(next);
    document.documentElement.dataset.skin = next;
  }

  function clearThread() {
    if (streaming) return;
    setThreads((currentThreads) => ({ ...currentThreads, [activity]: [] }));
    setError("");
  }

  function clearHistory() {
    setHistory([]);
  }

  function reopenHistory(entry: HistoryEntry) {
    if (streaming) return;
    setActivity(entry.activity);
    setHistoryOpen(false);
    setDraft(entry.query);
  }

  async function send(text = draft) {
    const content = text.trim();
    if (!content || streaming) return;
    setError("");
    const historyTurns = [...thread, { role: "user" as const, content }];
    const placeholder: StoredMessage = { role: "assistant", content: "", reasoning: "", mode: "taller" };
    setThreads((currentThreads) => ({ ...currentThreads, [activity]: [...historyTurns, placeholder] }));
    setDraft("");
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const target = activity;
    let answerPreview = "";
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activity: target,
          model,
          effort,
          thinking,
          messages: historyTurns.map((message) => ({ role: message.role, content: message.content })),
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
            if (payload.type === "content" && payload.text) answerPreview += payload.text;
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
      setHistory((entries) =>
        pushHistory(entries, {
          activity: target,
          query: content,
          preview: answerPreview.replace(/\*\*/g, "").replace(/\s+/g, " ").trim() || "Respuesta del taller",
        }),
      );
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

  const historyList = (
    <HistoryPanel
      entries={history}
      onOpen={reopenHistory}
      onClear={clearHistory}
      disabled={streaming}
    />
  );

  return (
    <div className="flex h-dvh text-foreground">
      <aside className="glass-panel m-3 hidden w-[17.5rem] shrink-0 flex-col overflow-hidden rounded-[1.4rem] md:flex">
        <div className="px-5 pt-6 pb-4">
          <p className="font-heading text-[2rem] leading-none tracking-tight italic">Taller</p>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">Ocho oficios. Elige una cara y pregunta.</p>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-3" aria-label="Oficios">
          {ACTIVITIES.map((item, index) => (
            <ActivityButton
              key={item.id}
              id={item.id}
              selected={item.id === activity}
              disabled={streaming}
              onSelect={chooseActivity}
              delay={index * 40}
            />
          ))}
        </nav>
        <div className="space-y-2 border-t border-border/70 px-3 py-3">
          <Button variant="outline" className="w-full justify-start" onClick={() => setSkinsOpen(true)}>
            <Palette />
            Interfaces
          </Button>
          <Button variant="ghost" className="w-full justify-start" onClick={() => setHistoryOpen(true)}>
            <History />
            Historial
            {history.length > 0 && <Badge className="ml-auto" variant="secondary">{history.length}</Badge>}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mx-3 mt-3 flex items-center gap-2 rounded-[1.2rem] px-3 py-3 glass-panel md:mx-0 md:mt-3 md:mr-3 md:px-5">
          <Button variant="outline" className="md:hidden titlebar-no-drag" onClick={() => setActivitiesOpen(true)}>
            Oficios
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-xl leading-none italic md:text-2xl">{current.label}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground md:text-sm">{current.blurb}</p>
          </div>
          <StatusBadge status={status} />
          <Button variant="ghost" size="icon" className="xl:hidden" onClick={() => setRecipeOpen(true)} aria-label="Ver la receta">
            <PanelRight />
          </Button>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setHistoryOpen(true)} aria-label="Historial">
            <History />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setSkinsOpen(true)} aria-label="Interfaces">
            <Palette />
          </Button>
          <HowItWorks />
        </header>

        <div className="mx-3 mt-2 flex items-center gap-2 overflow-x-auto rounded-[1.1rem] px-3 py-2 glass-panel md:mx-0 md:mr-3">
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
          <p className="mx-3 mt-2 rounded-xl bg-accent/70 px-3 py-2 text-sm text-accent-foreground md:mx-0 md:mr-3">
            Modo taller: cada oficio responde aquí. Prueba las interfaces con el botón de paleta.
          </p>
        )}
        {error && (
          <p className="mx-3 mt-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive md:mx-0 md:mr-3" role="alert">
            {error}
          </p>
        )}

        <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-5 md:px-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {thread.length === 0 ? (
              <WelcomeState
                activityLabel={current.label}
                starters={current.starters}
                recent={history.filter((entry) => entry.activity === activity).slice(0, 3)}
                onPick={(starter) => void send(starter)}
                onOpenHistory={reopenHistory}
                onBrowseSkins={() => setSkinsOpen(true)}
              />
            ) : (
              thread.map((message, index) => (
                <MessageBubble
                  key={`${message.role}-${index}`}
                  message={message}
                  pending={streaming && index === thread.length - 1}
                  delay={Math.min(index, 4) * 40}
                />
              ))
            )}
          </div>
        </div>

        <form
          className="mx-3 mb-3 rounded-[1.3rem] px-3 py-3 glass-panel md:mx-0 md:mr-3 md:mb-3"
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
              className="max-h-40 min-h-16 border-0 bg-transparent shadow-none focus-visible:ring-0"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            {streaming ? (
              <Button type="button" variant="outline" size="icon-lg" className="brand-mark" aria-label="Detener" onClick={() => abortRef.current?.abort()}>
                <Square />
              </Button>
            ) : (
              <Button type="submit" size="icon-lg" className="brand-mark" aria-label="Enviar" disabled={!draft.trim()}>
                <ArrowUp />
              </Button>
            )}
          </div>
        </form>
      </div>

      <aside className="m-3 ml-0 hidden w-[22rem] shrink-0 overflow-hidden rounded-[1.4rem] glass-panel xl:flex xl:flex-col">
        {recipe}
      </aside>

      <Sheet open={activitiesOpen} onOpenChange={setActivitiesOpen}>
        <SheetContent side="left" className="w-80">
          <SheetHeader>
            <SheetTitle className="font-heading italic">Oficios</SheetTitle>
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
            <SheetTitle className="font-heading italic">Receta</SheetTitle>
          </SheetHeader>
          {recipe}
        </SheetContent>
      </Sheet>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="font-heading italic">Historial</SheetTitle>
          </SheetHeader>
          <div className="px-1">{historyList}</div>
        </SheetContent>
      </Sheet>

      <Dialog open={skinsOpen} onOpenChange={setSkinsOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-2xl italic">Elige una interfaz</DialogTitle>
            <DialogDescription>
              Seis caras distintas para Taller. Toca una y la app cambia al momento. Puedes volver a este panel cuando quieras.
            </DialogDescription>
          </DialogHeader>
          <SkinGallery current={skin} onSelect={chooseSkin} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SkinGallery({ current, onSelect }: { current: SkinId; onSelect: (id: SkinId) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {SKINS.map((skin, index) => {
        const selected = skin.id === current;
        return (
          <button
            key={skin.id}
            type="button"
            onClick={() => onSelect(skin.id)}
            className={`animate-rise group overflow-hidden rounded-2xl border text-left transition ${
              selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/40"
            }`}
            style={{ animationDelay: `${index * 50}ms` }}
            aria-pressed={selected}
          >
            <div
              className="h-24 p-3"
              style={{
                background: `linear-gradient(135deg, ${skin.swatches[0]}, color-mix(in srgb, ${skin.swatches[0]} 70%, ${skin.swatches[1]}))`,
              }}
            >
              <div className="flex h-full flex-col justify-between rounded-xl p-3" style={{ background: skin.swatches[0], color: skin.swatches[2] }}>
                <span className="font-heading text-lg italic" style={{ color: skin.swatches[1] }}>
                  Taller
                </span>
                <span className="text-[11px] opacity-80">Bienvenido</span>
              </div>
            </div>
            <div className="space-y-2 bg-card px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{skin.name}</p>
                <div className="flex gap-1">
                  {skin.swatches.map((color) => (
                    <span key={color} className="size-3 rounded-full border border-black/10" style={{ background: color }} />
                  ))}
                </div>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{skin.blurb}</p>
              {selected && <Badge>En uso</Badge>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ActivityButton({
  id,
  selected,
  disabled,
  onSelect,
  delay = 0,
}: {
  id: ActivityId;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: ActivityId) => void;
  delay?: number;
}) {
  const item = ACTIVITY_MAP[id];
  const Icon = ICONS[id];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(id)}
      className={`animate-rise flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition disabled:opacity-50 ${
        selected ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-muted"
      }`}
      style={{ animationDelay: `${delay}ms` }}
      aria-current={selected ? "page" : undefined}
    >
      <span className={`mt-0.5 font-mono text-[11px] ${selected ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
        {item.number}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Icon className="size-3.5" />
          {item.label}
        </span>
        <span className={`mt-0.5 block text-xs leading-4 ${selected ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
          {item.blurb}
        </span>
      </span>
    </button>
  );
}

function WelcomeState({
  activityLabel,
  starters,
  recent,
  onPick,
  onOpenHistory,
  onBrowseSkins,
}: {
  activityLabel: string;
  starters: string[];
  recent: HistoryEntry[];
  onPick: (starter: string) => void;
  onOpenHistory: (entry: HistoryEntry) => void;
  onBrowseSkins: () => void;
}) {
  return (
    <div className="animate-rise pt-4 md:pt-10">
      <p className="font-heading text-5xl tracking-tight italic md:text-6xl">Bienvenido</p>
      <p className="mt-3 max-w-xl text-xl leading-8 text-muted-foreground md:text-2xl">
        ¿En qué te puedo ayudar hoy?
      </p>
      <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
        Estás en <span className="font-medium text-foreground">{activityLabel}</span>. Escribe abajo o elige un comienzo. También puedes
        cambiar la cara de Taller.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onBrowseSkins}>
          <Palette />
          Ver interfaces
        </Button>
      </div>
      <div className="mt-7 flex flex-col gap-2">
        {starters.map((starter, index) => (
          <button
            key={starter}
            type="button"
            onClick={() => onPick(starter)}
            className="animate-rise rounded-2xl border border-border bg-card/80 px-4 py-3 text-left text-sm leading-6 transition hover:border-primary/40 hover:bg-card"
            style={{ animationDelay: `${120 + index * 60}ms` }}
          >
            {starter.replace(/```[a-z]*\n?|```/g, "").trim()}
          </button>
        ))}
      </div>
      {recent.length > 0 && (
        <div className="mt-8">
          <p className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Clock3 className="size-4" />
            Reciente en este oficio
          </p>
          <div className="flex flex-col gap-2">
            {recent.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onOpenHistory(entry)}
                className="rounded-xl border border-border/80 bg-background/50 px-3 py-2 text-left transition hover:border-primary/30"
              >
                <p className="truncate text-sm">{entry.query}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatHistoryTime(entry.at)}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryPanel({
  entries,
  onOpen,
  onClear,
  disabled,
}: {
  entries: HistoryEntry[];
  onOpen: (entry: HistoryEntry) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  if (entries.length === 0) {
    return (
      <div className="px-3 py-6 text-sm leading-6 text-muted-foreground">
        Aún no hay búsquedas. Cuando preguntes algo, queda guardado aquí para volver a abrirlo.
      </div>
    );
  }
  return (
    <div className="space-y-3 px-3 pb-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{entries.length} búsqueda{entries.length === 1 ? "" : "s"}</p>
        <Button variant="ghost" size="sm" onClick={onClear} disabled={disabled}>
          <Trash2 />
          Borrar
        </Button>
      </div>
      <div className="space-y-2">
        {entries.map((entry) => {
          const activity = ACTIVITY_MAP[entry.activity];
          return (
            <button
              key={entry.id}
              type="button"
              disabled={disabled}
              onClick={() => onOpen(entry)}
              className="w-full rounded-xl border border-border bg-card/70 px-3 py-3 text-left transition hover:border-primary/35 disabled:opacity-50"
            >
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline">{activity.label}</Badge>
                <span className="text-[11px] text-muted-foreground">{formatHistoryTime(entry.at)}</span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm leading-5">{entry.query}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{entry.preview}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  pending,
  delay = 0,
}: {
  message: StoredMessage;
  pending: boolean;
  delay?: number;
}) {
  const mine = message.role === "user";
  return (
    <article
      className={`animate-rise ${mine ? "ml-8" : "mr-8"}`}
      style={{ animationDelay: `${delay}ms` }}
      aria-live={pending ? "polite" : undefined}
    >
      <div
        className={
          mine
            ? "rounded-3xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground shadow-sm"
            : "rounded-3xl rounded-bl-md border border-border bg-card/90 px-4 py-3 shadow-sm"
        }
      >
        {!mine && (
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="outline">{message.mode === "model" ? "DeepSeek" : "Taller"}</Badge>
            {pending && !message.content && <span className="text-xs text-muted-foreground">Preparando la respuesta…</span>}
          </div>
        )}
        {message.reasoning && (
          <details className="mb-3 rounded-xl bg-muted/70 px-3 py-2 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Razonamiento</summary>
            <p className="mt-2 whitespace-pre-wrap">{message.reasoning}</p>
          </details>
        )}
        {mine ? (
          <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
        ) : (
          <MarkdownView text={message.content || (pending ? "" : "…")} />
        )}
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
          <p className="font-heading text-xl italic">Receta</p>
          <p className="text-xs text-muted-foreground">{modelTitle}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onCopy}>
          {copied ? "Copiada" : "Copiar"}
        </Button>
      </div>
      <p className="px-4 pb-3 text-xs leading-5 text-muted-foreground">
        Así arma deepseek-recipe el prompt. Los tokens marcados son especiales.
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
      <DialogTrigger render={<Button variant="ghost" size="sm" className="hidden sm:inline-flex" />}>
        Cómo funciona
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading italic">Bienvenido a Taller</DialogTitle>
          <DialogDescription>
            Pregunta en el oficio que necesites. El historial guarda lo que buscaste. Las interfaces cambian solo la cara, no las
            herramientas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm leading-6">
          <p>Cada oficio tiene una herramienta local: cuentas, código, escritura, plan, traducción, resumen o investigación.</p>
          <p>El panel Receta muestra el formato abierto de DeepSeek (deepseek-recipe 0.2.0).</p>
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
  skin: SkinId;
  threads: Threads;
  history: HistoryEntry[];
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem("taller-receta-v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      activity?: ActivityId;
      model?: ModelId;
      effort?: Effort;
      thinking?: boolean;
      skin?: string;
      threads?: Threads;
      history?: unknown;
    };
    if (!parsed.activity || !(parsed.activity in ACTIVITY_MAP)) return null;
    if (parsed.model !== "flash" && parsed.model !== "pro") return null;
    if (parsed.effort !== "low" && parsed.effort !== "high" && parsed.effort !== "max") return null;
    const skin = parsed.skin && isSkinId(parsed.skin) ? parsed.skin : "brisa";
    return {
      activity: parsed.activity,
      model: parsed.model,
      effort: parsed.effort,
      thinking: Boolean(parsed.thinking),
      skin,
      threads: sanitizeThreads(parsed.threads ?? {}),
      history: sanitizeHistory(parsed.history),
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
      .filter(
        (message) =>
          message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string",
      )
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
