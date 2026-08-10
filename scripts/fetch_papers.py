#!/usr/bin/env python3
"""Fetch and classify new papers from pinned SJR Q1 journals.

Uses public metadata only. OpenAlex is primary; Crossref complements missing
records and metadata. No publisher pages, authenticated resources, or full text
are fetched.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

OPENALEX_API = "https://api.openalex.org/works"
CROSSREF_API = "https://api.crossref.org"
USER_AGENT = "ChronicleHistoryTracker/1.0 (+https://github.com/; open scholarly metadata collector)"
ARCHIVE_CALENDAR_YEARS = 2


@dataclass(frozen=True)
class Journal:
    title: str
    issns: tuple[str, ...]
    quartile: str
    year: int | None
    focus: str
    feed: str
    journal_url: str | None
    qualification_note: str

    @property
    def primary_issn(self) -> str:
        return self.issns[0]


FEED_LABELS = {
    "digital-humanities": "Digital & Computational Humanities",
    "ai-history": "AI & LLMs in History",
}

METHOD_RULES: tuple[tuple[str, int, str], ...] = (
    (r"\b(?:digital|computational) humanit(?:y|ies)\b", 38, "digital or computational humanities"),
    (r"\b(?:artificial intelligence|machine learning|deep learning|neural networks?|large language models?|\bllms?\b|generative ai|transformers?)\b", 30, "AI / ML / LLM method"),
    (r"\b(?:natural language processing|\bnlp\b|text mining|topic model(?:ling|ing)?|stylometr|named entity recognition|information extraction|word embeddings?|corpus analysis|distant reading)\b", 25, "NLP or text-as-data method"),
    (r"\b(?:optical character recognition|handwritten text recognition|\bocr\b|\bhtr\b|document image analysis)\b", 24, "OCR / HTR method"),
    (r"\b(?:computer vision|image processing|photogrammetr|lidar|remote sensing|3d reconstruction|virtual reality|augmented reality|digital twin)\b", 22, "visual or spatial computing method"),
    (r"\b(?:geographic information systems?|\bgis\b|spatial analysis|network analysis|digital mapping)\b", 20, "spatial or network method"),
    (r"\b(?:knowledge graphs?|linked open data|semantic web|ontology|digital archives?|digital collections?|digitization|digitisation|research database)\b", 18, "digital knowledge infrastructure"),
)

HUMANITIES_RULES: tuple[tuple[str, int, str], ...] = (
    (r"\b(?:historical (?:sources?|documents?|records?|texts?|newspapers?|maps?|data|datasets?|corpora?|corpus|language|linguistics)|primary sources?|history|historiograph|historian)\b", 26, "historical research or sources"),
    (r"\b(?:archives?|archival|manuscripts?|palaeograph|paleograph|codicolog|epigraph|papyr|inscriptions?)\b", 25, "archives or documentary evidence"),
    (r"\b(?:cultural heritage|digital heritage|heritage science|heritage sites?|historic buildings?|museums?|collections?|cultural memory|memory studies|material culture)\b", 25, "heritage, memory, or collections"),
    (r"\b(?:archaeolog|ancient|antiquity|medieval|early modern|colonial|postcolonial|imperial|eighteenth-century|nineteenth-century|twentieth-century)\b", 22, "historical period or archaeology"),
    (r"\b(?:historical linguistics|philolog|diachronic language|language change|ancient languages?|historical corpora?)\b", 24, "historical language evidence"),
)

NEGATIVE_RULES: tuple[tuple[str, int, str], ...] = (
    (r"^(?:review\s*:|inside the history lab\b|(?:book review|review of|books received|corrigendum|erratum|correction(?: to)?|editor(?:’|')?s corner|from the editor(?:’|')?s desk|editorial|introduction|front matter|back matter|volume index|index to volume|notes on contributors)\b)", -100, "non-research item signal"),
)


def normalise_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def parse_issns(value: str) -> tuple[str, ...]:
    found = re.findall(r"\b\d{4}-[\dXx]{4}\b", value or "")
    return tuple(dict.fromkeys(item.upper() for item in found))


def read_journals(path: Path) -> list[Journal]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        delimiter = ";" if ";" in (handle.readline() or "") else ","
        handle.seek(0)
        reader = csv.DictReader(handle, delimiter=delimiter)
        journals: list[Journal] = []
        for raw in reader:
            row = {normalise_header(key): (value or "").strip() for key, value in raw.items() if key}
            quartile = row.get("sjrbestquartile") or row.get("bestquartile") or row.get("quartile") or ""
            if quartile.upper() != "Q1":
                continue
            title = row.get("title") or row.get("journal") or row.get("sourcetitle") or ""
            issns = parse_issns(row.get("issn") or row.get("issns") or "")
            if not title or not issns:
                continue
            raw_year = row.get("year") or row.get("sjryear") or ""
            journals.append(
                Journal(
                    title=title,
                    issns=issns,
                    quartile="Q1",
                    year=int(raw_year) if raw_year.isdigit() else None,
                    focus=row.get("focus") or "computational humanities",
                    feed=row.get("feed") if row.get("feed") in FEED_LABELS else "digital-humanities",
                    journal_url=row.get("journalurl") or row.get("sourceurl") or None,
                    qualification_note=row.get("qualificationnote") or row.get("provenancenote") or "Pinned Q1 starter venue; review annually",
                )
            )
    if not journals:
        raise ValueError(f"No Q1 journals with usable ISSNs found in {path}")
    return journals


def reconstruct_abstract(index: dict[str, list[int]] | None) -> str | None:
    if not index:
        return None
    positions = [(position, word) for word, values in index.items() for position in values]
    if not positions:
        return None
    positions.sort()
    return " ".join(word for _, word in positions).strip() or None


def clean_abstract(value: str | None) -> str | None:
    if not value:
        return None
    text = re.sub(r"<[^>]+>", " ", html.unescape(value))
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def normalise_doi(value: str | None) -> str | None:
    if not value:
        return None
    doi = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", value.strip(), flags=re.I)
    return urllib.parse.unquote(doi).lower() or None


def work_key(paper: dict[str, Any]) -> str:
    if paper.get("doi"):
        return f"doi:{paper['doi'].lower()}"
    if paper.get("id"):
        return paper["id"]
    title = re.sub(r"\W+", "", paper.get("title", "").lower())
    return f"title:{title}:{paper.get('publicationDate', '')}"


def journal_for_issns(journals: list[Journal], issns: Iterable[str]) -> Journal | None:
    wanted = {item.upper() for item in issns if item}
    for journal in journals:
        if wanted.intersection(journal.issns):
            return journal
    return None


def classify(paper: dict[str, Any], journal: Journal) -> dict[str, Any]:
    base = 15 if journal.feed == "digital-humanities" else 10
    venue_signal = f"{FEED_LABELS[journal.feed]} venue"
    title = paper.get("title") or ""
    abstract = paper.get("abstract") or ""
    topics = " ".join(paper.get("topics") or [])
    text = f"{title} {abstract} {topics}".lower()
    evidence_text = text if journal.feed == "digital-humanities" else f"{title} {abstract[:1200]}".lower()
    title_lower = title.lower()

    method_matches: list[tuple[int, str]] = []
    humanities_matches: list[tuple[int, str]] = []
    for pattern, weight, label in METHOD_RULES:
        if re.search(pattern, evidence_text, flags=re.I):
            method_matches.append((weight, label))
    for pattern, weight, label in HUMANITIES_RULES:
        if re.search(pattern, evidence_text, flags=re.I):
            humanities_matches.append((weight, label))

    negative_signals: list[str] = []
    for pattern, _weight, label in NEGATIVE_RULES:
        if re.search(pattern, title_lower, flags=re.I):
            negative_signals.append(label)
    looks_like_book_review = bool(
        re.search(r"\beds?\.\s", title, flags=re.I)
        or re.search(r"\b(?:and|&)\s+(?:(?:[A-Z]\.)\s*){0,3}[A-Z][A-Za-zÀ-ÿ'’.-]+\.\s+", title)
        or (
            re.match(r"^(?:[A-Z][\w'’.-]+\s+){1,5}[A-Z][\w'’.-]+\.\s+", title)
            and re.search(r"\b(?:book|monograph|volume)\b", abstract[:700], flags=re.I)
        )
    )
    if looks_like_book_review and "non-research item signal" not in negative_signals:
        negative_signals.append("non-research item signal")

    method_signals = [label for _, label in method_matches]
    humanities_signals = [label for _, label in humanities_matches]
    qualifies = bool(method_signals and humanities_signals and not negative_signals)
    score = base + min(40, sum(weight for weight, _ in method_matches)) + min(40, sum(weight for weight, _ in humanities_matches))
    if negative_signals:
        score = 0
    score = max(0, min(100, score))
    signals = [venue_signal, *method_signals, *humanities_signals, *negative_signals]
    if qualifies:
        reason = (
            f"Matched computational evidence ({', '.join(method_signals[:2])}) and humanities evidence "
            f"({', '.join(humanities_signals[:2])}) in the {FEED_LABELS[journal.feed]} feed."
        )
    elif negative_signals:
        reason = "Excluded as likely editorial, review, correction, or other non-research matter."
    else:
        missing = "computational-method" if not method_signals else "history / heritage"
        reason = f"Excluded because no {missing} evidence was found in the available title, abstract, or topics."
    return {
        "score": score,
        "reason": reason,
        "signals": signals,
        "methodSignals": method_signals,
        "humanitiesSignals": humanities_signals,
        "qualifies": qualifies,
        "classifier": "rules-v2",
    }


def request_json(url: str, attempts: int = 3) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.load(response)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError):
            if attempt == attempts - 1:
                raise
            time.sleep(2**attempt)
    raise RuntimeError("unreachable")


def chunks(values: list[str], size: int) -> Iterable[list[str]]:
    for index in range(0, len(values), size):
        yield values[index:index + size]


def openalex_record(work: dict[str, Any], journals: list[Journal]) -> dict[str, Any] | None:
    primary = work.get("primary_location") or {}
    source = primary.get("source") or {}
    source_issns = source.get("issn") or ([source.get("issn_l")] if source.get("issn_l") else [])
    journal = journal_for_issns(journals, source_issns)
    if not journal or work.get("is_retracted") or work.get("is_paratext"):
        return None
    doi = normalise_doi(work.get("doi"))
    best_oa = work.get("best_oa_location") or {}
    oa_url = best_oa.get("landing_page_url") or best_oa.get("pdf_url")
    authors = [
        authorship.get("author", {}).get("display_name")
        for authorship in work.get("authorships") or []
        if authorship.get("author", {}).get("display_name")
    ]
    topics = [topic.get("display_name") for topic in (work.get("topics") or [])[:6] if topic.get("display_name")]
    paper = {
        "id": work.get("id") or (f"doi:{doi}" if doi else ""),
        "title": clean_abstract(work.get("display_name") or work.get("title")) or "Untitled work",
        "authors": authors,
        "publicationDate": work.get("publication_date") or f"{work.get('publication_year')}-01-01",
        "journal": journal.title,
        "issn": source.get("issn_l") or journal.primary_issn,
        "quartile": journal.quartile,
        "sjrYear": journal.year,
        "feed": journal.feed,
        "doi": doi,
        "doiUrl": f"https://doi.org/{doi}" if doi else None,
        "articleUrl": primary.get("landing_page_url"),
        "journalUrl": journal.journal_url or source.get("id"),
        "openAccessUrl": oa_url,
        "openAccessStatus": (work.get("open_access") or {}).get("oa_status"),
        "abstract": reconstruct_abstract(work.get("abstract_inverted_index")),
        "topics": topics,
        "metadataSources": ["OpenAlex"],
    }
    paper["relevance"] = classify(paper, journal)
    return paper


def fetch_openalex(journals: list[Journal], start: dt.date, end: dt.date, api_key: str | None) -> list[dict[str, Any]]:
    papers: list[dict[str, Any]] = []
    issns = list(dict.fromkeys(issn for journal in journals for issn in journal.issns))
    select = ",".join((
        "id", "doi", "display_name", "publication_date", "publication_year", "authorships",
        "primary_location", "best_oa_location", "abstract_inverted_index", "open_access",
        "topics", "is_retracted", "is_paratext",
    ))
    for batch in chunks(issns, 90):
        cursor: str | None = "*"
        pages = 0
        while cursor and pages < 100:
            filters = f"primary_location.source.issn:{'|'.join(batch)},from_publication_date:{start},to_publication_date:{end},type:article"
            params = {"filter": filters, "per_page": "100", "cursor": cursor, "select": select}
            if api_key:
                params["api_key"] = api_key
            payload = request_json(f"{OPENALEX_API}?{urllib.parse.urlencode(params)}")
            for work in payload.get("results") or []:
                record = openalex_record(work, journals)
                if record:
                    papers.append(record)
            cursor = (payload.get("meta") or {}).get("next_cursor")
            pages += 1
            if not (payload.get("results") or []):
                break
    return papers


def crossref_date(item: dict[str, Any]) -> str | None:
    for field in ("published-online", "published-print", "published", "issued"):
        parts = ((item.get(field) or {}).get("date-parts") or [[]])[0]
        if parts:
            year, month, day = (list(parts) + [1, 1])[:3]
            try:
                return dt.date(int(year), int(month), int(day)).isoformat()
            except ValueError:
                continue
    return None


def crossref_record(item: dict[str, Any], journal: Journal) -> dict[str, Any] | None:
    date = crossref_date(item)
    if not date:
        return None
    doi = normalise_doi(item.get("DOI"))
    authors = []
    for author in item.get("author") or []:
        name = " ".join(part for part in (author.get("given"), author.get("family")) if part)
        if name:
            authors.append(name)
    title = next(iter(item.get("title") or []), "Untitled work")
    article_url = item.get("URL") or ((item.get("resource") or {}).get("primary") or {}).get("URL")
    paper = {
        "id": f"doi:{doi}" if doi else f"crossref:{journal.primary_issn}:{re.sub(r'\W+', '', title.lower())}",
        "title": clean_abstract(title) or "Untitled work",
        "authors": authors,
        "publicationDate": date,
        "journal": journal.title,
        "issn": next(iter(item.get("ISSN") or []), journal.primary_issn),
        "quartile": journal.quartile,
        "sjrYear": journal.year,
        "feed": journal.feed,
        "doi": doi,
        "doiUrl": f"https://doi.org/{doi}" if doi else None,
        "articleUrl": article_url,
        "journalUrl": journal.journal_url,
        "openAccessUrl": None,
        "openAccessStatus": None,
        "abstract": clean_abstract(item.get("abstract")),
        "topics": list(item.get("subject") or [])[:6],
        "metadataSources": ["Crossref"],
    }
    paper["relevance"] = classify(paper, journal)
    return paper


def fetch_crossref(journals: list[Journal], start: dt.date, end: dt.date, mailto: str | None) -> tuple[list[dict[str, Any]], int]:
    papers: list[dict[str, Any]] = []
    successes = 0
    for journal in journals:
        last_error: Exception | None = None
        for issn in journal.issns:
            cursor: str | None = "*"
            pages = 0
            journal_records: list[dict[str, Any]] = []
            try:
                while cursor and pages < 10:
                    params = {
                        "filter": f"from-pub-date:{start},until-pub-date:{end},type:journal-article",
                        "rows": "200",
                        "cursor": cursor,
                        "select": "DOI,title,author,published,published-online,published-print,issued,container-title,ISSN,URL,resource,abstract,subject",
                    }
                    if mailto:
                        params["mailto"] = mailto
                    payload = request_json(f"{CROSSREF_API}/journals/{issn}/works?{urllib.parse.urlencode(params)}")
                    message = payload.get("message") or {}
                    items = message.get("items") or []
                    for item in items:
                        record = crossref_record(item, journal)
                        if record:
                            journal_records.append(record)
                    cursor = message.get("next-cursor")
                    pages += 1
                    if len(items) < 200:
                        break
                papers.extend(journal_records)
                successes += 1
                break
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = exc
        else:
            print(f"Crossref warning for {journal.title}: {last_error}", file=sys.stderr)
    return papers, successes


def merge_record(preferred: dict[str, Any], complement: dict[str, Any]) -> dict[str, Any]:
    merged = dict(preferred)
    for field in ("abstract", "doi", "doiUrl", "articleUrl", "journalUrl", "openAccessUrl", "openAccessStatus"):
        if not merged.get(field) and complement.get(field):
            merged[field] = complement[field]
    if not merged.get("authors") and complement.get("authors"):
        merged["authors"] = complement["authors"]
    merged["topics"] = list(dict.fromkeys((merged.get("topics") or []) + (complement.get("topics") or [])))[:8]
    merged["metadataSources"] = list(dict.fromkeys((merged.get("metadataSources") or []) + (complement.get("metadataSources") or [])))
    return merged


def load_existing(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        return (json.loads(path.read_text(encoding="utf-8")).get("papers") or [])
    except (OSError, json.JSONDecodeError):
        return []


def archive_start_date(run_date: dt.date) -> dt.date:
    """Return January 1 of the older year in the two-calendar-year archive."""
    return dt.date(run_date.year - ARCHIVE_CALENDAR_YEARS + 1, 1, 1)


def sort_papers_newest_first(papers: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep newer calendar years and dates ahead of older archive records."""
    return sorted(
        papers,
        key=lambda item: (item.get("publicationDate", ""), item.get("relevance", {}).get("score", 0)),
        reverse=True,
    )


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--journals", type=Path, default=Path("config/journals.csv"))
    parser.add_argument("--output", type=Path, default=Path("public/data/papers.json"))
    parser.add_argument("--state", type=Path, default=Path("public/data/state.json"))
    parser.add_argument("--since", type=dt.date.fromisoformat)
    parser.add_argument("--until", type=dt.date.fromisoformat)
    parser.add_argument("--max-papers", type=int, default=0, help="Optional output cap; 0 retains every matching paper")
    parser.add_argument("--min-score", type=int, default=50)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    today = args.until or dt.datetime.now(dt.timezone.utc).date()
    archive_start = archive_start_date(today)
    start = args.since or archive_start
    journals = read_journals(args.journals)
    print(f"Collecting {start} through {today} from {len(journals)} pinned Q1 journals")

    openalex_ok = False
    try:
        openalex = fetch_openalex(journals, start, today, os.getenv("OPENALEX_API_KEY"))
        openalex_ok = True
        print(f"OpenAlex returned {len(openalex)} records")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        openalex = []
        print(f"OpenAlex warning: {exc}; continuing with Crossref", file=sys.stderr)

    crossref, crossref_successes = fetch_crossref(journals, start, today, os.getenv("CROSSREF_MAILTO"))
    print(f"Crossref returned {len(crossref)} records")
    if not openalex_ok and not crossref_successes:
        raise RuntimeError("Neither metadata source completed successfully; existing data was left unchanged")

    by_key: dict[str, dict[str, Any]] = {}
    for paper in openalex:
        by_key[work_key(paper)] = paper
    for paper in crossref:
        key = work_key(paper)
        by_key[key] = merge_record(by_key[key], paper) if key in by_key else paper

    for paper in load_existing(args.output):
        try:
            if dt.date.fromisoformat(paper.get("publicationDate", "")) < archive_start:
                continue
        except ValueError:
            continue
        key = work_key(paper)
        by_key[key] = merge_record(by_key[key], paper) if key in by_key else paper

    qualified: list[dict[str, Any]] = []
    for paper in by_key.values():
        journal = journal_for_issns(journals, [paper.get("issn") or ""])
        if not journal:
            continue
        paper["journal"] = journal.title
        paper["quartile"] = journal.quartile
        paper["sjrYear"] = journal.year
        paper["feed"] = journal.feed
        paper["relevance"] = classify(paper, journal)
        if paper["relevance"]["qualifies"] and paper["relevance"]["score"] >= args.min_score:
            qualified.append(paper)

    papers = sort_papers_newest_first(qualified)
    if args.max_papers > 0:
        papers = papers[:args.max_papers]
    source_counts = {
        source: sum(source in (paper.get("metadataSources") or []) for paper in papers)
        for source in ("OpenAlex", "Crossref")
    }
    payload = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "windowStart": archive_start.isoformat(),
        "windowEnd": today.isoformat(),
        "journalCount": len(journals),
        "sjrYear": max((journal.year or 0 for journal in journals), default=0) or None,
        "sourceCounts": source_counts,
        "feedCounts": {
            feed: sum(paper.get("feed") == feed for paper in papers)
            for feed in FEED_LABELS
        },
        "journals": [
            {
                "title": journal.title,
                "issns": list(journal.issns),
                "quartile": journal.quartile,
                "sjrYear": journal.year,
                "focus": journal.focus,
                "feed": journal.feed,
                "feedLabel": FEED_LABELS[journal.feed],
                "journalUrl": journal.journal_url,
                "qualificationNote": journal.qualification_note,
                "resultCount": sum(paper.get("journal") == journal.title for paper in papers),
            }
            for journal in journals
        ],
        "papers": papers,
    }
    atomic_write_json(args.output, payload)
    atomic_write_json(
        args.state,
        {
            "lastSuccessDate": today.isoformat(),
            "archiveStartDate": archive_start.isoformat(),
            "archiveCalendarYears": ARCHIVE_CALENDAR_YEARS,
            "lastWindowStart": start.isoformat(),
        },
    )
    print(f"Wrote {len(papers)} classified papers to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
