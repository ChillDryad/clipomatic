# Performance Opportunities

**Project:** Momiji Clipper  
**Date:** 2026-04-15  
**Status:** In Progress (Interruptible)

---

## Executive Summary

Identified **8 performance improvement opportunities** across database queries, caching, and frontend loading patterns.

| Category | Opportunity | Impact | Effort |
|----------|-------------|--------|--------|
| Database | N+1 query fixes | HIGH | LOW |
| Database | Index additions | MEDIUM | LOW |
| Caching | Transcript/clip cache optimization | HIGH | LOW |
| Frontend | Lazy loading video projects | MEDIUM | MEDIUM |
| Frontend | Virtualized clip lists | MEDIUM | MEDIUM |
| Backend | Batch operations | LOW | MEDIUM |
| Backend | Async optimization | LOW | LOW |
| Infrastructure | CDN for static assets | LOW | LOW |

---

## 1. Database Query Optimization

### 1.1 N+1 Query Issues

**Current State:**

`db.py` already uses `lazy="selectin"` for most relationships:
```python
oauth_accounts: Mapped[list["UserOAuthAccount"]] = relationship(
    back_populates="user", cascade="all, delete-orphan", lazy="selectin"
)
```

**Potential Issues:**

Check these query patterns in `api.py`:

```python
# Pattern to audit - may cause N+1:
async with get_session() as session:
    result = await session.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    # Accessing user.oauth_accounts here triggers separate query
    for account in user.oauth_accounts:  # N+1 if lazy!="selectin"
        # ...
```

**Recommendation:**
- Audit all endpoints that access relationships
- Use `joinedload()` or `selectinload()` explicitly in queries:

```python
from sqlalchemy.orm import selectinload

result = await session.execute(
    select(User)
    .options(selectinload(User.oauth_accounts))
    .where(User.id == user_id)
)
```

**Impact:** Reduces database round-trips from N+1 to 2 queries

---

### 1.2 Missing Database Indexes

**Current Indexes:**
```python
# db.py
email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)  # ✓
```

**Missing Indexes:**

| Table | Column | Reason | Priority |
|-------|--------|--------|----------|
| `user_oauth_accounts` | `provider_account_id` | OAuth lookups | HIGH |
| `user_oauth_accounts` | `provider` | Provider filtering | MEDIUM |
| `video_projects` | `owner_id` | User's projects | HIGH |
| `video_projects` | `team_id` | Team projects | MEDIUM |
| `generated_clips` | `project_id` | Project clips | HIGH |
| `team_members` | `user_id` | User's teams | MEDIUM |
| `team_invites` | `invitee_email` | Invite lookups | LOW |
| `post_jobs` | `status` | Job scheduling | MEDIUM |
| `post_jobs` | `schedule_at` | Upcoming jobs | HIGH |

**Recommended Schema Updates:**

```python
# db.py - Add __table_args__ to models

class UserOAuthAccount(Base):
    # ... columns ...
    
    __table_args__ = (
        UniqueConstraint('provider', 'provider_account_id', name='unique_provider_account'),
        Index('ix_user_oauth_provider', 'provider'),
        Index('ix_user_oauth_account_id', 'provider_account_id'),
    )

class VideoProject(Base):
    # ... columns ...
    
    __table_args__ = (
        Index('ix_video_projects_owner', 'owner_id'),
        Index('ix_video_projects_team', 'team_id'),
        Index('ix_video_projects_status', 'status'),
    )

class GeneratedClip(Base):
    # ... columns ...
    
    __table_args__ = (
        Index('ix_generated_clips_project', 'project_id'),
    )

class PostJob(Base):
    # ... columns ...
    
    __table_args__ = (
        Index('ix_post_jobs_status', 'status'),
        Index('ix_post_jobs_schedule', 'schedule_at'),
        Index('ix_post_jobs_platform', 'platform'),
    )
```

**Migration Script:**

```python
# migrations/add_indexes.py
from sqlalchemy import text

async def upgrade():
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_user_oauth_provider ON user_oauth_accounts(provider)"))
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_user_oauth_account_id ON user_oauth_accounts(provider_account_id)"))
    # ... etc
```

**Impact:** 10-100x faster lookups on indexed columns

---

## 2. Caching Strategies

### 2.1 Transcript Cache Optimization

**Current State:**

```python
# api.py:335-343
@app.get("/api/transcribe/cached")
async def transcribe_cached(path: str = Query(...)):
    stem = os.path.splitext(os.path.basename(path))[0]
    transcript_path = os.path.join(WORKSPACE, f"{stem}_transcript.json")
    if not os.path.exists(transcript_path):
        raise HTTPException(status_code=404, detail="No cached transcript found.")
    with open(transcript_path, "r", encoding="utf-8") as f:
        return json.load(f)
```

