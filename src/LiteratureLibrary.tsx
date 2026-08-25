import { useEffect, useMemo, useState } from "react";

const DATA_URL = `${import.meta.env.BASE_URL}data/literature.json`;
const REVIEW_STORAGE_KEY = "brilliant-literature-review-v1";
const PAGE_SIZE = 12;

type ReviewStatus = "unread" | "to-read" | "reviewed" | "cited";
type ReviewState = Record<string, { status: ReviewStatus; tags: string[]; updatedAt: string }>;

type LiteratureRecord = {
  id: string;
  citation: string;
  authors: string[];
  year: number;
  title: string;
  container_title: string;
  publisher: string;
  doi: string;
  isbn: string;
  url: string;
  source_type: string;
  category: string;
  period: string;
  geography: string;
  method_corpus: string;
  key_claim: string;
  relevance: string;
  dialogue: string;
  tags: string[];
  must_cite: boolean;
  closest_precedent: boolean;
  verification: {
    status: string;
    checked_at: string;
    primary_record: string;
    metadata_record: string;
    notes: string;
  };
};

type LiteratureData = {
  title: string;
  generated_at: string;
  record_count: number;
  must_cite_count: number;
  closest_precedent_count: number;
  verification_note: string;
  categories: string[];
  records: LiteratureRecord[];
};

