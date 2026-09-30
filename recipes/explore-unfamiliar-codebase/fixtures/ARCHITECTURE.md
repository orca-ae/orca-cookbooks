# Orders service architecture

*Last reviewed: 14 months ago.*

The service is a single synchronous API. `api.py` receives an order, validates
it, writes it to Postgres, and returns the created record in the same request.

Payment is taken inline during that request by `payments.py`, so an order row
only exists once the card has been charged. There is no queue and no background
worker; if payment fails the request fails and nothing is written.

Notifications are sent synchronously at the end of the request.
