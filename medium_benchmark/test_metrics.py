import unittest

from metrics import average, normalize_values, summary


class MetricTests(unittest.TestCase):
    def test_regular_average(self):
        self.assertEqual(average([2, 4, 6]), 4.0)

    def test_missing_values_are_ignored(self):
        self.assertEqual(normalize_values([1, None, 3]), [1.0, 3.0])

    def test_zero_is_a_valid_observation(self):
        self.assertEqual(summary([0, 10, None]), {"provided": 3, "used": 2, "average": 5.0})

    def test_zero_is_a_valid_only_observation(self):
        self.assertEqual(summary([0, None, None]), {"provided": 3, "used": 1, "average": 0.0})

    def test_summary_tracks_used_values(self):
        self.assertEqual(summary([2, None, 4]), {"provided": 3, "used": 2, "average": 3.0})

    def test_all_missing_raises(self):
        with self.assertRaises(ValueError):
            average([None, None])


if __name__ == "__main__":
    unittest.main()
