# DRY Analysis - Code Duplication & Refactoring Opportunities

**Project:** Momiji Clipper  
**Date:** 2026-04-15  
**Status:** In Progress (Interruptible)

---

## Executive Summary

Identified **12 duplication hotspots** across the codebase with recommended refactoring strategies. Priority focuses on OAuth provider implementations and API endpoint patterns.

| Area | Duplication Level | Priority |
|------|-------------------|----------|
| OAuth providers | HIGH | Critical (security implications) |
| Platform adapters | MEDIUM | High |
| API endpoint patterns | MEDIUM | Medium |
| Database model patterns | LOW | Low |
| Frontend components | MEDIUM | Medium |

---

## 1. OAuth Provider Implementations (HIGH PRIORITY)

### Current State

All 5 OAuth providers implement nearly identical patterns:

| File | Lines | Pattern |
|------|-------|---------|
| `oauth/youtube.py` | 28-86 | `build_*_auth_url()`, `exchange_*_code()` |
| `oauth/twitch.py` | 16-95 | `build_*_auth_url()`, `exchange_*_code()`, `refresh_*_token()` |
| `oauth/tiktok.py` | 14-56 | `build_*_auth_url()`, `exchange_*_code()` |
| `oauth/instagram.py` | 16-103 | `build_*_auth_url()`, `exchange_*_code()` |
| `oauth/google.py` | 18-86 | `build_*_auth_url()`, `exchange_*_code()` |

### Duplication Analysis

**Common Pattern (100% overlap):**
```python
# Every provider has this:
def build_{provider}_auth_url(state: str) -> str:
    from urllib.parse import urlencode
    params = {
        "client_id": {PROVIDER}_CLIENT_ID,
        "redirect_uri": {PROVIDER}_REDIRECT_URI,
        "response_type": "code",
        "scope": {PROVIDER}_SCOPE,
        "state": state,
    }
    return "{AUTH_URL}?" + urlencode(params)

async def exchange_{provider}_code(code: str) -> tuple:
    import httpx
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "{TOKEN_ENDPOINT}",
            data={
                "client_id": {PROVIDER}_CLIENT_ID,
                "client_secret": {PROVIDER}_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": {PROVIDER}_REDIRECT_URI,
            },
        )
        # ... parse response, return tokens
```

### Security Impact

This duplication led to **missing PKCE in ALL providers** - a CRITICAL security vulnerability. A single base class would ensure:
- PKCE is implemented once, correctly
- Security updates propagate to all providers
- Consistent error handling

### Recommended Refactor

```python
# oauth/base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
import hashlib
import secrets
from urllib.parse import urlencode

@dataclass
class OAuthConfig:
    auth_url: str
    token_url: str
    client_id_env: str
    client_secret_env: str
    redirect_uri_env: str
    default_scopes: list[str]
    pkce_required: bool = True  # RFC 9700 mandate

@dataclass
class OAuthTokens:
    access_token: str
    refresh_token: Optional[str]
    expires_at: Optional[float]
    provider_account_id: str

class OAuthBase(ABC):
    def __init__(self, config: OAuthConfig):
        self.config = config
        self.client_id = os.environ.get(config.client_id_env)
        self.client_secret = os.environ.get(config.client_secret_env)
        self.redirect_uri = os.environ.get(config.redirect_uri_env)
    
    def generate_pkce_pair(self) -> tuple[str, str]:
        """Generate PKCE code verifier and challenge."""
        code_verifier = secrets.token_urlsafe(32)
        code_challenge = hashlib.sha256(code_verifier.encode()).base64url()
        return code_verifier, code_challenge
    
    def build_auth_url(self, state: str, scopes: Optional[list[str]] = None) -> str:
        """Build OAuth authorization URL with PKCE."""
        scopes = scopes or self.config.default_scopes
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": " ".join(scopes),
            "state": state,
        }
        
        # Add PKCE if required (RFC 9700 mandate)
        if self.config.pkce_required:
            code_verifier, code_challenge = self.generate_pkce_pair()
            # Store verifier in session for callback validation
            session["oauth_code_verifier"] = code_verifier
            params["code_challenge"] = code_challenge
            params["code_challenge_method"] = "S256"
        
        return f"{self.config.auth_url}?" + urlencode(params)
    
    @abstractmethod
    async def exchange_code(self, code: str) -> OAuthTokens:
        """Exchange authorization code for tokens."""
        pass
    
    async def _post_token_request(self, data: dict) -> dict:
        """Common token exchange logic."""
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.post(self.config.token_url, data=data)
            resp.raise_for_status()
            return resp.json()

# Provider implementations become trivial
class YouTubeOAuth(OAuthBase):
    def __init__(self):
        super().__init__(OAuthConfig(
            auth_url="https://accounts.google.com/o/oauth2/v2/auth",
            token_url="https://oauth2.googleapis.com/token",
            client_id_env="GOOGLE_OAUTH_CLIENT_ID",
            client_secret_env="GOOGLE_OAUTH_CLIENT_SECRET",
            redirect_uri_env="GOOGLE_OAUTH_REDIRECT_URI",
            default_scopes=["https://www.googleapis.com/auth/youtube.upload"],
        ))
    
    async def exchange_code(self, code: str) -> OAuthTokens:
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": self.redirect_uri,
            "code_verifier": session.pop("oauth_code_verifier"),  # PKCE
        }
        tokens = await self._post_token_request(data)
        # Fetch channel ID, return OAuthTokens...
```

