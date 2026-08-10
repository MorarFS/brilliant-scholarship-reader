export type Paper = {
  id: string;
  title: string;
  authors: string[];
  publicationDate: string;
  journal: string;
  issn: string | null;
  quartile: string;
  sjrYear: number | null;
  doi: string | null;
  doiUrl: string | null;
  articleUrl: string | null;
  journalUrl: string | null;
  openAccessUrl: string | null;
  openAccessStatus: string | null;
  abstract: string | null;
  topics: string[];
  relevance: {
    score: number;
    reason: string;
    signals: string[];
    classifier: "rules-v1" | "llm";
  };
  metadataSources: string[];
};

export type TrackerData = {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  journalCount: number;
  sjrYear: number | null;
  sourceCounts: Record<string, number>;
  papers: Paper[];
};
