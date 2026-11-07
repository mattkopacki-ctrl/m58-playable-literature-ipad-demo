import json
import threading
import unittest
from http.server import HTTPServer
from urllib.request import urlopen

from metrics import average, normalize_values, summary
from server import Handler


class MetricTests(unittest.TestCase):
    def test_regular_average(self):
        self.assertEqual(average([2, 4, 6]), 4.0)

    def test_missing_values_are_ignored(self):
        self.assertEqual(normalize_values([1, None, 3]), [1.0, 3.0])

    def test_summary_tracks_used_values(self):
        self.assertEqual(summary([2, None, 4]), {"provided": 3, "used": 2, "average": 3.0})

    def test_all_missing_raises(self):
        with self.assertRaises(ValueError):
            average([None, None])

    def test_zero_is_a_valid_observation(self):
        self.assertEqual(normalize_values([0, None, 0.0]), [0.0, 0.0])

    def test_blank_strings_are_ignored(self):
        self.assertEqual(normalize_values(["0", "", None, "10"]), [0.0, 10.0])

    def test_summary_counts_zero(self):
        self.assertEqual(summary([0, 10, None]), {"provided": 3, "used": 2, "average": 5.0})

    def test_summary_all_zero_observations(self):
        self.assertEqual(summary([0, None, None]), {"provided": 3, "used": 1, "average": 0.0})


class SummaryApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def get_summary(self, query):
        port = self.server.server_address[1]
        with urlopen(f"http://127.0.0.1:{port}/api/summary?{query}") as response:
            return json.load(response)

    def test_zero_ten_blank(self):
        self.assertEqual(
            self.get_summary("value=0&value=10&value="),
            {"provided": 3, "used": 2, "average": 5.0},
        )

    def test_zero_blank_blank(self):
        self.assertEqual(
            self.get_summary("value=0&value=&value="),
            {"provided": 3, "used": 1, "average": 0.0},
        )


if __name__ == "__main__":
    unittest.main()
