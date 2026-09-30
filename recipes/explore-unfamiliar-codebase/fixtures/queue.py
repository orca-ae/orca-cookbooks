"""Thin wrapper over the message broker."""

_SUBSCRIBERS = {}


def publish(topic, message):
    for handler in _SUBSCRIBERS.get(topic, []):
        handler(message)


def subscribe(topic, handler):
    _SUBSCRIBERS.setdefault(topic, []).append(handler)
