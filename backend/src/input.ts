import type { PaperInput } from "./types.js";

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

export function parsePaperInput(value: unknown): PaperInput | null {
  if (!value || typeof value !== "object") return null;
  const paper = (value as { paper?: unknown }).paper;
  if (!paper || typeof paper !== "object") return null;
  const record = paper as Record<string, unknown>;
  const id = boundedString(record.id, 500);
  const title = boundedString(record.title, 1_000);
  const publicationDate = boundedString(record.publicationDate, 32);
  const journal = boundedString(record.journal, 500);
  const extractedText = boundedString(record.extractedText, 60_000);
  const doi = record.doi === null ? null : boundedString(record.doi, 300);
  if (!id || !title || !publicationDate || !journal || !extractedText || (record.doi !== null && !doi)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publicationDate)) return null;
  if (!Array.isArray(record.authors) || record.authors.length > 30) return null;
  const authors = record.authors.map((author) => boundedString(author, 300));
  if (authors.some((author) => author === null)) return null;
  return { id, title, authors: authors as string[], publicationDate, journal, doi, extractedText };
}
