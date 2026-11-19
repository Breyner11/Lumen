/**
 * Tablas de hechos genéricos alineadas con Wikidata (no respuestas de examen).
 * Fuente: propiedades P36 (capital) y estructura territorial de Colombia.
 * Se usan solo como semilla corta de contexto; el modelo debe redactar.
 */

export type CapitalFact = {
  country: string;
  capital: string;
  note?: string;
  wikidata: string;
};

/** Capitales frecuentes (P36). IDs de país Wikidata. */
export const CAPITALS_WIKIDATA: CapitalFact[] = [
  { country: "colombia", capital: "Bogotá", wikidata: "Q739" },
  { country: "australia", capital: "Canberra", note: "Territorio de la Capital Australiana (ACT)", wikidata: "Q408" },
  { country: "francia", capital: "París", wikidata: "Q142" },
  { country: "españa", capital: "Madrid", wikidata: "Q29" },
  { country: "méxico", capital: "Ciudad de México", wikidata: "Q96" },
  { country: "mexico", capital: "Ciudad de México", wikidata: "Q96" },
  { country: "perú", capital: "Lima", wikidata: "Q419" },
  { country: "peru", capital: "Lima", wikidata: "Q419" },
  { country: "argentina", capital: "Buenos Aires", wikidata: "Q414" },
  { country: "chile", capital: "Santiago", wikidata: "Q298" },
  { country: "brasil", capital: "Brasilia", wikidata: "Q155" },
  { country: "brazil", capital: "Brasilia", wikidata: "Q155" },
  { country: "estados unidos", capital: "Washington D. C.", wikidata: "Q30" },
  { country: "eeuu", capital: "Washington D. C.", wikidata: "Q30" },
  { country: "canada", capital: "Ottawa", wikidata: "Q16" },
  { country: "canadá", capital: "Ottawa", wikidata: "Q16" },
  { country: "japón", capital: "Tokio", wikidata: "Q17" },
  { country: "japon", capital: "Tokio", wikidata: "Q17" },
  { country: "italia", capital: "Roma", wikidata: "Q38" },
  { country: "alemania", capital: "Berlín", wikidata: "Q183" },
  { country: "reino unido", capital: "Londres", wikidata: "Q145" },
  { country: "ecuador", capital: "Quito", wikidata: "Q736" },
  { country: "venezuela", capital: "Caracas", wikidata: "Q717" },
];

/** Colombia: 32 departamentos + Distrito Capital (Wikidata Q739 / división administrativa). */
export const COLOMBIA_DEPTS = {
  departments: 32,
  capitalDistrict: "Bogotá",
  note: "32 departamentos y un Distrito Capital (Bogotá). Cundinamarca es departamento.",
  wikidata: "Q739",
} as const;

export function lookupCapital(question: string): CapitalFact | null {
  const q = question.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const m =
    /capital\s+(?:de|del|de\s+la|de\s+los)\s+(.+?)(?:\?|$)/i.exec(question) ||
    /(?:cual|cuál)\s+es\s+la\s+capital\s+(?:de|del|de\s+la)\s+(.+?)(?:\?|$)/i.exec(question);
  const raw = (m?.[1] || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
  if (!raw && !/capital/.test(q)) return null;
  const key = raw.replace(/\s+/g, " ").trim();
  if (!key) return null;
  return (
    CAPITALS_WIKIDATA.find((c) => {
      const name = c.country.normalize("NFD").replace(/\p{M}/gu, "");
      return key === name || key.includes(name) || name.includes(key);
    }) || null
  );
}

export function lookupColombiaDepartments(question: string): typeof COLOMBIA_DEPTS | null {
  if (!/colombia/i.test(question)) return null;
  if (!/departamento/i.test(question)) return null;
  return COLOMBIA_DEPTS;
}

/** Semilla corta para el redactor (no es una respuesta completa). */
export function factSeedSnippet(question: string): { title: string; text: string; url: string } | null {
  const capital = lookupCapital(question);
  if (capital) {
    const note = capital.note ? ` (${capital.note})` : "";
    return {
      title: `Wikidata P36 · ${capital.country}`,
      text: `Hecho tabular: la capital de ${capital.country} es ${capital.capital}${note}. Fuente: Wikidata ${capital.wikidata}.`,
      url: `https://www.wikidata.org/wiki/${capital.wikidata}`,
    };
  }
  const depts = lookupColombiaDepartments(question);
  if (depts) {
    return {
      title: "Wikidata · Colombia división territorial",
      text: `Hecho tabular: Colombia tiene ${depts.departments} departamentos y el Distrito Capital de ${depts.capitalDistrict}. ${depts.note} Fuente: Wikidata ${depts.wikidata}.`,
      url: `https://www.wikidata.org/wiki/${depts.wikidata}`,
    };
  }
  return null;
}
