import { describe, expect, it } from "vitest";
import { citationToRis, commitLocalAnnotation, formatCitation, mergeAnnotations, normalizePdfSelectionRects, parseAnnotation, parseReadingLocation, stablePaperId, writeLocalJson } from "./readingRoomData";

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

  it("retains a validated PDF page, quote, and normalized selection geometry", () => {
    const parsed = parseAnnotation({
      id: "pdf-note", paperId: "p", citation: "c", quote: "Selected history", note: "n", page: 3,
      source: "user-uploaded PDF", createdAt: "2026-01-01",
      anchor: { kind: "pdf", page: 3, quote: "Selected history", rects: [{ x: 0.2, y: 0.3, width: 0.4, height: 0.05 }] },
    });
    expect(parsed?.anchor).toEqual({ kind: "pdf", page: 3, quote: "Selected history", rects: [{ x: 0.2, y: 0.3, width: 0.4, height: 0.05 }] });
    expect(parseAnnotation({ id: "bad", paperId: "p", citation: "c", quote: "q", note: "n", createdAt: "2026-01-01", anchor: { kind: "pdf", page: 1, rects: [] } })?.anchor).toBeUndefined();
  });

  it("normalizes PDF selection rectangles and clips them to the page", () => {
    expect(normalizePdfSelectionRects(
      { left: 100, top: 200, width: 400, height: 800 },
      [{ left: 140, top: 280, width: 200, height: 40 }, { left: 480, top: 980, width: 80, height: 80 }],
    )).toEqual([
      { x: 0.1, y: 0.1, width: 0.5, height: 0.05 },
      { x: 0.95, y: 0.975, width: 0.05, height: 0.025 },
    ]);
  });

  it("validates and bounds persisted reading locations", () => {
    expect(parseReadingLocation({ page: 4.8, offset: 1.5 })).toEqual({ page: 4, offset: 1 });
    expect(parseReadingLocation({ page: "4", offset: 0.2 })).toBeNull();
  });

  it("reports whether private browser storage actually accepted the annotation", () => {
    let written = "";
    expect(writeLocalJson({ setItem: (_key, value) => { written = value; } }, "annotations", [{ id: "a" }])).toBe(true);
    expect(written).toBe('[{"id":"a"}]');
    expect(writeLocalJson({ setItem: () => { throw new Error("quota"); } }, "annotations", [])).toBe(false);
  });

  it("commits a one-action highlight only after both paper and annotation storage succeed", () => {
    const calls: string[] = [];
    expect(commitLocalAnnotation(() => { calls.push("paper"); return true; }, () => { calls.push("annotation"); return true; })).toBe("saved");
    expect(calls).toEqual(["paper", "annotation"]);
    expect(commitLocalAnnotation(() => false, () => true)).toBe("paper-storage-failed");
    expect(commitLocalAnnotation(() => true, () => false)).toBe("annotation-storage-failed");
  });

  it("merges annotations by stable annotation id", () => {
    const first = parseAnnotation({ id: "a", paperId: "p", citation: "c", quote: "q", note: "old", createdAt: "2026-01-01", updatedAt: "2026-01-01" })!;
    const replacement = { ...first, note: "new", updatedAt: "2026-02-01" };
    expect(mergeAnnotations([first], [replacement])).toEqual([replacement]);
  });
});
