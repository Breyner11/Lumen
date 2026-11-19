/**
 * Ronda 3 — preguntas NUEVAS; el modelo qwen2.5:7b genera de verdad.
 * skipKnownFichas=true. «dato correcto» = wiki-verify-independent (no el modelo).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { independentFactCheck } from "../lib/search/wiki-verify-independent";
import { researchBrief } from "../lib/tools/research";

const MODEL = process.env.OLLAMA_QUALITY_MODEL?.trim() || "qwen2.5:7b";

/** 15 preguntas nuevas (no estaban en ronda 2). Incluye 2 trampas. */
const QUESTIONS: Array<{ q: string; tag: string }> = [
  { q: "¿Dónde nació Simón Bolívar y en qué año?", tag: "historia" },
  { q: "¿Qué significa la sigla ADN?", tag: "ciencia" },
  { q: "¿Dónde nace el río Magdalena?", tag: "Colombia" },
  { q: "¿Quién fue Policarpa Salavarrieta?", tag: "persona" },
  { q: "Explica qué es la fotosíntesis en pocas palabras", tag: "ciencia" },
  { q: "¿Cuál es la velocidad de la luz en el vacío?", tag: "cifras" },
  { q: "¿Quién fue Hipatia de Alejandría?", tag: "persona" },
  { q: "¿Para qué sirve la insulina en el cuerpo humano?", tag: "salud" },
  { q: "¿Qué mejora HTTP/2 respecto a HTTP/1.1?", tag: "tecnología" },
  { q: "¿Qué es el campus virtual de la UNAD?", tag: "UNAD" },
  { q: "¿Qué es Apache Parquet y para qué se usa?", tag: "tecnología" },
  { q: "¿Cuál es la capital de Canadá?", tag: "cifras" },
  { q: "¿Qué es un neutrón?", tag: "ciencia" },
  // Trampas
  { q: "¿En qué año Colombia ganó el Mundial de fútbol?", tag: "trampa" },
  { q: "¿Desde cuándo el Vaticano es un departamento de Colombia?", tag: "trampa" },
];

function structureOk(answer: string): boolean {
  if (!answer || answer.length < 40) return false;
  if (/No pude responder|No encontré información/i.test(answer)) return false;
  return /^- \*\*/m.test(answer) || /\*\*[^*]+\*\*:/.test(answer) || answer.length > 120;
}

async function warmOllama() {
  await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      keep_alive: "30m",
      messages: [{ role: "user", content: "responde solo: ok" }],
      options: { num_predict: 4, num_ctx: 512 },
    }),
  }).catch(() => null);
}

type ModeResult = {
  ms: number;
  firstTokenMs?: number;
  clara: boolean;
  estructura: boolean;
  dato: boolean;
  wikiIssues: string[];
  evidence: Array<{ title: string; url: string; snippet: string; engine: string }>;
  clarityNote: string;
  enginesUsed: string[];
  enginesTried: string[];
  answerSource?: string;
  usedWeb: boolean;
  pasa: boolean;
  answer: string;
  falsePremise?: boolean;
};

