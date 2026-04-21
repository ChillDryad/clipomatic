# Frontend/Backend Refactor Plan

**Date:** 2026-04-20
**Goal:** Address remaining findings from SECURITY_FINDINGS.md, DRY_ANALYSIS.md, PERFORMANCE_OPPORTUNITIES.md, and CODE_LEGIBILITY.md

---

## Backend Tasks (backend-engineer agent)

### P0 - Security Critical

1. **JWT Security Hardening** (`auth.py`) ✅ COMPLETED
   - [x] Switch from HS256 to RS256 (asymmetric keys)
   - [x] Reduce access token expiry from 24h to 15 minutes
   - [x] Add JWT claims validation (issuer, audience, required claims)
   - Files: `backend/auth.py`

2. **OAuth State Parameter Validation** (`api.py`, `oauth/*.py`) ✅ COMPLETED
   - [x] Implement state parameter storage/validation for all providers
   - [x] Add 10-minute expiry on pending states
   - [x] Validate provider matching on callback
   - [x] Add PKCE code_verifier tracking
   - Files: `backend/api.py`, `backend/oauth/*.py`

3. **Refresh Token Rotation** (`scheduler.py`, `platforms/*.py`) ✅ COMPLETED
   - [x] Implement RFC 9700 token rotation with reuse detection
   - [x] Add `refresh_token_used_at` tracking
   - [x] Add family revocation on reuse detection
   - Files: `backend/db.py`, `backend/scheduler.py`, `backend/platforms/base.py`

4. **File Upload Validation** (`api.py:ingest_upload`) ✅ COMPLETED
   - [x] Add file extension allowlist (.mp4, .mkv, .mov, .avi, .webm)
   - [x] Add MIME type validation (via python-magic)
   - [x] Add file size limits (100MB max)
   - Files: `backend/api.py`

### P1 - Security Hardening

5. **Security Headers Middleware** (`api.py`) ✅ COMPLETED
   - [x] X-Frame-Options: DENY
   - [x] X-Content-Type-Options: nosniff
   - [x] X-XSS-Protection: 1; mode=block
   - [x] Referrer-Policy: strict-origin-when-cross-origin
   - [x] Content-Security-Policy header
   - [x] Permissions-Policy header
   - Files: `backend/api.py`

