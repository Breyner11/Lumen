"use client";

import { useEffect, useState } from "react";
import { APP_NAME } from "@/lib/brand";
import { DEFAULT_FALLBACK_MODEL, DEFAULT_QUALITY_MODEL } from "@/lib/ollama-models";
import { LumenLogo } from "@/components/lumen-logo";
import { Button } from "@/components/ui/button";

type Props = {
  ollamaModel: string;
  onDone: () => void;
};

/** Pantalla amable si falta Ollama o el modelo (desktop / primera visita). */
export function FirstRunSetup({ ollamaModel, onDone }: Props) {
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [modelOk, setModelOk] = useState<boolean | null>(null);
  const [note, setNote] = useState("Comprobando Ollama…");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setNote("Comprobando Ollama…");
    try {
      const response = await fetch("/api/ollama/models");
      if (!response.ok) {
        setOllamaOk(false);
        setModelOk(false);
        setNote("No pude hablar con el servidor local. Arranca Lumen de nuevo.");
        return;
      }
      const json = (await response.json()) as {
        models?: Array<{ id: string; installed?: boolean }>;
        installed?: string[];
      };
      const hasOllama = Array.isArray(json.installed);
      setOllamaOk(hasOllama);
      const wanted = ollamaModel || DEFAULT_QUALITY_MODEL;
      const installed = json.models?.some((m) => m.id === wanted && m.installed) ?? false;
      const fallback = json.models?.some((m) => m.id === DEFAULT_FALLBACK_MODEL && m.installed) ?? false;
      setModelOk(installed || fallback);
      if (!hasOllama) {
        setNote("Instala Ollama desde https://ollama.com/download y vuelve a comprobar.");
      } else if (!installed && !fallback) {
        setNote(`Ollama está listo. Falta descargar el modelo «${wanted}».`);
      } else {
        setNote("Todo listo para usar Lumen en local.");
      }
    } catch {
      setOllamaOk(false);
      setModelOk(false);
      setNote("Sin conexión con Ollama en 127.0.0.1:11434.");
    }
  }

  useEffect(() => {
    void refresh();
  }, [ollamaModel]);

  async function pullModel() {
    setBusy(true);
    setNote(`Descargando ${ollamaModel || DEFAULT_QUALITY_MODEL}… (puede tardar varios minutos)`);
    try {
      // En Tauri se puede invocar pull_ollama_model; en web usamos hint.
      const w = window as Window & {
        __TAURI__?: { core?: { invoke?: (cmd: string, args: Record<string, string>) => Promise<unknown> } };
      };
      if (w.__TAURI__?.core?.invoke) {
        await w.__TAURI__.core.invoke("pull_ollama_model", {
          model: ollamaModel || DEFAULT_QUALITY_MODEL,
        });
      } else {
        setNote(
          `Abre una terminal y ejecuta: ollama pull ${ollamaModel || DEFAULT_QUALITY_MODEL}`,
        );
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : "No pude descargar el modelo.");
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  if (ollamaOk && modelOk) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-run-title"
    >
      <div className="w-full max-w-lg rounded-3xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <LumenLogo className="size-10 text-primary" />
          <div>
            <h2 id="first-run-title" className="font-heading text-2xl italic">
              Bienvenido a {APP_NAME}
            </h2>
            <p className="text-sm text-muted-foreground">Configuración local · sin cuenta · sin nube</p>
          </div>
        </div>
        <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm leading-6">
          <li>Instala Ollama para Windows si aún no lo tienes.</li>
          <li>Descarga un modelo (recomendado {DEFAULT_QUALITY_MODEL}; respaldo {DEFAULT_FALLBACK_MODEL}).</li>
          <li>Vuelve aquí y pulsa «Comprobar de nuevo».</li>
        </ol>
        <div className="mt-4 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm" aria-live="polite">
          {note}
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full bg-primary transition-all ${busy ? "w-2/3 animate-pulse" : ollamaOk && modelOk ? "w-full" : ollamaOk ? "w-1/2" : "w-1/4"}`}
            />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" onClick={() => void refresh()} disabled={busy}>
            Comprobar de nuevo
          </Button>
          <Button type="button" variant="secondary" onClick={() => void pullModel()} disabled={busy || !ollamaOk}>
            Descargar modelo
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Continuar igual
          </Button>
        </div>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          En el instalador de Windows, Lumen arranca solo el servidor local y mira si Ollama responde. Tus datos no salen del PC.
        </p>
      </div>
    </div>
  );
}