**Issues:**
1. No cache invalidation strategy
2. No size limits
3. No LRU eviction
4. File I/O on every request

**Recommended Improvements:**

```python
# Add in-memory LRU cache for hot transcripts
from functools import lru_cache
import asyncio

# In-memory cache with 100-entry limit
@lru_cache(maxsize=100)
def _get_cached_transcript(path: str) -> dict | None:
    """Get transcript from LRU cache."""
    stem = os.path.splitext(os.path.basename(path))[0]
    transcript_path = os.path.join(WORKSPACE, f"{stem}_transcript.json")
    if not os.path.exists(transcript_path):
        return None
    with open(transcript_path, "r", encoding="utf-8") as f:
        return json.load(f)

# Async wrapper for FastAPI
async def get_cached_transcript(path: str) -> dict | None:
    return await asyncio.to_thread(_get_cached_transcript, path)

# Invalidate cache when transcript is updated
def invalidate_transcript_cache(path: str):
    _get_cached_transcript.cache_clear()  # Or use more granular invalidation
```

**Disk Cache Management:**

```python
# Periodic cleanup of old transcripts
import time

def cleanup_old_transcripts(max_age_days: int = 30):
    """Remove transcript files older than max_age_days."""
    cutoff = time.time() - (max_age_days * 24 * 3600)
    for filename in os.listdir(WORKSPACE):
        if filename.endswith("_transcript.json"):
            path = os.path.join(WORKSPACE, filename)
            if os.path.getmtime(path) < cutoff:
                os.remove(path)
                logger.info("Cleaned up old transcript: %s", filename)
```

**Impact:** 
- Hot cache hits: <1ms (vs 10-50ms for file I/O)
- Reduced disk I/O pressure

---

### 2.2 Clip Cache Optimization

**Current State:**

Similar to transcript cache - file-based with no memory cache.

**Recommended:**

```python
# Same LRU cache pattern as transcripts
@lru_cache(maxsize=200)  # Clips are smaller, cache more
def _get_cached_clips(source_path: str) -> list | None:
    stem = os.path.splitext(os.path.basename(source_path))[0]
    cache_path = os.path.join(WORKSPACE, f"{stem}_clips.json")
    if not os.path.exists(cache_path):
        return None
    with open(cache_path, "r", encoding="utf-8") as f:
        return json.load(f)
```

---

### 2.3 Frame Cache Strategy

**Current State:**

```python
# api.py:431-453
@app.get("/api/frame")
async def get_frame(video: str, t: float):
    # Extracts frame on every request
    frame_path = await asyncio.to_thread(extract_frame, video, t, frames_dir)
    return FileResponse(frame_path)
```

**Issue:** Same frame extracted multiple times if user scrubs timeline.

**Recommended:**

```python
# Hash-based frame caching
import hashlib

def _get_frame_cache_key(video_path: str, timestamp: float) -> str:
    """Generate cache key for a frame."""
    # Round timestamp to nearest 0.5s to reduce cache entries
    rounded_ts = round(timestamp * 2) / 2
    key_input = f"{video_path}:{rounded_ts}"
    return hashlib.md5(key_input.encode()).hexdigest()

@lru_cache(maxsize=500)  # Cache 500 frames (~50MB at 100KB/frame)
def _get_cached_frame(video_path: str, timestamp: float, frames_dir: str) -> str:
    """Get or create cached frame."""
    return extract_frame(video_path, timestamp, frames_dir)
```

**Impact:** Instant frame display for previously-scrubbed timestamps

---

## 3. Frontend Loading Optimization

### 3.1 Lazy Loading Video Projects

**Current State:**

Check `DashboardPage.tsx` and `VideoProjectPage.tsx` for loading patterns.

**Recommended Pattern:**

```typescript
// frontend/src/pages/DashboardPage.tsx
import { useInfiniteQuery } from '@tanstack/react-query'

// Paginated project loading
export function DashboardPage() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['projects'],
    queryFn: async ({ pageParam = 0 }) => {
      const res = await fetch(`/api/projects?limit=20&offset=${pageParam}`)
      return res.json()
    },
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === 20 ? allPages.length * 20 : undefined
    },
  })

  return (
    <InfiniteScroll
      dataLength={data?.pages.flat().length ?? 0}
      next={fetchNextPage}
      hasMore={!!hasNextPage}
      loader={<p>Loading more projects...</p>}
    >
      {data?.pages.flat().map(project => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </InfiniteScroll>
  )
}
```

**Backend Support:**

