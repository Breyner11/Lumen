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
  Library,
  ListChecks,
  MessageCircle,
  Mic,
  Palette,
  PanelRight,
  PenLine,
  Plus,
  Search,
  Square,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import { ACTIVITIES, ACTIVITY_MAP, MODEL_LABEL } from "@/lib/activities";
import { syncLessonToEngine } from "@/lib/rag/sync-lesson";
import { STYLE_QUICK_PROMPTS } from "@/lib/style";
import { looksLikeMath, SPECIALTY_IDS } from "@/lib/tools/route";
import { formatHistoryTime, pushHistory, sanitizeHistory, type HistoryEntry } from "@/lib/history";
import {
  parseCorrectionMessage,
  sanitizeLessons,
  touchLesson,
  upsertLesson,
  type Lesson,
} from "@/lib/lessons";
import { addDocument, removeDocument, seedDocuments } from "@/lib/rag/documents";
import { sanitizeDocuments } from "@/lib/rag/pipeline";
import type { RagDocument } from "@/lib/rag/types";
import { composeRecipePreview } from "@/lib/recipe-preview";
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
  preguntar: MessageCircle,
  estudiar: BookOpen,
  programar: Code2,
  escribir: PenLine,
  calcular: Calculator,
  organizar: ListChecks,
  traducir: Languages,
  resumir: AlignLeft,
  investigar: Search,
} as const;

const SPECIALTY_ACTIVITIES = ACTIVITIES.filter((item) =>
  (SPECIALTY_IDS as readonly string[]).includes(item.id),
);

type Threads = Partial<Record<ActivityId, StoredMessage[]>>;
type Status = "loading" | "taller" | "model";
type RagStatus = {
  engine: boolean;
  ollama: boolean;
  embedModel: string;
  search: string;
  visionModel?: string | null;
  sympy?: boolean;
  mathModel?: string | null;
};

