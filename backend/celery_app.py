"""
Momiji Clipper — Celery app configuration.

Redis is used as both broker and result backend.
Broker DB 0, Result backend DB 1 (to avoid key collisions).
"""

import os

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