# Chronicle — Computational Humanities Research Tracker

Chronicle is a standalone, static tracker with two deliberately separated research feeds:

1. **Digital & Computational Humanities** (the default): computational methods applied to history, historical sources, archives, heritage, cultural memory, historical language, and historical data in leading specialist or closely adjacent venues.
2. **AI & LLMs in History** (secondary): AI, machine-learning, LLM, NLP, and other computational-method papers found in selected history journals, only when they are substantively tied to historical research or materials.

Generic history and generic AI papers are excluded. Chronicle uses open scholarly metadata, preserves the evidence behind every match, and links readers to the article. The collector never scrapes publisher full text or signs into a library. The browser Reading Room processes only a direct legal OA PDF that the source allows it to fetch, or a PDF the user attaches locally.

The site is designed for GitHub Pages. A GitHub Actions workflow refreshes the two-calendar-year archive weekly, commits the generated JSON, verifies the project, and republishes the static site.

## What it does

- iterates the configured journal ISSNs directly; there is no opaque broad web search;
- uses OpenAlex as the primary metadata source and Crossref as a complement/fallback;
- scans 1 January of the previous calendar year through the current UTC date;
- admits a paper only when metadata contains **both** a computational-method signal and a relevant historical/humanities signal;
- records its feed, score, sentence-length reason, method signals, humanities signals, and `classifier: rules-v2`;
- sorts each feed newest-first and exposes clear 2026/2025 counts and filters;
- displays readable abstracts when supplied by metadata;
- opens the DOI resolver first, or falls back to the specific article landing page when a DOI is absent;
- labels DOI, Article page, Journal, and legal Open-access copy links separately;
- publishes the complete monitored-journal list, ISSNs, feed membership, Q1 edition/note, result count, journal link, and last scan time on the site.
- lets readers save or unsave papers in a private browser-local reading list, with JSON export/import for backup and transfer.
- opens a local-first Reading Room with selectable extracted PDF text, original-PDF view, passage highlights, attached notes, paper-level notes, citation copy, and RIS export;
- allows a legally obtained PDF to be attached to an existing tracked paper and processed only in the browser, without upload or library automation.

## Run locally

Prerequisites: Node.js 20+ and Python 3.11+. The collector itself uses only Python’s standard library.

```bash
npm install
npm run dev
```

Run deterministic collector tests, TypeScript checks, and the production build:

```bash
npm test
npm run lint
```

Refresh public metadata manually:

```bash
python scripts/fetch_papers.py
```

Optional environment settings:

- `OPENALEX_API_KEY`: a free key can increase the OpenAlex allowance.
- `CROSSREF_MAILTO`: identifies the client to Crossref’s polite pool; it is not a password.

Neither value is requested by the browser app, written to files, or committed. No Vertex AI, library, or LibKey credentials are required.

## The pinned monitored-journal starter list

`config/journals.csv` is the collector’s complete venue universe. Each row has `Title`, `Issn`, `SJR Best Quartile`, `Year`, `Focus`, `Feed`, `Journal URL`, a plain-language `Qualification note`, and `Inclusion Basis`. The collector accepts reviewed Q1 rows and explicitly marked `user-curated specialist` rows; other non-Q1 rows are ignored.

### Primary: Digital & Computational Humanities