export function TallerApp() {
  const [activity, setActivity] = useState<ActivityId>("preguntar");
  const [model, setModel] = useState<ModelId>("flash");
  const [effort, setEffort] = useState<Effort>("high");
  const [thinking, setThinking] = useState(true);
  const [skin, setSkin] = useState<SkinId>("brisa");
  const [threads, setThreads] = useState<Threads>({});
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [ragStatus, setRagStatus] = useState<RagStatus | null>(null);
  const [activitiesOpen, setActivitiesOpen] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [skinsOpen, setSkinsOpen] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docText, setDocText] = useState("");
  const [imageQuery, setImageQuery] = useState("");
  const [imageHits, setImageHits] = useState<
    Array<{ id: string; title: string; caption?: string | null; latex?: string | null; score: number }>
  >([]);
  const [imageSearchNote, setImageSearchNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [ready, setReady] = useState(false);
  const [correctingIndex, setCorrectingIndex] = useState<number | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState("");
  const [learnNote, setLearnNote] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
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
      setLessons(stored.lessons);
      setDocuments(stored.documents.length ? stored.documents : seedDocuments());
      document.documentElement.dataset.skin = stored.skin;
    } else {
      setDocuments(seedDocuments());
      document.documentElement.dataset.skin = "brisa";
    }
    setReady(true);
    void fetch("/api/status")
      .then(async (response) => {
        if (!response.ok) {
          setStatus("taller");
          return;
        }
        const body = (await response.json()) as { modelReady?: boolean };
        setStatus(body.modelReady ? "model" : "taller");
      })
      .catch(() => setStatus("taller"));
    void fetch("/api/rag/status")
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as RagStatus;
        setRagStatus(body);
      })
      .catch(() => setRagStatus(null));
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
      JSON.stringify({ activity, model, effort, thinking, skin, threads, history, lessons, documents }),
    );
  }, [activity, model, effort, thinking, skin, threads, history, lessons, documents, ready]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [thread, streaming, activity, learnNote]);

  const previewPrompt = useMemo(() => {
    const historyTurns = thread.map((message) => ({ role: message.role, content: message.content }));
    const pending = draft.trim();
    const messages = pending ? [...historyTurns, { role: "user" as const, content: pending }] : historyTurns;
    return composeRecipePreview({ activity, model, effort, thinking, messages });
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

  function learnFromCorrection(question: string, answer: string, reason?: string) {
    const q = question.trim();
    const a = answer.trim();
    if (!q || !a) return;
    const nextLessons = upsertLesson(lessons, {
      activity,
      question: q,
      answer: a,
      reason: reason ?? "Corrección del usuario",
    });
    setLessons(nextLessons);
    const saved = nextLessons.find(
      (lesson) => lesson.activity === activity && lesson.question.trim() === q,
    );
    if (saved) void syncLessonToEngine(saved);
    setLearnNote("Guardé la corrección en el navegador y en el motor RAG.");
    window.setTimeout(() => setLearnNote(""), 5000);
  }

  async function learnFromInternetNow() {
    setLearnNote("Aprendiendo de internet…");
    try {
      const response = await fetch("/api/learn/now", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await response.json()) as { ok?: boolean; count?: number; error?: string };
      setLearnNote(
        json.ok
          ? `Indexé ${json.count ?? 0} resumen${(json.count ?? 0) === 1 ? "" : "es"} de la web.`
          : json.error || "Sin internet o motor apagado.",
      );
    } catch (caught) {
      setLearnNote(caught instanceof Error ? caught.message : "No pude aprender ahora.");
    }
    window.setTimeout(() => setLearnNote(""), 6000);
  }

  async function transcribeAudio(file: File) {
    if (streaming) return;
    setError("");
    setLearnNote("Transcribiendo audio…");
    try {
      const body = new FormData();
      body.append("file", file, file.name || "audio.webm");
      const response = await fetch("/api/audio/transcribe", { method: "POST", body });
      const json = (await response.json()) as { text?: string; error?: string };
      if (!response.ok || !json.text) {
        setError(json.error || "No pude transcribir el audio.");
        setLearnNote("");
        return;
      }
      setDraft((current) => (current ? `${current}\n${json.text}` : json.text!));
      setLearnNote("Audio pasado a texto. Revísalo y envía.");
      window.setTimeout(() => setLearnNote(""), 4000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falló la transcripción.");
      setLearnNote("");
    }
  }

  async function recordAndTranscribe() {
    if (streaming || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      audioInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        void transcribeAudio(new File([blob], "nota-voz.webm", { type: blob.type }));
      };
      setLearnNote("Grabando 5 s… habla ahora.");
      recorder.start();
      window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 5000);
    } catch {
      audioInputRef.current?.click();
    }
  }

  function markGood(assistantIndex: number) {
    const list = threads[activity] ?? [];
    const assistant = list[assistantIndex];
    const question = [...list.slice(0, assistantIndex)].reverse().find((message) => message.role === "user");
    if (!assistant || assistant.role !== "assistant" || !question) return;
    learnFromCorrection(question.content, assistant.content, "Confirmado como correcto");
  }

  function submitCorrection(assistantIndex: number) {
    const list = threads[activity] ?? [];
    const question = [...list.slice(0, assistantIndex)].reverse().find((message) => message.role === "user");
    const answer = correctionDraft.trim();
    if (!question || !answer) return;
    learnFromCorrection(question.content, answer, "Corregido con Mal");
    setThreads((currentThreads) => {
      const current = currentThreads[activity] ?? [];
      const next = [...current];
      if (next[assistantIndex]?.role === "assistant") {
        next[assistantIndex] = {
          ...next[assistantIndex]!,
          content: `${answer}\n\n_Aprendí esta corrección. Gracias._`,
        };
      }
      return { ...currentThreads, [activity]: next };
    });
    setCorrectingIndex(null);
    setCorrectionDraft("");
  }

  async function searchStoredImages() {
    const query = imageQuery.trim();
    if (query.length < 2) return;
    setImageSearchNote("Buscando…");
    try {
      const response = await fetch("/api/images/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, topK: 6 }),
      });
      const json = (await response.json()) as {
        hits?: Array<{ id: string; title: string; caption?: string | null; latex?: string | null; score: number }>;
        error?: string;
      };
      setImageHits(json.hits ?? []);
      setImageSearchNote(
        json.error
          ? json.error
          : (json.hits?.length ?? 0) === 0
            ? "Sin coincidencias. Sube fotos desde Calcular primero."
            : `${json.hits!.length} imagen${json.hits!.length === 1 ? "" : "es"}`,
      );
    } catch (caught) {
      setImageHits([]);
      setImageSearchNote(caught instanceof Error ? caught.message : "No pude buscar imágenes.");
    }
  }

  async function solveImage(file: File) {
    if (streaming) return;
    setError("");
    setLearnNote("");
    const target: ActivityId = activity === "preguntar" ? "preguntar" : "calcular";
    setActivity(target);
    const previewUrl = URL.createObjectURL(file);
    const userMessage: StoredMessage = {
      role: "user",
      content: `📷 Imagen: ${file.name}\n(Problema matemático / apunte)`,
    };
    const placeholder: StoredMessage = { role: "assistant", content: "", mode: "taller" };
    setThreads((current) => ({
      ...current,
      [target]: [...(current[target] ?? []), userMessage, placeholder],
    }));
    setStreaming(true);
    try {
      const body = new FormData();
      body.append("file", file, file.name);
      const response = await fetch("/api/vision/solve", { method: "POST", body });
      const json = (await response.json()) as { ok?: boolean; answer?: string; error?: string };
      let answer =
        json.answer ||
        json.error ||
        "No pude leer la imagen. Arranca el motor Python y `ollama pull qwen2.5-vl:3b`.";
      if (target === "preguntar" && !answer.includes("Herramienta:")) {
        answer = `_Herramienta: Calcular_\n\n${answer}`;
      }
      setThreads((current) => {
        const list = [...(current[target] ?? [])];
        const last = list[list.length - 1];
        if (last?.role === "assistant") {
          list[list.length - 1] = { ...last, content: answer, mode: "taller" };
        }
        return { ...current, [target]: list };
      });
      setHistory((entries) =>
        pushHistory(entries, {
          activity: target,
          query: `imagen:${file.name}`,
          preview: answer.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().slice(0, 180),
        }),
      );
      if (json.ok) {
        setLearnNote("Guardé la imagen, el LaTeX y la solución SymPy en la memoria del motor.");
        window.setTimeout(() => setLearnNote(""), 5000);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "No pude procesar la imagen.";
      setError(message);
    } finally {
      URL.revokeObjectURL(previewUrl);
      setStreaming(false);
    }
  }

  function isImageFile(file: File): boolean {
    return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
  }

  function isAudioFile(file: File): boolean {
    return file.type.startsWith("audio/") || /\.(webm|wav|mp3|m4a|ogg)$/i.test(file.name);
  }

  async function processPendingAttachments(base: string): Promise<string | null> {
    if (!pendingFiles.length) return base;
    const files = [...pendingFiles];
    const onlyImage = files.length === 1 && isImageFile(files[0]!) && !base;
    if (onlyImage) {
      setPendingFiles([]);
      void solveImage(files[0]!);
      return null;
    }

    const chunks: string[] = [];
    for (const file of files) {
      if (isImageFile(file)) {
        const body = new FormData();
        body.append("file", file, file.name);
        const response = await fetch("/api/vision/solve", { method: "POST", body });
        const json = (await response.json()) as { answer?: string; error?: string };
        if (!response.ok || !json.answer) {
          setError(json.error || `No pude leer la imagen ${file.name}`);
          return null;
        }
        chunks.push(`Análisis de la imagen «${file.name}»:\n${json.answer}`);
        continue;
      }
      if (isAudioFile(file)) {
        const body = new FormData();
        body.append("file", file, file.name);
        const response = await fetch("/api/audio/transcribe", { method: "POST", body });
        const json = (await response.json()) as { text?: string; error?: string };
        if (!response.ok || !json.text) {
          setError(json.error || `No pude transcribir ${file.name}`);
          return null;
        }
        chunks.push(`Transcripción de «${file.name}»:\n${json.text}`);
        continue;
      }
      const body = new FormData();
      body.append("file", file, file.name);
      const response = await fetch("/api/documents/extract", { method: "POST", body });
      const json = (await response.json()) as {
        text?: string;
        title?: string;
        indexed?: boolean;
        error?: string;
      };
      if (!response.ok || !json.text) {
        setError(json.error || `No pude leer ${file.name}`);
        return null;
      }
      chunks.push(
        [
          `Documento adjunto «${json.title || file.name}»${json.indexed ? " (indexado en RAG)" : ""}:`,
          json.text.slice(0, 12_000),
        ].join("\n"),
      );
    }
    setPendingFiles([]);
    return [base, ...chunks].filter(Boolean).join("\n\n");
  }

  async function send(text = draft) {
    if (streaming) return;
    setError("");
    setLearnNote("");
    const prepared = await processPendingAttachments(text.trim());
    if (prepared === null) return;
    const content = prepared.trim();
    if (!content) return;

    // Calcular / Preguntar (si parece cuenta): prefer SymPy engine.
    if (activity === "calcular" || (activity === "preguntar" && looksLikeMath(content))) {
      setStreaming(true);
      setDraft("");
      try {
        const response = await fetch("/api/math/solve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ problem: content, webContext: true }),
        });
        const json = (await response.json()) as {
          ok?: boolean;
          answer?: string;
          remembered?: boolean;
        };
        if (json.answer) {
          const mathActivity = activity === "preguntar" ? "preguntar" : "calcular";
          const answer =
            mathActivity === "preguntar" && !json.answer!.includes("Herramienta:")
              ? `_Herramienta: Calcular_\n\n${json.answer}`
              : json.answer!;
          const historyTurns: StoredMessage[] = [
            ...thread,
            { role: "user", content },
            { role: "assistant", content: answer, mode: "taller" },
          ];
          setThreads((currentThreads) => ({ ...currentThreads, [mathActivity]: historyTurns }));
          setHistory((entries) =>
            pushHistory(entries, {
              activity: mathActivity,
              query: content,
              preview: answer.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().slice(0, 180),
            }),
          );
          if (json.remembered) {
            setLearnNote("Reutilicé un problema parecido de la memoria matemática.");
            window.setTimeout(() => setLearnNote(""), 4000);
          }
          return;
        }
      } catch {
        // fall through to normal chat
      } finally {
        setStreaming(false);
      }
    }

    const autoCorrection = parseCorrectionMessage(content);
    if (autoCorrection) {
      const question = [...thread].reverse().find((message) => message.role === "user");
      if (question) {
        learnFromCorrection(question.content, autoCorrection.answer, autoCorrection.reason);
        const ack: StoredMessage = {
          role: "assistant",
          content: [
            "Listo: aprendí la corrección para esa pregunta.",
            "",
            `**Pregunta:** ${question.content}`,
            "",
            autoCorrection.answer,
            "",
            "La próxima vez que preguntes lo mismo (en este oficio), usaré esta versión.",
          ].join("\n"),
          mode: "taller",
        };
        setThreads((currentThreads) => ({
          ...currentThreads,
          [activity]: [...thread, { role: "user", content }, ack],
        }));
        setDraft("");
        return;
      }
    }

    const historyTurns = [...thread, { role: "user" as const, content }];
    const placeholder: StoredMessage = { role: "assistant", content: "", reasoning: "", mode: "taller" };
    setThreads((currentThreads) => ({ ...currentThreads, [activity]: [...historyTurns, placeholder] }));
    setDraft("");
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const target = activity;
    let answerPreview = "";
    let sawDone = false;

    const patchAssistant = (patch: Partial<StoredMessage>) => {
      setThreads((currentThreads) => {
        const list = currentThreads[target] ?? [];
        const last = list[list.length - 1];
        if (!last || last.role !== "assistant") return currentThreads;
        const next = [...list];
        next[next.length - 1] = { ...last, ...patch };
        return { ...currentThreads, [target]: next };
      });
    };

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
          lessons,
          documents,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `No pude completar la petición (HTTP ${response.status}).`);
      }
      if (!response.body) throw new Error("La respuesta llegó vacía.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let learnedFrom: string | null = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          let payload: {
            type?: string;
            text?: string;
            mode?: "model" | "taller";
            message?: string;
            learnedFrom?: string | null;
            images?: Array<{ url: string; title?: string }>;
            sources?: Array<{ title: string; url: string }>;
          };
          try {
            payload = JSON.parse(trimmed.slice(5)) as typeof payload;
          } catch {
            continue;
          }
          if (payload.type === "ping") continue;
          if (payload.type === "status") {
            // Solo actualiza el texto provisional si aún no hay respuesta.
            if (!answerPreview) {
              patchAssistant({ content: "_" + (payload.text || "Pensando…") + "_" });
            }
            continue;
          }
          if (payload.type === "error") {
            const message = payload.message || "Algo falló al responder.";
            setError(message);
            if (!answerPreview) patchAssistant({ content: message, mode: "taller" });
            continue;
          }
          if (payload.type === "content" || payload.type === "reasoning" || payload.type === "done") {
            if (payload.type === "content" && payload.text) answerPreview += payload.text;
            if (payload.type === "done") {
              sawDone = true;
              if (payload.learnedFrom) {
                learnedFrom = payload.learnedFrom;
                setLessons((current) => touchLesson(current, payload.learnedFrom!));
              }
            }
            setThreads((currentThreads) => {
              const list = currentThreads[target] ?? [];
              const last = list[list.length - 1];
              if (!last || last.role !== "assistant") return currentThreads;
              const next = [...list];
              next[next.length - 1] = {
                ...last,
                content: payload.type === "content" ? answerPreview : last.content,
                reasoning:
                  payload.type === "reasoning" ? `${last.reasoning ?? ""}${payload.text ?? ""}` : last.reasoning,
                mode: payload.type === "done" ? payload.mode ?? last.mode : last.mode,
                images: payload.type === "done" && payload.images ? payload.images : last.images,
                sources: payload.type === "done" && payload.sources ? payload.sources : last.sources,
              };
              return { ...currentThreads, [target]: next };
            });
          }
        }
      }
      if (!sawDone && !answerPreview) {
        const fallback =
          "La conexión se cerró antes de recibir la respuesta. Revisa que Ollama esté en marcha e inténtalo de nuevo.";
        setError(fallback);
        patchAssistant({ content: fallback, mode: "taller" });
      } else {
        setHistory((entries) =>
          pushHistory(entries, {
            activity: target,
            query: content,
            preview: answerPreview.replace(/\*\*/g, "").replace(/\s+/g, " ").trim() || "Respuesta del taller",
          }),
        );
      }
      if (learnedFrom) {
        setLearnNote("Usé una corrección que aprendí antes.");
        window.setTimeout(() => setLearnNote(""), 4000);
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      const raw = caught instanceof Error ? caught.message : "No pude completar la petición.";
      const message =
        /failed to fetch|networkerror|load failed|fetch failed/i.test(raw)
          ? `Error de red al hablar con el servidor (${raw}). Si Ollama tarda en cargar el modelo, espera e inténtalo otra vez.`
          : raw;
      setError(message);
      if (!answerPreview) patchAssistant({ content: message, mode: "taller" });
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  const recipe = (
    <RecipePanel
      prompt={previewPrompt}
      modelTitle={MODEL_LABEL[model].recipe}
      copied={copied}
      onCopy={() => {
        void navigator.clipboard.writeText(previewPrompt).then(() => {
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
          <p className="mt-2 text-sm leading-5 text-muted-foreground">
            Un solo chat. Pregunta lo que necesites.
          </p>
        </div>
        <nav className="flex-1 space-y-3 overflow-y-auto px-3 pb-3" aria-label="Oficios">
          <ActivityButton
            id="preguntar"
            selected={activity === "preguntar"}
            disabled={streaming}
            onSelect={chooseActivity}
            delay={0}
            featured
          />
          <div>
            <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Especialidades
            </p>
            <div className="space-y-1">
              {SPECIALTY_ACTIVITIES.map((item, index) => (
                <ActivityButton
                  key={item.id}
                  id={item.id}
                  selected={item.id === activity}
                  disabled={streaming}
                  onSelect={chooseActivity}
                  delay={(index + 1) * 40}
                />
              ))}
            </div>
          </div>
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
          <Button variant="ghost" className="w-full justify-start" onClick={() => setKnowledgeOpen(true)}>
            <Library />
            Conocimiento RAG
            {documents.length > 0 && <Badge className="ml-auto" variant="secondary">{documents.length}</Badge>}
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start"
            disabled={streaming}
            onClick={() => void learnFromInternetNow()}
          >
            <Wifi />
            Aprender de Internet ahora
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mx-3 mt-3 flex items-center gap-2 rounded-[1.2rem] px-3 py-3 glass-panel md:mx-0 md:mt-3 md:mr-3 md:px-5">
          <Button variant="outline" className="md:hidden titlebar-no-drag" onClick={() => setActivitiesOpen(true)}>
            Menú
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
          <Button variant="ghost" size="icon" onClick={() => setKnowledgeOpen(true)} aria-label="Conocimiento RAG">
            <Library />
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
            Modo taller + RAG: DuckDuckGo, documentos
            {ragStatus?.engine ? ", SymPy" : ""}
            {ragStatus?.visionModel ? ` y visión (${ragStatus.visionModel})` : ragStatus?.engine ? " (visión con Ollama si instalas qwen2.5-vl)" : ""}
            . En Calcular puedes subir una foto de una fórmula.
            {lessons.length > 0 ? ` Lleva ${lessons.length} corrección${lessons.length === 1 ? "" : "es"}.` : ""}
          </p>
        )}
        {learnNote && (
          <p className="mx-3 mt-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm md:mx-0 md:mr-3" role="status">
            {learnNote}
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
                  feedbackEnabled={message.role === "assistant" && !streaming && Boolean(message.content)}
                  correcting={correctingIndex === index}
                  correctionDraft={correctingIndex === index ? correctionDraft : ""}
                  onGood={() => markGood(index)}
                  onBad={() => {
                    setCorrectingIndex(index);
                    setCorrectionDraft("");
                  }}
                  onCorrectionChange={setCorrectionDraft}
                  onCorrectionSubmit={() => submitCorrection(index)}
                  onCorrectionCancel={() => {
                    setCorrectingIndex(null);
                    setCorrectionDraft("");
                  }}
                  onStyle={(style) => void send(STYLE_QUICK_PROMPTS[style])}
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
          {pendingFiles.length > 0 ? (
            <div className="mx-auto mb-2 flex max-w-2xl flex-wrap gap-2">
              {pendingFiles.map((file, index) => (
                <span
                  key={`${file.name}-${index}`}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs"
                >
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-background"
                    aria-label={`Quitar ${file.name}`}
                    onClick={() => setPendingFiles((current) => current.filter((_, i) => i !== index))}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
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
            <input
              ref={attachInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.markdown,image/*,audio/*"
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (!files.length) return;
                setPendingFiles((current) => [...current, ...files].slice(0, 6));
              }}
            />
            <input ref={audioInputRef} type="file" accept="audio/*,.webm,.wav,.mp3,.m4a,.ogg" className="hidden" />
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              aria-label="Adjuntar documento, imagen o audio"
              disabled={streaming}
              onClick={() => attachInputRef.current?.click()}
            >
              <Plus />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              aria-label="Grabar audio"
              disabled={streaming}
              onClick={() => void recordAndTranscribe()}
            >
              <Mic />
            </Button>
            {streaming ? (
              <Button type="button" variant="outline" size="icon-lg" className="brand-mark" aria-label="Detener" onClick={() => abortRef.current?.abort()}>
                <Square />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon-lg"
                className="brand-mark"
                aria-label="Enviar"
                disabled={!draft.trim() && pendingFiles.length === 0}
              >
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
            <SheetTitle className="font-heading italic">Menú</SheetTitle>
          </SheetHeader>
          <div className="space-y-3 px-3">
            <ActivityButton
              id="preguntar"
              selected={activity === "preguntar"}
              disabled={streaming}
              onSelect={chooseActivity}
              featured
            />
            <div>
              <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Especialidades
              </p>
              <div className="space-y-1">
                {SPECIALTY_ACTIVITIES.map((item) => (
                  <ActivityButton
                    key={item.id}
                    id={item.id}
                    selected={item.id === activity}
                    disabled={streaming}
                    onSelect={chooseActivity}
                  />
                ))}
              </div>
            </div>
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

      <Sheet open={knowledgeOpen} onOpenChange={setKnowledgeOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="font-heading italic">Conocimiento RAG</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 px-1 pb-6">
            <p className="text-sm leading-6 text-muted-foreground">
              Pega apuntes o textos. Taller los parte en fragmentos, los indexa (TF-IDF) y recupera los más parecidos a tu pregunta antes de responder.
            </p>
            <div className="space-y-2">
              <input
                value={docTitle}
                onChange={(event) => setDocTitle(event.target.value)}
                placeholder="Título del documento"
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
              />
              <Textarea
                value={docText}
                onChange={(event) => setDocText(event.target.value)}
                placeholder="Pega aquí el texto (mínimo un párrafo)…"
                rows={6}
                className="text-sm"
              />
              <Button
                type="button"
                className="w-full"
                disabled={docText.trim().length < 20}
                onClick={() => {
                  setDocuments((current) => addDocument(current, { title: docTitle, text: docText }));
                  setDocTitle("");
                  setDocText("");
                }}
              >
                Indexar documento
              </Button>
            </div>
            <div className="space-y-2">
              {documents.map((document) => (
                <div key={document.id} className="rounded-xl border border-border bg-card/70 px-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{document.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{document.text}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{document.source ?? "usuario"}</p>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Quitar ${document.title}`}
                      onClick={() => setDocuments((current) => removeDocument(current, document.id))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm font-medium">Memoria de imágenes</p>
              <p className="text-xs leading-5 text-muted-foreground">
                Busca fotos ya guardadas por contenido (“gráfica de parábola”, “integral a mano”).
              </p>
              <div className="flex gap-2">
                <input
                  value={imageQuery}
                  onChange={(event) => setImageQuery(event.target.value)}
                  placeholder="Buscar imagen…"
                  className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void searchStoredImages();
                    }
                  }}
                />
                <Button type="button" variant="outline" disabled={imageQuery.trim().length < 2} onClick={() => void searchStoredImages()}>
                  Buscar
                </Button>
              </div>
              {imageSearchNote ? <p className="text-xs text-muted-foreground">{imageSearchNote}</p> : null}
              {imageHits.map((hit) => (
                <div key={hit.id} className="rounded-xl border border-border bg-card/70 px-3 py-3">
                  <p className="truncate text-sm font-medium">{hit.title}</p>
                  {hit.caption ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{hit.caption}</p> : null}
                  {hit.latex ? <p className="mt-1 font-mono text-[11px] text-muted-foreground">{hit.latex}</p> : null}
                  <p className="mt-1 text-[11px] text-muted-foreground">similitud {(hit.score * 100).toFixed(0)}%</p>
                </div>
              ))}
            </div>
          </div>
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
  featured = false,
}: {
  id: ActivityId;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: ActivityId) => void;
  delay?: number;
  featured?: boolean;
}) {
  const item = ACTIVITY_MAP[id];
  const Icon = ICONS[id];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(id)}
      className={`animate-rise flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition disabled:opacity-50 ${
        selected
          ? "bg-primary text-primary-foreground shadow-sm"
          : featured
            ? "border border-primary/25 bg-primary/8 hover:bg-primary/12"
            : "hover:bg-muted"
      }`}
      style={{ animationDelay: `${delay}ms` }}
      aria-current={selected ? "page" : undefined}
    >
      <span className={`mt-0.5 font-mono text-[11px] ${selected ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
        {featured ? "★" : item.number}
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
        {activityLabel === "Preguntar" ? (
          <>
            Todo en un solo chat: cuentas, dudas, textos o código. Taller elige la herramienta. También puedes usar una especialidad o
            cambiar la cara de Taller.
          </>
        ) : (
          <>
            Estás en <span className="font-medium text-foreground">{activityLabel}</span>. Escribe abajo o elige un comienzo. También
            puedes volver a <span className="font-medium text-foreground">Preguntar</span> para no elegir oficio.
          </>
        )}
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
  feedbackEnabled = false,
  correcting = false,
  correctionDraft = "",
  onGood,
  onBad,
  onCorrectionChange,
  onCorrectionSubmit,
  onCorrectionCancel,
  onStyle,
}: {
  message: StoredMessage;
  pending: boolean;
  delay?: number;
  feedbackEnabled?: boolean;
  correcting?: boolean;
  correctionDraft?: string;
  onGood?: () => void;
  onBad?: () => void;
  onCorrectionChange?: (value: string) => void;
  onCorrectionSubmit?: () => void;
  onCorrectionCancel?: () => void;
  onStyle?: (style: "corto" | "informativo" | "natural") => void;
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
            {pending && !message.content && <span className="text-xs text-muted-foreground">Pensando…</span>}
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
          <MarkdownView
            text={message.content || (pending ? "" : "…")}
            images={message.images}
            sources={message.sources}
          />
        )}
        {feedbackEnabled && (
          <div className="mt-3 space-y-2 border-t border-border/70 pt-2">
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => onStyle?.("corto")}>
                Más corto
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => onStyle?.("informativo")}>
                Más informativo
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => onStyle?.("natural")}>
                Más natural
              </Button>
            </div>
            {correcting ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">¿Cuál era la respuesta correcta? La guardo para la próxima vez.</p>
                <Textarea
                  value={correctionDraft}
                  rows={2}
                  className="min-h-14 text-sm"
                  placeholder="Escribe la respuesta correcta…"
                  onChange={(event) => onCorrectionChange?.(event.target.value)}
                />
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={onCorrectionSubmit} disabled={!correctionDraft.trim()}>
                    Aprender
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={onCorrectionCancel}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">¿Le sirvió?</span>
                <Button type="button" size="sm" variant="outline" onClick={onGood}>
                  Bien
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={onBad}>
                  Mal
                </Button>
              </div>
            )}
          </div>
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
          <p>Si se equivoca, marca Mal o escribe «está mal, la respuesta es…». Guarda la corrección y la reutiliza solo.</p>
          <p>RAG: indexa documentos en Conocimiento, recupera fragmentos por similitud y los usa al responder. Investigar también indexa fuentes en vivo.</p>
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
  lessons: Lesson[];
  documents: RagDocument[];
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
      lessons?: unknown;
      documents?: unknown;
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
      lessons: sanitizeLessons(parsed.lessons),
      documents: sanitizeDocuments(parsed.documents),
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
        images: Array.isArray(message.images)
          ? message.images
              .filter((image) => image && typeof image.url === "string" && image.url.startsWith("http"))
              .slice(0, 3)
              .map((image) => ({
                url: image.url,
                title: typeof image.title === "string" ? image.title.slice(0, 120) : undefined,
              }))
          : undefined,
        sources: Array.isArray(message.sources)
          ? message.sources
              .filter((source) => source && typeof source.title === "string")
              .slice(0, 12)
              .map((source) => ({
                title: source.title.slice(0, 160),
                url: typeof source.url === "string" ? source.url.slice(0, 500) : "",
              }))
          : undefined,
      }));
  }
  return clean;
}
