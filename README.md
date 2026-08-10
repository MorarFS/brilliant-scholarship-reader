# Chronicle — History Research Tracker

Chronicle is a standalone static research tracker for newly published work in history and digital humanities. It scans a pinned list of SJR Q1 journals, retrieves open scholarly metadata, assigns a transparent rule-based relevance score, and presents readable abstracts with reliable article links.

It is designed for GitHub Pages. The included GitHub Actions workflow refreshes metadata weekly, commits the generated JSON, verifies the project, and republishes the site.

## What the first version does

- uses OpenAlex as the primary paper metadata source;
- uses Crossref to complement missing records, authors, dates, DOI data, and abstracts;
- backfills and refreshes the current and previous calendar years by publication date, then merges and deduplicates records;
- scores history relevance from the pinned journal focus plus visible title, abstract, topic, period, archival, and digital-method signals;
- stores the score, reason, matched signals, and classifier version on every paper;
- displays a substantial abstract when metadata supplies one, and says plainly when it does not;
- opens the DOI resolver first, or falls back to the best article landing page when no DOI exists;
- keeps DOI, article page, journal, and legal open-access-copy links distinct;
- never scrapes publisher full text, signs into a library, or downloads papers.

The checked-in data contains the current two-calendar-year archive, so the site is useful immediately before its first automated refresh.

## Run locally

Prerequisites: Node.js 20 or newer and Python 3.11 or newer. The collector uses only Python’s standard library.

```bash
npm install
npm run dev
```

Open the local address shown by Vite. To run the rule tests and production build:

```bash
npm test
```

To refresh the paper data manually:

```bash
python scripts/fetch_papers.py
```

Useful optional settings:

- `OPENALEX_API_KEY`: a free OpenAlex key increases the API allowance. The collector currently works without one within OpenAlex’s anonymous allowance and falls back to Crossref if OpenAlex is unavailable.
- `CROSSREF_MAILTO`: identifies the client to Crossref’s polite pool. It is not a password.

Neither value is requested by the app, written to files, or committed. If supplied, keep it in your shell environment or in GitHub repository settings—not in the repository.

## Obtain and pin a maintained SJR Q1 journal list

The practical, lawful approach is an **annual, human-reviewed export from SCImago**, not automated scraping:

