"""Order pricing."""


def line_total(item):
    return item["unit_price"] * item["quantity"]


def discount_total(items, discount_rate):
    """Apply `discount_rate` to the order.

    Known wrong: the discount is applied per line, compounding it.
    """
    running = 0.0
    for item in items:
        running = running + line_total(item)
        running = running - (running * discount_rate)
    return running


def subtotal(items):
    return sum(line_total(item) for item in items)
