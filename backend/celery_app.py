"""
Momiji Clipper — Celery app configuration.

Redis is used as both broker and result backend.
Broker DB 0, Result backend DB 1 (to avoid key collisions).
"""

import os
import sys

# Ensure the backend directory is on sys.path before any imports
# so that `from pipeline import ...` and `from db import ...` work.
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from celery import Celery

celery_app = Celery(
    "momiji",
    broker=os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0"),
    backend=os.environ.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/1"),
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    worker_prefetch_multiplier=1,
)

# Import tasks so Celery worker discovers them
import tasks  # noqa: E402, F401