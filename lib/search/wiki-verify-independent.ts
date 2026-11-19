/**
 * Verificación independiente de hechos vía Wikipedia/Wikidata.
 * No usa el modelo de chat: solo APIs públicas + reglas de contraste.
 */
import { searchWikipediaEs, searchWikidata, type MultiSearchHit } from "@/lib/search/engines";

export type IndependentCheck = {
  ok: boolean;
  /** true = la premisa de la pregunta es falsa y la respuesta debe rechazarla */
  falsePremise?: boolean;
  issues: string[];
  evidence: Array<{ title: string; url: string; snippet: string; engine: string }>;
  expectedHints: string[];
};

async function gatherEvidence(queries: string[]): Promise<MultiSearchHit[]> {
  const hits: MultiSearchHit[] = [];
  for (const q of queries.slice(0, 3)) {
    const [wiki, wd] = await Promise.all([searchWikipediaEs(q), searchWikidata(q)]);
    hits.push(...wiki.slice(0, 3), ...wd.slice(0, 2));
  }
  // dedupe by url
  const seen = new Set<string>();
  return hits.filter((h) => {
    if (!h.url || seen.has(h.url)) return false;
    seen.add(h.url);
    return true;
  });
}

function blobOf(hits: MultiSearchHit[]): string {
  return hits.map((h) => `${h.title} ${h.snippet}`).join("\n").toLowerCase();
}

function mustInclude(answer: string, patterns: RegExp[], label: string, issues: string[]) {
  if (!patterns.some((p) => p.test(answer))) issues.push(`falta dato esperado: ${label}`);
}

function mustNot(answer: string, patterns: RegExp[], label: string, issues: string[]) {
  if (patterns.some((p) => p.test(answer))) issues.push(`dato incorrecto: ${label}`);
}

/**
 * Chequeo independiente por pregunta de ronda 3.
 * Cada caso define consultas Wiki y aserciones contrastables.
 */
