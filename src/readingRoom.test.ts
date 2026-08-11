import { describe, expect, it } from "vitest";
import { citationToRis, formatCitation, mergeAnnotations, parseAnnotation, stablePaperId } from "./readingRoomData";

const paper = {
  id: "https://openalex.org/W1",
  doi: "10.1234/example",
  title: "Reading the Archive",
  publicationDate: "2026-04-12",
  authors: ["Ada Historian", "Chris Coder"],
  journal: "Computational Humanities Research",
  doiUrl: "https://doi.org/10.1234/example",
  articleUrl: "https://example.org/article",
};

describe("reading-room research data", () => {
  it("uses a DOI as the stable paper identity", () => {
    expect(stablePaperId(paper)).toBe("doi:10.1234/example");
  });

  it("formats a readable citation and RIS record", () => {
    expect(formatCitation(paper)).toContain("Ada Historian, Chris Coder (2026). Reading the Archive.");
    expect(citationToRis(paper)).toContain("DO  - 10.1234/example");
    expect(citationToRis(paper)).toContain("AU  - Ada Historian");
  });

  it("rejects malformed annotations and bounds imported text", () => {
    expect(parseAnnotation({ id: "bad" })).toBeNull();
    const parsed = parseAnnotation({ id: "a", paperId: "p", citation: "c", quote: "q", note: "n", page: 2.8, source: "user-uploaded PDF", createdAt: "2026-01-01" });
    expect(parsed?.page).toBe(2);
    expect(parsed?.source).toBe("user-uploaded PDF");
  });

  it("merges annotations by stable annotation id", () => {
    const first = parseAnnotation({ id: "a", paperId: "p", citation: "c", quote: "q", note: "old", createdAt: "2026-01-01", updatedAt: "2026-01-01" })!;
    const replacement = { ...first, note: "new", updatedAt: "2026-02-01" };
    expect(mergeAnnotations([first], [replacement])).toEqual([replacement]);
  });
});