1. Open [SCImago Journal Rankings](https://www.scimagojr.com/journalrank.php).
2. Select the latest completed year, publication type **Journals**, and the relevant areas/categories—at minimum **Arts and Humanities → History**. For a broader digital-humanities watchlist, also review adjacent Arts and Humanities categories.
3. Use SCImago’s **Download data** control in the browser.
4. Keep the downloaded CSV as a dated provenance file, for example `config/sjr-history-2025.csv`.
5. Review the chosen scope, then replace `config/journals.csv`. The collector recognizes the official `Title`, `Issn`, and `SJR Best Quartile` columns and keeps only `Q1` rows. Add a `Year` column to make the edition visible in the interface. Optional `Focus` and `Journal URL` columns improve explanations and journal links.
6. Commit that dated list so future runs are reproducible. Repeat after SCImago’s annual update, rather than silently changing the journal universe mid-year.

Why this route: SCImago describes SJR as a publicly available, annually updated portal based on Scopus data; its FAQ says site information may be used with citation and notes that the ranking is a static annual snapshot. Its product page states that ranking data can be downloaded in Excel format. SCImago does not publish a stable public journal-ranking API, so scripting the web interface would be brittle and unnecessary. See [SCImago’s SJR product description](https://www.scimagolab.com/products/sjr-scimago-journal-country-rank/) and [SCImago’s FAQ](https://www.scimagolab.com/faqs-2/).

The included `config/journals.csv` is a deliberately small starter subset for demonstration. Treat it as a pinned seed, not a complete or perpetual claim about every current Q1 history journal. Replace it with your reviewed official export before relying on the tracker for comprehensive monitoring.

Suggested citation for the pinned list, following SCImago’s guidance:

> SCImago, (n.d.). SJR — SCImago Journal & Country Rank [Portal]. Retrieved [date], from https://www.scimagojr.com

## Collection and relevance logic

### Two-calendar-year collection

Each run starts on January 1 of the previous calendar year and queries through the current UTC date. On 10 August 2026, that means **1 January 2025 through 10 August 2026**. Records are merged by DOI (or stable source identifier when no DOI exists), sorted newest-first, and retained for those two calendar years. When the year changes, the window advances automatically; in 2027 it will cover 2026 and 2027. `public/data/state.json` records the successful run date and archive boundary.

OpenAlex is queried first with the journal ISSNs and the two-year publication-date window. Crossref is then queried by journal ISSN over the same window and fills gaps. Crossref’s own synchronization guidance prefers created/updated dates for a complete deposit mirror; this tracker intentionally uses publication dates because the product question is “what was published in the archive period?” and because those filters remain available without premium access. Re-querying the complete two-year window each week helps pick up delayed or corrected deposits, though manual review remains important.

The interface shows explicit counts for 2026 and 2025, offers a publication-year filter, and always groups the newer year before the older year—even when sorting by relevance score within each year. Results are rendered in batches for a responsive experience.

### Rules v1

The starting score comes from membership in a pinned Q1 history/digital-humanities journal. Additional weighted signals include:

- explicit history, historiography, archive, or historian language;
- historical periods such as early modern, colonial, nineteenth century, or Cold War;
- public history, oral history, memory, museum, heritage, manuscript, and primary-source methods;
- digital humanities, text mining, topic modeling, corpus, GIS, OCR/HTR, digital archive, database, and linked-data methods.

Likely non-research matter such as corrigenda, front matter, and book-review headings is penalized. The final score is capped at 100. Every output record contains `score`, a sentence-length `reason`, the exact `signals`, and `classifier: rules-v1`, so the logic can be unit tested and audited.

Tune the rules and weights in `scripts/fetch_papers.py`. Tune the inclusion threshold with `--min-score`.

## GitHub Pages setup

1. Create a GitHub repository and push this project to its `main` branch.
2. In **Settings → Pages**, choose **GitHub Actions** as the source.
3. In **Settings → Actions → General**, allow workflows **Read and write permissions**. The weekly job needs this to commit generated data. If `main` is protected, allow the GitHub Actions bot to write or change the workflow to open a pull request instead.
4. Run **Refresh papers and publish Pages** once from the Actions tab, or wait for the Monday schedule.

The workflow uses GitHub’s built-in `GITHUB_TOKEN`; no personal access token is needed in the normal setup. It does not store library credentials. An optional `OPENALEX_API_KEY` may be added as an Actions secret and `CROSSREF_MAILTO` as an Actions variable, but neither is required for the checked-in sample or basic fallback operation.

For a manual publication, authenticate to GitHub locally or through the GitHub interface, create or choose the destination repository, and authorize the workflow permissions described above.

## Link and library-access behavior

The primary **Open article** button follows this chain:

1. `https://doi.org/<doi>` when a DOI exists;
2. otherwise, the publisher/journal landing-page URL supplied by OpenAlex or Crossref;
3. otherwise, a clear “No article link in open metadata” message.

The DOI resolver is intentionally preferred because it is durable and should hand off cleanly to institutional link tools such as LibKey when configured in the browser or institution. Chronicle does not integrate with LibKey, attempt authenticated access, automate a download, or bypass access controls. A known legal open-access location is shown separately as **Open-access copy**.

## Metadata, licensing, and limitations

- [OpenAlex](https://developers.openalex.org/) is the primary open scholarly index. It supplies works, authors, sources, topics, locations, OA status, and abstracts as an inverted index. OpenAlex notes that abstract coverage is incomplete and is better for newer work.
- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) supplies publisher-deposited bibliographic metadata without sign-up. Crossref says almost all metadata may be reused, but some deposited abstracts may remain copyrighted by their publishers or authors.
- Chronicle stores and displays metadata/abstract material returned by those APIs; it does not fetch article HTML or PDFs. If you operate a public deployment, review abstract reuse against your institution’s policy and jurisdiction. You can shorten or suppress abstracts in the collector without affecting the DOI/link workflow.
- Dates, titles, author lists, journal assignments, OA status, and retraction flags can be incomplete or delayed. Links can change. A score is a triage aid, not a scholarly judgment or quality rating.
- SJR quartiles change annually and can differ by category. The pinned CSV documents the edition used; it must be reviewed rather than treated as timeless.
- SCImago data originates from Scopus. Attribute the pinned SJR list as described above and preserve the original dated export.

## Optional future LLM / Vertex AI classifier

The JSON schema already identifies the classifier on each result. A later second-stage classifier could review borderline rule scores, return a structured label/reason, and write `classifier: llm` while preserving the rules score for comparison.

For Vertex AI, a future implementation would need a Google Cloud project, enabled Vertex AI API, a service account with the minimum prediction role, a region/model choice, and GitHub workload identity federation or an encrypted repository secret. Do not place a service-account key in this repository. No Vertex AI credentials are needed or used in this version.

## Project map

- `src/` — static React interface and styling
- `config/journals.csv` — pinned Q1 journal seed
- `scripts/fetch_papers.py` — two-calendar-year OpenAlex/Crossref collector and rules classifier
- `public/data/` — generated data and collection state
- `tests/test_collector.py` — deterministic rules/data tests
- `.github/workflows/weekly-refresh-and-pages.yml` — weekly refresh, commit, build, and Pages deployment
