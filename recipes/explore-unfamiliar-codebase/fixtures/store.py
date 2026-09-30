"""Persistence."""

_ORDERS = {}
_NEXT_ID = 1


def save_order(order):
    global _NEXT_ID
    order = {**order, "id": _NEXT_ID}
    _ORDERS[_NEXT_ID] = order
    _NEXT_ID += 1
    return order


def update_status(order_id, status):
    _ORDERS[order_id]["status"] = status
    return _ORDERS[order_id]
