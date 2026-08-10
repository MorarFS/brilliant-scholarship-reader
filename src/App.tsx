import { useEffect, useMemo, useState } from "react";
import type { MonitoredJournal, Paper, TrackerData } from "./types";

const DATA_URL = `${import.meta.env.BASE_URL}data/papers.json`;
const PAGE_SIZE = 40;
type Feed = "digital-humanities" | "ai-history";

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

function ArrowIcon() { return <span aria-hidden="true">↗</span>; }

function LinkButton({ href, label, primary = false }: { href: string; label: string; primary?: boolean }) {
  return <a className={primary ? "link-button link-button--primary" : "link-button"} href={href} target="_blank" rel="noreferrer">{label} <ArrowIcon /></a>;
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
        <time dateTime={paper.publicationDate}>{formatDate(paper.publicationDate)}</time><span className="dot" aria-hidden="true" />
        <span>{paper.journal}</span><span className="feed-pill">{FEEDS[paper.feed].shortLabel}</span>
        <span className="quartile">{paper.quartile} · SJR {paper.sjrYear ?? "pinned"}</span>
      </div>
      <h2>{paper.title}</h2>
      <p className="authors">{paper.authors.length ? paper.authors.join(", ") : "Authors not listed in open metadata"}</p>

      <section className="abstract-block" aria-label="Abstract">
        <p className="eyebrow">Abstract</p>
        {abstractText ? <><p className="abstract-text">{abstractText}</p>{isLong && <button className="text-button" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : "Read full abstract"}</button>}</> :
          <p className="abstract-missing">No abstract was supplied by OpenAlex or Crossref. The article page may include one.</p>}
      </section>

      <div className="relevance-panel">
        <div className="score-orbit" style={{ "--score": `${paper.relevance.score * 3.6}deg` } as React.CSSProperties}><span>{paper.relevance.score}</span></div>
        <div>
          <p className="eyebrow">{scoreLabel(paper.relevance.score)} · rules v2</p>
          <p>{paper.relevance.reason}</p>
          <div className="signal-list" aria-label="Relevance signals">{paper.relevance.signals.slice(0, 5).map((signal) => <span key={signal}>{signal}</span>)}</div>
        </div>
      </div>

      <footer className="paper-actions">
        <div className="paper-actions__primary">{openArticleUrl ? <LinkButton href={openArticleUrl} label="Open article" primary /> : <span className="unavailable">No article link in open metadata</span>}</div>
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

function JournalCard({ journal }: { journal: MonitoredJournal }) {
  return (
    <article className="journal-card">
      <div><span className="feed-pill">{FEEDS[journal.feed].shortLabel}</span><span className="journal-card__status">{journal.quartile} · SJR {journal.sjrYear ?? "pinned"}</span></div>
      <h3>{journal.title}</h3>
      <p>{journal.focus}</p>
      <dl><div><dt>ISSN</dt><dd>{journal.issns.join(" · ") || "Not listed"}</dd></div><div><dt>Current matches</dt><dd>{journal.resultCount}</dd></div></dl>
      <p className="journal-card__note">{journal.qualificationNote}</p>
      {journal.journalUrl && <LinkButton href={journal.journalUrl} label="Journal" />}
    </article>
  );
}