function loadReviews(): ReviewState {
  try {
    const value = JSON.parse(localStorage.getItem(REVIEW_STORAGE_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as ReviewState : {};
  } catch {
    return {};
  }
}

function statusLabel(status: ReviewStatus) {
  return status === "to-read" ? "To read" : status[0].toUpperCase() + status.slice(1);
}

export default function LiteratureLibrary() {
  const [data, setData] = useState<LiteratureData | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [period, setPeriod] = useState("all");
  const [priority, setPriority] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("author");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [reviews, setReviews] = useState<ReviewState>(loadReviews);
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch(DATA_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Literature request failed (${response.status})`);
        return response.json() as Promise<LiteratureData>;
      })
      .then(setData)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    try { localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(reviews)); } catch { /* Review state remains available for this visit. */ }
  }, [reviews]);

  const updateReview = (record: LiteratureRecord, nextStatus?: ReviewStatus, newTag?: string) => {
    setReviews((current) => {
      const prior = current[record.id] || { status: "unread" as ReviewStatus, tags: [], updatedAt: "" };
      const tags = newTag && !prior.tags.includes(newTag) ? [...prior.tags, newTag] : prior.tags;
      return { ...current, [record.id]: { status: nextStatus || prior.status, tags, updatedAt: new Date().toISOString() } };
    });
  };

  const removeTag = (record: LiteratureRecord, tag: string) => {
    setReviews((current) => {
      const prior = current[record.id];
      if (!prior) return current;
      return { ...current, [record.id]: { ...prior, tags: prior.tags.filter((item) => item !== tag), updatedAt: new Date().toISOString() } };
    });
  };

  const filtered = useMemo(() => {
    if (!data) return [];
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return data.records.filter((record) => {
      const review = reviews[record.id];
      const haystack = [record.title, record.authors.join(" "), record.citation, record.category, record.period, record.geography, record.method_corpus, record.key_claim, record.relevance, record.dialogue, ...record.tags, ...(review?.tags || [])].join(" ").toLowerCase();
      const yearMatches = period === "all" || (period === "pre-1945" && record.year < 1945) || (period === "1945-1979" && record.year >= 1945 && record.year <= 1979) || (period === "1980-1999" && record.year >= 1980 && record.year <= 1999) || (period === "2000-present" && record.year >= 2000);
      return terms.every((term) => haystack.includes(term))
        && (category === "all" || record.category === category)
        && yearMatches
        && (priority === "all" || (priority === "must-cite" && record.must_cite) || (priority === "closest" && record.closest_precedent))
        && (status === "all" || (review?.status || "unread") === status);
    }).sort((a, b) => sort === "newest" ? b.year - a.year || a.title.localeCompare(b.title) : sort === "oldest" ? a.year - b.year || a.title.localeCompare(b.title) : (a.authors[0] || "").localeCompare(b.authors[0] || "") || b.year - a.year);
  }, [category, data, period, priority, query, reviews, sort, status]);


  const exportReviews = () => {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), reviews }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `brilliant-literature-review-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return <section id="literature" className="literature-library" aria-labelledby="literature-heading">
    <div className="literature-hero">
      <div><p className="kicker">Canonical secondary literature</p><h2 id="literature-heading">The Pulse of History</h2><p>A verified literature map for computational analysis of historical scholarship, including the 1900–1944 comparison. Search the canonical records, review their claims, and keep private workflow tags in this browser.</p></div>
      {data && <dl><div><dt>Verified</dt><dd>{data.record_count}</dd></div><div><dt>Must-cite</dt><dd>{data.must_cite_count}</dd></div><div><dt>Closest precedents</dt><dd>{data.closest_precedent_count}</dd></div></dl>}
    </div>
    {error ? <div className="state-card" role="alert"><h2>Literature library unavailable.</h2><p>{error}. Check that <code>public/data/literature.json</code> is present.</p></div> : !data ? <div className="literature-loading" aria-live="polite">Loading verified literature…</div> : <>
      <div className="literature-controls" aria-label="Filter secondary literature">
        <label className="literature-search"><span className="sr-only">Search literature</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search citations, claims, methods, places, or tags" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear literature search">×</button>}</label>
        <label><span className="sr-only">Literature category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All review layers</option>{data.categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label><span className="sr-only">Publication period</span><select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="all">All publication years</option><option value="pre-1945">Before 1945</option><option value="1945-1979">1945–1979</option><option value="1980-1999">1980–1999</option><option value="2000-present">2000–present</option></select></label>
        <label><span className="sr-only">Citation priority</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="all">All priorities</option><option value="must-cite">Must-cite only</option><option value="closest">Closest precedents</option></select></label>
        <label><span className="sr-only">Review status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All review states</option><option value="unread">Unread</option><option value="to-read">To read</option><option value="reviewed">Reviewed</option><option value="cited">Cited</option></select></label>
        <label><span className="sr-only">Sort literature</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="author">Author A–Z</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      </div>
      <div className="literature-summary"><p><strong>{filtered.length}</strong> of {data.record_count} records</p><p>{data.verification_note}</p><button type="button" onClick={exportReviews}>Export private review state</button></div>
      <div className="literature-grid">
        {filtered.slice(0, visible).map((record) => {
          const review = reviews[record.id] || { status: "unread" as ReviewStatus, tags: [], updatedAt: "" };
          return <article className="literature-card" key={record.id}>
            <div className="literature-card__meta"><span>{record.category}</span><span>{record.year}</span>{record.must_cite && <strong>Must-cite</strong>}{record.closest_precedent && <strong>Closest precedent</strong>}</div>
            <h3>{record.title}</h3><p className="literature-authors">{record.authors.join(" · ")}</p>
            <details><summary>Why it matters</summary><dl><div><dt>Key claim</dt><dd>{record.key_claim}</dd></div><div><dt>Exact relevance</dt><dd>{record.relevance}</dd></div><div><dt>Paper dialogue</dt><dd>{record.dialogue}</dd></div><div><dt>Corpus / method</dt><dd>{record.method_corpus}</dd></div><div><dt>Period / geography</dt><dd>{record.period} · {record.geography}</dd></div></dl></details>
            <p className="literature-citation">{record.citation}</p>
            <div className="literature-tags" aria-label="Source tags">{record.tags.map((tag) => <span key={tag}>{tag}</span>)}{review.tags.map((tag) => <button type="button" key={tag} onClick={() => removeTag(record, tag)} title="Remove private tag">{tag} ×</button>)}</div>
            <div className="literature-review"><label>Review state<select value={review.status} onChange={(event) => updateReview(record, event.target.value as ReviewStatus)}>{(["unread", "to-read", "reviewed", "cited"] as ReviewStatus[]).map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}</select></label><label>Private tag<input value={tagDrafts[record.id] || ""} onChange={(event) => setTagDrafts((current) => ({ ...current, [record.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); const tag = (tagDrafts[record.id] || "").trim(); if (tag) updateReview(record, undefined, tag); setTagDrafts((current) => ({ ...current, [record.id]: "" })); } }} placeholder="Type + Enter" /></label></div>
            <footer><a href={record.verification.primary_record || record.url} target="_blank" rel="noreferrer">Primary record</a><span>Verified {record.verification.checked_at}</span></footer>
          </article>;
        })}
      </div>
      {!filtered.length && <div className="empty-state"><span aria-hidden="true">∅</span><h2>No sources match.</h2><p>Broaden the search or reset one of the literature filters.</p></div>}
      {visible < filtered.length && <button className="load-more" type="button" onClick={() => setVisible((count) => count + PAGE_SIZE)}>Show more sources <span>{filtered.length - visible} remaining</span></button>}
    </>}
  </section>;
}
