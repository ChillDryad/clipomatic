# Code Legibility & Style Guide

**Project:** Momiji Clipper  
**Date:** 2026-04-15  
**Status:** In Progress (Interruptible)

---

## Executive Summary

This document establishes coding standards and legibility improvements for the Momiji Clipper codebase. Focus areas: naming conventions, type hints, documentation, error handling, and logging.

---

## 1. Naming Conventions

### 1.1 Python Naming

**Current State:**
```python
# Good examples from codebase:
def transcribe_segment(...)  # ✓ snake_case for functions
class VideoProject(Base)     # ✓ PascalCase for classes
WORKSPACE = os.environ.get(...)  # ✓ UPPER_CASE for constants
```

**Inconsistencies Found:**

```python
# api.py - Mixed naming for similar functions:
def _parse_srt(text: str) -> list[dict]:      # ✓ Private with underscore
def _parse_ass(text: str) -> list[dict]:      # ✓ Private with underscore
def _sse_stream(fn, *args, **kwargs):         # ✓ Private with underscore
def _sse_response(generator):                 # ✓ Private with underscore

# But public helpers lack consistency:
def _parse_clip_key(encoded: str):            # Private helper (good)
def _clips_cache_path(source_path: str):      # Private helper (good)
def _extract_clip_segment(...):               # Private helper (good, but defined inside async fn)
```

**Standard:**

```python
# FUNCTION NAMES
def process_video_file(path: str) -> str:           # Public function
def _internal_helper(data: dict) -> str:            # Private function (module-local)
async def fetch_transcript(id: str) -> Transcript:  # Async function

# VARIABLE NAMES
user_id = "abc123"           # Descriptive, not abbreviated
oauth_tokens = []            # Plural for collections
is_authenticated = False     # Boolean with is/has/can prefix

# CONSTANT NAMES
MAX_FILE_SIZE_BYTES = 104857600
DEFAULT_WHISPER_MODEL = "large-v3"
JWT_ALGORITHM = "RS256"

# CLASS NAMES
class OAuthToken(Base)       # Noun, descriptive
class PlatformAdapter(ABC)   # Abstract base class
class VideoProject(Base)     # Entity class
```

### 1.2 TypeScript Naming

**Current State:**
```typescript
// Good examples:
interface AuthUser { ... }           # ✓ PascalCase for interfaces
const useAuthStore = create(...)     # ✓ camelCase for variables
function uploadFile(file: File)      # ✓ camelCase for functions
```

**Standard:**

```typescript
// INTERFACES & TYPES
interface User { ... }               # Noun, PascalCase
type ClipData = { ... }              # Alias, PascalCase
type UserRole = 'owner' | 'editor'   # Union, PascalCase

// COMPONENTS
function VideoProjectPage() { ... }  # PascalCase for React components
function ClipCard({ clip }: ...) { ... }

// HOOKS
function useAuth() { ... }           # use prefix for hooks
function usePipeline() { ... }

// VARIABLES & FUNCTIONS
const isAuthenticated = false        # camelCase, descriptive
async function fetchProjects() { ... }
const handleLogin = async () => { ... }  # Event handlers with handle prefix
```

---

## 2. Type Hints

### 2.2 Python Type Hints

**Current State:**

Good coverage in `db.py`:
```python
class User(Base):
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
```

Inconsistent in `api.py`:
```python
# Good:
def _parse_srt(text: str) -> list[dict]:  # ✓ Typed

# Missing types:
def _sse_response(generator) -> StreamingResponse:  # ✗ Missing generator type
async def _sse_stream(fn, *args, **kwargs) -> AsyncGenerator[str, None]:  # ✗ fn untyped
```

**Standard:**

```python
# FUNCTION SIGNATURES
from typing import Optional, Union, Any
from collections.abc import Callable, AsyncGenerator

def process_video(
    path: str,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> str:
    """Process video and return output path."""

async def stream_progress(
    fn: Callable[..., Any],
    *args: Any,
    progress_callback: Callable[[float, str], None],
    **kwargs: Any,
) -> AsyncGenerator[str, None]:
    """Stream SSE progress events."""

# RETURN TYPE ALIASES
from typing import TypedDict

class TranscriptWord(TypedDict):
    word: str
    start: float
    end: float
    probability: float

class TranscriptSegment(TypedDict):
    start: float
    end: float
    text: str
    words: list[TranscriptWord]

class Transcript(TypedDict):
    language: str
    language_probability: float
    duration: float
    segments: list[TranscriptSegment]

# Use in function signatures
def parse_transcript(data: dict) -> Transcript:
    """Parse transcript data with type safety."""
```

