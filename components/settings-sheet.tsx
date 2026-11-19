"use client";

import { useEffect, useState } from "react";
import { APP_NAME } from "@/lib/brand";
import {
  DEFAULT_FALLBACK_MODEL,
  type OllamaChatModelId,
  type OllamaChatModelOption,
} from "@/lib/ollama-models";
import { createDeadlineId, type UserMemory } from "@/lib/user-memory";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

type ModelsApi = {
  hardwareLabel?: string;
  recommended?: string;
  models?: Array<OllamaChatModelOption & { installed?: boolean; recommended?: boolean }>;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  webSearch: boolean | "auto";
  onWebSearchChange: (value: boolean | "auto") => void;
  ollamaModel: string;
  onOllamaModelChange: (value: string) => void;
  memory: UserMemory;
  onMemoryChange: (memory: UserMemory) => void;
  onExportBackup: () => void;
  onImportBackup: (file: File) => void;
};

export function SettingsSheet(props: Props) {
  const [catalog, setCatalog] = useState<ModelsApi | null>(null);
  const [loadError, setLoadError] = useState("");
  const [deadlineTitle, setDeadlineTitle] = useState("");
  const [deadlineDate, setDeadlineDate] = useState("");

  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    void fetch("/api/ollama/models")
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = (await response.json()) as ModelsApi;
        if (!cancelled) {
          setCatalog(json);
          setLoadError("");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "No pude leer los modelos");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.open]);

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-heading italic">Ajustes</SheetTitle>
        </SheetHeader>
        <div className="space-y-6 px-1 pb-8">
          <section className="space-y-2" aria-labelledby="web-search-heading">
            <h3 id="web-search-heading" className="text-sm font-semibold">
              Buscar en internet
            </h3>
            <p className="text-xs leading-5 text-muted-foreground">
              Por defecto {APP_NAME} responde sin internet (modelo local + tus documentos). No inventa
              fuentes.
            </p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: false, label: "Apagado" },
                  { id: "auto" as const, label: "Automático" },
                  { id: true, label: "Siempre" },
                ] as const
              ).map((option) => (
                <Button
                  key={String(option.id)}
                  type="button"
                  size="sm"
                  variant={props.webSearch === option.id ? "secondary" : "outline"}
                  aria-pressed={props.webSearch === option.id}
                  onClick={() => props.onWebSearchChange(option.id)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </section>

          <section className="space-y-2" aria-labelledby="model-heading">
            <h3 id="model-heading" className="text-sm font-semibold">
              Modelo Ollama
            </h3>
            <p className="text-xs leading-5 text-muted-foreground">
              {catalog?.hardwareLabel || "Detectando hardware…"}
              {catalog?.recommended ? ` · recomendado: ${catalog.recommended}` : ""}
            </p>
            {loadError ? <p className="text-xs text-destructive">{loadError}</p> : null}
            <div className="space-y-2">
              {(catalog?.models || defaultOptions()).map((option) => {
                const selected = props.ollamaModel === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => props.onOllamaModelChange(option.id)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                      selected ? "border-primary bg-primary/10" : "border-border hover:bg-muted/60"
                    }`}
                    aria-pressed={selected}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{option.label}</p>
                      <span className="text-[11px] text-muted-foreground">
                        {"installed" in option && option.installed === false ? "no instalado" : option.quality}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{option.blurb}</p>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Instala con <code className="rounded bg-muted px-1">ollama pull {props.ollamaModel || DEFAULT_FALLBACK_MODEL}</code>
            </p>
          </section>

          <section className="space-y-2" aria-labelledby="memory-heading">
            <h3 id="memory-heading" className="text-sm font-semibold">
              Memoria personal
            </h3>
            <p className="text-xs leading-5 text-muted-foreground">
              Solo en este dispositivo. Editable y borrable cuando quieras.
            </p>
            <label className="block text-xs font-medium" htmlFor="mem-name">
              Nombre
            </label>
            <input
              id="mem-name"
              value={props.memory.name}
              onChange={(event) =>
                props.onMemoryChange({
                  ...props.memory,
                  name: event.target.value,
                  updatedAt: Date.now(),
                })
              }
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
              placeholder="Cómo te gusta que te llamen"
            />
            <label className="block text-xs font-medium" htmlFor="mem-program">
              Programa / carrera
            </label>
            <input
              id="mem-program"
              value={props.memory.program}
              onChange={(event) =>
                props.onMemoryChange({
                  ...props.memory,
                  program: event.target.value,
                  updatedAt: Date.now(),
                })
              }
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
              placeholder="Ej. Ingeniería de sistemas · UNAD"
            />
            <div className="space-y-2 pt-2">
              <p className="text-xs font-medium">Entregas</p>
              {props.memory.deadlines.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-2 rounded-xl border border-border px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{item.title}</p>
                    <p className="text-[11px] text-muted-foreground">{item.dueAt}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      props.onMemoryChange({
                        ...props.memory,
                        deadlines: props.memory.deadlines.filter((d) => d.id !== item.id),
                        updatedAt: Date.now(),
                      })
                    }
                  >
                    Borrar
                  </Button>
                </div>
              ))}
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={deadlineTitle}
                  onChange={(event) => setDeadlineTitle(event.target.value)}
                  placeholder="Entrega"
                  className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm"
                />
                <input
                  type="date"
                  value={deadlineDate}
                  onChange={(event) => setDeadlineDate(event.target.value)}
                  className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={!deadlineTitle.trim() || !deadlineDate}
                onClick={() => {
                  props.onMemoryChange({
                    ...props.memory,
                    deadlines: [
                      ...props.memory.deadlines,
                      { id: createDeadlineId(), title: deadlineTitle.trim(), dueAt: deadlineDate },
                    ],
                    updatedAt: Date.now(),
                  });
                  setDeadlineTitle("");
                  setDeadlineDate("");
                }}
              >
                Añadir entrega
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() =>
                  props.onMemoryChange({
                    name: "",
                    program: "",
                    deadlines: [],
                    updatedAt: Date.now(),
                  })
                }
              >
                Borrar toda la memoria
              </Button>
            </div>
          </section>

          <section className="space-y-2" aria-labelledby="backup-heading">
            <h3 id="backup-heading" className="text-sm font-semibold">
              Copia de seguridad
            </h3>
            <p className="text-xs leading-5 text-muted-foreground">
              Exporta chats, tareas, memoria y documentos a un JSON local. Privacidad: no sale de tu PC.
            </p>
            <Button type="button" className="w-full" onClick={props.onExportBackup}>
              Exportar copia JSON
            </Button>
            <label className="flex w-full cursor-pointer items-center justify-center rounded-xl border border-dashed border-border px-3 py-3 text-sm hover:bg-muted/50">
              Importar copia JSON
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) props.onImportBackup(file);
                  event.target.value = "";
                }}
              />
            </label>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Privacidad</h3>
            <Textarea
              readOnly
              rows={4}
              className="text-xs"
              value={`${APP_NAME} guarda chats, memoria y documentos en este dispositivo. La búsqueda web es opcional. No hay cuenta en la nube ni telemetría de tus textos.`}
            />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function defaultOptions(): OllamaChatModelOption[] {
  return [
    {
      id: "deepseek-r1:1.5b" as OllamaChatModelId,
      label: "DeepSeek R1 1.5B",
      blurb: "Respaldo rápido",
      minRamGb: 6,
      minVramGb: 0,
      quality: "rápido",
      role: "fallback",
    },
    {
      id: "qwen2.5:7b" as OllamaChatModelId,
      label: "Qwen 2.5 7B",
      blurb: "Recomendado en 16 GB",
      minRamGb: 12,
      minVramGb: 6,
      quality: "mejor",
      role: "recomendado",
    },
  ];
}
