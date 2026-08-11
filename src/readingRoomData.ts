import type { Annotation, Paper } from "./types";

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
  return {
    id: item.id,
    paperId: item.paperId,
    citation: item.citation,
    quote: item.quote.slice(0, 12000),
    note: item.note.slice(0, 20000),
    page: typeof item.page === "number" && Number.isFinite(item.page) ? Math.max(1, Math.floor(item.page)) : null,
    source: item.source === "open-access PDF" || item.source === "user-uploaded PDF" ? item.source : "citation only",
    createdAt: item.createdAt,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : item.createdAt,
  };
}

export function mergeAnnotations(current: Annotation[], imported: Annotation[]): Annotation[] {
  return [...new Map([...current, ...imported].map((annotation) => [annotation.id, annotation])).values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