### Effort Estimate
- **Initial refactor:** 4-6 hours
- **Testing:** 2-3 hours
- **Security benefit:** Eliminates entire class of vulnerabilities
- **Maintenance:** Future providers take 30 min instead of 4 hours

---

## 2. Platform Adapter Pattern (MEDIUM PRIORITY)

### Current State

`platforms/base.py` already has a good abstract base class, but implementations duplicate token refresh logic:

| File | Token Refresh Pattern |
|------|----------------------|
| `platforms/youtube.py:88-106` | Google credentials rebuild |
| `platforms/tiktok.py:98-121` | HTTP POST to token endpoint |
| `platforms/instagram.py:94-117` | Facebook token exchange |

### Duplication Analysis

All adapters:
1. Check if refresh_token exists
2. Make HTTP request to provider's token endpoint
3. Parse response for new access_token
4. Optionally update refresh_token and expires_at

### Recommended Refactor

```python
# platforms/base.py - Add to PlatformAdapter
class PlatformAdapter(ABC):
    # ... existing code ...
    
    def _get_token_envs(self) -> tuple[str, str]:
        """Return env var names for client credentials."""
        raise NotImplementedError
    
    async def _refresh_oauth_token(self, refresh_token: str) -> dict[str, Any]:
        """Common OAuth2 token refresh logic."""
        import httpx
        client_id_env, client_secret_env = self._get_token_envs()
        
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                self._get_token_url(),  # Abstract method
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": os.environ.get(client_id_env),
                    "client_secret": os.environ.get(client_secret_env),
                },
            )
            resp.raise_for_status()
            data = resp.json()
        
        return {
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token"),
            "expires_at": time.time() + data.get("expires_in", 0),
        }
```

### Effort Estimate
- **Refactor:** 2-3 hours
- **Testing:** 1-2 hours per platform

---

## 3. API Endpoint Patterns (MEDIUM PRIORITY)

### Current State

api.py has 20+ endpoints with duplicated patterns:

#### Path Validation Pattern (duplicated 3x)
```python
# api.py:435-444, 459-469
if video.startswith("/workspace/"):
    video = os.path.join(WORKSPACE, video.removeprefix("/workspace/"))
try:
    video_abs = os.path.abspath(video)
    workspace_abs = os.path.abspath(WORKSPACE)
    if not video_abs.startswith(workspace_abs + os.sep):
        raise HTTPException(status_code=400, detail="Video path is outside workspace.")
except Exception:
    raise HTTPException(status_code=400, detail="Invalid video path.")
```

#### Cache File Pattern (duplicated 4x)
```python
# api.py:337-343, 419-424, 708-710, 764-768
stem = os.path.splitext(os.path.basename(path))[0]
cache_path = os.path.join(WORKSPACE, f"{stem}_clips.json")
if not os.path.exists(cache_path):
    raise HTTPException(status_code=404, detail="No cached clips found.")
with open(cache_path, "r", encoding="utf-8") as f:
    return json.load(f)
```

