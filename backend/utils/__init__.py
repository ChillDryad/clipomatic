"""
Momiji Clipper — Shared utilities.

This module provides cross-cutting utilities used across multiple routers:
- sse: Server-Sent Events streaming infrastructure
- helpers: Shared helper functions (user serialization, path utils, cache helpers)
- state: In-memory state stores for OAuth and auth flows
"""

from utils.sse import _sse_event, _sse_stream, _sse_response
from utils.helpers import (
    _user_dict,
    _set_auth_cookies,
    _resolve_workspace_path,
    _validate_workspace_path,
    _clips_cache_path,
    _parse_clip_key,
    _update_project_status,
    _parse_srt,
    _parse_ass,
    _extract_clip_segment,
    _regenerate_clip_metadata,
    _get_cached_frame_path,
    _invalidate_frame_cache,
    _get_cached_transcript_path,
    _invalidate_transcript_cache,
    _get_cached_clips_path,
    _invalidate_clips_cache,
)
from utils.state import (
    _pending_oauth_states,
    _pending_auth_states,
    _AUTH_STATE_EXPIRY_SECONDS,
    _OAUTH_STATE_EXPIRY_SECONDS,
)

__all__ = [
    # SSE
    "_sse_event",
    "_sse_stream",
    "_sse_response",
    # Helpers
    "_user_dict",
    "_set_auth_cookies",
    "_resolve_workspace_path",
    "_validate_workspace_path",
    "_clips_cache_path",
    "_parse_clip_key",
    "_update_project_status",
    "_parse_srt",
    "_parse_ass",
    "_extract_clip_segment",
    "_regenerate_clip_metadata",
    "_get_cached_frame_path",
    "_invalidate_frame_cache",
    "_get_cached_transcript_path",
    "_invalidate_transcript_cache",
    "_get_cached_clips_path",
    "_invalidate_clips_cache",
    # State
    "_pending_oauth_states",
    "_pending_auth_states",
    "_AUTH_STATE_EXPIRY_SECONDS",
    "_OAUTH_STATE_EXPIRY_SECONDS",
]
