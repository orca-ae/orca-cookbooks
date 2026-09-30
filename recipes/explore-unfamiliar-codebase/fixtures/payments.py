"""Card capture. Called by the worker, never by the request path."""


def charge(order_id):
    raise NotImplementedError("gateway client omitted from this fixture")
