"""Minimal internal OpenAI-compatible bridge for official Codex CLI auth."""

from __future__ import annotations

import base64
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Clipomatic Codex Bridge")
MODELS = ["default", "gpt-5.2-codex", "gpt-5.1-codex"]


class ChatRequest(BaseModel):
    model: str = "default"
    messages: list[dict[str, Any]]
    temperature: float | None = None


def _login_status() -> tuple[bool, str]:
    result = subprocess.run(
        ["codex", "login", "status"], text=True, capture_output=True, timeout=15
    )
    return result.returncode == 0, (result.stdout + result.stderr).strip()


def _message_text(messages: list[dict[str, Any]], image_paths: list[str]) -> str:
    parts: list[str] = []
    for message in messages:
        content = message.get("content", "")
        if isinstance(content, str):
            parts.append(content)
            continue
        if not isinstance(content, list):
            continue
        for item in content:
            if item.get("type") == "text":
                parts.append(str(item.get("text", "")))
            elif item.get("type") == "image_url":
                url = item.get("image_url", {}).get("url", "")
                if url.startswith("data:image/") and "," in url:
                    header, encoded = url.split(",", 1)
                    suffix = ".jpg" if "jpeg" in header else ".png"
                    fd, path = tempfile.mkstemp(suffix=suffix, dir="/tmp/codex")
                    with os.fdopen(fd, "wb") as handle:
                        handle.write(base64.b64decode(encoded))
                    image_paths.append(path)
    return "\n\n".join(part for part in parts if part)


@app.get("/health")
def health() -> dict[str, Any]:
    authenticated, detail = _login_status()
    return {"status": "ok", "authenticated": authenticated, "detail": detail, "models": MODELS}


@app.get("/v1/models")
def models() -> dict[str, Any]:
    return {"object": "list", "data": [{"id": model, "object": "model"} for model in MODELS]}


@app.post("/v1/chat/completions")
def chat(request: ChatRequest) -> dict[str, Any]:
    authenticated, detail = _login_status()
    if not authenticated:
        raise HTTPException(status_code=401, detail="Codex is not authenticated. Run codex login --device-auth in the Codex container.")
    if request.model not in MODELS:
        raise HTTPException(status_code=400, detail=f"Unsupported Codex model: {request.model}")

    images: list[str] = []
    output_path = ""
    try:
        prompt = _message_text(request.messages, images)
        if not prompt:
            raise HTTPException(status_code=400, detail="No prompt content supplied")
        fd, output_path = tempfile.mkstemp(suffix=".txt", dir="/tmp/codex")
        os.close(fd)
        command = [
            "codex", "exec", "--skip-git-repo-check", "--sandbox", "read-only",
            "--ephemeral", "--output-last-message", output_path,
        ]
        if request.model != "default":
            command.extend(["--model", request.model])
        for image in images:
            command.extend(["--image", image])
        command.append(prompt)
        result = subprocess.run(command, text=True, capture_output=True, timeout=600)
        if result.returncode:
            raise HTTPException(status_code=502, detail=(result.stderr or result.stdout)[-2000:])
        content = Path(output_path).read_text(encoding="utf-8").strip()
        return {
            "id": "codex-bridge",
            "object": "chat.completion",
            "model": request.model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
        }
    finally:
        for path in images + ([output_path] if output_path else []):
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass
