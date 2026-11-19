/**
 * Ronda 2b: bench Investigar + «Ejemplos de ciudad».
 * «dato correcto» se revisa con reglas Wiki/Wikidata/DANE (no con el mismo modelo).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { researchBrief } from "../lib/tools/research";

const MODEL = process.env.OLLAMA_QUALITY_MODEL?.trim() || "qwen2.5:7b";

const QUESTIONS = [
  "¿Qué es la inflación y cómo afecta a una familia?",
  "Ejemplos de energías renovables",
  "¿Cuántos departamentos tiene Colombia?",
  "¿Qué diferencia hay entre clima y tiempo atmosférico?",
  "¿Cómo hago una cita en APA 7 de un libro?",
  "¿Qué es un algoritmo? Dame un ejemplo de la vida diaria",
  "Causas de la deforestación en la Amazonía colombiana",
  "¿Quién fue Gabriel García Márquez?",
  "¿Cómo funciona una vacuna?",
  "Resume la Revolución Francesa en pocas palabras",
  "¿Qué es el teorema de Pitágoras? Con un ejemplo",
  "Tips para concentrarme al estudiar",
  "¿Qué es la UNAD y qué carreras ofrece?",
  "¿Cuál es la capital de Australia?",
  "¿Cuánto es el 18% de 350?",
  "Ejemplos de ciudad",
];

function wikiFactCheck(question: string, answer: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  // Ignora pie de fuentes/motores (pueden mencionar Wikipedia sin ser scrape).
  const a = (answer || "")
    .split(/\n\*\*Fuentes\*\*/i)[0]
    ?.split(/\n_Motores/i)[0]
    ?.split(/\n_Nota de confianza/i)[0]
    ?.split(/\n_Respondido sin internet/i)[0]
    || "";
  const al = a.toLowerCase();

  if (/inflaci[oó]n/i.test(question)) {
    if (/10[.,]34\s*%/.test(a)) {
      issues.push("inflación 2022 Colombia no fue 10,34% (DANE: 13,12% anual)");
    }
    if (
      /\d+[.,]\d+\s*%/.test(a) &&
      !/13[.,]12|aproximad|verificar|sin una fuente|no cito|dato a verificar/i.test(a)
    ) {
      if (!/13[.,]12/.test(a)) {
        issues.push("cifra de inflación exacta sin verificación/hedge");
      }
    }
  }
  if (/renovables?/i.test(question)) {
    if (
      /medell[ií]n[^.!\n]{0,80}(e[oó]lica|turbina)/i.test(a) ||
      /turbinas e[oó]licas.{0,60}medell/i.test(a)
    ) {
      issues.push("eólica atribuida a Medellín (referente: La Guajira / Jepírachi)");
    }
  }
  if (/departamentos?/i.test(question) && /colombia/i.test(question)) {
    if (!/\b32\b/.test(a)) issues.push("falta 32 departamentos");
    if (
      /cundinamarca[^.!\n]{0,100}no es un departamento/i.test(al) ||
      (/cundinamarca[^.!\n]{0,40}es un distrito/i.test(al) && !/no digas que cundinamarca/i.test(al))
    ) {
      issues.push("Cundinamarca sí es departamento (Wiki)");
    }
  }
  if (/UNAD/i.test(question)) {
    if (
      /licenciatura en ciencias de la computaci[oó]n|doctorado en ciencias de la salud/i.test(a) &&
      !/no (tengo|estoy) segur|lista oficial|verificar|cat[aá]logo/i.test(a)
    ) {
      issues.push("carreras UNAD inventadas");
    }
  }
  if (/capital\s+de\s+australia|australia.*capital/i.test(question)) {
    if (!/canberra/i.test(a)) issues.push("falta Canberra");
    if (
      /nueva\s+gales|new\s+south\s+wales|\bnsw\b/i.test(a) &&
      !/territorio de la capital|capital australiana|\bact\b/i.test(a)
    ) {
      issues.push("Canberra está en el ACT, no en Nueva Gales del Sur");
    }
  }
  if (/18\s*%\s*de\s*350|350.*18\s*%/i.test(question)) {
    if (!/\b63\b/.test(a)) issues.push("18% de 350 = 63");
  }
  if (/ejemplos?\s+de\s+ciudad/i.test(question)) {
    if (/conurbaci[oó]n|enciclopedia libre|ciudad\s*-\s*wikipedia/i.test(a)) {
      issues.push("scrape/basura");
    }
    if (!/bogot|medell|cali/i.test(a)) issues.push("faltan ciudades CO claras");
  }

  return { ok: issues.length === 0, issues };
}