async function main() {
  process.env.LUMEN_BENCH_NO_FICHAS = "1";
  console.error("Warming Ollama qwen2.5:7b…");
  await warmOllama();

  const rows: Array<{ n: number; q: string; tag: string; modes: Record<string, ModeResult> }> = [];

  for (let i = 0; i < QUESTIONS.length; i += 1) {
    const { q, tag } = QUESTIONS[i]!;
    const entry: (typeof rows)[0] = { n: i + 1, q, tag, modes: {} };

    for (const mode of [
      { key: "apagado", webSearch: false as const },
      { key: "auto", webSearch: "auto" as const },
    ]) {
      const t0 = Date.now();
      let result: Awaited<ReturnType<typeof researchBrief>>;
      try {
        result = await researchBrief(q, {
          webSearch: mode.webSearch,
          ollamaModel: MODEL,
          useMultiEngines: true,
          skipKnownFichas: true,
        });
      } catch (err) {
        result = {
          applicable: false,
          answer: String(err),
          notes: "",
          images: [],
          sources: [],
          clarity: { clear: false, reasons: ["error"], note: String(err) },
          enginesUsed: [],
          enginesTried: [],
          answerSource: "empty",
          totalMs: Date.now() - t0,
        };
      }
      const ms = result.totalMs ?? Date.now() - t0;
      const answer = result.answer || "";
      const clara = Boolean(result.clarity?.clear);
      const estructura = structureOk(answer);
      const wiki = await independentFactCheck(q, answer);
      const dato = wiki.ok;
      const pasa = clara && estructura && dato && result.applicable !== false;
      // Fuente debe ser modelo (no ficha memorizada)
      if (result.answerSource === "known_lexical") {
        wiki.issues.push("respuesta desde ficha léxica (no debería en ronda3)");
      }

      entry.modes[mode.key] = {
        ms,
        firstTokenMs: result.firstTokenMs,
        clara,
        estructura,
        dato: wiki.ok,
        wikiIssues: wiki.issues,
        evidence: wiki.evidence,
        clarityNote: result.clarity?.note || "",
        enginesUsed: (result.enginesUsed || []) as string[],
        enginesTried: (result.enginesTried || []) as string[],
        answerSource: result.answerSource,
        usedWeb: Boolean(result.usedWeb),
        pasa: clara && estructura && wiki.ok && result.applicable !== false,
        answer: answer.slice(0, 4000),
        falsePremise: wiki.falsePremise,
      };

      const eng =
        (result.enginesUsed || []).join(",") ||
        ((result.enginesTried || []).length
          ? `tried:${(result.enginesTried || []).join(",")}`
          : "—");
      console.error(
        `[${i + 1}/15] ${mode.key} total=${(ms / 1000).toFixed(1)}s ttft=${
          result.firstTokenMs != null ? `${(result.firstTokenMs / 1000).toFixed(1)}s` : "?"
        } src=${result.answerSource || "?"} clara=${clara} dato=${wiki.ok} eng=${eng}`,
      );
    }
    rows.push(entry);
  }

  const out =
    process.env.RONDA_OUT ||
    "/cursor/stores/bc-5d1cb9af-f0f6-4e0f-bec1-c7357ba0781a/internal/ronda3.md";
  mkdirSync(dirname(out), { recursive: true });

  const now = new Date();
  const bogota = now.toLocaleString("es-CO", { timeZone: "America/Bogota" });
  const passOff = rows.filter((r) => r.modes.apagado!.pasa).length;
  const passAuto = rows.filter((r) => r.modes.auto!.pasa).length;
  const modelOff = rows.filter((r) => r.modes.apagado!.answerSource === "model").length;
  const modelAuto = rows.filter((r) => r.modes.auto!.answerSource === "model").length;

  const lines: string[] = [];
  lines.push("---");
  lines.push("cursor:");
  lines.push('  subagentId: "bc-ec2a049a-15a9-43a6-83d8-cd2d904b95be"');
  lines.push("---");
  lines.push("");
  lines.push("# Ronda 3 — bench honesto (preguntas nuevas, modelo real)");
  lines.push("");
  lines.push(
    `Modelo: \`${MODEL}\`. **skipKnownFichas=true**. Sin ensayos memorizados de ronda 2.`,
  );
  lines.push(
    "«dato correcto» = `independentFactCheck` (Wikipedia/Wikidata API), con evidencia citada. No el 7B ni juicio manual.",
  );
  lines.push(`Generado (UTC): \`${now.toISOString()}\` → America/Bogota: \`${bogota}\``);
  lines.push("");
  lines.push("## Resumen (honesto)");
  lines.push("");
  lines.push(`- **Apagado:** ${passOff}/15`);
  lines.push(`- **Auto:** ${passAuto}/15`);
  lines.push(
    `- Origen modelo (no ficha): Apagado ${modelOff}/15, Auto ${modelAuto}/15`,
  );
  lines.push(
    "- Preferimos un score real bajo a un 16/16 falso. Las trampas deben **rechazar** la premisa.",
  );
  lines.push("");
  lines.push(
    "| # | Tag | Pregunta | Apagado | Auto | Dato off | Dato auto | Fuente off | Fuente auto | Motores (auto usados) | TTFT off | Total off | TTFT auto | Total auto |",
  );
  lines.push(
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );

  for (const r of rows) {
    const a = r.modes.apagado!;
    const u = r.modes.auto!;
    const engUsed = (u.enginesUsed || []).join(", ") || "—";
    lines.push(
      `| ${r.n} | ${r.tag} | ${r.q} | ${a.pasa ? "pasa" : "falla"} | ${u.pasa ? "pasa" : "falla"} | ${a.dato ? "sí" : "no"} | ${u.dato ? "sí" : "no"} | ${a.answerSource || "?"} | ${u.answerSource || "?"} | ${engUsed} | ${
        a.firstTokenMs != null ? `${(a.firstTokenMs / 1000).toFixed(1)}s` : "—"
      } | ${(a.ms / 1000).toFixed(1)}s | ${
        u.firstTokenMs != null ? `${(u.firstTokenMs / 1000).toFixed(1)}s` : "—"
      } | ${(u.ms / 1000).toFixed(1)}s |`,
    );
  }

  lines.push("");
  lines.push("## Fallas");
  lines.push("");
  let any = false;
  for (const r of rows) {
    for (const [key, label] of [
      ["apagado", "Apagado"],
      ["auto", "Auto"],
    ] as const) {
      const m = r.modes[key]!;
      if (m.pasa) continue;
      any = true;
      lines.push(
        `- **${label}** — ${r.q}: clara=${m.clara ? "sí" : "no"}, estructura=${m.estructura ? "sí" : "no"}, dato=${m.dato ? "sí" : "no"}; wiki: ${m.wikiIssues.join("; ") || "—"}; src=${m.answerSource}; nota: ${m.clarityNote || "—"}`,
      );
    }
  }
  if (!any) lines.push("- Ninguna (revisar que no sea sobreajuste).");

  for (const mode of [
    ["apagado", "Apagado"],
    ["auto", "Auto"],
  ] as const) {
    lines.push("");
    lines.push(`## Respuestas — ${mode[1]}`);
    for (const r of rows) {
      const m = r.modes[mode[0]]!;
      lines.push("");
      lines.push(`### ${r.n}. [${r.tag}] ${r.q}`);
      lines.push("");
      lines.push(
        `- TTFT (primera pieza Ollama): **${
          m.firstTokenMs != null ? `${(m.firstTokenMs / 1000).toFixed(2)}s` : "n/d"
        }**`,
      );
      lines.push(`- Tiempo total: **${(m.ms / 1000).toFixed(1)}s**`);
      lines.push(`- Origen: **${m.answerSource || "?"}**`);
      lines.push(`- Clara: **${m.clara ? "sí" : "no"}**${m.clarityNote ? ` — ${m.clarityNote}` : ""}`);
      lines.push(`- Estructura: **${m.estructura ? "sí" : "no"}**`);
      lines.push(
        `- Dato correcto (Wiki independiente): **${m.dato ? "sí" : "no"}**${
          m.wikiIssues.length ? ` — ${m.wikiIssues.join("; ")}` : ""
        }`,
      );
      if (m.falsePremise) lines.push("- Premisa falsa esperada: **sí** (debe rechazarse)");
      lines.push(
        `- Motores usados (con hits): **${(m.enginesUsed || []).join(", ") || "—"}**`,
      );
      lines.push(
        `- Motores intentados: **${(m.enginesTried || []).join(", ") || "—"}**`,
      );
      lines.push(`- Resultado: **${m.pasa ? "pasa" : "falla"}**`);
      if (m.evidence.length) {
        lines.push("");
        lines.push("**Evidencia Wiki/Wikidata**");
        for (const e of m.evidence.slice(0, 4)) {
          lines.push(`- [${e.engine}] [${e.title}](${e.url}) — ${e.snippet.replace(/\n/g, " ")}`);
        }
      }
      lines.push("");
      lines.push("```");
      lines.push(m.answer || "(vacío)");
      lines.push("```");
    }
  }

  writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
  console.error(`Wrote ${out}`);
  console.log(
    JSON.stringify(
      {
        passOff,
        passAuto,
        modelOff,
        modelAuto,
        total: 15,
        out,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
