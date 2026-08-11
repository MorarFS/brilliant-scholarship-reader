import { describe, expect, it } from "vitest";
import type { Paper } from "./types";
import { buildSummaryRequest, normalizeGoogleClientId, normalizeSummaryApiUrl, parseSummaryResponse } from "./summaryApi";

const paper = {
  id: "https://openalex.org/W1",
  title: "Computational methods for medieval archives",
  authors: ["Ada Scholar"],
  publicationDate: "2026-06-01",
  journal: "Digital Scholarship in the Humanities",
  doi: "10.1234/example",
  abstract: "A detailed abstract about computational methods and medieval archival evidence.",
} as Paper;

describe("secure summary client", () => {
  it("allows HTTPS and local development endpoints but rejects unsafe URLs", () => {
    expect(normalizeSummaryApiUrl("https://summary.example.run.app/")).toBe("https://summary.example.run.app");
    expect(normalizeSummaryApiUrl("http://localhost:8080")).toBe("http://localhost:8080");
    expect(normalizeSummaryApiUrl("http://summary.example.com")).toBeNull();
    expect(normalizeSummaryApiUrl("https://user:pass@example.com")).toBeNull();
  });

  it("accepts only a Google web client ID shape", () => {
    expect(normalizeGoogleClientId("1234-example.apps.googleusercontent.com")).toBe("1234-example.apps.googleusercontent.com");
    expect(normalizeGoogleClientId("not-a-client-id")).toBeNull();
  });

  it("builds a metadata-only request and requires an abstract", () => {
    expect(buildSummaryRequest(paper)).toEqual({ paper: { id: paper.doi, title: paper.title, authors: paper.authors, publicationDate: paper.publicationDate, journal: paper.journal, doi: paper.doi, abstract: paper.abstract } });
    expect(buildSummaryRequest({ ...paper, abstract: null })).toBeNull();
  });

  it("validates and bounds backend responses", () => {
    expect(parseSummaryResponse({ summary: "Brief", keyPoints: ["One"], caveats: ["Abstract only"], model: "gemini", generatedAt: "2026-08-11T00:00:00Z" })?.summary).toBe("Brief");
    expect(parseSummaryResponse({ summary: "", keyPoints: [], caveats: [], model: "gemini", generatedAt: "now" })).toBeNull();
  });
});
