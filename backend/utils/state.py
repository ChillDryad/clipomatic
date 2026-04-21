"""
Momiji Clipper — In-memory state stores.

State dictionaries for OAuth and authentication flows.
These are temporary, in-memory stores for CSRF state tokens
that expire after a configurable duration.
"""

# In-memory state store for OAuth flows (YouTube/TikTok/Instagram)
# Keyed by random state token, value = {user_id, platform, created_at}
_pending_oauth_states: dict[str, dict] = {}

# In-memory state store for auth flows (register/login CSRF)
# Keyed by random state token, value = {email, password_hash?, created_at}
_pending_auth_states: dict[str, dict] = {}

# State expiry durations (seconds)
_AUTH_STATE_EXPIRY_SECONDS = 300  # 5 minutes for auth flows
_OAUTH_STATE_EXPIRY_SECONDS = 600  # 10 minutes for OAuth flows
