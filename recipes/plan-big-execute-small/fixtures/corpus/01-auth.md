# Authentication

Sessions are JWT-based with a 15 minute access token and a 30 day refresh token. Refresh rotation is enabled: using a refresh token invalidates it and issues a new one. A reused refresh token revokes the whole family, which is how token theft is detected.

## Caveat

Known gap: revocation is eventually consistent across regions, up to 40 seconds.