6. **SQLite Database Location** (`db.py`) ✅ COMPLETED
   - [x] Move default from `./momiji.db` to `./data/momiji.db`
   - [x] Ensure data/*.db in .gitignore
   - Files: `backend/db.py`, `.gitignore`

### P2 - DRY Refactoring

7. **OAuth Base Class** (`oauth/base.py`) ✅ COMPLETED
   - [x] Create abstract base class with shared PKCE logic
   - [x] Consolidate token exchange patterns
   - [x] Provide base for migrating 5 providers
   - Files: `backend/oauth/base.py`

8. **Platform Adapter Token Refresh** (`platforms/base.py`) ✅ COMPLETED
   - [x] Extract common `_refresh_oauth_token()` to base class
   - [x] Implements RFC 9700 rotation with reuse detection
   - Files: `backend/platforms/base.py`

9. **API Utility Functions** (`api.py`) ✅ COMPLETED
   - [x] Extract `_get_cache_path()` helper
   - [x] Extract `_read_cache_json()` helper
   - [x] Extract `_write_cache_json()` helper
   - [x] `_parse_clip_key()` already at module level
   - Files: `backend/api.py`

### P3 - Performance

10. **Database Indexes** (`db.py`) ✅ COMPLETED
    - [x] Add indexes on: video_projects.owner_id, video_projects.team_id
    - [x] Add indexes on: generated_clips.project_id
    - [x] Add indexes on: post_jobs.status, post_jobs.schedule_at, post_jobs.platform
    - Files: `backend/db.py`

11. **LRU Cache Layer** (`api.py`) ✅ COMPLETED
    - [x] Add `@lru_cache` for transcripts (maxsize=100)
    - [x] Add `@lru_cache` for clips (maxsize=200)
    - [x] Add `@lru_cache` for frames with rounded timestamps (maxsize=500)
    - [x] Add cache invalidation helpers
    - Files: `backend/api.py`

12. **Batch Clip Operations** (`api.py`) ✅ COMPLETED
    - [x] Add `/api/projects/{id}/clips/batch` endpoint
    - [x] Use `session.add_all()` for single-transaction inserts
    - Files: `backend/api.py`

13. **Connection Pool Tuning** (`db.py`) ✅ COMPLETED
    - [x] Add pool_size=20, max_overflow=40
    - [x] Add pool_pre_ping=True, pool_recycle=3600
    - Files: `backend/db.py`

14. **Static Asset Caching** (`api.py`) ✅ COMPLETED
    - [x] Create CachedStaticFiles class with Cache-Control headers
    - Files: `backend/api.py`

### P4 - Code Legibility

15. **Module-Level Loggers** (`api.py`) ✅ COMPLETED
    - [x] Move inline `logger = logging.getLogger(__name__)` to module level
    - [x] Add logging to SSE error handlers
    - Files: `backend/api.py`

16. **Type Hints** (`api.py`) ✅ COMPLETED
    - [x] Add type hints to SSE helpers (`_sse_stream`, `_sse_response`)
    - [x] Add type hints to cache helpers
    - [x] Add TypedDict for transcript/clip structures
    - Files: `backend/api.py`

17. **Error Handling Patterns** (`api.py`) ✅ COMPLETED
    - [x] Add logging to SSE error handlers (was silently swallowed)
    - [x] Specific exception handling in OAuth callbacks
    - Files: `backend/api.py`, `backend/scheduler.py`

18. **Docstrings** (`api.py`, pipeline modules) ✅ COMPLETED
    - [x] Add Google-style docstrings to public endpoints
    - [x] Add docstrings to utility functions
    - Files: `backend/api.py`, `backend/db.py`, `backend/auth.py`

---

## Frontend Tasks (frontend-engineer agent)

### P0 - Security Critical

1. **Remove localStorage from Auth Store** (`stores/authStore.ts`)
   - Already done - verify no token in persist state
   - Confirm HttpOnly cookie-only auth
   - Files: `frontend/src/stores/authStore.ts`

### P1 - Security Hardening

2. **Remove localStorage from UI Stores** (`stores/*.ts`)
   - timelineStore: Move to in-memory or sessionStorage
   - selectionStore: Move to in-memory or sessionStorage
   - playbackStore: Move to in-memory or sessionStorage
   - panelStore: Move to in-memory or sessionStorage
   - Files: `frontend/src/stores/timelineStore.ts`, `selectionStore.ts`, `playbackStore.ts`, `panelStore.ts`

### P2 - Performance

3. **Lazy Loading Video Projects** (`pages/DashboardPage.tsx`)
   - Implement @tanstack/react-query infinite query
   - Add pagination to backend endpoint (limit/offset)
   - Add InfiniteScroll component
   - Files: `frontend/src/pages/DashboardPage.tsx`, `frontend/src/api.ts`

4. **Virtualized Clip Lists** (`pages/VideoProjectPage.tsx`)
   - Implement @tanstack/react-virtual for clip rendering
   - Files: `frontend/src/pages/VideoProjectPage.tsx`, `frontend/src/components/`

### P3 - DRY Refactoring

5. **Frontend Component Library** (`components/ui/*.tsx`)
   - Create reusable Button, Modal, Input, Select components
   - Standardize variants (primary, secondary, danger, etc.)
   - Extract common modal patterns (focus trapping, ARIA)
   - Files: `frontend/src/components/ui/*.tsx`

### P4 - Code Legibility

6. **TypeScript Logger Utility** (`utils/logger.ts`)
   - Create Logger class with debug/info/warn/error levels
   - Add timestamp prefixing
   - Use throughout stores and components
   - Files: `frontend/src/utils/logger.ts`

7. **JSDoc Documentation** (all public functions)
   - Add JSDoc to api.ts functions
   - Add JSDoc to store actions
   - Add @example blocks
   - Files: `frontend/src/api.ts`, `frontend/src/stores/*.ts`

8. **Type Safety** (all .ts/.tsx files)
   - Eliminate `any` types (replace with `unknown` + type guards)
   - Add discriminated unions for state machines
   - Files: `frontend/src/**/*.ts`, `frontend/src/**/*.tsx`

---

## Integration Tasks (integration agent)

After frontend and backend agents complete their work:

1. **Verify API Contract** - Ensure frontend api.ts matches backend endpoints
2. **Test Authentication Flow** - Login/logout with HttpOnly cookies
3. **Test OAuth Flows** - All 5 providers with PKCE + state validation
4. **Performance Testing** - Measure cache hit rates, query times
5. **Security Testing** - Verify XSS can't access tokens, CSRF protected
6. **Type Check** - Ensure TypeScript compiles without errors
7. **Run Test Suite** - All unit and integration tests pass

---

## Agent Assignments

| Agent | Specialization | Tasks |
|-------|---------------|-------|
| `backend-engineer` | Python/FastAPI, SQLAlchemy, OAuth | Tasks 1-18 (Backend) |
| `frontend-engineer` | React/TypeScript, Zustand, Tailwind | Tasks 1-8 (Frontend) |
| `integration-engineer` | Full-stack testing, API contracts | All Integration Tasks |

---

## Success Criteria

- [ ] All P0/P1 security items completed
- [ ] No localStorage contains sensitive data
- [ ] All OAuth providers have PKCE + state validation + token rotation
- [ ] JWT uses RS256 with 15-minute expiry
- [ ] Test suite passes (unit + integration)
- [ ] No TypeScript errors
- [ ] Performance benchmarks show improvement (cache hits, query times)
