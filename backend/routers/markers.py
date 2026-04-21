"""
Momiji Clipper — Markers router.

Endpoints:
- POST /api/markers — Create timeline marker
- GET /api/markers — List markers (optionally by project)
- PUT /api/markers/{marker_id} — Update marker
- DELETE /api/markers/{marker_id} — Delete marker
"""

import json
import time
import uuid
from fastapi import APIRouter, HTTPException, Query

from db import Marker as MarkerModel, get_session_cm
from pydantic import BaseModel
from sqlalchemy import select

router = APIRouter(prefix="/api/markers", tags=["Markers"])


class MarkerRequest(BaseModel):
    time: float
    duration: float | None = None
    label: str
    color: str = "#FF5733"
    project_id: str | None = None
    extra_data: dict | None = None


class MarkerResponse(BaseModel):
    id: str
    time: float
    duration: float | None
    label: str
    color: str
    project_id: str | None
    extra_data: dict | None
    created_at: float
    updated_at: float


@router.post("")
async def create_marker(req: MarkerRequest):
    """Create a new timeline marker."""
    async with get_session_cm() as session:
        marker = MarkerModel(
            id=uuid.uuid4().hex,
            project_id=req.project_id,
            time=req.time,
            duration=req.duration,
            label=req.label,
            color=req.color,
            extra_data=json.dumps(req.extra_data) if req.extra_data else None,
            created_at=time.time(),
            updated_at=time.time(),
        )
        session.add(marker)
        await session.commit()
        await session.refresh(marker)

        return MarkerResponse(
            id=marker.id,
            time=marker.time,
            duration=marker.duration,
            label=marker.label,
            color=marker.color,
            project_id=marker.project_id,
            extra_data=json.loads(marker.extra_data) if marker.extra_data else None,
            created_at=marker.created_at,
            updated_at=marker.updated_at,
        )


@router.get("")
async def list_markers(project_id: str | None = Query(None)):
    """List all markers, optionally filtered by project."""
    async with get_session_cm() as session:
        query = select(MarkerModel).order_by(MarkerModel.time)
        if project_id:
            query = query.where(MarkerModel.project_id == project_id)
        result = await session.execute(query)
        markers = result.scalars().all()

    return {
        "markers": [
            MarkerResponse(
                id=m.id,
                time=m.time,
                duration=m.duration,
                label=m.label,
                color=m.color,
                project_id=m.project_id,
                extra_data=json.loads(m.extra_data) if m.extra_data else None,
                created_at=m.created_at,
                updated_at=m.updated_at,
            )
            for m in markers
        ]
    }


@router.put("/{marker_id}")
async def update_marker(marker_id: str, req: MarkerRequest):
    """Update an existing marker."""
    async with get_session_cm() as session:
        result = await session.execute(select(MarkerModel).where(MarkerModel.id == marker_id))
        marker = result.scalar_one_or_none()

        if not marker:
            raise HTTPException(status_code=404, detail="Marker not found")

        marker.time = req.time
        marker.duration = req.duration
        marker.label = req.label
        marker.color = req.color
        marker.project_id = req.project_id
        marker.extra_data = json.dumps(req.extra_data) if req.extra_data else None
        marker.updated_at = time.time()

        await session.commit()
        await session.refresh(marker)

        return MarkerResponse(
            id=marker.id,
            time=marker.time,
            duration=marker.duration,
            label=marker.label,
            color=marker.color,
            project_id=marker.project_id,
            extra_data=json.loads(marker.extra_data) if marker.extra_data else None,
            created_at=marker.created_at,
            updated_at=marker.updated_at,
        )


@router.delete("/{marker_id}")
async def delete_marker(marker_id: str):
    """Delete a marker."""
    async with get_session_cm() as session:
        result = await session.execute(select(MarkerModel).where(MarkerModel.id == marker_id))
        marker = result.scalar_one_or_none()

        if not marker:
            raise HTTPException(status_code=404, detail="Marker not found")

        await session.delete(marker)
        await session.commit()

    return {"ok": True}
