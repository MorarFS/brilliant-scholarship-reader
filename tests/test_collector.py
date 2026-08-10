import csv
import datetime as dt
import tempfile
import unittest
from pathlib import Path

from scripts.fetch_papers import (
    Journal,
    archive_start_date,
    classify,
    merge_record,
    openalex_record,
    read_journals,
    reconstruct_abstract,
    sort_papers_newest_first,
)


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.journal = Journal(
            title="Example Digital Humanities Journal",
            issns=("1234-567X",),
            quartile="Q1",
            year=2024,
            focus="digital humanities",
            feed="digital-humanities",
            journal_url="https://example.org/journal",
            qualification_note="Pinned test venue",
            inclusion_basis="sjr-q1",
        )

    def test_reconstructs_openalex_abstract_in_order(self):
        index = {"Archives": [0], "shape": [1], "history": [2, 5], "and": [3], "memory": [4]}
        self.assertEqual(reconstruct_abstract(index), "Archives shape history and memory history")

    def test_archive_starts_at_previous_calendar_year(self):
        self.assertEqual(archive_start_date(dt.date(2026, 8, 10)), dt.date(2025, 1, 1))

    def test_archive_sort_keeps_2026_before_2025(self):
        papers = [
            {"publicationDate": "2025-12-31", "relevance": {"score": 99}},
            {"publicationDate": "2026-01-01", "relevance": {"score": 35}},
            {"publicationDate": "2026-08-10", "relevance": {"score": 40}},
        ]
        sorted_dates = [paper["publicationDate"] for paper in sort_papers_newest_first(papers)]
        self.assertEqual(sorted_dates, ["2026-08-10", "2026-01-01", "2025-12-31"])

    def test_classifier_preserves_explainable_signals(self):
        paper = {
            "title": "Computational history through a digital archive",
            "abstract": "We use text mining on nineteenth-century newspapers.",
            "topics": ["Digital humanities"],
        }
        result = classify(paper, self.journal)
        self.assertGreaterEqual(result["score"], 75)
        self.assertTrue(result["qualifies"])
        self.assertEqual(result["classifier"], "rules-v2")
        self.assertIn("NLP or text-as-data method", result["methodSignals"])
        self.assertIn("historical research or sources", result["humanitiesSignals"])
        self.assertIn("Digital & Computational Humanities venue", result["signals"])

    def test_generic_history_does_not_qualify_without_computational_method(self):
        result = classify(
            {"title": "Trade and diplomacy in nineteenth-century Europe", "abstract": "A study of archival sources.", "topics": ["History"]},
            self.journal,
        )
        self.assertFalse(result["qualifies"])
        self.assertEqual(result["methodSignals"], [])

    def test_generic_ai_does_not_qualify_without_humanities_connection(self):
        result = classify(
            {"title": "A large language model benchmark", "abstract": "We improve transformer efficiency on code tasks.", "topics": ["Artificial intelligence"]},
            self.journal,
        )
        self.assertFalse(result["qualifies"])
        self.assertEqual(result["humanitiesSignals"], [])

    def test_generic_digital_humanities_does_not_replace_historical_evidence(self):
        result = classify(
            {"title": "Inclusive digital humanities infrastructures", "abstract": "A digital humanities platform for current classroom collaboration.", "topics": ["Digital humanities"]},
            self.journal,
        )
        self.assertFalse(result["qualifies"])
        self.assertEqual(result["humanitiesSignals"], [])

    def test_llm_applied_to_manuscripts_qualifies_for_secondary_feed(self):
        secondary = Journal(
            title="Example History Journal",
            issns=("9999-9999",),
            quartile="Q1",
            year=2024,
            focus="history monitored for AI",
            feed="ai-history",
            journal_url="https://example.org/history",
            qualification_note="Pinned Q1 history venue",
            inclusion_basis="sjr-q1",
        )
        result = classify(
            {"title": "Large language models for medieval manuscripts", "abstract": "NLP extracts people from archival documents.", "topics": []},
            secondary,
        )
        self.assertTrue(result["qualifies"])
        self.assertIn("AI & LLMs in History feed", result["reason"])

    def test_non_research_headings_fall_below_inclusion_threshold(self):
        result = classify(
            {"title": "From the Editor’s Desk", "abstract": "A history editorial.", "topics": ["History"]},
            self.journal,
        )
        self.assertEqual(result["score"], 0)
        self.assertFalse(result["qualifies"])
        self.assertIn("non-research item signal", result["signals"])

        placeholder = classify(
            {"title": "Title Pending", "abstract": "Digital humanities analysis of historical archives.", "topics": []},
            self.journal,
        )
        self.assertFalse(placeholder["qualifies"])

    def test_bibliographic_book_review_title_is_excluded(self):
        result = classify(
            {"title": "Ada Historian. Algorithms and the Medieval Archive", "abstract": "This book considers digital humanities methods for manuscripts.", "topics": []},
            self.journal,
        )
        self.assertFalse(result["qualifies"])
        self.assertIn("non-research item signal", result["signals"])

        initials_result = classify(
            {"title": "Eric C. Nystrom and R. A. R. Edwards. Ordinary Lives", "abstract": "Digital humanities approaches to census history.", "topics": []},
            self.journal,
        )
        self.assertFalse(initials_result["qualifies"])

    def test_crossref_complements_missing_openalex_fields(self):
        primary = {"abstract": None, "authors": [], "topics": [], "metadataSources": ["OpenAlex"]}
        complement = {
            "abstract": "A deposited abstract.",
            "authors": ["Ada Historian"],
            "topics": ["History"],
            "metadataSources": ["Crossref"],
        }
        result = merge_record(primary, complement)
        self.assertEqual(result["abstract"], "A deposited abstract.")
        self.assertEqual(result["authors"], ["Ada Historian"])
        self.assertEqual(result["metadataSources"], ["OpenAlex", "Crossref"])

    def test_no_doi_record_keeps_article_landing_page(self):
        work = {
            "id": "https://openalex.org/W123",
            "display_name": "An archival article without a DOI",
            "publication_date": "2026-08-01",
            "primary_location": {
                "landing_page_url": "https://example.org/articles/123",
                "source": {"display_name": self.journal.title, "issn": ["1234-567X"], "issn_l": "1234-567X"},
            },
            "authorships": [],
            "topics": [],
        }
        paper = openalex_record(work, [self.journal])
        self.assertIsNotNone(paper)
        self.assertIsNone(paper["doiUrl"])
        self.assertEqual(paper["articleUrl"], "https://example.org/articles/123")

    def test_csv_loader_keeps_q1_and_requires_issn(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "journals.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(["Title", "Issn", "SJR Best Quartile", "Year", "Feed", "Qualification note", "Inclusion Basis"])
                writer.writerow(["Keep Me", "1234-567X", "Q1", "2024", "ai-history", "Pinned test list", "sjr-q1"])
                writer.writerow(["User Pick", "4444-5555", "", "", "digital-humanities", "Requested specialist", "user-curated specialist"])
                writer.writerow(["Not Q1", "2222-3333", "Q2", "2024"])
                writer.writerow(["No ISSN", "", "Q1", "2024"])
            journals = read_journals(path)
        self.assertEqual([journal.title for journal in journals], ["Keep Me", "User Pick"])
        self.assertEqual(journals[0].feed, "ai-history")
        self.assertEqual(journals[0].qualification_note, "Pinned test list")
        self.assertEqual(journals[1].quartile, "User-curated specialist")
        self.assertEqual(journals[1].inclusion_basis, "user-curated specialist")


if __name__ == "__main__":
    unittest.main()
