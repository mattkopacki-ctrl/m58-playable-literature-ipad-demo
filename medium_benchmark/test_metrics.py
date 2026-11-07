import unittest

from metrics import average, normalize_values, summary


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

    def test_normalization_preserves_zeros_and_ignores_blanks(self):
        self.assertEqual(normalize_values([0, "0", None, "", 10]), [0.0, 0.0, 10.0])

    def test_summary_includes_zero_observations(self):
        for values, used, expected_average in [
            ([0, 10, None], 2, 5.0),
            (["0", "10", None], 2, 5.0),
            ([0, "", None], 1, 0.0),
            (["0", "", None], 1, 0.0),
        ]:
            with self.subTest(values=values):
                self.assertEqual(
                    summary(values),
                    {"provided": 3, "used": used, "average": expected_average},
                )

    def test_all_blank_values_raise(self):
        with self.assertRaises(ValueError):
            average(["", None, ""])


if __name__ == "__main__":
    unittest.main()