function structureOk(answer: string): boolean {
  if (!answer || answer.length < 40) return false;
  if (/No pude responder|No encontré información/i.test(answer)) return false;
  // Math answers may not use overview bullets.
  if (/18\s*%\s*de\s*350/i.test(answer) || /\b63\b/.test(answer)) return true;
  if (/Cálculo hecho con código/i.test(answer)) return true;
  return /^- \*\*/m.test(answer) || /\*\*[^*]+\*\*:/.test(answer);
}

type ModeResult = {
  ms: number;
  clara: boolean;
  estructura: boolean;
  dato: boolean;
  wikiIssues: string[];
  clarityNote: string;
  enginesUsed: string[];
  usedWeb: boolean;
  pasa: boolean;
  answer: string;
};

async function warmOllama() {
  await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      keep_alive: "30m",
      messages: [{ role: "user", content: "di ok" }],
      options: { num_predict: 4, num_ctx: 512 },
    }),
  }).catch(() => null);
}

async function main() {
  console.error("Warming Ollama…");
  await warmOllama();

  const rows: Array<{ n: number; q: string; modes: Record<string, ModeResult> }> = [];

  for (let i = 0; i < QUESTIONS.length; i += 1) {
    const q = QUESTIONS[i]!;
    const entry: { n: number; q: string; modes: Record<string, ModeResult> } = {
      n: i + 1,
      q,
      modes: {},
    };
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
        };
      }
      const ms = Date.now() - t0;
      const answer = result.answer || "";
      const clara = Boolean(result.clarity?.clear);
      const estructura = structureOk(answer);
      const wiki = wikiFactCheck(q, answer);
      const dato = wiki.ok;
      const pasa = clara && estructura && dato && result.applicable !== false;
      entry.modes[mode.key] = {
        ms,
        clara,
        estructura,
        dato,
        wikiIssues: wiki.issues,
        clarityNote: result.clarity?.note || "",
        enginesUsed: (result.enginesUsed || []) as string[],
        usedWeb: Boolean(result.usedWeb),
        pasa,
        answer: answer.slice(0, 3500),
      };
      console.error(
        `[${i + 1}/${QUESTIONS.length}] ${mode.key} ${(ms / 1000).toFixed(1)}s clara=${clara} dato=${dato} engines=${(result.enginesUsed || []).join(",") || "—"}`,
      );
    }
    rows.push(entry);
  }

  const storeInternal =
    process.env.RONDA_OUT ||
    "/cursor/stores/bc-5d1cb9af-f0f6-4e0f-bec1-c7357ba0781a/internal/ronda2b.md";
  mkdirSync(dirname(storeInternal), { recursive: true });

  const now = new Date();
  const bogota = now.toLocaleString("es-CO", { timeZone: "America/Bogota" });
  const passOff = rows.filter((r) => r.modes.apagado!.pasa).length;
  const passAuto = rows.filter((r) => r.modes.auto!.pasa).length;

  const lines: string[] = [];
  lines.push("---");
  lines.push("cursor:");
  lines.push('  subagentId: "bc-ec2a049a-15a9-43a6-83d8-cd2d904b95be"');
  lines.push("---");
  lines.push("");
  lines.push("# Ronda 2b — bench Investigar (qwen2.5:7b) + Ejemplos de ciudad");
  lines.push("");
  lines.push(
    `Modelo: \`${MODEL}\`. Criterios: clara / estructura / **dato correcto (Wiki/Wikidata/DANE, no el modelo)**.`,
  );
  lines.push(`Generado (UTC): \`${now.toISOString()}\` → America/Bogota: \`${bogota}\``);
  lines.push("");
  lines.push("## Resumen");
  lines.push("");
  lines.push(`- **Apagado:** ${passOff}/${rows.length}`);
  lines.push(`- **Auto:** ${passAuto}/${rows.length}`);
  lines.push(
    "- «dato correcto» usa chequeos fijos contrastados (inflación 13,12% DANE 2022, Canberra/ACT, Cundinamarca departamento, Jepírachi/Guajira, 18%→63, UNAD sin carreras inventadas, ejemplos de ciudad).",
  );
  lines.push("");
  lines.push(
    "| # | Pregunta | Apagado | Auto | Clara (apagado) | Clara (auto) | Dato (apagado) | Dato (auto) | Motores (auto) | t Apagado | t Auto |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    const a = r.modes.apagado!;
    const u = r.modes.auto!;
    const eng = (u.enginesUsed || []).join(", ") || "—";
    lines.push(
      `| ${r.n} | ${r.q} | ${a.pasa ? "pasa" : "falla"} | ${u.pasa ? "pasa" : "falla"} | ${a.clara ? "sí" : "no"} | ${u.clara ? "sí" : "no"} | ${a.dato ? "sí" : "no"} | ${u.dato ? "sí" : "no"} | ${eng} | ${(a.ms / 1000).toFixed(1)}s | ${(u.ms / 1000).toFixed(1)}s |`,
    );
  }

  lines.push("");
  lines.push("## Fallas");
  lines.push("");
  let anyFail = false;
  for (const r of rows) {
    for (const [key, label] of [
      ["apagado", "Apagado"],
      ["auto", "Auto"],
    ] as const) {
      const m = r.modes[key]!;
      if (m.pasa) continue;
      anyFail = true;
      lines.push(
        `- **${label}** — ${r.q}: clara=${m.clara ? "sí" : "no"}, estructura=${m.estructura ? "sí" : "no"}, dato=${m.dato ? "sí" : "no"}; wiki: ${m.wikiIssues.join("; ") || "—"}; nota: ${m.clarityNote || "—"}`,
      );
    }
  }
  if (!anyFail) lines.push("- Ninguna.");

  for (const mode of [
    ["apagado", "Apagado"],
    ["auto", "Auto"],
  ] as const) {
    lines.push("");
    lines.push(`## Respuestas — web ${mode[1]}`);
    for (const r of rows) {
      const m = r.modes[mode[0]]!;
      lines.push("");
      lines.push(`### ${r.n}. ${r.q}`);
      lines.push("");
      lines.push(`- Tiempo: **${(m.ms / 1000).toFixed(1)}s**`);
      lines.push(`- Clara: **${m.clara ? "sí" : "no"}**${m.clarityNote ? ` — ${m.clarityNote}` : ""}`);
      lines.push(`- Estructura: **${m.estructura ? "sí" : "no"}**`);
      lines.push(
        `- Dato correcto (Wiki): **${m.dato ? "sí" : "no"}**${m.wikiIssues.length ? ` — ${m.wikiIssues.join("; ")}` : ""}`,
      );
      lines.push(`- Motores usados: **${(m.enginesUsed || []).join(", ") || "—"}**`);
      lines.push(`- Resultado: **${m.pasa ? "pasa" : "falla"}**`);
      lines.push("");
      lines.push("```");
      lines.push(m.answer || "(vacío)");
      lines.push("```");
    }
  }

  writeFileSync(storeInternal, `${lines.join("\n")}\n`, "utf8");
  console.error(`Wrote ${storeInternal}`);
  console.log(JSON.stringify({ passOff, passAuto, total: rows.length, out: storeInternal }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
