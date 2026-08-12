export type RuntimeConfig = {
  project: string;
  location: string;
  model: string;
  googleWebClientId: string;
  allowedEmails: Set<string>;
  allowedOrigins: Set<string>;
  maxRequestsPerUserPerHour: number;
  port: number;
};

export type PaperInput = {
  id: string;
  title: string;
  authors: string[];
  publicationDate: string;
  journal: string;
  doi: string | null;
  pdfBase64: string;
};

export type SummaryResult = {
  summary: string;
  keyPoints: string[];
  sections: Array<{ heading: string; summary: string }>;
  caveats: string[];
  model: string;
  generatedAt: string;
};

export type VerifiedUser = { subject: string; email: string };
export type VerifyUser = (idToken: string) => Promise<VerifiedUser>;
export type SummarizePaper = (paper: PaperInput) => Promise<SummaryResult>;