```python
# api.py
@app.get("/api/projects")
async def list_projects(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    team_id: str = None,
    user: User = Depends(get_current_user)
):
    query = select(VideoProject).where(VideoProject.owner_id == user.id)
    if team_id:
        query = query.where(VideoProject.team_id == team_id)
    query = query.offset(offset).limit(limit).order_by(VideoProject.created_at.desc())
    result = await session.execute(query)
    return result.scalars().all()
```

**Impact:** Faster initial page load, reduced memory usage

---

### 3.2 Virtualized Clip Lists

**For VideoProjectPage with many clips:**

```typescript
// Use react-virtuoso or @tanstack/react-virtual
import { useVirtualizer } from '@tanstack/react-virtual'

export function ClipList({ clips }: { clips: Clip[] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  
  const virtualizer = useVirtualizer({
    count: clips.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200, // Estimated height per clip
    overscan: 5,
  })

  return (
    <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map(virtualRow => (
          <ClipCard
            key={virtualRow.key}
            clip={clips[virtualRow.index]}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          />
        ))}
      </div>
    </div>
  )
}
```

**Impact:** Smooth scrolling with 1000+ clips

---

## 4. Batch Operations

### 4.1 Bulk Clip Creation

**Current State:**

Check if clips are created one-at-a-time or in batches.

**Recommended:**

```python
# api.py - Batch clip creation
@app.post("/api/projects/{project_id}/clips/batch")
async def create_clips_batch(
    project_id: str,
    clips: list[ClipCreateRequest],
    user: User = Depends(get_current_user)
):
    """Create multiple clips in a single transaction."""
    async with get_session() as session:
        # Verify project ownership
        project = await session.get(VideoProject, project_id)
        if not project or project.owner_id != user.id:
            raise HTTPException(403, "Not authorized")
        
        # Bulk insert
        db_clips = [
            GeneratedClip(
                project_id=project_id,
                index=i,
                title=clip.title,
                start_time=clip.start,
                end_time=clip.end,
                reason=clip.reason,
                virality_score=clip.virality_score,
                brand_alignment=json.dumps(clip.brand_alignment),
                hashtags=json.dumps(clip.hashtags),
            )
            for i, clip in enumerate(clips)
        ]
        session.add_all(db_clips)
        await session.commit()
        
        # Refresh to get IDs
        for clip in db_clips:
            await session.refresh(clip)
        
        return {"clips": db_clips}
```

**Impact:** Single transaction vs N transactions

---

## 5. Async Optimization

### 5.1 File I/O Already Optimized

Good news: Codebase already uses `asyncio.to_thread()` for blocking operations:

```python
# api.py:101
result = await asyncio.to_thread(fn, *args, progress_callback=cb, **kwargs)
```

### 5.2 Potential Improvement: Connection Pooling

**Current State:**

```python
# db.py
_async_session_factory = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)
```

**Recommended:**

```python
# Add pool configuration
_engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=20,           # Connections to keep in pool
    max_overflow=40,        # Extra connections under load
    pool_pre_ping=True,     # Verify connection before use
    pool_recycle=3600,      # Recycle connections after 1 hour
)
```

**Impact:** Better connection management under load

---

## 6. Infrastructure Optimizations

### 6.1 Static Asset Caching

**Current State:**

```python
# api.py:73
app.mount("/workspace", StaticFiles(directory=WORKSPACE), name="workspace")
```

**Recommended:**

```python
# Add cache headers for static files
from fastapi.responses import FileResponse
from starlette.staticfiles import StaticFiles

class CachedStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "public, max-age=31536000"  # 1 year
        return response

app.mount("/workspace", CachedStaticFiles(directory=WORKSPACE), name="workspace")
```

**Impact:** Browser caching for rendered clips, frames

---

## Summary by Priority

| Priority | Optimization | Impact | Effort |
|----------|-------------|--------|--------|
| P0 | Add database indexes | HIGH | LOW |
| P1 | LRU cache for transcripts/clips | HIGH | LOW |
| P2 | Frame cache with rounding | MEDIUM | LOW |
| P2 | Infinite scroll for projects | MEDIUM | MEDIUM |
| P3 | Batch clip operations | LOW | MEDIUM |
| P3 | Connection pool tuning | LOW | LOW |
| P3 | Static file caching | LOW | LOW |

---

## Benchmarking Recommendations

Before implementing:

```python
# Add simple benchmarking middleware
import time
import logging

logger = logging.getLogger("performance")

@app.middleware("http")
async def benchmark_requests(request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration = time.perf_counter() - start
    
    if duration > 1.0:  # Log slow requests
        logger.warning(
            "Slow request: %s %s took %.2fs",
            request.method, request.url.path, duration
        )
    
    return response
```

This helps identify actual bottlenecks vs assumed ones.