### 2.2 TypeScript Type Safety

**Current State:**

Good type coverage in `frontend/src/types.ts` and `frontend/src/api.ts`.

**Standard:**

```typescript
// STRICT TYPE DEFINITIONS
interface Clip {
  readonly id: string;           // Immutable
  title: string;
  start_time: number;
  end_time: number;
  reason?: string | null;        // Optional with explicit null
  virality_score?: number | null;
}

// DISCRIMINATED UNIONS
type AuthState = 
  | { status: 'loading' }
  | { status: 'authenticated'; user: User }
  | { status: 'unauthenticated' }
  | { status: 'error'; error: string }

// GENERIC TYPES
type ApiResponse<T> = 
  | { success: true; data: T }
  | { success: false; error: string }

// AVOID ANY
// Bad:
function processData(data: any): any { ... }  // ✗ Loses type safety

// Good:
function processData<T>(data: unknown): T {   // ✓ Generic with unknown
  return data as T;
}
```

---

## 3. Documentation Standards

### 3.1 Python Docstrings

**Current State:**

Good examples:
```python
# api.py
def _parse_srt(text: str) -> list[dict]:
    """Parse SRT content into a list of cue dicts."""

# oauth/twitch.py
async def exchange_twitch_code(code: str) -> tuple[str, str, str | None, float | None]:
    """
    Exchange auth code for Twitch tokens.

    Returns (user_id, access_token, refresh_token, expires_at).
    """
```

**Standard (Google Style):**

```python
def transcribe_video(
    video_path: str,
    model_size: str = "large-v3",
    device: str = "auto",
    language: str | None = None,
    progress_callback: Callable[[float, str], None] | None = None,
) -> Transcript:
    """
    Transcribe video audio using Whisper model.

    Args:
        video_path: Absolute path to video file in workspace.
        model_size: Whisper model size ('tiny', 'base', 'small', 'medium', 'large-v3').
        device: Compute device ('auto', 'cuda', 'cpu').
        language: ISO language code (e.g., 'en', 'es'). Auto-detected if None.
        progress_callback: Optional callback(fraction, label) for progress updates.

    Returns:
        Transcript object with segments and word-level timestamps.

    Raises:
        FileNotFoundError: If video_path does not exist.
        RuntimeError: If Whisper model fails to load.

    Example:
        >>> transcript = transcribe_video("/workspace/video.mp4")
        >>> print(transcript["segments"][0]["text"])
        'Hello world'
    """
```

### 3.2 TypeScript JSDoc

**Standard:**

```typescript
/**
 * Upload a video file to the workspace.
 * 
 * @param file - The video file to upload (MP4, MKV, MOV, AVI, or WebM).
 * @param onProgress - Callback invoked with progress (0-1) and label.
 * @returns Promise resolving to the workspace path of the uploaded file.
 * @throws Error if upload fails or file type is invalid.
 * 
 * @example
 * ```typescript
 * const path = await uploadFile(videoFile, (progress, label) => {
 *   console.log(`${label}: ${(progress * 100).toFixed(0)}%`);
 * });
 * ```
 */
export async function uploadFile(
  file: File,
  onProgress: (progress: number, label: string) => void,
): Promise<string> {
  // ...
}
```

---

## 4. Error Handling Patterns

### 4.1 Python Error Handling

**Current State:**

```python
# Good: Specific exception handling
try:
    result = await session.execute(query)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
except HTTPException:
    raise
except Exception as exc:
    logger.exception("Database error: %s", exc)
    raise HTTPException(status_code=500, detail="Internal server error")
```

**Issues Found:**

```python
# api.py:103-104
except Exception as exc:
    queue.put_nowait({"error": str(exc)})  # ✗ Silent - no logging

# api.py:878-881
except Exception as exc:
    logger = logging.getLogger(__name__)
    logger.error("Failed to regenerate clip metadata: %s", exc)
    return clip  # ✓ Good: graceful degradation
```

**Standard:**