#### Clip Key Parsing (duplicated 3x)
```python
# api.py:696-705, 731, 764
def _parse_clip_key(encoded: str) -> tuple[str, int]:
    parts = encoded.rsplit("___", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="Invalid clip_key format.")
    try:
        index = int(parts[1])
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid clip index.")
    return parts[0], index
```

### Recommended Refactor

```python
# api.py - Add utility functions at top

def _validate_workspace_path(path: str) -> str:
    """Validate and resolve a workspace-relative path."""
    if path.startswith("/workspace/"):
        path = os.path.join(WORKSPACE, path.removeprefix("/workspace/"))
    
    try:
        abs_path = os.path.abspath(path)
        workspace_abs = os.path.abspath(WORKSPACE)
        if not abs_path.startswith(workspace_abs + os.sep):
            raise HTTPException(400, "Path outside workspace")
        return abs_path
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "Invalid path")

def _get_cache_path(source_path: str, suffix: str = "_transcript.json") -> str:
    """Get cache file path for a source file."""
    stem = os.path.splitext(os.path.basename(source_path))[0]
    return os.path.join(WORKSPACE, f"{stem}{suffix}")

async def _read_cache_json(cache_path: str, not_found_detail: str = "Cache not found"):
    """Read and parse a cache JSON file."""
    if not os.path.exists(cache_path):
        raise HTTPException(404, not_found_detail)
    with open(cache_path, "r", encoding="utf-8") as f:
        return json.load(f)
```

### Effort Estimate
- **Refactor:** 1-2 hours
- **Testing:** 1 hour

---

## 4. Database Model Patterns (LOW PRIORITY)

### Current State

All models use identical column patterns:

```python
# Every model has:
id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uuid.uuid4().hex)
created_at: Mapped[float] = mapped_column(Float, default=func.now())
updated_at: Mapped[float] = mapped_column(Float, default=func.now(), onupdate=func.now())
```

### Recommended Refactor

```python
# db.py - Add mixin classes

class TimestampMixin:
    """Add created_at and updated_at timestamps."""
    created_at: Mapped[float] = mapped_column(
        Float, default=func.now()
    )
    updated_at: Mapped[float] = mapped_column(
        Float, default=func.now(), onupdate=func.now()
    )

class PrimaryKeyMixin:
    """Add UUID primary key."""
    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: uuid.uuid4().hex
    )

# Usage:
class User(Base, PrimaryKeyMixin, TimestampMixin):
    __tablename__ = "users"
    # Only define business logic columns
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    # ...
```

### Effort Estimate
- **Refactor:** 1 hour
- **Testing:** 30 min (no logic changes)

---

## 5. Frontend Component Patterns (MEDIUM PRIORITY)

### Current State

Similar patterns across UI components:

#### Button Variants (duplicated 4x)
```typescript
// frontend/src/components/ui/Button.tsx
// Multiple components define similar variant logic
const variants = {
  primary: "bg-blue-600 hover:bg-blue-700",
  secondary: "bg-gray-600 hover:bg-gray-700",
  // ...
}
```

#### Modal Patterns (duplicated 3x)
```typescript
// Multiple components have similar modal state management
const [isOpen, setIsOpen] = useState(false)
// Similar ARIA attributes, focus trapping
```

### Recommended Refactor

Create reusable component library with consistent patterns (similar to shadcn/ui approach).

### Effort Estimate
- **Refactor:** 4-6 hours
- **Benefit:** Consistent UI, easier maintenance

---

## Summary by Priority

| Priority | Area | Effort | Benefit |
|----------|------|--------|---------|
| P0 | OAuth base class | 6-9 hours | Eliminates security vulnerabilities |
| P1 | Platform adapter refresh | 3-5 hours | Reduces token refresh bugs |
| P2 | API utility functions | 2-3 hours | Cleaner code, fewer bugs |
| P3 | Database mixins | 1.5 hours | Slightly cleaner models |
| P3 | Frontend component library | 4-6 hours | Consistent UI |

---

## Next Steps

1. **Implement OAuth base class** - Highest security impact
2. **Add PKCE to base class** - RFC 9700 compliance
3. **Refactor platform adapters** - Reduce token refresh duplication
4. **Extract API utilities** - Clean up endpoint handlers
5. **Consider database mixins** - Nice-to-have

**Note:** Security fixes (PKCE, JWT cookies) take priority over DRY refactoring.