| Journal | ISSN(s) | Why it is monitored |
|---|---|---|
| [Digital Scholarship in the Humanities](https://academic.oup.com/dsh) | 2055-7671; 2055-768X | Specialist digital-humanities venue |
| [Journal of Cultural Analytics](https://culturalanalytics.org/) | 2371-4549 | User-requested specialist venue; confirmed by the [ISSN International Centre](https://portal.issn.org/resource/ISSN/2371-4549) |
| [Computational Humanities Research](https://www.cambridge.org/core/journals/computational-humanities-research) | 2977-8158 | User-requested specialist venue launched in 2025; confirmed by [Cambridge University Press](https://www.cambridge.org/core/journals/computational-humanities-research) and the [ISSN International Centre](https://portal.issn.org/resource/ISSN/2977-8158) |
| [Journal of Computer Applications in Archaeology](https://journal.caa-international.org/) | 2514-8362 | Computational archaeology |
| [Digital Applications in Archaeology and Cultural Heritage](https://www.sciencedirect.com/journal/digital-applications-in-archaeology-and-cultural-heritage) | 2212-0548 | Digital archaeology and heritage |
| [ACM Journal on Computing and Cultural Heritage](https://dl.acm.org/journal/jocch) | 1556-4673; 1556-4711 | Computing and cultural heritage |
| [Journal of Cultural Heritage](https://www.sciencedirect.com/journal/journal-of-cultural-heritage) | 1296-2074; 1778-3674 | Adjacent heritage venue, strictly content-filtered |
| [Heritage Science](https://heritagesciencejournal.springeropen.com/) | 2050-7445 | Adjacent heritage-science venue, strictly content-filtered |
| [Virtual Archaeology Review](https://polipapers.upv.es/index.php/var) | 1989-9947 | Virtual archaeology and digital heritage |

### Secondary: AI & LLMs in History

The American Historical Review, Past & Present, History Workshop Journal, The Historical Journal, History and Theory, Journal of Social History, The Journal of Modern History, and The Public Historian are monitored only for dual-evidence computational work. Membership in these journals never qualifies an ordinary history paper by itself. Their ISSNs, links, notes, and current result counts are visible on the live site and pinned in `config/journals.csv`.

### Maintaining Q1 status lawfully

The practical approach is an **annual, human-reviewed SCImago export**, not automated scraping:

1. Open [SCImago Journal Rankings](https://www.scimagojr.com/journalrank.php).
2. Select the latest completed year, publication type **Journals**, and the relevant categories. Review Arts and Humanities categories plus the categories in which specialist digital-heritage/computing venues are ranked.
3. Use SCImago’s browser **Download data** control and preserve the dated original, for example `config/sjr-reviewed-2025.csv`.
4. Verify journal title, ISSN, best quartile, and category against the journal’s own site and the SCImago journal page.
5. Review `config/journals.csv`, retaining the two feed labels and a transparent qualification note. Commit both the reviewed configuration and provenance date.
6. Repeat after the annual SJR update.

SCImago describes SJR as an annually updated portal based on Scopus data and provides ranking downloads. It does not offer a stable public journal-ranking API. See the [SJR product description](https://www.scimagolab.com/products/sjr-scimago-journal-country-rank/) and [SCImago FAQ](https://www.scimagolab.com/faqs-2/).

Important limitation: “Q1” is category- and year-specific, not a timeless or universal quality label. A journal can be Q1 in one category and lower in another. Most of the included list records the **2024 SJR best quartile**. Journal of Cultural Analytics and Computational Humanities Research are separately and visibly included as user-curated specialist venues at the user’s request; Q1 is neither claimed nor required for those two rows. The on-site monitored-journals section makes both inclusion paths auditable.

Suggested attribution:

> SCImago, (n.d.). SJR — SCImago Journal & Country Rank [Portal]. Retrieved [date], from https://www.scimagojr.com

## Collection window and source behavior

Each run queries from January 1 of the previous calendar year through the run date. On 10 August 2026 the window is **2025-01-01 through 2026-08-10**; in 2027 it advances to 2026–2027. Existing records inside the window are merged so temporarily missing API fields are retained. DOI is the preferred deduplication key, with stable source identifiers or normalized title/date fallbacks.

OpenAlex is queried by the configured ISSNs and date range. Crossref is then queried journal-by-journal over the same range, filling missing DOI, author, abstract, and landing-page fields. Re-querying the full window weekly helps recover delayed or corrected deposits while keeping the logic date-based and deterministic.

## Rules v2: strict dual evidence

The classifier searches title, available abstract, and OpenAlex/Crossref topics in two independent dimensions.

**Computational-method evidence** includes digital/computational humanities; AI, ML, neural networks, LLMs, and transformers; NLP, text mining, topic modeling, stylometry, named entities, corpus analysis, and distant reading; OCR/HTR; computer vision, photogrammetry, LiDAR, GIS, spatial/network analysis; and knowledge graphs, linked data, digital archives, or research databases.

**Historical/humanities evidence** includes historical research and sources; archives, manuscripts, palaeography, epigraphy, and primary sources; cultural heritage, museums, collections, memory, and material culture; archaeology and historical periods; and historical linguistics, philology, or diachronic language evidence.

A record must have at least one match in each dimension and must not look like an editorial, review, correction, or front-matter item. Venue membership adds a modest score but cannot pass the gate. Thus:

- “Trade and diplomacy in nineteenth-century Europe” is excluded without a computational method.
- “A faster LLM benchmark for code” is excluded without historical/humanities evidence.
- “Large language models for entity extraction from medieval manuscripts” qualifies.

The generated record preserves `methodSignals`, `humanitiesSignals`, `qualifies`, `reason`, and `score`. Tune rules and weights in `scripts/fetch_papers.py`; tune the numeric floor with `--min-score`. Any future LLM classifier should be optional, second-stage, and preserve these rule results for comparison.

## Article, DOI, OA, and library access

The primary **Open article** action follows this chain:

1. `https://doi.org/<doi>` when a DOI exists;
2. otherwise, the specific publisher/journal landing-page URL supplied by OpenAlex or Crossref;
3. otherwise, a clear “No article link in open metadata” message.

The DOI resolver should hand off normally to institutional browser tools such as LibKey. Chronicle does not integrate with LibKey, automate authenticated access, download articles, or bypass controls. A legal OA location is shown separately as **Open-access copy** when metadata provides one.

## Reading Room, annotations, and saved-paper portability

Every paper card has a Reading Room action. When OpenAlex supplies a direct legal OA PDF URL, **Read & annotate** asks the source for that PDF from the browser. If the source permits cross-origin access and returns a valid PDF, Chronicle extracts selectable text locally, preserves page boundaries, offers the original PDF in a second tab, and lets the user capture selected passages. A highlight may have an attached note; paper-level notes need no selection. Every annotation records the stable paper identity, readable citation, page when available, timestamp, and source indicator (`open-access PDF`, `user-uploaded PDF`, or `citation only`).

When a source blocks browser fetching through CORS, returns a landing page instead of a PDF, or supplies no PDF URL, Chronicle switches honestly to citation-and-notes mode. It links to the legal OA/source location and explains that the document must be read there. It does not proxy the source, bypass controls, scrape publisher pages, or attempt authenticated access.

### Uploading a legally obtained PDF

The Reading Room’s **Upload PDF** control is scoped to the currently selected tracked paper. A PDF obtained manually through a library, proxy, repository, or publisher can be attached to that paper’s stable citation. The file is parsed in the browser and is never sent to Chronicle, GitHub Pages, OpenAlex, Crossref, or another server.

Chronicle attempts to retain the file in that browser’s IndexedDB storage so it can reopen with the same paper. Browser quota, private-browsing rules, clearing site data, or a device/browser change can remove it; in those cases the user must reattach the file. **Forget local PDF** removes the retained local copy. Uploaded PDF bytes are deliberately excluded from JSON export.

### Privacy, persistence, and export

Every annotation automatically saves its paper. The **Saved papers** view keeps abstracts and DOI/article/journal/OA links, shows annotation counts, and supports the existing filters. Papers are stored in local storage; attached PDF files use IndexedDB. There is no Chronicle account, cloud sync, or server-side research profile.

**Export JSON** produces a versioned backup containing saved paper snapshots, citations, highlights, notes, page references, timestamps, and annotation source indicators. **Import JSON** merges those records on another browser or device. The JSON never contains PDF bytes; legally obtained PDFs must be reattached on the destination. Imported external URLs are restricted to HTTP/HTTPS.

The Reading Room can copy a readable author-date citation and download an RIS journal record for citation managers. Citation formatting is intentionally lightweight and should be checked against the user’s required style. Treat exported JSON as personal research data and store it accordingly.

## GitHub Pages and weekly refresh

1. Push the project to a GitHub repository’s `main` branch.
2. In **Settings → Pages**, choose **GitHub Actions**.
3. In **Settings → Actions → General**, allow workflows **Read and write permissions** so the refresh job can commit generated JSON. Adjust branch protection if needed.
4. Run **Refresh papers and publish Pages** once from Actions, or wait for its Monday schedule.

The workflow uses GitHub’s built-in `GITHUB_TOKEN`; no personal access token is stored in the repository. Optional OpenAlex/Crossref settings belong in GitHub repository secrets/variables, not source files.

## Metadata, licensing, and limitations

- [OpenAlex](https://developers.openalex.org/) supplies open work, author, source, topic, location, OA, and reconstructed abstract metadata. Abstract coverage is incomplete.
- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) supplies publisher-deposited bibliographic metadata. Most metadata is reusable, but deposited abstracts may carry publisher/author copyright.
- The collector stores metadata returned by these APIs; it does not fetch article HTML or PDFs. The optional browser Reading Room fetches only metadata-identified OA PDF URLs after a user opens it, with no credentials, and holds the resulting bytes locally.
- OA metadata can point to a landing page, a moved file, or a server that rejects CORS. In-app reading is therefore best-effort. The source-site link and citation/notes panel remain available when embedding fails.
- PDF text extraction can lose columns, footnotes, formulae, images, or reading order. The original-PDF tab is the authoritative visual copy; annotations are research aids rather than changes to the source file.
- Local browser storage is not a preservation service. Quota, private mode, site-data clearing, and device changes can remove notes or attached files unless the JSON research record is exported and PDFs are retained separately.
- Dates, author lists, journal assignments, abstracts, links, OA status, and topics can be incomplete or delayed. Rule matches are triage signals, not scholarly or quality judgments.
- Strict rules reduce noise but can miss relevant papers whose titles/abstracts do not name both dimensions. The visible journal list and preserved reasons make that tradeoff inspectable.

## Optional future Vertex AI classifier

A later opt-in stage could send only borderline metadata to a structured classifier and record `classifier: llm` while preserving rules-v2 evidence. Vertex AI would require a Google Cloud project, enabled API, region/model choice, least-privilege prediction role, and workload identity federation or an encrypted repository secret. Never commit a service-account key. This version needs and uses no Vertex AI credentials.

## Project map

- `config/journals.csv` — complete two-feed venue configuration with Q1 and user-curated inclusion bases
- `scripts/fetch_papers.py` — OpenAlex/Crossref collector and rules-v2 classifier
- `public/data/` — generated two-year data, journal manifest, and scan state
- `src/` — static tracker, PDF Reading Room, browser-local annotations/files, citation utilities, reading list, and monitored-journals audit section
- `src/readingRoom.test.ts` — deterministic citation, stable-identity, annotation-import, and merge tests
- `tests/test_collector.py` — deterministic rules, feed, date, link, and CSV tests
- `.github/workflows/weekly-refresh-and-pages.yml` — weekly refresh, verification, commit, and Pages deployment