export default function App() {
  const [data, setData] = useState<TrackerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState<Feed>("digital-humanities");
  const [query, setQuery] = useState("");
  const [journal, setJournal] = useState("all");
  const [focus, setFocus] = useState("all");
  const [year, setYear] = useState("all");
  const [sort, setSort] = useState("newest");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    fetch(DATA_URL).then((response) => { if (!response.ok) throw new Error(`Data request failed (${response.status})`); return response.json() as Promise<TrackerData>; }).then(setData).catch((reason: Error) => setError(reason.message));
  }, []);

  const selectFeed = (next: Feed) => { setFeed(next); setJournal("all"); setFocus("all"); setYear("all"); setVisibleCount(PAGE_SIZE); };
  const feedPapers = useMemo(() => data?.papers.filter((paper) => paper.feed === feed) ?? [], [data, feed]);
  const journals = useMemo(() => [...new Set(feedPapers.map((paper) => paper.journal))].sort(), [feedPapers]);
  const yearCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const paper of feedPapers) { const paperYear = paper.publicationDate.slice(0, 4); counts.set(paperYear, (counts.get(paperYear) ?? 0) + 1); }
    return [...counts.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [feedPapers]);

  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return feedPapers.filter((paper) => {
      const haystack = [paper.title, paper.authors.join(" "), paper.journal, paper.abstract ?? "", paper.topics.join(" "), paper.relevance.reason].join(" ").toLowerCase();
      const methodText = paper.relevance.methodSignals.join(" ").toLowerCase();
      return terms.every((term) => haystack.includes(term)) && (journal === "all" || paper.journal === journal) &&
        (year === "all" || paper.publicationDate.startsWith(year)) &&
        (focus === "all" || (focus === "ai" && /ai \/ ml \/ llm|nlp/.test(methodText)) || (focus === "text" && /nlp|text-as-data|ocr|htr|knowledge/.test(methodText)) || (focus === "spatial" && /spatial|visual/.test(methodText)) || (focus === "oa" && Boolean(paper.openAccessUrl)));
    }).sort((a, b) => {
      const yearOrder = b.publicationDate.slice(0, 4).localeCompare(a.publicationDate.slice(0, 4));
      if (yearOrder) return yearOrder;
      return sort === "score" ? b.relevance.score - a.relevance.score : b.publicationDate.localeCompare(a.publicationDate);
    });
  }, [feedPapers, query, journal, focus, year, sort]);

  const visiblePapers = filtered.slice(0, visibleCount);
  const abstractCoverage = data?.papers.length ? Math.round((data.papers.filter((paper) => paper.abstract).length / data.papers.length) * 100) : 0;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Chronicle home"><span className="brand-mark" aria-hidden="true">C</span><span><strong>Chronicle</strong><small>Computational humanities tracker</small></span></a>
        <nav className="header-nav" aria-label="Page navigation"><a href="#feeds">Research feeds</a><a href="#journals">Monitored journals</a><a href="#method">How it works</a></nav>
      </header>

      <main id="top">
        <section className="hero"><div><p className="kicker">Focused scholarship, clearly surfaced</p><h1>Methods meet<br />the archive.</h1><p className="hero-copy">A weekly, two-feed scan for computational humanities—and for AI or LLM work that genuinely engages historical evidence.</p></div><div className="hero-rule" aria-hidden="true"><span>Two focused feeds</span><span>Open metadata</span><span>Dual evidence</span></div></section>

        {error ? <div className="state-card" role="alert"><p className="eyebrow">Data could not be loaded</p><h2>The journal desk is temporarily unavailable.</h2><p>{error}. Serve the project locally or check that <code>public/data/papers.json</code> is present.</p></div> : !data ?
          <div className="state-card" aria-live="polite"><div className="loading-line" /><p>Opening the latest research desk…</p></div> : <>
            <section className="stat-strip" aria-label="Collection summary">
              <div><span>{data.feedCounts["digital-humanities"]}</span><p>primary-feed papers</p></div><div><span>{data.feedCounts["ai-history"]}</span><p>AI-in-history papers</p></div><div><span>{data.journalCount}</span><p>monitored Q1 venues</p></div><div><span>{abstractCoverage}%</span><p>with readable abstracts</p></div>
            </section>

            <section id="feeds" className="feed-switcher" aria-label="Choose research feed">
              {(Object.keys(FEEDS) as Feed[]).map((feedId) => <button key={feedId} className={feed === feedId ? "is-active" : ""} type="button" onClick={() => selectFeed(feedId)} aria-pressed={feed === feedId}><span>{FEEDS[feedId].shortLabel}</span><strong>{FEEDS[feedId].label}</strong><small>{data.feedCounts[feedId]} qualifying papers</small></button>)}
              <p>{FEEDS[feed].description}</p>
            </section>

            <section className="controls" aria-label="Filter papers">
              <label className="search-field"><span aria-hidden="true">⌕</span><span className="sr-only">Search title, author, abstract, or topic</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, author, abstract, or topic" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button>}</label>
              <label><span className="sr-only">Journal</span><select value={journal} onChange={(event) => setJournal(event.target.value)}><option value="all">All journals in feed</option>{journals.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
              <label><span className="sr-only">Method</span><select value={focus} onChange={(event) => setFocus(event.target.value)}><option value="all">All qualifying methods</option><option value="ai">AI / ML / LLM / NLP</option><option value="text">Text & document methods</option><option value="spatial">Spatial & visual methods</option><option value="oa">Open-access copy</option></select></label>
              <label><span className="sr-only">Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="score">Highest score within year</option></select></label>
            </section>

            <section className="year-filter" aria-label="Filter by publication year"><p>Publication year</p><div><button className={year === "all" ? "is-active" : ""} type="button" onClick={() => { setYear("all"); setVisibleCount(PAGE_SIZE); }} aria-pressed={year === "all"}>All years <span>{feedPapers.length}</span></button>{yearCounts.map(([paperYear, count]) => <button key={paperYear} className={year === paperYear ? "is-active" : ""} type="button" onClick={() => { setYear(paperYear); setVisibleCount(PAGE_SIZE); }} aria-pressed={year === paperYear}>{paperYear} <span>{count}</span></button>)}</div></section>

            <div className="content-grid"><section className="results" aria-label="Research results"><div className="results-heading"><div><p className="kicker">{FEEDS[feed].shortLabel} · {year === "all" ? "two-year archive" : year}</p><h2>{filtered.length} {filtered.length === 1 ? "paper" : "papers"}</h2></div><p>{formatDate(data.windowStart)} — {formatDate(data.windowEnd)}</p></div>
              {filtered.length ? <>{visiblePapers.map((paper) => <PaperCard key={paper.id} paper={paper} />)}{visiblePapers.length < filtered.length && <button className="load-more" type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Show more papers <span>{filtered.length - visiblePapers.length} remaining</span></button>}</> : <div className="empty-state"><span aria-hidden="true">∅</span><h2>No papers match these filters.</h2><p>Try another term or reset the year, journal, and method filters.</p><button type="button" onClick={() => { setQuery(""); setJournal("all"); setFocus("all"); setYear("all"); }}>Reset filters</button></div>}
            </section>
              <aside id="method" className="method-card"><p className="kicker">Reading the signals</p><h2>Why this paper?</h2><p>Membership in a monitored journal is only the starting point. Every visible record must match both a computational-method signal and a history, archives, heritage, cultural-memory, historical-language, or historical-data signal.</p><ol><li><span>01</span><div><strong>Configured venue</strong><p>The collector iterates the pinned ISSN list directly.</p></div></li><li><span>02</span><div><strong>Open metadata</strong><p>OpenAlex first; Crossref complements gaps.</p></div></li><li><span>03</span><div><strong>Dual evidence</strong><p>Method and humanities matches are saved with the score.</p></div></li></ol><div className="method-note"><span aria-hidden="true">i</span><p>Generic history and generic AI are excluded. “Open article” uses DOI first, then the best available article page. Access remains manual through the destination or your library.</p></div><p className="refreshed">Last scan {formatGenerated(data.generatedAt)}</p></aside>
            </div>

            <section id="journals" className="journals-section"><div className="section-heading"><div><p className="kicker">Transparent coverage</p><h2>Monitored journals</h2></div><p>Direct ISSN scan · last updated {formatGenerated(data.generatedAt)}</p></div>
              <p className="journals-intro">This pinned starter list is the complete venue universe used by the collector. Q1 status is tied to the displayed SJR edition and must be reviewed annually; category quartiles can differ.</p>
              {(Object.keys(FEEDS) as Feed[]).map((feedId) => <section className="journal-group" key={feedId}><div><p className="eyebrow">{FEEDS[feedId].shortLabel}</p><h3>{FEEDS[feedId].label}</h3><p>{FEEDS[feedId].description}</p></div><div className="journal-grid">{data.journals.filter((item) => item.feed === feedId).map((item) => <JournalCard key={item.title} journal={item} />)}</div></section>)}
            </section>
          </>}
      </main>

      <footer className="site-footer"><div className="brand brand--footer"><span className="brand-mark" aria-hidden="true">C</span><span><strong>Chronicle</strong><small>Follow the methods, keep the historical thread.</small></span></div><p>Open scholarly metadata only · No publisher full text collected · DOI links resolve at doi.org</p></footer>
    </div>
  );
}
