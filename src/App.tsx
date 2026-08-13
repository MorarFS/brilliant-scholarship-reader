import { useEffect, useMemo, useState } from "react";
import ReadingRoom from "./ReadingRoom";
import type { Annotation, MonitoredJournal, Paper, TrackerData } from "./types";
import { mergeAnnotations, parseAnnotation, stablePaperId } from "./readingRoomData";
import { loadLocalPdf, saveLocalPdf } from "./localPdfStore";

const DATA_URL = `${import.meta.env.BASE_URL}data/papers.json`;
const SAVED_STORAGE_KEY = "chronicle-saved-papers-v1";
const ANNOTATION_STORAGE_KEY = "chronicle-annotations-v1";
const READING_MODE_STORAGE_KEY = "chronicle-dyslexia-reading-mode";
const PAGE_SIZE = 40;
type Feed = "digital-humanities" | "ai-history";
type View = Feed | "emotions-humanities" | "audit" | "saved";

type ImportedCitation = Pick<Paper, "title" | "authors" | "publicationDate" | "journal" | "doi" | "doiUrl" | "articleUrl" | "abstract">;

const FEEDS: Record<Feed, { label: string; shortLabel: string; description: string }> = {
  "digital-humanities": {
    label: "Digital & Computational Humanities",
    shortLabel: "Primary feed",
    description: "Computational methods applied to history, archives, heritage, cultural memory, historical language, and historical data in leading specialist venues.",
  },
  "ai-history": {
    label: "AI & LLMs in History",
    shortLabel: "Secondary feed",
    description: "AI, machine learning, LLM, NLP, and computational-method papers found inside selected history venues—and only when tied to historical research or materials.",
  },
};

const EMOTIONS_FEED = {
  label: "Emotions in Digital & Computational Humanities",
  shortLabel: "Tertiary feed",
  description: "Emotion, affect, sentiment, feeling, and affective-computing research from the specialist digital and computational humanities venues. History is welcome here but not required.",
};

function formatDate(value: string, long = false) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("en", { day: "numeric", month: long ? "long" : "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatGenerated(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(date);
}

function scoreLabel(score: number) {
  if (score >= 80) return "Strong dual-evidence match";
  if (score >= 65) return "Clear dual-evidence match";
  return "Qualified dual-evidence match";
}

function venueStatus(quartile: string, year: number | null) {
  return quartile === "Q1" || quartile === "Q2" ? `${quartile} · SJR ${year ?? "pinned"}` : quartile;
}

function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function normaliseDoi(value: string) {
  return value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").replace(/[\s.]+$/, "").toLowerCase();
}

function dateFromCrossref(item: Record<string, unknown>) {
  for (const field of ["published-online", "published-print", "published", "issued"]) {
    const value = item[field] as { "date-parts"?: unknown } | undefined;
    const parts = Array.isArray(value?.["date-parts"]) ? value?.["date-parts"]?.[0] : null;
    if (Array.isArray(parts) && typeof parts[0] === "number") {
      const [year, month = 1, day = 1] = parts;
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return new Date().toISOString().slice(0, 10);
}

function citationFromCrossref(doi: string, item: Record<string, unknown>): ImportedCitation {
  const authors = Array.isArray(item.author) ? item.author.flatMap((author) => {
    if (!author || typeof author !== "object") return [];
    const value = author as Record<string, unknown>;
    const name = [value.given, value.family].filter((part): part is string => typeof part === "string" && Boolean(part.trim())).join(" ");
    return name ? [name] : [];
  }) : [];
  const title = Array.isArray(item.title) && typeof item.title[0] === "string" ? item.title[0] : "Untitled paper";
  const journal = Array.isArray(item["container-title"]) && typeof item["container-title"][0] === "string" ? item["container-title"][0] : "Journal not listed";
  const abstract = typeof item.abstract === "string" ? item.abstract.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null : null;
  const articleUrl = typeof item.URL === "string" ? safeExternalUrl(item.URL) : null;
  return { title, authors, publicationDate: dateFromCrossref(item), journal, doi, doiUrl: `https://doi.org/${doi}`, articleUrl, abstract };
}

function parseImportedPaper(value: unknown): Paper | null {
  if (!value || typeof value !== "object") return null;
  const paper = value as Partial<Paper>;
  const relevance = paper.relevance;
  if (
    typeof paper.id !== "string" || typeof paper.title !== "string" || typeof paper.publicationDate !== "string" ||
    typeof paper.journal !== "string" || (paper.feed !== "digital-humanities" && paper.feed !== "ai-history") ||
    !Array.isArray(paper.authors) || !Array.isArray(paper.topics) || !relevance ||
    !Array.isArray(relevance.signals) || !Array.isArray(relevance.methodSignals) || !Array.isArray(relevance.humanitiesSignals)
  ) return null;
  return {
    ...paper,
    issn: typeof paper.issn === "string" ? paper.issn : null,
    quartile: typeof paper.quartile === "string" ? paper.quartile : "Saved record",
    sjrYear: typeof paper.sjrYear === "number" ? paper.sjrYear : null,
    doi: typeof paper.doi === "string" ? paper.doi : null,
    doiUrl: safeExternalUrl(paper.doiUrl),
    articleUrl: safeExternalUrl(paper.articleUrl),
    journalUrl: safeExternalUrl(paper.journalUrl),
    openAccessUrl: safeExternalUrl(paper.openAccessUrl),
    openAccessPdfUrl: safeExternalUrl(paper.openAccessPdfUrl),
    openAccessStatus: typeof paper.openAccessStatus === "string" ? paper.openAccessStatus : null,
    abstract: typeof paper.abstract === "string" ? paper.abstract : null,
    metadataSources: Array.isArray(paper.metadataSources) ? paper.metadataSources.filter((item): item is string => typeof item === "string") : [],
  } as Paper;
}

function loadSavedPapers(): Paper[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_STORAGE_KEY) || "[]") as unknown;
    const values = Array.isArray(parsed) ? parsed : [];
    return values.map(parseImportedPaper).filter((paper): paper is Paper => Boolean(paper));
  } catch {
    return [];
  }
}