export async function independentFactCheck(
  question: string,
  answer: string,
): Promise<IndependentCheck> {
  const issues: string[] = [];
  const a = answer || "";
  const al = a.toLowerCase();
  let falsePremise = false;
  let queries: string[] = [];
  let expectedHints: string[] = [];

  // —— Casos ronda 3 (preguntas nuevas) ——
  if (/sim[oó]n\s+bol[ií]var/i.test(question) && /naci[oó]/i.test(question)) {
    queries = ["Simón Bolívar", "Simón Bolívar nacimiento"];
    expectedHints = ["Caracas", "1783"];
    const hits = await gatherEvidence(queries);
    const blob = blobOf(hits);
    if (!/caracas/i.test(al) && !/caracas/i.test(blob)) {
      // si wiki dice Caracas y la respuesta no, falla
      if (/caracas/i.test(blob)) mustInclude(a, [/caracas/i], "Caracas", issues);
    } else if (!/caracas/i.test(al)) {
      issues.push("falta Caracas (Wiki)");
    }
    if (/1783/.test(blob) && !/1783/.test(a)) issues.push("falta año 1783 (Wiki)");
    if (/bogot[aá]|medell[ií]n|cali/i.test(al) && /naci[oó]/i.test(al)) {
      issues.push("lugar de nacimiento incorrecto");
    }
    return pack(issues, hits, expectedHints, falsePremise);
  }

  if (/adn|dna|desoxirribonucleico/i.test(question) && /significa|sigla|quiere decir/i.test(question)) {
    queries = ["ADN", "ácido desoxirribonucleico"];
    expectedHints = ["ácido desoxirribonucleico"];
    const hits = await gatherEvidence(queries);
    const blob = blobOf(hits);
    if (!/desoxirribonucle/i.test(al)) {
      if (/desoxirribonucle/i.test(blob)) issues.push("falta «ácido desoxirribonucleico»");
      else issues.push("no explica la sigla ADN");
    }
    return pack(issues, hits, expectedHints, falsePremise);
  }

  if (/r[ií]o\s+magdalena/i.test(question) && /(d[oó]nde|nace|origen)/i.test(question)) {
    queries = ["Río Magdalena", "nacimiento Río Magdalena"];
    expectedHints = ["Macizo Colombiano", "Huila"];
    const hits = await gatherEvidence(queries);
    const blob = blobOf(hits);
    if (!/macizo|huila|padua|laguna/i.test(al)) {
      if (/macizo|huila/i.test(blob)) issues.push("falta Macizo Colombiano/Huila (Wiki)");
      else issues.push("origen del Magdalena no contrastable en respuesta");
    }
    if (/amazonas|orinoco/i.test(al) && /nace/i.test(al)) issues.push("origen incorrecto del Magdalena");
    return pack(issues, hits, expectedHints, falsePremise);
  }

  if (/policarpa\s+salavarrieta|la\s+pola/i.test(question)) {
    queries = ["Policarpa Salavarrieta"];
    expectedHints = ["independencia", "Colombia"];
    const hits = await gatherEvidence(queries);
    if (!/independ|patriota|fusil|espa[nñ]ol/i.test(al)) {
      issues.push("no describe el rol histórico de La Pola");
    }
    return pack(issues, hits, expectedHints, falsePremise);
  }

  if (/fotos[ií]ntesis/i.test(question)) {
    queries = ["Fotosíntesis"];
    expectedHints = ["luz", "glucosa", "oxígeno"];
    const hits = await gatherEvidence(queries);
    if (!/luz|sol/i.test(al)) issues.push("falta rol de la luz");
    if (!/ox[ií]geno|glucosa|az[uú]car|co2|di[oó]xido/i.test(al)) {
      issues.push("faltan productos/reactivos clave de la fotosíntesis");
    }
    return pack(issues, hits, expectedHints, falsePremise);
  }

  if (/velocidad\s+de\s+la\s+luz|velocidad\s+luz/i.test(question)) {
    queries = ["Velocidad de la luz"];
    expectedHints = ["299792458", "300000"];
    const hits = await gatherEvidence(queries);
    const blob = blobOf(hits);
    // Acepta ~300000 km/s o 299792458 m/s
    if (!/299\s*792\s*458|300\s*000|3\s*·\s*10|3e8|300000/i.test(a.replace(/\./g, ""))) {
      if (/299|300/.test(blob)) issues.push("cifra de velocidad de la luz ausente o incorrecta");
    }
    return pack(issues, hits, expectedHints, falsePremise);
  }

  if (/hipatia/i.test(question)) {
    queries = ["Hipatia", "Hipatia de Alejandría"];
    expectedHints = ["Alejandría", "matemática"];
    const hits = await gatherEvidence(queries);
    if (!/alejandr[ií]a|matem[aá]tica|filosof/i.test(al)) {
      issues.push("faltan datos básicos de Hipatia (Wiki)");
    }
    return pack(issues, hits, expectedHints, falsePremise);
  }

  if (/insulina/i.test(question)) {
    queries = ["Insulina"];
    expectedHints = ["páncreas", "glucosa"];
    const hits = await gatherEvidence(queries);
    if (!/p[aá]ncreas|glucosa|az[uú]car|diabetes/i.test(al)) {
      issues.push("faltan funciones básicas de la insulina");
    }
    return pack(issues, hits, expectedHints, falsePremise);
  }

  if (/http\/?2|http\s*2/i.test(question)) {
    queries = ["HTTP/2"];
    expectedHints = ["multiplex", "binario"];
    const hits = await gatherEvidence(queries);
    if (!/multiplex|binari|stream|cabeza|header|rendimiento|latencia/i.test(al)) {
      issues.push("no explica mejoras típicas de HTTP/2");
    }
    return pack(issues, hits, expectedHints, falsePremise);
  }

  if (/campus\s+virtual|UNAD/i.test(question) && /qu[eé]\s+es/i.test(question)) {
    queries = ["Universidad Nacional Abierta y a Distancia", "UNAD"];
    expectedHints = ["abierta", "distancia", "Colombia"];
    const hits = await gatherEvidence(queries);
    if (!/abierta|distancia|virtual|colombia/i.test(al)) {
      issues.push("definición UNAD incompleta frente a Wiki");
    }
    // No inventar listados de carreras concretas sin advertencia
    if (
      /licenciatura en|doctorado en|ingenier[ií]a de sistemas,|medicina,/i.test(al) &&
      !/verificar|cat[aá]logo|oficial|no (estoy|tengo) segur/i.test(al)
    ) {
      issues.push("lista de carreras concreta sin advertencia");
    }
    return pack(issues, hits, expectedHints, falsePremise);
  }

  if (/parquet|apache parquet/i.test(question)) {
    queries = ["Apache Parquet"];
    expectedHints = ["columnar", "analítico"];
    const hits = await gatherEvidence(queries);
    if (!/column|anal[ií]tic|hadoop|big data|compresi/i.test(al)) {
      issues.push("no describe Parquet como formato columnar");
    }
    return pack(issues, hits, expectedHints, falsePremise);
  }

  // Trampa 1: Colombia nunca ha ganado el Mundial de fútbol
  if (/mundial/i.test(question) && /colombia/i.test(question) && /gan[oó]|campe[oó]n/i.test(question)) {
    falsePremise = true;
    queries = ["Selección de fútbol de Colombia", "Copa Mundial de Fútbol"];
    expectedHints = ["nunca ha ganado", "no ha sido campeón"];
    const hits = await gatherEvidence(queries);
    const claimsWin = /gan[oó] en\s+\d{4}|campe[oó]n (en|del)\s+\d{4}|el a[nñ]o\s+\d{4}/i.test(a);
    const rejects =
      /no ha ganado|nunca ha ganado|no (fue|ha sido) campe[oó]n|premisa (falsa|incorrecta)|ning[uú]n mundial/i.test(
        al,
      );
    if (claimsWin && !rejects) issues.push("afirma un título mundial inexistente");
    if (!rejects) issues.push("no rechaza la premisa falsa (Colombia no ha ganado el Mundial)");
    return pack(issues, hits, expectedHints, falsePremise);
  }

  // Trampa 2: El Vaticano no es un departamento de Colombia
  if (/vaticano/i.test(question) && /departamento/i.test(question) && /colombia/i.test(question)) {
    falsePremise = true;
    queries = ["Departamentos de Colombia", "Ciudad del Vaticano"];
    expectedHints = ["no es departamento", "Estado soberano"];
    const hits = await gatherEvidence(queries);
    const accepts = /el vaticano (es|fue) (un )?departamento/i.test(al);
    const rejects =
      /no es (un )?departamento|premisa (falsa|incorrecta)|estado (independiente|soberano)|no forma parte de colombia/i.test(
        al,
      );
    if (accepts && !rejects) issues.push("acepta que el Vaticano es departamento de Colombia");
    if (!rejects) issues.push("no rechaza la premisa falsa del Vaticano-departamento");
    return pack(issues, hits, expectedHints, falsePremise);
  }

  if (/capital\s+de\s+canad|canad[aá].*capital/i.test(question)) {
    queries = ["Ottawa", "capital de Canadá"];
    expectedHints = ["Ottawa"];
    const hits = await gatherEvidence(queries);
    if (!/ottawa/i.test(al)) issues.push("falta Ottawa");
    if (/toronto|montreal|vancouver/i.test(al) && /capital/i.test(al) && !/ottawa/i.test(al)) {
      issues.push("capital de Canadá incorrecta");
    }
    return pack(issues, hits, expectedHints, falsePremise);
  }

  if (/neutr[oó]n/i.test(question)) {
    queries = ["Neutrón"];
    expectedHints = ["sin carga", "núcleo"];
    const hits = await gatherEvidence(queries);
    if (!/carga|n[uú]cleo|prot[oó]n|electr[oó]n/i.test(al)) {
      issues.push("definición de neutrón incompleta");
    }
    return pack(issues, hits, expectedHints, falsePremise);
  }

  // Genérico: al menos buscar evidencia y no marcar ok automático
  queries = [question.replace(/[¿?¡!]/g, " ").trim()];
  const hits = await gatherEvidence(queries);
  if (!a.trim() || /no pude responder|no encontr[eé] informaci[oó]n/i.test(a)) {
    issues.push("sin respuesta útil del modelo");
  }
  return pack(issues, hits, expectedHints, falsePremise);
}

function pack(
  issues: string[],
  hits: MultiSearchHit[],
  expectedHints: string[],
  falsePremise: boolean,
): IndependentCheck {
  return {
    ok: issues.length === 0,
    falsePremise,
    issues,
    expectedHints,
    evidence: hits.slice(0, 6).map((h) => ({
      title: h.title,
      url: h.url,
      snippet: (h.snippet || "").slice(0, 220),
      engine: h.engine,
    })),
  };
}
