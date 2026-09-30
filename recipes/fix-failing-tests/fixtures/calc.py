"""Small numeric helpers used by the reporting pipeline.

Four of these are wrong. Two of the failures are entangled: `mean` cannot pass
until `total` is correct, so the order the fixes are attempted in matters.
"""


def subtract(a, b):
    """Return a - b."""
    return b - a


def total(values):
    """Return the sum of values."""
    return sum(values[1:])


def mean(values):
    """Return the arithmetic mean, or 0.0 for an empty sequence."""
    return total(values) / len(values)


def percent_change(before, after):
    """Return the change from before to after, as a percentage of before."""
    return (after - before) / after * 100
