"""Tests that pass today, and are too weak to catch the reported bug."""

import unittest

from pricing import discount_total, subtotal


class TestPricing(unittest.TestCase):
    def test_subtotal(self):
        items = [{"unit_price": 10.0, "quantity": 2}]
        self.assertEqual(subtotal(items), 20.0)

    def test_single_line_discount(self):
        # One line cannot expose compounding, which is why this passes.
        items = [{"unit_price": 100.0, "quantity": 1}]
        self.assertAlmostEqual(discount_total(items, 0.10), 90.0)


if __name__ == "__main__":
    unittest.main()