```python
# LAYERED ERROR HANDLING
from fastapi import HTTPException, status

class ClipProcessingError(Exception):
    """Custom exception for clip processing failures."""
    def __init__(self, message: str, clip_id: str | None = None):
        super().__init__(message)
        self.clip_id = clip_id

async def process_clip(clip_id: str) -> dict:
    """Process a clip with proper error handling."""
    try:
        # Database operation
        clip = await db.get_clip(clip_id)
        if not clip:
            raise ClipProcessingError("Clip not found", clip_id)
        
        # Processing logic
        result = await _render_clip(clip)
        return result
        
    except ClipProcessingError:
        # Re-raise custom exceptions (already logged)
        raise
    except FileNotFoundError as exc:
        # Specific known error
        logger.warning("Clip file not found: %s", clip_id)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Clip file not found: {clip_id}"
        )
    except Exception as exc:
        # Unexpected error - log and convert to HTTP 500
        logger.exception("Unexpected error processing clip %s: %s", clip_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Clip processing failed"
        )
```

### 4.2 TypeScript Error Handling

**Current State:**

```typescript
// frontend/src/api.ts
export async function uploadFile(file: File, onProgress: ...) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/ingest/upload', { method: 'POST', body: form })
  return consumeSSE<string>(res, onProgress)
}
// ✗ No error handling for non-200 responses
```

**Standard:**

```typescript
// CUSTOM ERROR CLASS
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// CONSISTENT ERROR HANDLING
export async function uploadFile(
  file: File,
  onProgress: (progress: number, label: string) => void,
): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  
  const res = await fetch('/api/ingest/upload', {
    method: 'POST',
    body: form,
  });
  
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(
      `Upload failed: ${res.status}`,
      res.status,
      errorData.detail,
    );
  }
  
  return consumeSSE<string>(res, onProgress);
}

// REACT ERROR BOUNDARIES
function UploadForm() {
  const [error, setError] = useState<string | null>(null);
  
  const handleUpload = async (file: File) => {
    try {
      await uploadFile(file, setProgress);
      setError(null);
    } catch (err) {
      const message = err instanceof ApiError 
        ? err.detail ?? err.message 
        : 'Upload failed';
      setError(message);
    }
  };
  
  if (error) {
    return <Alert variant="error">{error}</Alert>;
  }
  // ...
}
```

---

## 5. Logging & Observability

### 5.1 Python Logging

**Current State:**

```python
# Good:
logger = logging.getLogger(__name__)
logger.info("APScheduler started.")
logger.exception("Job %s failed: %s", job_id, exc)
```

**Inconsistencies:**

```python
# api.py:811-812
logger = logging.getLogger(__name__)
logger.warning("Failed to write clips cache: %s", exc)
# ✗ Logger created inline instead of at module level

# api.py:879-880
logger = logging.getLogger(__name__)
logger.error("Failed to regenerate clip metadata: %s", exc)
# ✗ Same issue
```

**Standard:**

```python
# MODULE-LEVEL LOGGER (top of file)
import logging

logger = logging.getLogger(__name__)

# LOG LEVELS
logger.debug("Detailed info for debugging")      # Development
logger.info("Normal operational message")        # Production baseline
logger.warning("Unexpected but handled issue")   # Needs attention
logger.error("Error occurred but handled")       # Action may be needed
logger.critical("Severe error requiring action") # Immediate action needed
logger.exception("Error with traceback")         # In except blocks

# STRUCTURED LOGGING (for production)
import json

class StructuredFormatter(logging.Formatter):
    def format(self, record):
        log_entry = {
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
        }
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_entry)

# Configure in main.py or on startup
handler = logging.StreamHandler()
handler.setFormatter(StructuredFormatter())
logging.getLogger("momiji").addHandler(handler)
```

### 5.2 Frontend Logging

**Current State:**

Minimal logging in frontend code.

**Standard:**

```typescript
// frontend/src/utils/logger.ts

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private level: LogLevel = 'info';
  
  setLevel(level: LogLevel) {
    this.level = level;
  }
  
  private log(level: LogLevel, message: string, ...args: unknown[]) {
    const levels = ['debug', 'info', 'warn', 'error'] as const;
    if (levels.indexOf(level) < levels.indexOf(this.level)) return;
    
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
    switch (level) {
      case 'debug':
        console.debug(prefix, message, ...args);
        break;
      case 'info':
        console.info(prefix, message, ...args);
        break;
      case 'warn':
        console.warn(prefix, message, ...args);
        break;
      case 'error':
        console.error(prefix, message, ...args);
        break;
    }
  }
  
  debug(message: string, ...args: unknown[]) {
    this.log('debug', message, ...args);
  }
  
  info(message: string, ...args: unknown[]) {
    this.log('info', message, ...args);
  }
  
  warn(message: string, ...args: unknown[]) {
    this.log('warn', message, ...args);
  }
  
  error(message: string, error?: Error, ...args: unknown[]) {
    this.log('error', message, error, ...args);
  }
}

export const logger = new Logger();

// Usage in components
// frontend/src/stores/authStore.ts
import { logger } from '../utils/logger';

login: async (email: string, password: string) => {
  logger.debug('Attempting login for', email);
  try {
    const res = await fetch('/api/auth/login', { ... });
    logger.info('Login successful for', email);
  } catch (err) {
    logger.error('Login failed', err as Error, email);
    throw err;
  }
}
```

