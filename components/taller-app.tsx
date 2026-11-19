"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Clock3,
  Library,
  MessageCircle,
  Mic,
  Moon,
  Palette,
  PanelRight,
  Plus,
  Settings,
  Square,
  Sun,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import { LumenLogo } from "@/components/lumen-logo";
import { FirstRunSetup } from "@/components/first-run-setup";
import { SettingsSheet } from "@/components/settings-sheet";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import {
  DEFAULT_SEARCH_ENGINE_PREFS,
  sanitizeSearchEnginePrefs,
  type SearchEnginePrefs,
} from "@/lib/search/engines";
import { ACTIVITY_MAP, MODEL_LABEL } from "@/lib/activities";
import { buildBackup, downloadJson, parseBackup } from "@/lib/backup";
import { chatToMarkdown, downloadDocx, downloadText, openPrintablePdf } from "@/lib/export-doc";
import { DEFAULT_QUALITY_MODEL } from "@/lib/ollama-models";
import { syncLessonToEngine } from "@/lib/rag/sync-lesson";
import { STYLE_QUICK_PROMPTS } from "@/lib/style";
import {
  confirmDestructive,
  handleAssistantIntent,
  sanitizeTasks,
  type AssistantTask,
  type PendingDestructive,
} from "@/lib/tools/assistant";
import { looksLikeMath } from "@/lib/tools/route";
import { EMPTY_USER_MEMORY, sanitizeUserMemory, type UserMemory } from "@/lib/user-memory";
import { buildDayBrief } from "@/lib/tools/day-brief";
import {
  answerUnadCampusFaq,
  looksLikeUnadCampus,
  SEED_UNAD_KB,
  sanitizeUnadKb,
  type UnadKbArticle,
} from "@/lib/tools/unad";
import { speakSpanish, stopSpeaking } from "@/lib/voice";
import { formatHistoryTime } from "@/lib/history";
import {
  createEmptySession,
  ensureSessions,
  sanitizeSessions,
  sessionsFromThreads,
  titleFromMessages,
  type ChatSession,
} from "@/lib/sessions";
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
import { splitToolBadge } from "@/lib/tool-badge";
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

const STORAGE_KEY = "taller-receta-v3";
const THEME_KEY = "lumen-theme";
const EMPTY_THREAD: StoredMessage[] = [];
const activity: ActivityId = "preguntar";

type Status = "loading" | "taller" | "model";
type ThemeMode = "light" | "dark";

