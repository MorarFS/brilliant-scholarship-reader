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
  openAccessPdfUrl: string | null;
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
    emotionSignals?: string[];
    emotionQualifies?: boolean;
    classifier: "rules-v2" | "rules-v3" | "llm";
  };
  metadataSources: string[];
};

export type Annotation = {
  id: string;
  paperId: string;
  citation: string;
  quote: string;
  note: string;
  page: number | null;
  anchor?: {
    kind: "pdf";
    page: number;
    quote: string;
    rects: Array<{ x: number; y: number; width: number; height: number }>;
  };
  source: "open-access PDF" | "user-uploaded PDF" | "citation only";
  createdAt: string;
  updatedAt: string;
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
  inclusionBasis: "sjr-q1" | "sjr-q2" | "user-curated specialist";
  resultCount: number;
  emotionResultCount?: number;
  candidateCount?: number;
  unreviewedCount?: number;
  knownIssueCount?: number;
};

export type TrackerData = {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  journalCount: number;
  sjrYear: number | null;
  sourceCounts: Record<string, number>;
  feedCounts: Record<"digital-humanities" | "ai-history", number>;
  emotionFeedCount?: number;
  audit?: {
    candidateCount: number;
    historyIncludedCount: number;
    emotionIncludedCount: number;
    unreviewedCount: number;
    definition: string;
  };
  journals: MonitoredJournal[];
  papers: Paper[];
  emotionPapers?: Paper[];
  auditPapers?: Paper[];
};
