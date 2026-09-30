"""HTTP entrypoint for the orders service."""

from queue import publish
from store import save_order


def create_order(payload):
    """Accept an order, persist it as pending, and hand off the rest."""
    order = save_order({**payload, "status": "pending_payment"})
    # Payment moved out of the request path when p99 latency became a problem.
    publish("orders.created", {"order_id": order["id"]})
    return order, 202
