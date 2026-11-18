import type { RagDocument } from "@/lib/rag/types";
import { createDocumentId } from "@/lib/rag/pipeline";

/** Starter knowledge so RAG has something useful before the user uploads docs. */
export function seedDocuments(): RagDocument[] {
  const now = 0;
  return [
    {
      id: "seed-rag",
      title: "Arquitectura RAG en Taller",
      source: "taller",
      createdAt: now,
      text: [
        "RAG (Retrieval-Augmented Generation) en Taller funciona en cuatro pasos.",
        "1. Ingesta: se guardan documentos del usuario y lecciones aprendidas.",
        "2. Chunking: el texto se parte en fragmentos solapados.",
        "3. Índice: cada fragmento se convierte en un vector TF-IDF disperso.",
        "4. Recuperación: ante una pregunta se buscan los fragmentos más similares por coseno y se inyectan en la respuesta o en el prompt del modelo.",
        "Para Investigar, además se consultan Wikipedia, Wikidata, OpenAlex, Crossref, Europe PMC y Open Library, se indexan al vuelo y se recuperan los trozos más pertinentes.",
      ].join(" "),
    },
    {
      id: "seed-metodologia",
      title: "Metodología de investigación (apuntes)",
      source: "taller",
      createdAt: now,
      text: [
        "La metodología de investigación es el conjunto de criterios, pasos y técnicas para plantear un problema,",
        "recoger información, analizarla y llegar a conclusiones comprobables.",
        "Incluye problema, objetivos, enfoque (cualitativo, cuantitativo o mixto), diseño, población y muestra,",
        "técnicas e instrumentos, análisis, ética y límites.",
        "Debe permitir que otra persona entienda y, en lo posible, repita el estudio.",
      ].join(" "),
    },
  ];
}

export function addDocument(
  documents: RagDocument[],
  input: { title: string; text: string; source?: string },
): RagDocument[] {
  const title = input.title.trim() || "Documento sin título";
  const text = input.text.trim();
  if (text.length < 20) return documents;
  const doc: RagDocument = {
    id: createDocumentId(),
    title: title.slice(0, 160),
    text: text.slice(0, 40_000),
    source: input.source?.trim() || "usuario",
    createdAt: Date.now(),
  };
  return [doc, ...documents.filter((item) => item.id !== doc.id)].slice(0, 40);
}

export function removeDocument(documents: RagDocument[], id: string): RagDocument[] {
  return documents.filter((document) => document.id !== id);
}
