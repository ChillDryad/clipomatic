# MCP Server Implementation Plan

## Overview

Implement Model Context Protocol (MCP) server for clipomatic, enabling AI agents (Claude Code, OpenClaw, etc.) to discover and control the clip factory programmatically.

**Why:** Transforms clipomatic from a manual UI-driven app into an AI-controllable service. External agents can query projects, trigger renders, and manage clips without REST API boilerplate.

---

## Architecture

### New Components

```
backend/
├── mcp/
│   ├── __init__.py          # Package init, version
│   ├── server.py            # MCP server entry (stdio + SSE transport)
│   ├── resources.py         # Read-only resources: projects, clips, markers
│   ├── tools.py             # Writable actions: render, transcribe, post
│   └── prompts.py           # MCP prompts: "analyze this clip for hooks"
├── .mcp.json                # MCP config for clients
└── ...existing files...
```

### Existing Code Reused (No Changes)

| MCP Layer | Wraps Existing Module |
|-----------|----------------------|
| `get_project` tool | `backend/db.py::get_project()` |
| `list_clips` tool | `backend/routers/clips.py` |
| `render_clip` tool | `backend/pipeline/renderer.py` |
| `transcribe` tool | `backend/pipeline/transcription.py` |
| `get_markers` tool | `backend/routers/markers.py` |
| `post_to_platform` tool | `backend/platforms/*.py` |

---

## Implementation Phases

### Phase 1: MCP Server Skeleton

**Goal:** Minimal working MCP server with one tool.

**Files:**
- `backend/mcp/__init__.py`
- `backend/mcp/server.py`
- `backend/.mcp.json`

**Dependencies:** Add `mcp` package to `backend/requirements.txt`

**Verification:**
```bash
cd backend
uv run python -m backend.mcp.server
# In Claude Code: /mcp connect clipomatic
# Should list available tools
```

---

### Phase 2: Resources (Read-Only)

**Goal:** Expose projects, clips, markers as MCP resources.

**Files:**
- `backend/mcp/resources.py`

**Resources to expose:**
- `projects://{id}` — Full project with metadata
- `clips://{id}` — Clip details with timeline
- `markers://{clip_id}` — Subtitle markers with timestamps
- `transcript://{clip_id}` — Word-level transcript

**Verification:**
```python
# Any MCP client can read resources
async with MCPClient("stdio://backend.mcp.server") as client:
    project = await client.read_resource("projects://abc123")
```

---

### Phase 3: Tools (Actions)

**Goal:** Expose pipeline actions as callable MCP tools.

**Files:**
- `backend/mcp/tools.py`

**Tools to expose:**

| Tool | Wraps | Description |
|------|-------|-------------|
| `render_clip` | `pipeline/renderer.py` | Render 9:16 vertical clip |
| `transcribe_video` | `pipeline/transcription.py` | Generate Whisper transcript |
| `identify_highlights` | `pipeline/highlight_detection.py` | LLM scoring for viral moments |
| `add_marker` | `routers/markers.py` | Add subtitle marker |
| `post_to_platform` | `platforms/*.py` | Upload to YouTube/TikTok/Instagram |
| `get_project_status` | `utils/state.py` | Get pipeline progress |

**Verification:**
```python
result = await client.call_tool("render_clip", {"clip_id": "abc123", "layout": "stacked"})
```

---

### Phase 4: Prompts (Optional)

**Goal:** Pre-built prompt templates for common AI workflows.

**Files:**
- `backend/mcp/prompts.py`

**Prompts:**
- `analyze_clip_hooks` — "Analyze this clip for hook effectiveness"
- `suggest_cuts` — "Suggest optimal cut points for 9:16 format"
- `generate_title` — "Generate viral titles for this clip"

---

### Phase 5: Transport Configuration

**Goal:** Support multiple transport modes.

**Modes:**
1. **stdio** — Local subprocess (default for Claude Code)
2. **SSE** — HTTP Server-Sent Events (for remote clients)
3. **streamable-http** — Bidirectional (OpenClaw gateway)

**Files:**
- Modify `backend/mcp/server.py` to support multiple transports

**Verification:**
```bash
# stdio
uv run python -m backend.mcp.server

# SSE
uv run uvicorn backend.mcp.server:app --port 8001
```

---

### Phase 6: Client Integration

**Goal:** Document how to connect from major clients.

**Files:**
- `docs/mcp-clients.md` (new)

**Clients to document:**
1. **Claude Code** — `.claude/settings.json` or `~/.claude/settings.json`
2. **OpenClaw** — `openclaw.json` mcp.servers config
3. **Generic Python** — `mcp` SDK example

---

## Dependencies

Add to `backend/requirements.txt`:

```
mcp>=1.0.0
```

---

## Testing

### Unit Tests

```python
# backend/tests/test_mcp.py
async def test_render_clip_tool():
    async with MCPClient("stdio://backend.mcp.server") as client:
        result = await client.call_tool("render_clip", {"clip_id": "test123"})
        assert result["status"] == "queued"
```

### Integration Tests

```bash
# Start MCP server, connect from Claude Code, verify tool discovery
pytest backend/tests/test_mcp_integration.py
```

---

## Security Considerations

1. **Authentication** — MCP tools should respect existing JWT auth from `backend/auth.py`
2. **Rate Limiting** — Wrap tools with existing `slowapi` limits
3. **Input Validation** — Reuse Pydantic models from existing routers
4. **SSE Transport** — Require auth token for remote connections

---

## Rollout Checklist

- [ ] Phase 1: Skeleton server running
- [ ] Phase 2: Resources readable
- [ ] Phase 3: Tools callable
- [ ] Phase 4: Prompts (optional)
- [ ] Phase 5: Multiple transports
- [ ] Phase 6: Client docs
- [ ] Unit tests passing
- [ ] Integration test with Claude Code
- [ ] Integration test with OpenClaw

---

## Estimated Effort

| Phase | Lines of Code | Time |
|-------|---------------|------|
| Phase 1 | ~80 | 1-2 hours |
| Phase 2 | ~120 | 2-3 hours |
| Phase 3 | ~150 | 3-4 hours |
| Phase 4 | ~60 | 1 hour |
| Phase 5 | ~100 | 2 hours |
| Phase 6 | ~100 (docs) | 1 hour |
| **Total** | **~610** | **10-13 hours** |

---

## Future Enhancements (Out of Scope)

- WebSocket transport for real-time progress updates
- MCP "sampling" — let AI request Claude API calls back
- Custom UI panel in Claude Code showing clipomatic dashboard
- Plugin manifest (`.claude-plugin/`) for slash commands

---

## References

- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)
- [OpenClaw MCP Docs](https://docs.openclaw.ai/cli/mcp)
- [Claude Code Plugins](https://code.claude.com/docs/en/plugins)
