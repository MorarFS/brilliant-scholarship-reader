import type { Annotation, Paper } from "./types";

export type ReadingLocation = { page: number; offset: number };
export type RectLike = { left: number; top: number; width: number; height: number };

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizePdfSelectionRects(pageRect: RectLike, selectionRects: RectLike[]) {
  if (!(pageRect.width > 0) || !(pageRect.height > 0)) return [];
  return selectionRects.slice(0, 200).flatMap((rect) => {
    if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return [];
    const left = clamp(rect.left, pageRect.left, pageRect.left + pageRect.width);
    const top = clamp(rect.top, pageRect.top, pageRect.top + pageRect.height);
    const right = clamp(rect.left + rect.width, pageRect.left, pageRect.left + pageRect.width);
    const bottom = clamp(rect.top + rect.height, pageRect.top, pageRect.top + pageRect.height);
    if (right <= left || bottom <= top) return [];
    return [{
      x: (left - pageRect.left) / pageRect.width,
      y: (top - pageRect.top) / pageRect.height,
      width: (right - left) / pageRect.width,
      height: (bottom - top) / pageRect.height,
    }];
  });
}

export function parseReadingLocation(value: unknown): ReadingLocation | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ReadingLocation>;
  if (typeof item.page !== "number" || !Number.isFinite(item.page) || typeof item.offset !== "number" || !Number.isFinite(item.offset)) return null;
  return { page: Math.max(1, Math.floor(item.page)), offset: clamp(item.offset, 0, 1) };
}

function parsePdfAnchor(value: unknown, fallbackQuote: string): Annotation["anchor"] {
  if (!value || typeof value !== "object") return undefined;
  const item = value as { kind?: unknown; page?: unknown; quote?: unknown; rects?: unknown };
  if (item.kind !== "pdf" || typeof item.page !== "number" || !Number.isFinite(item.page) || !Array.isArray(item.rects)) return undefined;
  const rects = item.rects.slice(0, 200).flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const rect = value as Record<string, unknown>;
    const numbers = [rect.x, rect.y, rect.width, rect.height];
    if (!numbers.every((number) => typeof number === "number" && Number.isFinite(number)) || Number(rect.width) <= 0 || Number(rect.height) <= 0) return [];
    const x = clamp(Number(rect.x), 0, 1);
    const y = clamp(Number(rect.y), 0, 1);
    const width = clamp(Number(rect.width), 0, 1 - x);
    const height = clamp(Number(rect.height), 0, 1 - y);
    return width > 0 && height > 0 ? [{ x, y, width, height }] : [];
  });
  if (!rects.length) return undefined;
  return {
    kind: "pdf",
    page: Math.max(1, Math.floor(item.page)),
    quote: (typeof item.quote === "string" ? item.quote : fallbackQuote).slice(0, 12000),
    rects,
  };
}

export function stablePaperId(paper: Pick<Paper, "id" | "doi" | "title" | "publicationDate">): string {
  if (paper.doi) return `doi:${paper.doi.toLowerCase()}`;
  if (paper.id) return paper.id;
  return `title:${paper.title.toLowerCase().replace(/\W+/g, "")}:${paper.publicationDate}`;
}

export function formatCitation(paper: Pick<Paper, "authors" | "publicationDate" | "title" | "journal" | "doi" | "doiUrl" | "articleUrl">): string {
  const authors = paper.authors.length ? paper.authors.join(", ") : "Unknown author";
  const year = paper.publicationDate.slice(0, 4) || "n.d.";
  const locator = paper.doiUrl || paper.articleUrl || (paper.doi ? `https://doi.org/${paper.doi}` : "");
  return `${authors} (${year}). ${paper.title}. ${paper.journal}.${locator ? ` ${locator}` : ""}`;
}

export function citationToRis(paper: Pick<Paper, "authors" | "publicationDate" | "title" | "journal" | "doi" | "doiUrl" | "articleUrl">): string {
  const lines = ["TY  - JOUR", `TI  - ${paper.title}`];
  for (const author of paper.authors) lines.push(`AU  - ${author}`);
  lines.push(`PY  - ${paper.publicationDate.slice(0, 4) || ""}`, `DA  - ${paper.publicationDate}`, `JO  - ${paper.journal}`);
  if (paper.doi) lines.push(`DO  - ${paper.doi}`);
  const url = paper.doiUrl || paper.articleUrl;
  if (url) lines.push(`UR  - ${url}`);
  lines.push("ER  - ");
  return `${lines.join("\n")}\n`;
}

export function parseAnnotation(value: unknown): Annotation | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<Annotation>;
  if (
    typeof item.id !== "string" || typeof item.paperId !== "string" || typeof item.citation !== "string" ||
    typeof item.quote !== "string" || typeof item.note !== "string" || typeof item.createdAt !== "string"
  ) return null;
  const quote = item.quote.slice(0, 12000);
  const anchor = parsePdfAnchor(item.anchor, quote);
  return {
    id: item.id,
    paperId: item.paperId,
    citation: item.citation,
    quote,
    note: item.note.slice(0, 20000),
    page: typeof item.page === "number" && Number.isFinite(item.page) ? Math.max(1, Math.floor(item.page)) : anchor?.page || null,
    ...(anchor ? { anchor } : {}),
    source: item.source === "open-access PDF" || item.source === "user-uploaded PDF" ? item.source : "citation only",
    createdAt: item.createdAt,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : item.createdAt,
  };
}

export function mergeAnnotations(current: Annotation[], imported: Annotation[]): Annotation[] {
  return [...new Map([...current, ...imported].map((annotation) => [annotation.id, annotation])).values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
