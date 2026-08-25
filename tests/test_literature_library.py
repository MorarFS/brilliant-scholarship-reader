import json
import re
import unittest
from pathlib import Path


class LiteratureLibraryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).parents[1] / "public" / "data" / "literature.json"
        cls.payload = json.loads(path.read_text(encoding="utf-8"))
        cls.records = cls.payload["records"]

    def test_declared_counts_match_records(self):
        self.assertEqual(self.payload["record_count"], len(self.records))
        self.assertEqual(self.payload["must_cite_count"], sum(item["must_cite"] for item in self.records))
        self.assertEqual(self.payload["closest_precedent_count"], sum(item["closest_precedent"] for item in self.records))
        self.assertGreaterEqual(len(self.records), 75)

    def test_records_are_verified_and_reviewable(self):
        required = {"id", "citation", "authors", "year", "title", "source_type", "category", "period", "geography", "method_corpus", "key_claim", "relevance", "dialogue", "tags", "verification"}
        for item in self.records:
            self.assertFalse(required - item.keys(), item["id"])
            self.assertEqual("verified", item["verification"]["status"], item["id"])
            self.assertTrue(item["verification"]["primary_record"].startswith("http"), item["id"])
            self.assertTrue(item["authors"], item["id"])
            self.assertTrue(item["citation"], item["id"])

    def test_identifiers_and_fallback_keys_are_unique(self):
        keys = []
        for item in self.records:
            if item["doi"]:
                key = ("doi", item["doi"].lower())
            elif item["isbn"]:
                key = ("isbn", item["isbn"].replace("-", ""))
            else:
                key = ("title-year", re.sub(r"\W+", "", item["title"].lower()) + str(item["year"]))
            keys.append(key)
        self.assertEqual(len(keys), len(set(keys)))

    def test_review_layers_and_jca_search_are_present(self):
        self.assertEqual({"canonical background", "direct computational precedent", "methods precedent", "interpretive dialogue"}, set(self.payload["categories"]))
        self.assertGreaterEqual(sum(item["container_title"] == "Journal of Cultural Analytics" for item in self.records), 8)
        self.assertTrue(any("1940" in (item["period"] + item["method_corpus"]) or "1880" in (item["period"] + item["method_corpus"]) for item in self.records))
        self.assertTrue(any(item["closest_precedent"] for item in self.records))


if __name__ == "__main__":
    unittest.main()
