import { useEffect, useMemo, useState } from "react";
import type { Paper, TrackerData } from "./types";

const DATA_URL = `${import.meta.env.BASE_URL}data/papers.json`;
const PAGE_SIZE = 40;

function formatDate(value: string, long = false) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: long ? "long" : "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatGenerated(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function scoreLabel(score: number) {
  if (score >= 75) return "Strong match";
  if (score >= 55) return "Good match";
  return "Possible match";
}

function ArrowIcon() {
  return <span aria-hidden="true">↗</span>;
}

function LinkButton({ href, label, primary = false }: { href: string; label: string; primary?: boolean }) {
  return (
    <a className={primary ? "link-button link-button--primary" : "link-button"} href={href} target="_blank" rel="noreferrer">
      {label} <ArrowIcon />
    </a>
  );
}

function PaperCard({ paper }: { paper: Paper }) {
  const [expanded, setExpanded] = useState(false);
  const abstract = paper.abstract?.trim() || null;
  const isLong = Boolean(abstract && abstract.length > 680);
  const abstractText = abstract && !expanded && isLong ? `${abstract.slice(0, 680).replace(/\s+\S*$/, "")}…` : abstract;
  const openArticleUrl = paper.doiUrl || paper.articleUrl;
  const showArticlePage = paper.articleUrl && paper.articleUrl !== paper.doiUrl;

  return (
    <article className="paper-card">
      <div className="paper-card__topline">
        <time dateTime={paper.publicationDate}>{formatDate(paper.publicationDate)}</time>
        <span className="dot" aria-hidden="true" />
        <span>{paper.journal}</span>
        <span className="quartile">{paper.quartile} · SJR {paper.sjrYear ?? "pinned"}</span>
      </div>

      <h2>{paper.title}</h2>
      <p className="authors">{paper.authors.length ? paper.authors.join(", ") : "Authors not listed in open metadata"}</p>

      <section className="abstract-block" aria-label="Abstract">
        <p className="eyebrow">Abstract</p>
        {abstractText ? (
          <>
            <p className="abstract-text">{abstractText}</p>
            {isLong && (
              <button className="text-button" type="button" onClick={() => setExpanded((value) => !value)}>
                {expanded ? "Show less" : "Read full abstract"}
              </button>
            )}
          </>
        ) : (
          <p className="abstract-missing">No abstract was supplied by OpenAlex or Crossref. The article page may include one.</p>
        )}
      </section>

      <div className="relevance-panel">
        <div className="score-orbit" style={{ "--score": `${paper.relevance.score * 3.6}deg` } as React.CSSProperties}>
          <span>{paper.relevance.score}</span>
        </div>
        <div>
          <p className="eyebrow">{scoreLabel(paper.relevance.score)} · rules v1</p>
          <p>{paper.relevance.reason}</p>
          <div className="signal-list" aria-label="Relevance signals">
            {paper.relevance.signals.slice(0, 4).map((signal) => <span key={signal}>{signal}</span>)}
          </div>
        </div>
      </div>

      <footer className="paper-actions">
        <div className="paper-actions__primary">
          {openArticleUrl ? (
            <LinkButton href={openArticleUrl} label="Open article" primary />
          ) : (
            <span className="unavailable">No article link in open metadata</span>
          )}
        </div>
        <div className="paper-actions__links" aria-label="Paper links">
          {paper.doiUrl && <LinkButton href={paper.doiUrl} label="DOI" />}
          {showArticlePage && <LinkButton href={paper.articleUrl!} label="Article page" />}
          {paper.journalUrl && <LinkButton href={paper.journalUrl} label="Journal" />}
          {paper.openAccessUrl && <LinkButton href={paper.openAccessUrl} label="Open-access copy" />}
        </div>
      </footer>
    </article>
  );
}

