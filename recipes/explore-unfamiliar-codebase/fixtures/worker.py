"""Background worker. Nothing in ARCHITECTURE.md mentions this file."""

from payments import charge
from queue import subscribe
from store import update_status


def on_order_created(message):
    """Charge asynchronously, then move the order out of pending."""
    order_id = message["order_id"]
    try:
        charge(order_id)
    except Exception:
        update_status(order_id, "payment_failed")
        return
    update_status(order_id, "confirmed")


subscribe("orders.created", on_order_created)
