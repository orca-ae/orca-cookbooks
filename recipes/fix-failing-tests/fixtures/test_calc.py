"""Tests for calc.py. Standard library only - no packages to install."""

import unittest

from calc import mean, percent_change, subtract, total


class TestCalc(unittest.TestCase):
    def test_subtract(self):
        self.assertEqual(subtract(10, 3), 7)

    def test_subtract_negative_result(self):
        self.assertEqual(subtract(3, 10), -7)

    def test_total(self):
        self.assertEqual(total([1, 2, 3, 4]), 10)

    def test_total_empty(self):
        self.assertEqual(total([]), 0)

    def test_mean(self):
        self.assertEqual(mean([2, 4, 6]), 4.0)

    def test_mean_empty_is_zero_not_an_error(self):
        self.assertEqual(mean([]), 0.0)

    def test_percent_change_increase(self):
        self.assertAlmostEqual(percent_change(200, 250), 25.0)

    def test_percent_change_decrease(self):
        self.assertAlmostEqual(percent_change(200, 150), -25.0)


if __name__ == "__main__":
    unittest.main()
