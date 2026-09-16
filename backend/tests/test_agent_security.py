"""Regression tests for agent authentication and security hardening."""

import json
import time

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute
from sqlalchemy import select

from auth import get_current_user_or_api_key, required_api_key_scopes
from db import ApiKey, DeviceCodePairing
from routers.api_keys import (
    AVAILABLE_SCOPES,
    DeviceCodeApproveRequest,
    DeviceCodeExchangeRequest,
    DeviceCodeStartRequest,
    approve_device_code,
    exchange_device_code,
    agent_router,
    router as api_keys_router,
    start_device_code,
)
from routers.clips import router as clips_router
from routers.config import router as config_router
from routers.highlights import router as highlights_router
from routers.thumbnails import router as thumbnails_router
from routers.timeline import render_router, router as timeline_router
from routers.auth import router as auth_router
from routers.transcribe import router as transcribe_router


def _route(router, path: str, method: str) -> APIRoute:
    return next(
        route
        for route in router.routes
        if isinstance(route, APIRoute)
        and route.path == path
        and method in route.methods
    )


def _dependency_calls(route: APIRoute) -> set:
    return {dependency.call for dependency in route.dependant.dependencies}


def test_previously_public_mutation_endpoints_require_user_or_api_key():
    protected_routes = [
        _route(transcribe_router, "/api/transcribe", "POST"),
        _route(highlights_router, "/api/highlights", "POST"),
        _route(transcribe_router, "/api/transcribe/segment", "POST"),
        _route(timeline_router, "/api/timeline/batch", "POST"),
        _route(clips_router, "/api/clips/{clip_key}", "PATCH"),
    ]

    for route in protected_routes:
        assert get_current_user_or_api_key in _dependency_calls(route), route.path


def test_agent_safe_identity_models_render_and_thumbnail_endpoints_accept_api_keys():
    protected_routes = [
        _route(auth_router, "/api/auth/me", "GET"),
        _route(config_router, "/api/models", "GET"),
        _route(render_router, "/api/render/clip", "POST"),
        _route(render_router, "/api/render/segment", "POST"),
        _route(render_router, "/api/render/timeline", "POST"),
        _route(render_router, "/api/render/preview", "POST"),
        _route(thumbnails_router, "/api/projects/{project_id}/thumbnail", "POST"),
        _route(thumbnails_router, "/api/projects/{project_id}/thumbnail", "DELETE"),
        _route(thumbnails_router, "/api/projects/{project_id}/thumbnail/auto-generate", "POST"),
        _route(thumbnails_router, "/api/projects/{project_id}/thumbnail", "GET"),
        _route(thumbnails_router, "/api/projects/{project_id}/thumbnail/status", "GET"),
    ]

    for route in protected_routes:
        assert get_current_user_or_api_key in _dependency_calls(route), route.path


def test_api_key_scopes_are_explicit_and_endpoint_mapping_is_fail_closed():
    assert {"api-keys", "agent"}.issubset(AVAILABLE_SCOPES)
    assert required_api_key_scopes("/api/transcribe/segment") == {"transcribe"}
    assert required_api_key_scopes("/api/timeline/batch") == {"render"}
    assert required_api_key_scopes("/api/pipeline/clip-studio/enqueue") == {
        "pipeline",
        "clip-studio",
    }
    assert required_api_key_scopes("/api/auth/me") == {"agent"}
    assert required_api_key_scopes("/api/models") == {"agent"}
    assert required_api_key_scopes("/api/api-keys/rotate") == {"api-keys"}

    with pytest.raises(HTTPException) as exc_info:
        required_api_key_scopes("/api/not-mapped")
    assert exc_info.value.status_code == 403


def test_api_key_management_endpoints_accept_scoped_api_keys():
    routes = [
        _route(api_keys_router, "/api/api-keys", "POST"),
        _route(api_keys_router, "/api/api-keys", "GET"),
        _route(api_keys_router, "/api/api-keys/{key_id}", "DELETE"),
        _route(api_keys_router, "/api/api-keys/scopes", "GET"),
    ]
    for route in routes:
        assert get_current_user_or_api_key in _dependency_calls(route), route.path


@pytest.mark.asyncio
async def test_device_code_pairing_is_hashed_restricted_and_single_use(db_session, test_user):
    started = await start_device_code(
        DeviceCodeStartRequest(label="test-agent", scopes=["agent", "projects"]),
        db_session,
    )
    assert len(started.device_code) >= 40
    assert len(started.user_code.replace("-", "")) == 8

    pairing = (
        await db_session.execute(select(DeviceCodePairing))
    ).scalar_one()
    assert started.device_code not in (pairing.device_code_hash, pairing.user_code_hash)
    assert started.user_code not in (pairing.device_code_hash, pairing.user_code_hash)
    assert json.loads(pairing.requested_scopes) == ["agent", "projects"]
    assert pairing.expires_at > time.time()

    with pytest.raises(HTTPException) as pending:
        await exchange_device_code(
            DeviceCodeExchangeRequest(device_code=started.device_code), db_session
        )
    assert pending.value.status_code == 428

    approved = await approve_device_code(
        DeviceCodeApproveRequest(
            user_code=started.user_code,
            scopes=["agent", "projects"],
        ),
        test_user,
        db_session,
    )
    assert approved["status"] == "approved"

    exchanged = await exchange_device_code(
        DeviceCodeExchangeRequest(device_code=started.device_code), db_session
    )
    assert exchanged.key.startswith("mc_live_")
    created_key = (
        await db_session.execute(select(ApiKey).where(ApiKey.id == exchanged.id))
    ).scalar_one()
    assert json.loads(created_key.scopes) == ["agent", "projects"]

    with pytest.raises(HTTPException) as reused:
        await exchange_device_code(
            DeviceCodeExchangeRequest(device_code=started.device_code), db_session
        )
    assert reused.value.status_code == 409


def test_agent_info_endpoint_is_api_key_authenticated():
    route = _route(agent_router, "/api/agent/info", "GET")
    assert get_current_user_or_api_key in _dependency_calls(route)
