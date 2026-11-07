import unittest

from stats import average, summarize


class StatsTests(unittest.TestCase):
    def test_average_regular_values(self):
        self.assertEqual(average([2, 4, 6]), 4.0)

    def test_average_decimals(self):
        self.assertEqual(average([1.25, 2.75]), 2.0)

    def test_empty_values_raise(self):
        with self.assertRaises(ValueError):
            average([])

    def test_summarize_count(self):
        self.assertEqual(summarize([3, 6, 9])["count"], 3)

    def test_average_includes_zero_values(self):
        self.assertEqual(average([0, 10]), 5.0)

    def test_summarize_includes_zero_values(self):
        self.assertEqual(summarize([0, 10]), {"count": 2, "average": 5.0})

    def test_average_all_zero_values(self):
        self.assertEqual(average([0, 0.0]), 0.0)


if __name__ == "__main__":
    unittest.main()
