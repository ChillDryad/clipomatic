"""
Momiji Clipper — SSE (Server-Sent Events) streaming infrastructure.

Provides utilities for streaming real-time progress updates to clients
during long-running pipeline operations (transcription, highlight detection, ingestion).
"""

import asyncio
import json
import logging
from typing import Any, AsyncGenerator, Callable

from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)

_CHUNK_SIZE = 4 * 1024 * 1024  # 4 MB for upload progress


def _sse_event(data: Any) -> str:
    """
    Format data as SSE event string.

    Args:
        data: Any JSON-serializable data to send

    Returns:
        SSE-formatted string with "data: " prefix
    """
    return f"data: {json.dumps(data)}\n\n"


async def _sse_stream(
    fn: Callable,
    *args: Any,
    on_complete: Callable | None = None,
    **kwargs: Any,
) -> AsyncGenerator[str, None]:
    """
    Run a blocking pipeline function in a thread pool, yielding SSE events.
    The function must accept a `progress_callback` kwarg.
    Final event is either {"done": true, "result": ...} or {"error": "..."}.

    Args:
        fn: Blocking function to run in thread pool
        *args: Positional arguments for fn
        on_complete: Optional async callback(result, error) called when done
        **kwargs: Keyword arguments for fn (must accept progress_callback)

    Yields:
        SSE-formatted event strings
    """
    import sys
    sys.stdout.flush()  # Ensure no buffering at startup

    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def cb(fraction: float, label: str) -> None:
        logger.debug("SSE progress callback: fraction=%s, label=%s", fraction, label)
        loop.call_soon_threadsafe(
            queue.put_nowait, {"progress": fraction, "label": label}
        )

    async def _run() -> None:
        try:
            result = await asyncio.to_thread(fn, *args, progress_callback=cb, **kwargs)
            logger.debug("SSE stream completed successfully, result: %s", result)
            queue.put_nowait({"done": True, "result": result})
        except Exception as exc:
            logger.exception("SSE stream error in %s: %s", fn.__name__, exc)
            queue.put_nowait({"error": str(exc)})

    task = asyncio.create_task(_run())
    result = None
    error = None
    while True:
        try:
            event = await asyncio.wait_for(queue.get(), timeout=1.0)
        except asyncio.TimeoutError:
            yield _sse_event({"heartbeat": True})
            continue
        logger.debug("SSE yielding event: %s", event)
        yield _sse_event(event)
        # Force flush after each event for real-time delivery
        await asyncio.sleep(0)
        if "done" in event or "error" in event:
            result = event.get("result")
            error = event.get("error")
            logger.debug("SSE stream ending: done=%s, error=%s", result is not None, error)
            break
    await task
    if on_complete:
        await on_complete(result, error)


def _sse_response(generator: AsyncGenerator[str, None]) -> StreamingResponse:
    """
    Create a StreamingResponse for SSE events.

    Args:
        generator: Async generator yielding SSE-formatted strings

    Returns:
        StreamingResponse with appropriate headers for SSE
    """
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
