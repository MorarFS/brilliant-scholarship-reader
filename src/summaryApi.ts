import type { Paper } from "./types";

export type SummaryRequest = {
  paper: {
    id: string;
    title: string;
    authors: string[];
    publicationDate: string;
    journal: string;
    doi: string | null;
    pdfBase64: string;
  };
};

export type PaperSummary = {
  summary: string;
  keyPoints: string[];
  caveats: string[];
  model: string;
  generatedAt: string;
};

export function normalizeSummaryApiUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const localDevelopment = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !localDevelopment) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function normalizeGoogleClientId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clientId = value.trim();
  return /^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(clientId) ? clientId : null;
}

export const SUMMARY_API_URL = normalizeSummaryApiUrl(import.meta.env.VITE_SUMMARY_API_URL);
export const GOOGLE_WEB_CLIENT_ID = normalizeGoogleClientId(import.meta.env.VITE_GOOGLE_CLIENT_ID);
export const SUMMARY_FEATURE_CONFIGURED = Boolean(SUMMARY_API_URL && GOOGLE_WEB_CLIENT_ID);

export function buildSummaryRequest(paper: Paper, pdfBase64: string): SummaryRequest | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(pdfBase64) || pdfBase64.length > 14_000_000) return null;
  return {
    paper: {
      id: paper.doi || paper.id,
      title: paper.title,
      authors: paper.authors.slice(0, 30),
      publicationDate: paper.publicationDate,
      journal: paper.journal,
      doi: paper.doi,
      pdfBase64,
    },
  };
}

export function parseSummaryResponse(value: unknown): PaperSummary | null {
  if (!value || typeof value !== "object") return null;
  const response = value as Partial<PaperSummary>;
  if (
    typeof response.summary !== "string" || !response.summary.trim() ||
    !Array.isArray(response.keyPoints) || !response.keyPoints.every((item) => typeof item === "string") ||
    !Array.isArray(response.caveats) || !response.caveats.every((item) => typeof item === "string") ||
    typeof response.model !== "string" || typeof response.generatedAt !== "string"
  ) return null;
  return {
    summary: response.summary.trim(),
    keyPoints: response.keyPoints.slice(0, 6).map((item) => item.trim()).filter(Boolean),
    caveats: response.caveats.slice(0, 4).map((item) => item.trim()).filter(Boolean),
    model: response.model,
    generatedAt: response.generatedAt,
  };
}