function loadAnnotations(): Annotation[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ANNOTATION_STORAGE_KEY) || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.map(parseAnnotation).filter((item): item is Annotation => Boolean(item)) : [];
  } catch {
    return [];
  }
}

function ArrowIcon() { return <span aria-hidden="true">↗</span>; }

function LinkButton({ href, label, primary = false }: { href: string; label: string; primary?: boolean }) {
  return <a className={primary ? "link-button link-button--primary" : "link-button"} href={href} target="_blank" rel="noreferrer">{label} <ArrowIcon /></a>;
}

function PaperCard({ paper, saved, annotationCount, hasUploadedPdf, onToggleSaved, onOpenReader }: { paper: Paper; saved: boolean; annotationCount: number; hasUploadedPdf: boolean; onToggleSaved: (paper: Paper) => void; onOpenReader: (paper: Paper) => void }) {
  const [expanded, setExpanded] = useState(false);
  const abstract = paper.abstract?.trim() || null;
  const isLong = Boolean(abstract && abstract.length > 680);
  const abstractText = abstract && !expanded && isLong ? `${abstract.slice(0, 680).replace(/\s+\S*$/, "")}…` : abstract;
  const openArticleUrl = paper.doiUrl || paper.articleUrl;
  const showArticlePage = paper.articleUrl && paper.articleUrl !== paper.doiUrl;

  return (
    <article className="paper-card">
      <div className="paper-card__topline"><time dateTime={paper.publicationDate}>{formatDate(paper.publicationDate)}</time><span className="dot" aria-hidden="true" /><span>{paper.journal}</span><span className="feed-pill">{FEEDS[paper.feed].shortLabel}</span><span className="quartile">{venueStatus(paper.quartile, paper.sjrYear)}</span></div>
      <h2>{paper.title}</h2>
      <p className="authors">{paper.authors.length ? paper.authors.join(", ") : "Authors not listed in open metadata"}</p>
      <section className="abstract-block" aria-label="Abstract"><p className="eyebrow">Abstract</p>{abstractText ? <><p className="abstract-text">{abstractText}</p>{isLong && <button className="text-button" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : "Read full abstract"}</button>}</> : <p className="abstract-missing">No abstract was supplied by OpenAlex or Crossref. The article page may include one.</p>}</section>
      <div className="relevance-panel"><div className="score-orbit" style={{ "--score": `${paper.relevance.score * 3.6}deg` } as React.CSSProperties}><span>{paper.relevance.score}</span></div><div><p className="eyebrow">{scoreLabel(paper.relevance.score)} · rules v2</p><p>{paper.relevance.reason}</p><div className="signal-list" aria-label="Relevance signals">{paper.relevance.signals.slice(0, 5).map((signal) => <span key={signal}>{signal}</span>)}</div></div></div>
      <footer className="paper-actions"><div className="paper-actions__primary">{openArticleUrl ? <LinkButton href={openArticleUrl} label="Open article" primary /> : <span className="unavailable">No article link in open metadata</span>}<button className="reader-button" type="button" onClick={() => onOpenReader(paper)}><span aria-hidden="true">▤</span>{hasUploadedPdf ? "Read & summarize" : paper.openAccessPdfUrl ? "Read & annotate" : "Notes / upload PDF"}{annotationCount > 0 && <strong>{annotationCount}</strong>}</button><button className={saved ? "save-button is-saved" : "save-button"} type="button" onClick={() => onToggleSaved(paper)} aria-pressed={saved} aria-label={`${saved ? "Remove" : "Save"} ${paper.title} ${saved ? "from" : "to"} reading list`}><span aria-hidden="true">{saved ? "✓" : "+"}</span>{saved ? "Saved" : "Save paper"}</button></div><div className="paper-actions__links" aria-label="Paper links">{paper.doiUrl && <LinkButton href={paper.doiUrl} label="DOI" />}{showArticlePage && <LinkButton href={paper.articleUrl!} label="Article page" />}{paper.journalUrl && <LinkButton href={paper.journalUrl} label="Journal" />}{paper.openAccessUrl && <LinkButton href={paper.openAccessUrl} label="Open-access copy" />}</div></footer>
    </article>
  );
}