export default function App() {
  const [data, setData] = useState<TrackerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [journal, setJournal] = useState("all");
  const [focus, setFocus] = useState("all");
  const [year, setYear] = useState("all");
  const [sort, setSort] = useState("newest");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    fetch(DATA_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`Data request failed (${response.status})`);
        return response.json() as Promise<TrackerData>;
      })
      .then(setData)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const journals = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.papers.map((paper) => paper.journal))].sort();
  }, [data]);

  const yearCounts = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    for (const paper of data.papers) {
      const paperYear = paper.publicationDate.slice(0, 4);
      counts.set(paperYear, (counts.get(paperYear) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return data.papers
      .filter((paper) => {
        const haystack = [paper.title, paper.authors.join(" "), paper.journal, paper.abstract ?? "", paper.topics.join(" "), paper.relevance.reason].join(" ").toLowerCase();
        const matchesSearch = terms.every((term) => haystack.includes(term));
        const matchesJournal = journal === "all" || paper.journal === journal;
        const matchesYear = year === "all" || paper.publicationDate.startsWith(year);
        const matchesFocus =
          focus === "all" ||
          (focus === "strong" && paper.relevance.score >= 75) ||
          (focus === "digital" && /digital|comput|text mining|gis|ocr|corpus/.test(haystack)) ||
          (focus === "oa" && Boolean(paper.openAccessUrl));
        return matchesSearch && matchesJournal && matchesYear && matchesFocus;
      })
      .sort((a, b) => {
        const yearOrder = b.publicationDate.slice(0, 4).localeCompare(a.publicationDate.slice(0, 4));
        if (yearOrder) return yearOrder;
        return sort === "score" ? b.relevance.score - a.relevance.score : b.publicationDate.localeCompare(a.publicationDate);
      });
  }, [data, query, journal, focus, year, sort]);

  const visiblePapers = filtered.slice(0, visibleCount);

  const abstractCoverage = data?.papers.length
    ? Math.round((data.papers.filter((paper) => paper.abstract).length / data.papers.length) * 100)
    : 0;
  const oaCount = data?.papers.filter((paper) => paper.openAccessUrl).length ?? 0;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Chronicle home">
          <span className="brand-mark" aria-hidden="true">C</span>
          <span><strong>Chronicle</strong><small>History research tracker</small></span>
        </a>
        <a className="method-link" href="#method">How it works <span aria-hidden="true">↓</span></a>
      </header>

      <main id="top">
        <section className="hero">
          <div>
            <p className="kicker">New scholarship, clearly surfaced</p>
            <h1>Stay current without<br />losing the thread.</h1>
            <p className="hero-copy">A weekly scan of pinned SJR Q1 journals, using open scholarly metadata and explainable history signals.</p>
          </div>
          <div className="hero-rule" aria-hidden="true"><span>Weekly</span><span>Open metadata</span><span>Explainable</span></div>
        </section>

        {error ? (
          <div className="state-card" role="alert">
            <p className="eyebrow">Data could not be loaded</p>
            <h2>The journal desk is temporarily unavailable.</h2>
            <p>{error}. Serve the project locally or check that <code>public/data/papers.json</code> is present.</p>
          </div>
        ) : !data ? (
          <div className="state-card" aria-live="polite"><div className="loading-line" /><p>Opening the latest research desk…</p></div>
        ) : (
          <>
            <section className="stat-strip" aria-label="Collection summary">
              <div><span>{data.papers.length}</span><p>papers across {data.windowStart.slice(0, 4)}–{data.windowEnd.slice(0, 4)}</p></div>
              <div><span>{data.journalCount}</span><p>pinned Q1 journals</p></div>
              <div><span>{abstractCoverage}%</span><p>with readable abstracts</p></div>
              <div><span>{oaCount}</span><p>legal OA copies found</p></div>
            </section>

            <section className="controls" aria-label="Filter papers">
              <label className="search-field">
                <span aria-hidden="true">⌕</span>
                <span className="sr-only">Search title, author, abstract, or topic</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, author, abstract, or topic" />
                {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button>}
              </label>
              <label><span className="sr-only">Journal</span><select value={journal} onChange={(event) => setJournal(event.target.value)}><option value="all">All journals</option>{journals.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
              <label><span className="sr-only">Focus</span><select value={focus} onChange={(event) => setFocus(event.target.value)}><option value="all">All matches</option><option value="strong">Strong matches</option><option value="digital">Digital humanities</option><option value="oa">Open-access copy</option></select></label>
              <label><span className="sr-only">Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="score">Highest score within year</option></select></label>
            </section>

            <section className="year-filter" aria-label="Filter by publication year">
              <p>Publication year</p>
              <div>
                <button className={year === "all" ? "is-active" : ""} type="button" onClick={() => { setYear("all"); setVisibleCount(PAGE_SIZE); }} aria-pressed={year === "all"}>All years <span>{data.papers.length}</span></button>
                {yearCounts.map(([paperYear, count]) => (
                  <button key={paperYear} className={year === paperYear ? "is-active" : ""} type="button" onClick={() => { setYear(paperYear); setVisibleCount(PAGE_SIZE); }} aria-pressed={year === paperYear}>{paperYear} <span>{count}</span></button>
                ))}
              </div>
            </section>

            <div className="content-grid">
              <section className="results" aria-label="Research results">
                <div className="results-heading">
                  <div><p className="kicker">{year === "all" ? "Two-year archive" : `${year} archive`}</p><h2>{filtered.length} {filtered.length === 1 ? "paper" : "papers"}</h2></div>
                  <p>{formatDate(data.windowStart)} — {formatDate(data.windowEnd)}</p>
                </div>
                {filtered.length ? <>
                  {visiblePapers.map((paper) => <PaperCard key={paper.id} paper={paper} />)}
                  {visiblePapers.length < filtered.length && <button className="load-more" type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Show more papers <span>{filtered.length - visiblePapers.length} remaining</span></button>}
                </> : (
                  <div className="empty-state"><span aria-hidden="true">∅</span><h2>No papers match these filters.</h2><p>Try a broader term or reset the year, journal, and focus filters.</p><button type="button" onClick={() => { setQuery(""); setJournal("all"); setFocus("all"); setYear("all"); }}>Reset filters</button></div>
                )}
              </section>

              <aside id="method" className="method-card">
                <p className="kicker">Reading the signals</p>
                <h2>Why this paper?</h2>
                <p>Every score is produced by visible rules—not a black box. A Q1 history or digital-humanities journal establishes the baseline; title, abstract, topic, and method terms add evidence.</p>
                <ol>
                  <li><span>01</span><div><strong>Venue</strong><p>Pinned from an annual SCImago Q1 export.</p></div></li>
                  <li><span>02</span><div><strong>Metadata</strong><p>OpenAlex first; Crossref complements gaps.</p></div></li>
                  <li><span>03</span><div><strong>Signals</strong><p>Matched terms and score stay with every record.</p></div></li>
                </ol>
                <div className="method-note"><span aria-hidden="true">i</span><p>Abstracts and links reflect open metadata and may be incomplete. “Open article” uses DOI first, then the best available article page. Access is completed manually through the destination site or your library.</p></div>
                <p className="refreshed">Refreshed {formatGenerated(data.generatedAt)}</p>
              </aside>
            </div>
          </>
        )}
      </main>

      <footer className="site-footer">
        <div className="brand brand--footer"><span className="brand-mark" aria-hidden="true">C</span><span><strong>Chronicle</strong><small>Follow the scholarship, not the noise.</small></span></div>
        <p>Metadata only · No publisher full text is collected · DOI links resolve at doi.org</p>
      </footer>
    </div>
  );
}
