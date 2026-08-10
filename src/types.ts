export type Paper = {
  id: string;
  title: string;
  authors: string[];
  publicationDate: string;
  journal: string;
  feed: "digital-humanities" | "ai-history";
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
    methodSignals: string[];
    humanitiesSignals: string[];
    qualifies: boolean;
    classifier: "rules-v2" | "llm";
  };
  metadataSources: string[];
};

export type MonitoredJournal = {
  title: string;
  issns: string[];
  quartile: string;
  sjrYear: number | null;
  focus: string;
  feed: "digital-humanities" | "ai-history";
  feedLabel: string;
  journalUrl: string | null;
  qualificationNote: string;
  resultCount: number;
};

export type TrackerData = {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  journalCount: number;
  sjrYear: number | null;
  sourceCounts: Record<string, number>;
  feedCounts: Record<"digital-humanities" | "ai-history", number>;
  journals: MonitoredJournal[];
  papers: Paper[];
};