export function TallerApp() {
  const [model, setModel] = useState<ModelId>("flash");
  const [effort, setEffort] = useState<Effort>("high");
  const [thinking, setThinking] = useState(true);
  const [skin, setSkin] = useState<SkinId>("brisa");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [clock, setClock] = useState(0);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [activitiesOpen, setActivitiesOpen] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [skinsOpen, setSkinsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showFirstRun, setShowFirstRun] = useState(true);
  const [webSearch, setWebSearch] = useState<boolean | "auto">(false);
  const [searchEngines, setSearchEngines] = useState<SearchEnginePrefs>(DEFAULT_SEARCH_ENGINE_PREFS);
  const [ollamaModel, setOllamaModel] = useState<string>(DEFAULT_QUALITY_MODEL);
  const [userMemory, setUserMemory] = useState<UserMemory>(EMPTY_USER_MEMORY);
  const [tasks, setTasks] = useState<AssistantTask[]>([]);
  const [unadKb, setUnadKb] = useState<UnadKbArticle[]>(SEED_UNAD_KB);
  const [pendingDestructive, setPendingDestructive] = useState<PendingDestructive | null>(null);
  const [dayBrief, setDayBrief] = useState("");
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
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const activeSessionIdRef = useRef(activeSessionId);
  const current = ACTIVITY_MAP.preguntar;
  const thread = useMemo(
    () => sessions.find((session) => session.id === activeSessionId)?.messages ?? EMPTY_THREAD,
    [sessions, activeSessionId],
  );
  const previousChats = useMemo(
    () =>
      [...sessions]
        .filter((session) => session.messages.length > 0 || session.id === activeSessionId)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions, activeSessionId],
  );

  function applyTheme(next: ThemeMode) {
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem(THEME_KEY, next);
  }

  function toggleTheme() {
    applyTheme(theme === "dark" ? "light" : "dark");
  }

  /* eslint-disable react-hooks/set-state-in-effect -- restore localStorage after hydration */
  useEffect(() => {
    setClock(Date.now());
    const storedTheme = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(storedTheme === "dark" || storedTheme === "light" ? storedTheme : prefersDark ? "dark" : "light");
    const stored = readStorage();
    if (stored) {
      setModel(stored.model);
      setEffort(stored.effort);
      setThinking(stored.thinking);
      setSkin(stored.skin);
      const ensured = ensureSessions(stored.sessions, stored.activeSessionId);
      setSessions(ensured.sessions);
      setActiveSessionId(ensured.activeId);
      setLessons(stored.lessons);
      setDocuments(stored.documents.length ? stored.documents : seedDocuments());
      setWebSearch(stored.webSearch ?? false);
      setSearchEngines(sanitizeSearchEnginePrefs(stored.searchEngines));
      setOllamaModel(stored.ollamaModel || DEFAULT_QUALITY_MODEL);
      setUserMemory(stored.memory || EMPTY_USER_MEMORY);
      setTasks(stored.tasks || []);
      setUnadKb(stored.unadKb || SEED_UNAD_KB);
      document.documentElement.dataset.skin = stored.skin;
    } else {
      const ensured = ensureSessions([createEmptySession()]);
      setSessions(ensured.sessions);
      setActiveSessionId(ensured.activeId);
      setDocuments(seedDocuments());
      document.documentElement.dataset.skin = "brisa";
    }
    setReady(true);
    setDayBrief(
      buildDayBrief({
        tasks: readStorage()?.tasks || [],
        memory: readStorage()?.memory || EMPTY_USER_MEMORY,
      }),
    );
    void fetch("/api/ollama/models")
      .then(async (response) => {
        if (!response.ok) {
          setStatus("taller");
          return;
        }
        const body = (await response.json()) as {
          recommended?: string;
          models?: Array<{ id: string; installed?: boolean; recommended?: boolean }>;
        };
        const storedModel = readStorage()?.ollamaModel;
        if (!storedModel && body.recommended) setOllamaModel(body.recommended);
        const installed = body.models?.some((m) => m.id === (storedModel || body.recommended) && m.installed);
        setStatus(installed ? "taller" : "taller");
      })
      .catch(() => setStatus("taller"));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.skin = skin;
  }, [skin, ready]);

  useEffect(() => {
    if (!ready || !activeSessionId) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        model,
        effort,
        thinking,
        skin,
        sessions,
        activeSessionId,
        lessons,
        documents,
        webSearch,
        searchEngines,
        ollamaModel,
        memory: userMemory,
        tasks,
        unadKb,
      }),
    );
  }, [
    model,
    effort,
    thinking,
    skin,
    sessions,
    activeSessionId,
    lessons,
    documents,
    webSearch,
    searchEngines,
    ollamaModel,
    userMemory,
    tasks,
    unadKb,
    ready,
  ]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [thread, streaming, activeSessionId, learnNote]);

  const previewPrompt = useMemo(() => {
    const historyTurns = thread.map((message) => ({ role: message.role, content: message.content }));
    const pending = draft.trim();
    const messages = pending ? [...historyTurns, { role: "user" as const, content: pending }] : historyTurns;
    return composeRecipePreview({ activity, model, effort, thinking, messages });
  }, [activity, model, effort, thinking, thread, draft]);

  function updateActiveMessages(updater: (messages: StoredMessage[]) => StoredMessage[]) {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;
    setSessions((current) =>
      current.map((session) => {
        if (session.id !== sessionId) return session;
        const messages = updater(session.messages);
        return {
          ...session,
          messages,
          title: titleFromMessages(messages),
          updatedAt: Date.now(),
        };
      }),
    );
  }

  function newChat() {
    if (streaming) return;
    const next = createEmptySession();
    setSessions((current) => {
      const active = current.find((session) => session.id === activeSessionId);
      const kept =
        active && active.messages.length === 0
          ? current.filter((session) => session.id !== activeSessionId)
          : current;
      return [next, ...kept].slice(0, 40);
    });
    setActiveSessionId(next.id);
    setDraft("");
    setError("");
    setCorrectingIndex(null);
    setActivitiesOpen(false);
  }

  function openChat(sessionId: string) {
    if (streaming) return;
    setActiveSessionId(sessionId);
    setDraft("");
    setError("");
    setCorrectingIndex(null);
    setActivitiesOpen(false);
  }

  function deleteChat(sessionId: string) {
    if (streaming) return;
    const remaining = sessions.filter((session) => session.id !== sessionId);
    const ensured = ensureSessions(remaining);
    setSessions(ensured.sessions);
    if (sessionId === activeSessionId) {
      setActiveSessionId(ensured.activeId);
    }
    setDraft("");
    setError("");
  }

  function chooseSkin(next: SkinId) {
    setSkin(next);
    document.documentElement.dataset.skin = next;
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
    const list = thread;
    const assistant = list[assistantIndex];
    const question = [...list.slice(0, assistantIndex)].reverse().find((message) => message.role === "user");
    if (!assistant || assistant.role !== "assistant" || !question) return;
    learnFromCorrection(question.content, assistant.content, "Confirmado como correcto");
  }

  function submitCorrection(assistantIndex: number) {
    const list = thread;
    const question = [...list.slice(0, assistantIndex)].reverse().find((message) => message.role === "user");
    const answer = correctionDraft.trim();
    if (!question || !answer) return;
    learnFromCorrection(question.content, answer, "Corregido con Mal");
    updateActiveMessages((current) => {
      const next = [...current];
      if (next[assistantIndex]?.role === "assistant") {
        next[assistantIndex] = {
          ...next[assistantIndex]!,
          content: `${answer}\n\n_Aprendí esta corrección. Gracias._`,
        };
      }
      return next;
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
    const previewUrl = URL.createObjectURL(file);
    const userMessage: StoredMessage = {
      role: "user",
      content: `📷 Imagen: ${file.name}\n(Problema matemático / apunte)`,
    };
    const placeholder: StoredMessage = { role: "assistant", content: "", mode: "taller" };
    updateActiveMessages((current) => [...current, userMessage, placeholder]);
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
      if (!answer.includes("Herramienta:")) {
        answer = `_Herramienta: Calcular_\n\n${answer}`;
      }
      updateActiveMessages((current) => {
        const list = [...current];
        const last = list[list.length - 1];
        if (last?.role === "assistant") {
          list[list.length - 1] = { ...last, content: answer, mode: "taller" };
        }
        return list;
      });
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
      // Si piden resumen/estudio o solo adjuntan el archivo, genera ficha de estudio.
      const wantsStudy =
        !base.trim() ||
        /\b(resume|resumen|ideas\s+clave|preguntas\s+de\s+estudio|estudia\s+(este|el)\s+archivo)\b/i.test(
          base,
        );
      if (wantsStudy) {
        const studyResponse = await fetch("/api/documents/study", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: json.title || file.name,
            text: json.text,
            ollamaModel,
          }),
        });
        const study = (await studyResponse.json()) as { answer?: string; error?: string };
        if (study.answer) {
          chunks.push(study.answer);
          continue;
        }
      }
      chunks.push(
        [
          `Documento adjunto «${json.title || file.name}»${json.indexed ? " (indexado local)" : ""}:`,
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

    // Si parece cuenta: prefer SymPy engine.
    if (looksLikeMath(content)) {
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
          const answer = !json.answer!.includes("Herramienta:")
              ? `_Herramienta: Calcular_\n\n${json.answer}`
              : json.answer!;
          const historyTurns: StoredMessage[] = [
            ...thread,
            { role: "user", content },
            { role: "assistant", content: answer, mode: "taller" },
          ];
          updateActiveMessages(() => historyTurns);
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
        updateActiveMessages((current) => [...current, { role: "user", content }, ack]);
        setDraft("");
        return;
      }
    }

    // Asistente local: tareas, revisión PC mock y borrados con confirmación.
    if (/^confirmar\s+borrado\b/i.test(content) && pendingDestructive) {
      const result = confirmDestructive(pendingDestructive);
      setPendingDestructive(null);
      updateActiveMessages((current) => [
        ...current,
        { role: "user", content },
        { role: "assistant", content: result, mode: "taller" },
      ]);
      setDraft("");
      return;
    }
    const assistant = handleAssistantIntent(content, tasks);
    if (assistant.applicable) {
      if (assistant.tasks) setTasks(assistant.tasks);
      if (assistant.pending) setPendingDestructive(assistant.pending);
      updateActiveMessages((current) => [
        ...current,
        { role: "user", content },
        {
          role: "assistant",
          content: `_Herramienta: Asistente_\n\n${assistant.answer}`,
          mode: "taller",
        },
      ]);
      setDraft("");
      return;
    }
    if (looksLikeUnadCampus(content)) {
      const faq = answerUnadCampusFaq(content, unadKb);
      updateActiveMessages((current) => [
        ...current,
        { role: "user", content },
        {
          role: "assistant",
          content: `_Herramienta: Campus UNAD_\n\n${faq.answer}`,
          mode: "taller",
        },
      ]);
      setDraft("");
      return;
    }

    const historyTurns = [...thread, { role: "user" as const, content }];
    const placeholder: StoredMessage = { role: "assistant", content: "", reasoning: "", mode: "taller" };
    updateActiveMessages(() => [...historyTurns, placeholder]);
    setDraft("");
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const target = activity;
    const sessionId = activeSessionIdRef.current;
    let answerPreview = "";
    let sawDone = false;

    const patchAssistant = (patch: Partial<StoredMessage>) => {
      setSessions((currentSessions) =>
        currentSessions.map((session) => {
          if (session.id !== sessionId) return session;
          const list = session.messages;
          const last = list[list.length - 1];
          if (!last || last.role !== "assistant") return session;
          const next = [...list];
          next[next.length - 1] = { ...last, ...patch };
          return {
            ...session,
            messages: next,
            title: titleFromMessages(next),
            updatedAt: Date.now(),
          };
        }),
      );
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
          webSearch,
          searchEngines,
          ollamaModel,
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
              patchAssistant({ content: payload.text || "Pensando…" });
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
            setSessions((currentSessions) =>
              currentSessions.map((session) => {
                if (session.id !== sessionId) return session;
                const list = session.messages;
                const last = list[list.length - 1];
                if (!last || last.role !== "assistant") return session;
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
                return {
                  ...session,
                  messages: next,
                  title: titleFromMessages(next),
                  updatedAt: Date.now(),
                };
              }),
            );
          }
        }
      }
      if (!sawDone && !answerPreview) {
        const fallback =
          "La conexión se cerró antes de recibir la respuesta. Revisa que Ollama esté en marcha e inténtalo de nuevo.";
        setError(fallback);
        patchAssistant({ content: fallback, mode: "taller" });
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

  return (
    <div className="flex h-dvh text-foreground">
      <aside className="glass-panel m-3 hidden w-[17.5rem] shrink-0 flex-col overflow-hidden rounded-[1.4rem] md:flex">
        <div className="px-5 pt-6 pb-4">
          <div className="flex items-center gap-2.5 text-primary">
            <LumenLogo className="size-8" />
            <p className="text-[1.65rem] font-semibold leading-none tracking-tight">{APP_NAME}</p>
          </div>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">{APP_TAGLINE}</p>
        </div>
        <nav className="flex-1 space-y-3 overflow-y-auto px-3 pb-3" aria-label="Chats">
          <button
            type="button"
            disabled={streaming}
            onClick={newChat}
            className={`animate-rise flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition disabled:opacity-50 ${
              thread.length === 0
                ? "bg-primary text-primary-foreground shadow-sm"
                : "border border-primary/25 bg-primary/8 hover:bg-primary/12"
            }`}
          >
            <span className={`mt-0.5 font-mono text-[11px] ${thread.length === 0 ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
              ★
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <MessageCircle className="size-3.5" />
                Preguntar
              </span>
              <span className={`mt-0.5 block text-xs leading-4 ${thread.length === 0 ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
                Un solo chat: calcula, investiga, escribe o programa según lo que digas.
              </span>
            </span>
          </button>
          <div>
            <div className="mb-1 flex items-center justify-between gap-2 px-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Chats anteriores
              </p>
              <button
                type="button"
                disabled={streaming}
                onClick={newChat}
                className="text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
              >
                + Nuevo
              </button>
            </div>
            <div className="space-y-1">
              {previousChats.length === 0 ? (
                <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">
                  Cuando envíes un mensaje, el chat queda aquí para volver o borrarlo.
                </p>
              ) : (
                previousChats.map((session) => {
                  const selected = session.id === activeSessionId;
                  return (
                    <div
                      key={session.id}
                      className={`group flex items-start gap-1 rounded-xl px-1.5 py-1 ${
                        selected ? "bg-muted" : "hover:bg-muted/70"
                      }`}
                    >
                      <button
                        type="button"
                        disabled={streaming}
                        onClick={() => openChat(session.id)}
                        className="min-w-0 flex-1 rounded-lg px-1.5 py-1.5 text-left disabled:opacity-50"
                      >
                        <p className="truncate text-sm font-medium">{session.title}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {clock ? formatHistoryTime(session.updatedAt, clock) : "…"}
                          {session.messages.length
                            ? ` · ${session.messages.length} msg`
                            : " · vacío"}
                        </p>
                      </button>
                      <button
                        type="button"
                        disabled={streaming}
                        aria-label={`Eliminar ${session.title}`}
                        onClick={() => deleteChat(session.id)}
                        className="mt-1 rounded-md p-1.5 text-muted-foreground opacity-70 transition hover:bg-background hover:text-destructive group-hover:opacity-100 disabled:opacity-40"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </nav>
        <div className="space-y-2 border-t border-border/70 px-3 py-3">
          <Button variant="outline" className="w-full justify-start hover-lift" onClick={toggleTheme}>
            {theme === "dark" ? <Sun /> : <Moon />}
            {theme === "dark" ? "Modo claro" : "Modo oscuro"}
          </Button>
          <Button variant="outline" className="w-full justify-start" onClick={() => setSkinsOpen(true)}>
            <Palette />
            Interfaces
          </Button>
          <Button variant="ghost" className="w-full justify-start" onClick={() => setKnowledgeOpen(true)}>
            <Library />
            Mis documentos
            {documents.length > 0 && <Badge className="ml-auto" variant="secondary">{documents.length}</Badge>}
          </Button>
          <Button variant="ghost" className="w-full justify-start" onClick={() => setSettingsOpen(true)}>
            <Settings />
            Ajustes
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start"
            disabled={streaming || webSearch === false}
            onClick={() => void learnFromInternetNow()}
            title={
              webSearch === false
                ? "Activa Internet arriba para actualizar datos opcionales"
                : "Busca temas útiles y los guarda solo en este PC"
            }
          >
            <Wifi />
            {webSearch === false ? "Internet apagado" : "Actualizar datos (opcional)"}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mx-3 mt-3 flex items-center gap-2 rounded-[1.2rem] px-3 py-3 glass-panel md:mx-0 md:mt-3 md:mr-3 md:px-5">
          <Button variant="outline" className="md:hidden titlebar-no-drag" onClick={() => setActivitiesOpen(true)}>
            Menú
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <LumenLogo className="size-7 text-primary md:hidden" />
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold leading-none tracking-tight md:text-xl">
                <span className="md:hidden">{APP_NAME}</span>
                <span className="hidden md:inline">{current.label}</span>
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground md:text-sm">
                <span className="md:hidden">{APP_TAGLINE}</span>
                <span className="hidden md:inline">{current.blurb}</span>
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Modo claro" : "Modo oscuro"}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
          <StatusBadge status={status} />
          <Button variant="ghost" size="icon" className="xl:hidden" onClick={() => setRecipeOpen(true)} aria-label="Ver la receta">
            <PanelRight />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setKnowledgeOpen(true)} aria-label="Mis documentos">
            <Library />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} aria-label="Ajustes">
            <Settings />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setSkinsOpen(true)} aria-label="Interfaces">
            <Palette />
          </Button>
          <HowItWorks />
        </header>

        <div className="mx-3 mt-2 flex items-center gap-2 overflow-x-auto rounded-[1.1rem] px-3 py-2 glass-panel md:mx-0 md:mr-3">
          <Button
            variant={effort === "low" && !thinking ? "secondary" : "outline"}
            size="sm"
            aria-pressed={effort === "low" && !thinking}
            onClick={() => {
              setEffort("low");
              setThinking(false);
              setModel("flash");
            }}
            title="Respuestas más cortas y rápidas"
          >
            Rápido
          </Button>
          <Button
            variant={effort !== "low" || thinking ? "secondary" : "outline"}
            size="sm"
            aria-pressed={effort !== "low" || thinking}
            onClick={() => {
              setEffort("high");
              setThinking(true);
              setModel("pro");
            }}
            title="Respuestas más completas"
          >
            Detallado
          </Button>
          <Button
            variant={webSearch === false ? "secondary" : "outline"}
            size="sm"
            aria-pressed={webSearch === false}
            onClick={() => setWebSearch(false)}
            title="Responder sin internet"
          >
            Sin internet
          </Button>
          <Button
            variant={webSearch !== false ? "secondary" : "outline"}
            size="sm"
            aria-pressed={webSearch !== false}
            onClick={() =>
              setWebSearch(
                webSearch === false ? "auto" : webSearch === "auto" ? true : false,
              )
            }
            title="Ciclar: apagado → automático → siempre"
          >
            {webSearch === true ? "Internet: sí" : webSearch === "auto" ? "Internet: auto" : "Internet"}
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={newChat} disabled={streaming}>
            <Plus />
            Nuevo chat
          </Button>
        </div>

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
              <>
                {dayBrief ? (
                  <div className="mb-2 rounded-2xl border border-border/80 bg-card/70 px-4 py-3 text-sm leading-6">
                    <MarkdownView text={dayBrief} />
                  </div>
                ) : null}
                <WelcomeState
                  starters={[
                    ...current.starters.slice(0, 2),
                    "Ayúdame a estudiar con quiz y tarjetas: fotosíntesis",
                    "Cómo recupero la contraseña del campus UNAD",
                    "Verifica esta noticia: ...",
                  ]}
                  recent={previousChats.filter((session) => session.id !== activeSessionId && session.messages.length > 0).slice(0, 3)}
                  clock={clock}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSubmit={() => void send()}
                  onPick={(starter) => void send(starter)}
                  onOpenChat={openChat}
                  theme={theme}
                  onToggleTheme={toggleTheme}
                />
              </>
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
          className={`mx-auto mb-3 w-full max-w-2xl px-3 md:px-6 ${
            thread.length === 0 ? "hidden md:hidden" : ""
          }`}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {pendingFiles.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
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
          <div className="composer-capsule">
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
            <button
              type="button"
              className="composer-icon-btn"
              aria-label="Adjuntar documento, imagen o audio"
              disabled={streaming}
              onClick={() => attachInputRef.current?.click()}
            >
              <Plus className="size-5" />
            </button>
            <label className="sr-only" htmlFor="mensaje">
              Mensaje para {current.label}
            </label>
            <textarea
              ref={composerRef}
              id="mensaje"
              value={draft}
              placeholder="Pregunta lo que necesites…"
              disabled={streaming}
              rows={1}
              className="composer-input"
              onChange={(event) => {
                setDraft(event.target.value);
                const el = event.target;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              className="composer-icon-btn"
              aria-label="Grabar audio"
              disabled={streaming}
              onClick={() => void recordAndTranscribe()}
            >
              <Mic className="size-5" />
            </button>
            {streaming ? (
              <button
                type="button"
                className="composer-send"
                aria-label="Detener"
                onClick={() => abortRef.current?.abort()}
              >
                <Square className="size-4" />
              </button>
            ) : (
              <button
                type="submit"
                className="composer-send"
                aria-label="Enviar"
                disabled={!draft.trim() && pendingFiles.length === 0}
              >
                <ArrowUp className="size-5" />
              </button>
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
            <SheetTitle className="font-heading italic">Chats</SheetTitle>
          </SheetHeader>
          <div className="space-y-3 px-3 pb-6">
            <Button className="w-full justify-start" onClick={newChat} disabled={streaming}>
              <Plus />
              Nuevo chat
            </Button>
            <div className="space-y-1">
              {previousChats.map((session) => (
                <div key={session.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={streaming}
                    onClick={() => openChat(session.id)}
                    className={`min-w-0 flex-1 rounded-xl px-3 py-2 text-left text-sm ${
                      session.id === activeSessionId ? "bg-muted font-medium" : "hover:bg-muted/70"
                    }`}
                  >
                    <span className="block truncate">{session.title}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {clock ? formatHistoryTime(session.updatedAt, clock) : "…"}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={streaming}
                    aria-label={`Eliminar ${session.title}`}
                    onClick={() => deleteChat(session.id)}
                    className="rounded-md p-2 text-muted-foreground hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
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

      <Sheet open={knowledgeOpen} onOpenChange={setKnowledgeOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="font-heading italic">Mis documentos</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 px-1 pb-6">
            <p className="text-sm leading-6 text-muted-foreground">
              Pega apuntes o sube PDF, DOCX o TXT. Quedan solo en este PC y {APP_NAME} los usa para responder sin internet.
            </p>
            <label className="flex w-full cursor-pointer items-center justify-center rounded-xl border border-dashed border-border px-3 py-3 text-sm hover:bg-muted/50">
              Elegir carpeta o archivos (PDF, DOCX, TXT)
              <input
                type="file"
                multiple
                // @ts-expect-error webkitdirectory is non-standard but supported in Chromium/Edge
                webkitdirectory=""
                accept=".pdf,.docx,.txt,text/plain,application/pdf"
                className="sr-only"
                onChange={(event) => {
                  const files = event.target.files ? [...event.target.files] : [];
                  const usable = files.filter((file) =>
                    /\.(pdf|docx|txt)$/i.test(file.name) || file.type.startsWith("text/"),
                  );
                  if (usable.length) setPendingFiles((current) => [...current, ...usable].slice(0, 12));
                  event.target.value = "";
                }}
              />
            </label>
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
              Seis caras distintas para {APP_NAME}. Toca una y la app cambia al momento. Puedes volver a este panel cuando quieras.
            </DialogDescription>
          </DialogHeader>
          <SkinGallery current={skin} onSelect={chooseSkin} />
        </DialogContent>
      </Dialog>

      {showFirstRun ? (
        <FirstRunSetup ollamaModel={ollamaModel} onDone={() => setShowFirstRun(false)} />
      ) : null}

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        webSearch={webSearch}
        onWebSearchChange={setWebSearch}
        searchEngines={searchEngines}
        onSearchEnginesChange={setSearchEngines}
        ollamaModel={ollamaModel}
        onOllamaModelChange={setOllamaModel}
        memory={userMemory}
        onMemoryChange={setUserMemory}
        onExportBackup={() => {
          const stamp = new Date().toISOString().slice(0, 10);
          downloadJson(
            `lumen-backup-${stamp}.json`,
            buildBackup({
              sessions,
              lessons,
              documents,
              memory: userMemory,
              tasks,
              settings: { webSearch, searchEngines, ollamaModel, skin, theme },
            }),
          );
          setLearnNote("Copia de seguridad descargada (solo local).");
          window.setTimeout(() => setLearnNote(""), 4000);
        }}
        onImportBackup={(file) => {
          void file.text().then((raw) => {
            const parsed = parseBackup(raw);
            if ("error" in parsed) {
              setError(parsed.error);
              return;
            }
            const ensured = ensureSessions(parsed.sessions);
            setSessions(ensured.sessions);
            setActiveSessionId(ensured.activeId);
            setLessons(sanitizeLessons(parsed.lessons));
            setDocuments(sanitizeDocuments(parsed.documents));
            setUserMemory(sanitizeUserMemory(parsed.memory));
            setTasks(sanitizeTasks(parsed.tasks));
            if (parsed.settings?.webSearch === true || parsed.settings?.webSearch === false || parsed.settings?.webSearch === "auto") {
              setWebSearch(parsed.settings.webSearch);
            }
            if (typeof parsed.settings?.ollamaModel === "string") {
              setOllamaModel(parsed.settings.ollamaModel);
            }
            setLearnNote("Copia de seguridad restaurada.");
            window.setTimeout(() => setLearnNote(""), 4000);
          });
        }}
        unadKb={unadKb}
        onUnadKbChange={setUnadKb}
      />
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
                  {APP_NAME}
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

function WelcomeState({
  starters,
  recent,
  clock,
  draft,
  onDraftChange,
  onSubmit,
  onPick,
  onOpenChat,
  theme,
  onToggleTheme,
}: {
  starters: string[];
  recent: ChatSession[];
  clock: number;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onPick: (starter: string) => void;
  onOpenChat: (sessionId: string) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  return (
    <div className="animate-rise mx-auto flex w-full max-w-xl flex-col items-center px-1 pb-8 pt-8 md:pt-16">
      <div className="mb-5 flex flex-col items-center text-primary">
        <LumenLogo className="size-14 md:size-16" />
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground md:text-5xl">{APP_NAME}</h1>
        <p className="mt-2 max-w-md text-center text-sm leading-6 text-muted-foreground md:text-base">
          {APP_TAGLINE}
        </p>
      </div>

      <form
        className="w-full"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="composer-capsule">
          <span className="composer-icon-btn pointer-events-none opacity-70" aria-hidden>
            <Plus className="size-5" />
          </span>
          <input
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="Pregunta lo que necesites…"
            className="composer-input"
            aria-label="Buscar o preguntar"
          />
          <button
            type="submit"
            className="composer-send"
            disabled={!draft.trim()}
            aria-label="Enviar"
          >
            <ArrowUp className="size-5" />
          </button>
        </div>
      </form>

      <div className="mt-5 flex w-full flex-wrap justify-center gap-2">
        {starters.slice(0, 4).map((starter, index) => (
          <button
            key={starter}
            type="button"
            onClick={() => onPick(starter)}
            className="animate-cascade hover-lift rounded-full border border-border bg-card/90 px-3.5 py-2 text-left text-xs leading-5 text-foreground transition hover:border-primary/35 md:text-sm"
            style={{ animationDelay: `${80 + index * 40}ms` }}
          >
            {starter.replace(/```[a-z]*\n?|```/g, "").trim().slice(0, 48)}
          </button>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" className="hover-lift" onClick={onToggleTheme}>
          {theme === "dark" ? <Sun /> : <Moon />}
          {theme === "dark" ? "Claro" : "Oscuro"}
        </Button>
      </div>

      {recent.length > 0 && (
        <div className="mt-8 w-full">
          <p className="mb-3 flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground">
            <Clock3 className="size-4" />
            Chats anteriores
          </p>
          <div className="flex flex-col gap-2">
            {recent.map((session, index) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onOpenChat(session.id)}
                className="animate-cascade hover-lift rounded-2xl border border-border/80 bg-card px-3 py-2.5 text-left transition hover:border-primary/30"
                style={{ animationDelay: `${120 + index * 40}ms` }}
              >
                <p className="truncate text-sm font-medium">{session.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {clock ? formatHistoryTime(session.updatedAt, clock) : "…"}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function normalizeStatusLabel(text: string): string {
  const clean = text.replace(/^_+|_+$/g, "").trim();
  return clean || "Pensando…";
}

function isThinkingStatus(text: string): boolean {
  const clean = normalizeStatusLabel(text);
  if (!clean) return true;
  if (clean.length > 64) return false;
  return /^(Pensando|Buscando información|Preparando|Pensando sin internet)/i.test(clean);
}

function ThinkingStatus({ label }: { label: string }) {
  return (
    <p className="status-thinking font-heading text-[1.08rem] italic leading-snug tracking-wide text-muted-foreground">
      <span>{label.replace(/…$/, "")}</span>
      <span className="status-thinking-dots" aria-hidden="true">
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </p>
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
  const { tool, content: bodyContent } = mine
    ? { tool: undefined, content: message.content }
    : splitToolBadge(message.content);
  const showThinking = !mine && pending && isThinkingStatus(bodyContent || message.content);
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
            : "hover-lift rounded-3xl rounded-bl-md border border-border bg-card px-4 py-3 shadow-sm"
        }
      >
        {!mine && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{message.mode === "model" ? "DeepSeek" : APP_NAME}</Badge>
            {tool ? (
              <Badge variant="secondary" className="font-normal text-muted-foreground">
                {tool}
              </Badge>
            ) : null}
          </div>
        )}
        {message.reasoning && (
          <details className="mb-3 rounded-xl bg-muted/70 px-3 py-2 text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Ver pasos (opcional)
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{message.reasoning}</p>
          </details>
        )}
        {mine ? (
          <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
        ) : showThinking ? (
          <ThinkingStatus label={normalizeStatusLabel(bodyContent || message.content)} />
        ) : (
          <MarkdownView
            text={bodyContent || (pending ? "" : "…")}
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
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => {
                  const md = chatToMarkdown(
                    [{ role: "assistant", content: bodyContent || message.content }],
                    "Respuesta Lumen",
                  );
                  downloadText(`lumen-respuesta-${Date.now()}.md`, md);
                }}
              >
                Exportar MD
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() =>
                  downloadDocx(
                    `lumen-respuesta-${Date.now()}.docx`,
                    "Respuesta Lumen",
                    bodyContent || message.content,
                  )
                }
              >
                Exportar DOCX
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() =>
                  openPrintablePdf(
                    "Respuesta Lumen",
                    `<pre>${(bodyContent || message.content).replace(/</g, "&lt;")}</pre>`,
                  )
                }
              >
                PDF / imprimir
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => speakSpanish(bodyContent || message.content)}
              >
                Leer en voz alta
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => stopSpeaking()}
              >
                Silencio
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
  return (
    <Badge variant={status === "model" ? "default" : "secondary"}>
      {status === "model" ? "DeepSeek" : APP_NAME}
    </Badge>
  );
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
          <DialogTitle className="font-semibold tracking-tight">Bienvenido a {APP_NAME}</DialogTitle>
          <DialogDescription>
            Pregunta en el oficio que necesites. El historial guarda lo que buscaste. Las interfaces cambian solo la cara, no las
            herramientas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm leading-6">
          <p>Cada oficio tiene una herramienta local: cuentas, código, escritura, plan, traducción, resumen o investigación.</p>
          <p>Si se equivoca, marca Mal o escribe «está mal, la respuesta es…». Guarda la corrección y la reutiliza solo.</p>
          <p>Por defecto responde sin internet con el modelo local. Activa «Buscar en internet» solo si lo necesitas. Tus documentos viven en Conocimiento local.</p>
          <p>En Ajustes eliges el modelo Ollama (1.5B rápido o 7B recomendado), tu memoria personal y copias de seguridad JSON.</p>
          <p>Asistente: tareas, revisión del PC (lista blanca) y borrados solo con confirmación.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function readStorage(): {
  model: ModelId;
  effort: Effort;
  thinking: boolean;
  skin: SkinId;
  sessions: ChatSession[];
  activeSessionId: string | null;
  lessons: Lesson[];
  documents: RagDocument[];
  webSearch?: boolean | "auto";
  searchEngines?: SearchEnginePrefs;
  ollamaModel?: string;
  memory?: UserMemory;
  tasks?: AssistantTask[];
  unadKb?: UnadKbArticle[];
} | null {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem("taller-receta-v2") ??
      localStorage.getItem("taller-receta-v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      model?: ModelId;
      effort?: Effort;
      thinking?: boolean;
      skin?: string;
      sessions?: unknown;
      activeSessionId?: string;
      threads?: Partial<Record<ActivityId, StoredMessage[]>>;
      lessons?: unknown;
      documents?: unknown;
      webSearch?: boolean | "auto";
      searchEngines?: unknown;
      ollamaModel?: string;
      memory?: unknown;
      tasks?: unknown;
      unadKb?: unknown;
    };
    if (parsed.model !== "flash" && parsed.model !== "pro") return null;
    if (parsed.effort !== "low" && parsed.effort !== "high" && parsed.effort !== "max") return null;
    const skin = parsed.skin && isSkinId(parsed.skin) ? parsed.skin : "brisa";
    const fromSessions = sanitizeSessions(parsed.sessions);
    const sessions =
      fromSessions.length > 0
        ? fromSessions
        : sessionsFromThreads((parsed.threads as Partial<Record<ActivityId, StoredMessage[]>>) ?? {});
    return {
      model: parsed.model,
      effort: parsed.effort,
      thinking: Boolean(parsed.thinking),
      skin,
      sessions,
      activeSessionId: typeof parsed.activeSessionId === "string" ? parsed.activeSessionId : null,
      lessons: sanitizeLessons(parsed.lessons),
      documents: sanitizeDocuments(parsed.documents),
      webSearch:
        parsed.webSearch === true || parsed.webSearch === false || parsed.webSearch === "auto"
          ? parsed.webSearch
          : false,
      searchEngines: sanitizeSearchEnginePrefs(parsed.searchEngines),
      ollamaModel: typeof parsed.ollamaModel === "string" ? parsed.ollamaModel : undefined,
      memory: sanitizeUserMemory(parsed.memory),
      tasks: sanitizeTasks(parsed.tasks),
      unadKb: sanitizeUnadKb(parsed.unadKb),
    };
  } catch {
    return null;
  }
}