---

## 6. Code Organization

### 6.1 Python Module Structure

**Standard:**

```python
# Module template
"""
Module name — One-line description.

Longer description if needed.
"""

# Standard library imports (alphabetical)
import asyncio
import json
import os
from typing import Optional

# Third-party imports (alphabetical)
from fastapi import FastAPI, HTTPException
from sqlalchemy import select

# Local imports (alphabetical)
from db import User, get_session
from auth import get_current_user

# Constants
DEFAULT_VALUE = "default"
MAX_SIZE = 100

# Helper functions (private first, then public)
def _internal_helper(data: dict) -> str:
    """Internal helper."""

def public_function(value: str) -> str:
    """Public function."""

# Classes (alphabetical or by dependency)
class BaseClass:
    """Base class."""

class DerivedClass(BaseClass):
    """Derived class."""

# FastAPI routes (grouped by resource)
@app.get("/api/resource")
async def get_resource():
    """Get resource."""

@app.post("/api/resource")
async def create_resource():
    """Create resource."""
```

### 6.2 TypeScript Module Structure

**Standard:**

```typescript
// Module template
/**
 * Module name — One-line description.
 */

// Standard library imports
import { useState, useEffect } from 'react';

// Third-party imports
import { create } from 'zustand';

// Local imports (relative, then absolute)
import { ApiError } from '../utils/api';
import { logger } from '../utils/logger';
import type { User } from '../types';

// Constants
const DEFAULT_TIMEOUT = 5000;

// Types (interfaces, then type aliases)
interface ComponentProps {
  value: string;
}

type State = 'idle' | 'loading' | 'success' | 'error';

// Helper functions
function formatValue(value: string): string {
  return value.trim();
}

// Components (exported)
export function MyComponent({ value }: ComponentProps) {
  // Hooks first
  const [state, setState] = useState<State>('idle');
  
  // Event handlers
  const handleClick = () => {
    setState('loading');
  };
  
  // Effects
  useEffect(() => {
    // Side effect
  }, []);
  
  // Render
  return <div>{value}</div>;
}

// Exports (prefer named exports)
export { MyComponent };
```

---

## 7. Checklist for Code Reviews

### Python Review Checklist

- [ ] Type hints on all function parameters and returns
- [ ] Docstrings with Args, Returns, Raises sections
- [ ] Logger at module level (not inline)
- [ ] Specific exception handling (not bare `except Exception`)
- [ ] HTTPException with appropriate status codes
- [ ] Constants in UPPER_CASE at module level
- [ ] Private helpers prefixed with underscore
- [ ] No magic numbers (use named constants)

### TypeScript Review Checklist

- [ ] Interfaces/types for all data structures
- [ ] No `any` types (use `unknown` if needed)
- [ ] JSDoc for public functions
- [ ] Error handling with custom error classes
- [ ] camelCase for variables/functions
- [ ] PascalCase for components/interfaces
- [ ] Event handlers prefixed with `handle`
- [ ] Hooks prefixed with `use`

---

## Summary

| Area | Current State | Target | Priority |
|------|---------------|--------|----------|
| Naming | Mostly consistent | Fully consistent | LOW |
| Type hints | Good in models, inconsistent in API | 100% coverage | MEDIUM |
| Documentation | Sparse docstrings | Google-style docstrings | MEDIUM |
| Error handling | Mixed patterns | Standardized patterns | HIGH |
| Logging | Inconsistent logger creation | Module-level loggers | MEDIUM |
| Code organization | Reasonable | Standardized structure | LOW |

---

## Next Steps

1. **Add type hints to `api.py`** - Focus on public functions
2. **Standardize error handling** - Create custom exception classes
3. **Add module-level loggers** - Replace inline logger creation
4. **Document public APIs** - Add docstrings to all endpoints
5. **Create TypeScript logger utility** - For consistent frontend logging