function JournalCard({ journal }: { journal: MonitoredJournal }) {
  return <article className="journal-card"><div><span className="feed-pill">{FEEDS[journal.feed].shortLabel}</span><span className="journal-card__status">{venueStatus(journal.quartile, journal.sjrYear)}</span></div><h3>{journal.title}</h3><p>{journal.focus}</p><dl><div><dt>ISSN</dt><dd>{journal.issns.join(" · ") || "Not listed"}</dd></div><div><dt>History matches</dt><dd>{journal.resultCount}</dd></div>{typeof journal.emotionResultCount === "number" && <div><dt>Emotion matches</dt><dd>{journal.emotionResultCount}</dd></div>}{typeof journal.candidateCount === "number" && <div><dt>Records audited</dt><dd>{journal.candidateCount}{journal.knownIssueCount ? ` · ${journal.knownIssueCount} labelled issue${journal.knownIssueCount === 1 ? "" : "s"}` : ""}</dd></div>}</dl><p className="journal-card__note">{journal.qualificationNote}</p>{journal.journalUrl && <LinkButton href={journal.journalUrl} label="Journal" />}</article>;
}

export default function App() {
  const [data, setData] = useState<TrackerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("digital-humanities");
  const [query, setQuery] = useState("");
  const [journal, setJournal] = useState("all");
  const [focus, setFocus] = useState("all");
  const [year, setYear] = useState("all");
  const [sort, setSort] = useState("newest");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [savedPapers, setSavedPapers] = useState<Paper[]>(loadSavedPapers);
  const [annotations, setAnnotations] = useState<Annotation[]>(loadAnnotations);
  const [uploadedPdfIds, setUploadedPdfIds] = useState<Set<string>>(() => new Set());
  const [activePaper, setActivePaper] = useState<Paper | null>(null);
  const [savedStatus, setSavedStatus] = useState("");
  const [dyslexiaMode, setDyslexiaMode] = useState(() => localStorage.getItem(READING_MODE_STORAGE_KEY) === "on");
  const [addPaperOpen, setAddPaperOpen] = useState(false);
  const [doiDraft, setDoiDraft] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualAuthors, setManualAuthors] = useState("");
  const [manualJournal, setManualJournal] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [pendingPdf, setPendingPdf] = useState<File | null>(null);
  const [addPaperStatus, setAddPaperStatus] = useState("");
  const [lookingUpDoi, setLookingUpDoi] = useState(false);

  useEffect(() => { fetch(DATA_URL).then((response) => { if (!response.ok) throw new Error(`Data request failed (${response.status})`); return response.json() as Promise<TrackerData>; }).then(setData).catch((reason: Error) => setError(reason.message)); }, []);
  useEffect(() => { try { localStorage.setItem(READING_MODE_STORAGE_KEY, dyslexiaMode ? "on" : "off"); } catch { /* The preference remains active for this visit. */ } }, [dyslexiaMode]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(savedPapers.map(async (paper) => (await loadLocalPdf(stablePaperId(paper))) ? stablePaperId(paper) : null)).then((ids) => {
      if (!cancelled) setUploadedPdfIds(new Set(ids.filter((id): id is string => Boolean(id))));
    }).catch(() => { if (!cancelled) setUploadedPdfIds(new Set()); });
    return () => { cancelled = true; };
  }, [savedPapers]);

  const selectView = (next: View) => { setView(next); setJournal("all"); setFocus("all"); setYear("all"); setVisibleCount(PAGE_SIZE); };
  const persistSaved = (next: Paper[]) => { setSavedPapers(next); try { localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(next)); setSavedStatus(""); } catch { setSavedStatus("This browser could not update local storage. Export the list to keep a backup."); } };
  const persistAnnotations = (next: Annotation[]) => { setAnnotations(next); try { localStorage.setItem(ANNOTATION_STORAGE_KEY, JSON.stringify(next)); } catch { setSavedStatus("This browser could not update annotation storage. Export your reading list now to keep a backup."); } };
  const ensureSaved = (paper: Paper) => { if (!savedPapers.some((item) => item.id === paper.id)) persistSaved([paper, ...savedPapers]); };
  const toggleSaved = (paper: Paper) => { const removing = savedPapers.some((item) => item.id === paper.id); persistSaved(removing ? savedPapers.filter((item) => item.id !== paper.id) : [paper, ...savedPapers]); };
  const addAnnotation = (annotation: Annotation) => persistAnnotations(mergeAnnotations(annotations, [annotation]));
  const updateAnnotation = (id: string, note: string) => persistAnnotations(annotations.map((item) => item.id === id ? { ...item, note, updatedAt: new Date().toISOString() } : item));
  const deleteAnnotation = (id: string) => persistAnnotations(annotations.filter((item) => item.id !== id));
  const addPersonalPaper = async () => {
    const doi = normaliseDoi(doiDraft);
    let citation: ImportedCitation | null = null;
    setAddPaperStatus("");
    if (doi) {
      setLookingUpDoi(true);
      try {
        const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error("not found");
        const payload = await response.json() as { message?: Record<string, unknown> };
        if (!payload.message) throw new Error("missing metadata");
        citation = citationFromCrossref(doi, payload.message);
      } catch {
        setAddPaperStatus("The DOI could not be looked up. You can still add the paper with the fields below.");
      } finally { setLookingUpDoi(false); }
    }
    const title = manualTitle.trim() || citation?.title || "";
    if (!title) { setAddPaperStatus("Add a DOI that resolves, or enter a title before saving."); return; }
    const paper: Paper = {
      id: doi ? `doi:${doi}` : `personal:${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`,
      title,
      authors: manualAuthors.trim() ? manualAuthors.split(/\s*;\s*|\s*,\s*/).filter(Boolean) : citation?.authors || [],
      publicationDate: manualDate || citation?.publicationDate || new Date().toISOString().slice(0, 10),
      journal: manualJournal.trim() || citation?.journal || "Personal library",
      feed: "digital-humanities",
      issn: null,
      quartile: "Personal library",
      sjrYear: null,
      doi: doi || null,
      doiUrl: doi ? `https://doi.org/${doi}` : null,
      articleUrl: citation?.articleUrl || null,
      journalUrl: null,
      openAccessUrl: null,
      openAccessPdfUrl: null,
      openAccessStatus: null,
      abstract: citation?.abstract || null,
      topics: [],
      relevance: { score: 0, reason: "Added manually to your private library.", signals: ["personal library"], methodSignals: [], humanitiesSignals: [], qualifies: true, classifier: "rules-v3" },
      metadataSources: doi && citation ? ["Crossref DOI lookup"] : ["Personal entry"],
    };
    try {
      if (pendingPdf) await saveLocalPdf(stablePaperId(paper), pendingPdf);
      persistSaved([paper, ...savedPapers.filter((item) => item.id !== paper.id)]);
      setUploadedPdfIds((current) => pendingPdf ? new Set([...current, stablePaperId(paper)]) : current);
      setAddPaperOpen(false);
      setDoiDraft(""); setManualTitle(""); setManualAuthors(""); setManualJournal(""); setManualDate(""); setPendingPdf(null);
      setActivePaper(paper);
      setSavedStatus(pendingPdf ? "Paper and local PDF added to your private library." : "Paper added to your private library.");
    } catch {
      setAddPaperStatus("The paper was not added because this browser could not retain the selected PDF. Try adding it without a PDF, then attach the PDF in the Reading Room.");
    }
  };
  const savedIds = useMemo(() => new Set(savedPapers.map((paper) => paper.id)), [savedPapers]);
  const annotationCounts = useMemo(() => { const counts = new Map<string, number>(); for (const annotation of annotations) counts.set(annotation.paperId, (counts.get(annotation.paperId) || 0) + 1); return counts; }, [annotations]);
  const sourcePapers = useMemo(() => {
    if (view === "saved") return savedPapers;
    if (view === "emotions-humanities") return data?.emotionPapers ?? [];
    if (view === "audit") return data?.auditPapers ?? [];
    return data?.papers.filter((paper) => paper.feed === view) ?? [];
  }, [data, savedPapers, view]);
  const journals = useMemo(() => [...new Set(sourcePapers.map((paper) => paper.journal))].sort(), [sourcePapers]);
  const yearCounts = useMemo(() => { const counts = new Map<string, number>(); for (const paper of sourcePapers) { const paperYear = paper.publicationDate.slice(0, 4); counts.set(paperYear, (counts.get(paperYear) ?? 0) + 1); } return [...counts.entries()].sort(([a], [b]) => b.localeCompare(a)); }, [sourcePapers]);

  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return sourcePapers.filter((paper) => {
      const haystack = [paper.title, paper.authors.join(" "), paper.journal, paper.abstract ?? "", paper.topics.join(" "), paper.relevance.reason].join(" ").toLowerCase();
      const methodText = paper.relevance.methodSignals.join(" ").toLowerCase();
      return terms.every((term) => haystack.includes(term)) && (journal === "all" || paper.journal === journal) && (year === "all" || paper.publicationDate.startsWith(year)) && (focus === "all" || (focus === "ai" && /ai \/ ml \/ llm|nlp/.test(methodText)) || (focus === "text" && /nlp|text-as-data|ocr|htr|knowledge/.test(methodText)) || (focus === "spatial" && /spatial|visual/.test(methodText)) || (focus === "oa" && Boolean(paper.openAccessUrl)));
    }).sort((a, b) => { const yearOrder = b.publicationDate.slice(0, 4).localeCompare(a.publicationDate.slice(0, 4)); if (yearOrder) return yearOrder; return sort === "score" ? b.relevance.score - a.relevance.score : b.publicationDate.localeCompare(a.publicationDate); });
  }, [sourcePapers, query, journal, focus, year, sort]);

  const exportSaved = () => {
    if (!savedPapers.length) return;
    const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), papers: savedPapers, annotations }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `chronicle-reading-list-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); setSavedStatus(`Exported ${savedPapers.length} saved ${savedPapers.length === 1 ? "paper" : "papers"}.`);
  };

  const importSaved = async (file: File | undefined) => {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as { papers?: unknown; annotations?: unknown };
      if (!Array.isArray(payload.papers)) throw new Error("missing papers array");
      const imported = payload.papers.map(parseImportedPaper).filter((paper): paper is Paper => Boolean(paper));
      if (!imported.length && payload.papers.length) throw new Error("no valid papers");
      persistSaved([...new Map([...savedPapers, ...imported].map((paper) => [paper.id, paper])).values()]);
      const importedAnnotations = Array.isArray(payload.annotations) ? payload.annotations.map(parseAnnotation).filter((item): item is Annotation => Boolean(item)) : [];
      persistAnnotations(mergeAnnotations(annotations, importedAnnotations));
      setSavedStatus(`Imported ${imported.length} ${imported.length === 1 ? "paper" : "papers"} and ${importedAnnotations.length} ${importedAnnotations.length === 1 ? "annotation" : "annotations"}; duplicates were merged.`);
    } catch {
      setSavedStatus("That file is not a valid Brilliant reading-list export.");
    }
  };

  const visiblePapers = filtered.slice(0, visibleCount);
  const viewLabel = view === "saved" ? "Saved papers" : view === "emotions-humanities" ? EMOTIONS_FEED.label : view === "audit" ? "Audit queue" : FEEDS[view].label;

  return <div className={dyslexiaMode ? "app-shell dyslexia-mode" : "app-shell"}>
    <header className="site-header"><a className="brand" href="#top" aria-label="Brilliant home"><span className="brand-mark" aria-hidden="true">B</span><span><strong>Brilliant</strong><small>Research tracker</small></span></a><nav className="header-nav" aria-label="Page navigation"><a href="#feeds">Feeds</a><button type="button" onClick={() => selectView("saved")}>Saved <span>{savedPapers.length}</span></button><a href="#journals">Journals</a><button className={dyslexiaMode ? "reading-mode-toggle is-active" : "reading-mode-toggle"} type="button" aria-pressed={dyslexiaMode} onClick={() => setDyslexiaMode((value) => !value)}>Reading mode</button></nav></header>
    <main id="top"><section className="hero"><div><p className="kicker">Research tracker</p><h1>Find the work<br />worth reading.</h1><p className="hero-copy">A focused, auditable scan of digital and computational humanities research.</p></div></section>
      {error ? <div className="state-card" role="alert"><p className="eyebrow">Data could not be loaded</p><h2>Research records are unavailable.</h2><p>{error}. Serve the project locally or check that <code>public/data/papers.json</code> is present.</p></div> : !data ? <div className="state-card" aria-live="polite"><div className="loading-line" /><p>Loading research records…</p></div> : <>
        <section className="stat-strip" aria-label="Collection summary"><div><span>{data.feedCounts["digital-humanities"]}</span><p>history-focused DH papers</p></div><div><span>{data.feedCounts["ai-history"]}</span><p>AI-in-history papers</p></div><div><span>{data.emotionFeedCount ?? 0}</span><p>emotion & affect papers</p></div><div><span>{data.audit?.candidateCount ?? "—"}</span><p>records audited</p></div></section>
        <section id="feeds" className="feed-switcher" aria-label="Choose research view">{(Object.keys(FEEDS) as Feed[]).map((feedId) => <button key={feedId} className={view === feedId ? "is-active" : ""} type="button" onClick={() => selectView(feedId)} aria-pressed={view === feedId}><span>{FEEDS[feedId].shortLabel}</span><strong>{FEEDS[feedId].label}</strong><small>{data.feedCounts[feedId]} qualifying papers</small></button>)}<button className={view === "emotions-humanities" ? "is-active" : ""} type="button" onClick={() => selectView("emotions-humanities")} aria-pressed={view === "emotions-humanities"}><span>{EMOTIONS_FEED.shortLabel}</span><strong>{EMOTIONS_FEED.label}</strong><small>{data.emotionFeedCount ?? 0} emotion-related papers</small></button><button className={view === "audit" ? "is-active" : ""} type="button" onClick={() => selectView("audit")} aria-pressed={view === "audit"}><span>Audit mode</span><strong>Review the remainder</strong><small>{data.audit?.unreviewedCount ?? 0} unreviewed records</small></button><button className={view === "saved" ? "is-active" : ""} type="button" onClick={() => selectView("saved")} aria-pressed={view === "saved"}><span>Private reading list</span><strong>Saved papers</strong><small>{savedPapers.length} saved in this browser</small></button><p>{view === "saved" ? "Your saved papers stay in this browser and are not sent to a server. Export a JSON backup to move the list to another browser or device." : view === "emotions-humanities" ? EMOTIONS_FEED.description : view === "audit" ? data.audit?.definition ?? "All available records that did not pass the primary history filter." : FEEDS[view].description}</p></section>
        {view === "saved" && <section className="saved-tools" aria-label="Saved-list backup and restore"><div><p className="eyebrow">Local & private</p><h2>Reading list controls</h2><p>Add a DOI or a personal PDF, then read, annotate, and keep the citation in this browser. JSON export carries saved paper snapshots, citations, highlights, notes, page references, and source indicators—but never attached PDF bytes.</p></div><div><button type="button" onClick={() => { setAddPaperOpen((open) => !open); setAddPaperStatus(""); }}>{addPaperOpen ? "Close" : "Add paper"}</button><button type="button" onClick={exportSaved} disabled={!savedPapers.length}>Export JSON</button><label>Import JSON<input className="sr-only" type="file" accept="application/json,.json" onChange={(event) => { void importSaved(event.target.files?.[0]); event.target.value = ""; }} /></label></div>{addPaperOpen && <form className="add-paper-form" onSubmit={(event) => { event.preventDefault(); void addPersonalPaper(); }}><div className="add-paper-form__intro"><p className="eyebrow">Add to your private library</p><p>Paste a DOI for automatic citation metadata, or enter a title and attach a legally obtained PDF. The PDF stays in this browser.</p></div><label>DOI <input value={doiDraft} onChange={(event) => setDoiDraft(event.target.value)} placeholder="10.1234/example or https://doi.org/..." /></label><label>Title <input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} placeholder="Required if the DOI does not resolve" /></label><label>Authors <input value={manualAuthors} onChange={(event) => setManualAuthors(event.target.value)} placeholder="Separate authors with semicolons" /></label><label>Journal / source <input value={manualJournal} onChange={(event) => setManualJournal(event.target.value)} placeholder="Optional" /></label><label>Publication date <input type="date" value={manualDate} onChange={(event) => setManualDate(event.target.value)} /></label><label>PDF <input type="file" accept="application/pdf,.pdf" onChange={(event) => setPendingPdf(event.target.files?.[0] || null)} /><small>{pendingPdf ? pendingPdf.name : "Optional — attach it now or later in the Reading Room."}</small></label><div className="add-paper-form__actions"><button type="submit" disabled={lookingUpDoi}>{lookingUpDoi ? "Looking up DOI…" : "Add and open Reading Room"}</button><p aria-live="polite">{addPaperStatus}</p></div></form>}<p className="saved-status" aria-live="polite">{savedStatus}</p></section>}
        <section className="controls" aria-label="Filter papers"><label className="search-field"><span aria-hidden="true">⌕</span><span className="sr-only">Search title, author, abstract, or topic</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, author, abstract, or topic" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button>}</label><label><span className="sr-only">Journal</span><select value={journal} onChange={(event) => setJournal(event.target.value)}><option value="all">All journals in view</option>{journals.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label><span className="sr-only">Method</span><select value={focus} onChange={(event) => setFocus(event.target.value)}><option value="all">All qualifying methods</option><option value="ai">AI / ML / LLM / NLP</option><option value="text">Text & document methods</option><option value="spatial">Spatial & visual methods</option><option value="oa">Open-access copy</option></select></label><label><span className="sr-only">Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="score">Highest score within year</option></select></label></section>
        <section className="year-filter" aria-label="Filter by publication year"><p>Publication year</p><div><button className={year === "all" ? "is-active" : ""} type="button" onClick={() => { setYear("all"); setVisibleCount(PAGE_SIZE); }} aria-pressed={year === "all"}>All years <span>{sourcePapers.length}</span></button>{yearCounts.map(([paperYear, count]) => <button key={paperYear} className={year === paperYear ? "is-active" : ""} type="button" onClick={() => { setYear(paperYear); setVisibleCount(PAGE_SIZE); }} aria-pressed={year === paperYear}>{paperYear} <span>{count}</span></button>)}</div></section>
        <div className="content-grid"><section className="results" aria-label={`${viewLabel} results`}><div className="results-heading"><div><p className="kicker">{view === "saved" ? "Private reading list" : view === "emotions-humanities" ? EMOTIONS_FEED.shortLabel : view === "audit" ? "Audit mode" : FEEDS[view].shortLabel} · {year === "all" ? "all saved years" : year}</p><h2>{filtered.length} {filtered.length === 1 ? "paper" : "papers"}</h2></div><p>{view === "saved" ? `${annotations.length} local annotations` : `${formatDate(data.windowStart)} — ${formatDate(data.windowEnd)}`}</p></div>{filtered.length ? <>{visiblePapers.map((paper) => <PaperCard key={paper.id} paper={paper} saved={savedIds.has(paper.id)} annotationCount={annotationCounts.get(stablePaperId(paper)) || 0} hasUploadedPdf={view === "saved" && uploadedPdfIds.has(stablePaperId(paper))} onToggleSaved={toggleSaved} onOpenReader={setActivePaper} />)}{visiblePapers.length < filtered.length && <button className="load-more" type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Show more papers <span>{filtered.length - visiblePapers.length} remaining</span></button>}</> : view === "saved" && !savedPapers.length ? <div className="empty-state"><span aria-hidden="true">☆</span><h2>Your reading list is empty.</h2><p>Save papers or create an annotation in the Reading Room. Saved records retain citation metadata, highlights, notes, and the same article links.</p><button type="button" onClick={() => selectView("digital-humanities")}>Browse the primary feed</button></div> : <div className="empty-state"><span aria-hidden="true">∅</span><h2>No papers match these filters.</h2><p>Try another term or reset the year, journal, and method filters.</p><button type="button" onClick={() => { setQuery(""); setJournal("all"); setFocus("all"); setYear("all"); }}>Reset filters</button></div>}</section>
          <aside id="method" className="method-card">{view === "saved" ? <><p className="kicker">Saved on this device</p><h2>Your private list</h2><p>Chronicle stores complete paper snapshots locally so saved abstracts and links remain available even if a paper later leaves the two-year feed.</p><ol><li><span>01</span><div><strong>No account</strong><p>Saving does not contact a server.</p></div></li><li><span>02</span><div><strong>Local storage</strong><p>The list belongs to this browser profile.</p></div></li><li><span>03</span><div><strong>Portable JSON</strong><p>Export and import to back up or move it.</p></div></li></ol></> : view === "audit" ? <><p className="kicker">No silent exclusions</p><h2>Audit coverage</h2><p>{data.audit?.candidateCount ?? 0} available article records were collected directly from the configured ISSNs. {data.audit?.unreviewedCount ?? 0} remain here because they did not meet the history rule; search them, inspect the reason, and save anything you judge relevant.</p><ol><li><span>01</span><div><strong>Venue universe</strong><p>The visible journal list is the entire collection scope.</p></div></li><li><span>02</span><div><strong>Metadata limits</strong><p>OpenAlex and Crossref can be incomplete or delayed; coverage is transparent, not a guarantee of every publisher issue.</p></div></li><li><span>03</span><div><strong>Human review</strong><p>Borderline records remain available for your own assessment.</p></div></li></ol></> : <><p className="kicker">Reading the signals</p><h2>Why this paper?</h2><p>{view === "emotions-humanities" ? "This tertiary feed looks for emotion, affect, sentiment, feeling, or affective-computing evidence inside the specialist digital and computational humanities venues. History is intentionally not required." : "Membership in a monitored journal is only the starting point. Every visible record must match both a computational-method signal and a history, archives, heritage, cultural-memory, historical-language, or historical-data signal."}</p><ol><li><span>01</span><div><strong>Configured venue</strong><p>The collector iterates the pinned ISSN list directly.</p></div></li><li><span>02</span><div><strong>Open metadata</strong><p>OpenAlex first; Crossref complements gaps.</p></div></li><li><span>03</span><div><strong>Explainable signals</strong><p>Every match retains the evidence that surfaced it.</p></div></li></ol></>}<div className="method-note"><span aria-hidden="true">i</span><p>Generic history and generic AI are excluded from the history feeds. “Open article” uses DOI first, then the best available article page. Access remains manual through the destination or your library.</p></div><p className="refreshed">Last scan {formatGenerated(data.generatedAt)}</p></aside></div>
        <section id="journals" className="journals-section"><div className="section-heading"><div><p className="kicker">Transparent coverage</p><h2>Monitored journals</h2></div><p>Direct ISSN scan · last updated {formatGenerated(data.generatedAt)}</p></div><p className="journals-intro">This configured list is the complete venue universe used by the collector. Ranked Q1/Q2 venues and visibly marked field-significant specialist venues are included; each card reports article records audited, rather than implying that unlisted publisher metadata does not exist.</p>{(Object.keys(FEEDS) as Feed[]).map((feedId) => <section className="journal-group" key={feedId}><div><p className="eyebrow">{FEEDS[feedId].shortLabel}</p><h3>{FEEDS[feedId].label}</h3><p>{FEEDS[feedId].description}</p></div><div className="journal-grid">{data.journals.filter((item) => item.feed === feedId).map((item) => <JournalCard key={item.title} journal={item} />)}</div></section>)}</section>
      </>}
    </main>
    <footer className="site-footer"><div className="brand brand--footer"><span className="brand-mark" aria-hidden="true">B</span><span><strong>Brilliant</strong><small>Research, kept readable.</small></span></div><p>Open scholarly metadata · Private saved papers · DOI links</p></footer>
    {activePaper && <ReadingRoom paper={activePaper} annotations={annotations.filter((item) => item.paperId === stablePaperId(activePaper))} onAddAnnotation={addAnnotation} onUpdateAnnotation={updateAnnotation} onDeleteAnnotation={deleteAnnotation} onEnsureSaved={ensureSaved} onClose={() => setActivePaper(null)} />}
  </div>;
}
