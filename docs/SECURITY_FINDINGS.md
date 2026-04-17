# Security Vulnerability Assessment

**Project:** Momiji Clipper  
**Date:** 2026-04-15  
**Reviewer:** Claude Code Security Review  
**Severity Scale:** CRITICAL | HIGH | MEDIUM | LOW

---

## Executive Summary

This security review identified **15 vulnerabilities** across the Momiji Clipper codebase:

| Severity | Count | Immediate Action Required |
|----------|-------|---------------------------|
| CRITICAL | 4     | Yes - Before production    |
| HIGH     | 4     | Yes - Before user data     |
| MEDIUM   | 4     | Recommended                |
| LOW      | 3     | Best practices             |

The most severe issues involve **JWT token storage in localStorage** (XSS vulnerability), **missing PKCE in OAuth flows** (authorization code interception), **unencrypted OAuth token storage** (credential exposure), and **weak JWT configuration** (30-day expiry, HS256 algorithm).

---

## CRITICAL Vulnerabilities

### 1. JWT Token Stored in localStorage (XSS Vulnerability)

**Severity:** CRITICAL  
**CWE:** CWE-312 (Concealment of Stored Password)  
**Location:** `frontend/src/stores/authStore.ts:146-153`

**Issue:**
```typescript
persist(
  (set, get) => ({ ... }),
  {
    name: STORAGE_KEY,
    partialize: (state) => ({
      user: state.user,
      token: state.token,  // ← JWT stored in localStorage
      isAuthenticated: state.isAuthenticated,
    }),
  },
)
```

**Risk:** JWT tokens in localStorage are accessible via XSS attacks. Any malicious script injected into the page can exfiltrate tokens via `localStorage.getItem('momiji_auth')` and impersonate users indefinitely (30-day expiry compounds this).

**Impact:** Complete account takeover for any user targeted by XSS.

**Fix:**
```typescript
// frontend/src/stores/authStore.ts
partialize: (state) => ({
  user: state.user,  // Non-sensitive UI state OK
  // token: state.token,  ← REMOVE - auth via HttpOnly cookie
  isAuthenticated: state.isAuthenticated,
}),
```

Backend must set HttpOnly cookies:
```python
# api.py
@app.post("/api/auth/login")
async def login(req: LoginRequest):
    token = create_access_token(user.id, user.email)
    response = JSONResponse({"user": user_data})
    response.set_cookie(
        "access_token",
        token,
        httponly=True,
        secure=True,      # HTTPS only
        samesite="lax",   # CSRF protection
        max_age=900       # 15 minutes
    )
    return response
```

**References:**
- OWASP: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- JWT Security Best Practices: https://ecosire.com/blog/jwt-authentication-best-practices

---

### 2. Weak JWT Configuration

**Severity:** CRITICAL  
**CWE:** CWE-327 (Use of a Broken or Risky Cryptographic Algorithm)  
**Location:** `auth.py:24-26`

**Issue:**
```python
SECRET_KEY = os.environ.get("JWT_SECRET", "change-me-in-production")  # ← Weak default
ALGORITHM = "HS256"  # ← Symmetric algorithm
TOKEN_EXPIRY_DAYS = 30  # ← Far too long
```

**Risks:**
1. Default secret key could be exploited if deployment skips environment configuration
2. HS256 requires same secret on client/server (vs RS256 public/private key pair)
3. 30-day access tokens = 30 days of attacker access if stolen

**Fix:**
```python
# auth.py
SECRET_KEY = os.environ.get("JWT_SECRET")  # No default - fail if not set
if not SECRET_KEY or SECRET_KEY == "change-me-in-production":
    raise RuntimeError("JWT_SECRET must be set in production")

ALGORITHM = "RS256"  # Asymmetric (public/private key)
ACCESS_TOKEN_EXPIRE_MINUTES = 15
REFRESH_TOKEN_EXPIRE_DAYS = 7
```

Add JWT key generation script:
```bash
# Generate RSA key pair
openssl genrsa -out jwt_private.pem 2048
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem
```

**References:**
- RFC 7518 (JSON Web Algorithms)
- JWT Best Practices: https://jwt.app/blog/jwt-best-practices

---

### 3. Missing PKCE in OAuth Flows

**Severity:** CRITICAL  
**CWE:** CWE-306 (Missing Authentication for Critical Function)  
**Locations:** `oauth/youtube.py:17-28`, `oauth/twitch.py:16-25`, `oauth/tiktok.py:14-23`, `oauth/instagram.py:16-25`

**Issue:** None of the OAuth implementations use PKCE (Proof Key for Code Exchange):

```python
# oauth/youtube.py - NO PKCE
params = {
    "client_id": GOOGLE_OAUTH_CLIENT_ID,
    "response_type": "code",
    "scope": YOUTUBE_UPLOAD_SCOPE,
    # Missing: code_challenge, code_challenge_method
}
```

**Risk:** Authorization code interception attacks. Attackers on same network can intercept auth codes and exchange for tokens. This is a **RFC 9700 mandate** for all OAuth 2.0 implementations (Jan 2025).

**Fix (all OAuth providers):**
```python
# oauth/youtube.py
import hashlib
import secrets

def generate_pkce_pair() -> tuple[str, str]:
    """Generate code_verifier and code_challenge."""
    code_verifier = secrets.token_urlsafe(32)
    code_challenge = hashlib.sha256(code_verifier.encode()).base64url()
    return code_verifier, code_challenge

def build_youtube_auth_url(state: str, code_challenge: str) -> str:
    params = {
        "client_id": GOOGLE_OAUTH_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": YOUTUBE_UPLOAD_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",  # ← Required
    }
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
```

Store `code_verifier` in session and include in token exchange:
```python
async def exchange_youtube_code(code: str, code_verifier: str) -> tuple:
    # ...
    data = {
        "code": code,
        "code_verifier": code_verifier,  # ← Required
        # ...
    }
```

**References:**
- RFC 9700 (OAuth 2.0 Security Best Current Practice, Jan 2025)
- RFC 7636 (PKCE)
- https://www.authgear.com/post/oauth2-security-best-practices-pkce-state

---

### 4. OAuth Tokens Stored Unencrypted

**Severity:** CRITICAL  
**CWE:** CWE-311 (Missing Encryption of Sensitive Data)  
**Location:** `db.py:225-226`

**Issue:**
```python
class UserOAuthAccount(Base):
    access_token: Mapped[str] = mapped_column(Text, nullable=False)   # ← Plain text
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)  # ← Plain text
```

**Risk:** Database breach exposes all OAuth tokens. Attackers can:
- Upload videos to users' YouTube channels
- Post to users' TikTok accounts
- Access Twitch account information
- Potentially change account settings

**Fix:**
```python
# db.py
from cryptography.fernet import Fernet

_ENCRYPTION_KEY = os.environ.get("TOKEN_ENCRYPTION_KEY")
if not _ENCRYPTION_KEY:
    raise RuntimeError("TOKEN_ENCRYPTION_KEY must be set")
_encryptor = Fernet(_ENCRYPTION_KEY)

def encrypt_token(value: str) -> str:
    return _encryptor.encrypt(value.encode()).decode()

def decrypt_token(value: str) -> str:
    return _encryptor.decrypt(value.encode()).decode()

# In model usage (via hybrid_property or events):
@event.listens_for(UserOAuthAccount, "before_insert")
@event.listens_for(UserOAuthAccount, "before_update")
def encrypt_tokens(mapper, connection, target):
    if target.access_token:
        target.access_token = encrypt_token(target.access_token)
    if target.refresh_token:
        target.refresh_token = encrypt_token(target.refresh_token)
```

Generate encryption key:
```python
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode())
```

**References:**
- OWASP: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- RFC 9700 Section 5.2 (Token Storage Security)

---

## HIGH Severity

### 5. Path Traversal in File Upload

**Severity:** HIGH  
**CWE:** CWE-22 (Improper Limitation of a Pathname to a Restricted Directory)  
**Location:** `api.py:139-158`

**Issue:**
```python
original_name = file.filename or "upload"
safe_name = f"{uuid.uuid4().hex[:8]}_{os.path.basename(original_name)}"
dest_path = os.path.join(WORKSPACE, safe_name)
```

While `os.path.basename()` prevents most path traversal, there's no validation of:
- File extensions (could upload `.py`, `.sh`, `.exe`)
- MIME type verification
- File size limits

**Risk:** Malicious file upload, potential code execution if server runs uploaded files.

**Fix:**
```python
# api.py
ALLOWED_EXTENSIONS = {".mp4", ".mkv", ".mov", ".avi", ".webm"}
ALLOWED_MIME_TYPES = {"video/mp4", "video/x-matroska", "video/quicktime", "video/x-msvideo", "video/webm"}

@app.post("/api/ingest/upload")
async def ingest_upload(file: UploadFile = File(...)):
    # Validate extension
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Invalid file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}")
    
    # Validate MIME type
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(400, f"Invalid content type: {file.content_type}")
    
    # Validate file size (100MB max)
    MAX_FILE_SIZE = 100 * 1024 * 1024
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "File too large (max 100MB)")
    
    # Safe filename
    safe_name = f"{uuid.uuid4().hex[:8]}_upload{ext}"
    # ...
```

---

### 6. Missing Rate Limiting

**Severity:** HIGH  
**CWE:** CWE-307 (Improper Restriction of Excessive Authentication Attempts)  
**Location:** All API endpoints

**Issue:** No rate limiting on:
- Login/register endpoints (brute force)
- OAuth callbacks (token stuffing)
- File uploads (DoS)
- LLM API calls (cost exhaustion)

**Fix:**
```python
# Install: pip install slowapi
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.post("/api/auth/login")
@limiter.limit("5/minute")
async def login(request: Request, req: LoginRequest):
    # ...

@app.post("/api/auth/register")
@limiter.limit("3/minute")
async def register(request: Request, req: RegisterRequest):
    # ...

@app.post("/api/ingest/upload")
@limiter.limit("10/hour")  # Prevent storage DoS
async def ingest_upload(request: Request, file: UploadFile = File(...)):
    # ...
```

---

### 7. No Password Validation Policy

**Severity:** HIGH  
**CWE:** CWE-521 (Weak Password Requirements)  
**Location:** `api.py` (register endpoint)

**Issue:** No evidence of:
- Minimum length requirements
- Breach database checking (HIBP)
- Common password blocklist

**Fix:**
```python
# api.py
import hashlib
import httpx

COMMON_PASSWORDS = {"password", "123456", "qwerty", "letmein", "admin"}  # Extend this

async def check_password_breach(password: str) -> bool:
    """Check if password appears in HIBP Pwned Passwords database."""
    sha1 = hashlib.sha1(password.encode()).hexdigest().upper()
    prefix, suffix = sha1[:5], sha1[5:]
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"https://api.pwnedpasswords.com/range/{prefix}")
        return suffix in resp.text

def validate_password(password: str, email: str) -> list[str]:
    """Validate password meets requirements. Returns list of errors."""
    errors = []
    
    if len(password) < 12:
        errors.append("Password must be at least 12 characters")
    
    if password.lower() in COMMON_PASSWORDS:
        errors.append("Password is too common")
    
    if email.lower() in password.lower():
        errors.append("Password cannot contain email address")
    
    return errors

@app.post("/api/auth/register")
async def register(req: RegisterRequest):
    errors = validate_password(req.password, req.email)
    if errors:
        raise HTTPException(400, {"password_errors": errors})
    
    if await check_password_breach(req.password):
        raise HTTPException(400, "Password has been exposed in a data breach")
    # ...
```

**References:**
- NIST SP 800-63B (Digital Identity Guidelines)
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

---

### 8. CORS Configuration Issues

**Severity:** HIGH  
**CWE:** CWE-942 (Permissive Cross-domain Policy with Untrusted Domains)  
**Location:** `api.py:50-60`

**Issue:**
```python
_cors_origins = [
    o.strip()
    for o in os.environ.get("CORS_ORIGINS", "http://localhost:7860").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],  # ← Too permissive
    allow_headers=["*"],  # ← Too permissive
)
```

**Risk:** If `CORS_ORIGINS` is misconfigured with wildcard or overly broad domain, attackers can make authenticated requests from malicious sites.

**Fix:**
```python
# api.py
import re

def validate_cors_origin(origin: str) -> bool:
    """Validate CORS origin is a valid URL."""
    pattern = re.compile(r"^https?://[a-zA-Z0-9.-]+(:\d+)?$")
    return bool(pattern.match(origin))

_cors_origins = [
    o.strip()
    for o in os.environ.get("CORS_ORIGINS", "http://localhost:7860").split(",")
    if o.strip() and validate_cors_origin(o.strip())
]

# Validate no wildcards
if any("*" in o for o in _cors_origins):
    raise RuntimeError("CORS_ORIGINS cannot contain wildcards")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],  # Explicit
    allow_headers=["Content-Type", "Authorization"],  # Explicit
    allow_credentials=True,
)
```

---

## MEDIUM Severity

### 9. JWT Missing Claims Validation

**Severity:** MEDIUM  
**CWE:** CWE-347 (Improper Verification of Cryptographic Signature)  
**Location:** `auth.py:61-68`

**Issue:**
```python
def decode_access_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    # Missing: issuer, audience, required claims
```

**Fix:**
```python
def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            PUBLIC_KEY if ALGORITHM == "RS256" else SECRET_KEY,
            algorithms=[ALGORITHM],
            issuer="https://api.momiji.local",
            audience="https://app.momiji.local",
            options={
                "require": ["exp", "iat", "sub", "jti"],
                "verify_signature": True,
            }
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")
```

---

### 10. No Refresh Token Rotation

**Severity:** MEDIUM  
**CWE:** CWE-384 (Session Fixation)  
**Location:** `scheduler.py:122-136`, OAuth handlers

**Issue:** Refresh tokens are reused without rotation per RFC 9700 requirements.

**Fix:**
```python
# scheduler.py
async def refresh_token_with_rotation(token_row: OAuthToken) -> dict:
    """Refresh token with rotation and reuse detection."""
    # Check if this refresh token was already used
    if token_row.used_at is not None:
        # Reuse detected - revoke entire token family
        await revoke_token_family(token_row.family_id)
        raise SecurityError("Token reuse detected")
    
    # Get new tokens from provider
    new_tokens = await adapter.refresh_token(token_row)
    
    # Mark old token as used
    token_row.used_at = time.time()
    
    # Update with new tokens
    token_row.access_token = new_tokens["access_token"]
    token_row.refresh_token = new_tokens.get("refresh_token")
    token_row.expires_at = new_tokens.get("expires_at")
    token_row.family_id = new_tokens.get("family_id", token_row.family_id)
    
    return new_tokens
```

**References:**
- RFC 9700 Section 4.13 (Refresh Token Rotation)
- https://dev.auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation

---

### 11. OAuth State Parameter Validation

**Severity:** MEDIUM  
**CWE:** CWE-352 (Cross-Site Request Forgery)  
**Location:** `api.py:206-274`

**Issue:** Twitch OAuth has state validation, but verify all providers implement this:
- YouTube (`/api/oauth/youtube/authorize`)
- TikTok (`/api/oauth/tiktok/authorize`)
- Instagram (`/api/oauth/instagram/authorize`)
- Google (`/api/auth/google/authorize`)

**Fix Pattern (apply to all providers):**
```python
_pending_oauth_states: dict[str, dict] = {}

@app.get("/api/oauth/{provider}/authorize")
async def oauth_authorize(provider: str, label: str = Query(...)):
    state = secrets.token_hex(16)  # 32 hex chars = 128 bits
    _pending_oauth_states[state] = {
        "provider": provider,
        "label": label,
        "expires_at": time.time() + 600,  # 10 minutes
    }
    auth_url = build_oauth_url(provider, state)
    return {"auth_url": auth_url}

@app.get("/api/oauth/{provider}/callback")
async def oauth_callback(provider: str, code: str, state: str):
    state_data = _pending_oauth_states.pop(state, None)
    
    if not state_data:
        raise HTTPException(400, "Invalid or expired OAuth state")
    
    if time.time() > state_data["expires_at"]:
        raise HTTPException(400, "OAuth state expired")
    
    if state_data["provider"] != provider:
        raise HTTPException(400, "Provider mismatch")
    
    # Continue with token exchange...
```

---

### 12. SQLite Database in Project Root

**Severity:** MEDIUM  
**CWE:** CWE-200 (Information Exposure)  
**Location:** `db.py:27`

**Issue:**
```python
DATABASE_URL = "sqlite+aiosqlite:///./momiji.db"  # Default
```

Verify `*.db` is in `.gitignore`. SQLite files contain all data including tokens.

**Fix:**
```python
# db.py
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "sqlite+aiosqlite:///" + os.path.join(os.path.dirname(__file__), "data", "momiji.db"),
)
# Store in data/ subdirectory, ensure .gitignore includes data/*.db
```

---

## LOW Severity

### 13. Verbose Error Messages

**Severity:** LOW  
**Location:** Multiple endpoints

Some error messages reveal internal structure:
```python
# api.py:741
raise HTTPException(status_code=404, detail=f"Clip index {index} out of range (clips has {len(clips)} items)...")
```

**Recommendation:** Use generic error messages in production:
```python
raise HTTPException(status_code=404, detail="Clip not found")
```

---

### 14. Missing Security Headers

**Severity:** LOW  
**Location:** `api.py`

**Issue:** No Content Security Policy, X-Frame-Options, etc.

**Fix:**
```python
from fastapi.middleware import Middleware
from starlette.middleware import Middleware as StarletteMiddleware

@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    return response
```

---

### 15. localStorage for Non-Critical State

**Severity:** LOW  
**Locations:** `frontend/src/stores/timelineStore.ts:321`, `selectionStore.ts:102`, `playbackStore.ts:86`

**Issue:** While not security-critical, any localStorage use increases XSS attack surface.

**Recommendation:** Consider sessionStorage or in-memory storage for UI state.

---

## Implementation Priority

### Phase 1 (Before Any User Data)
1. [ ] Move JWT to HttpOnly cookies
2. [ ] Implement PKCE for all OAuth providers
3. [ ] Encrypt OAuth tokens at rest
4. [ ] Add file upload validation

### Phase 2 (Before Production Launch)
5. [ ] Fix JWT configuration (RS256, short expiry)
6. [ ] Add rate limiting
7. [ ] Implement password validation + breach checking
8. [ ] Fix CORS configuration
9. [ ] Add refresh token rotation

### Phase 3 (Security Hardening)
10. [ ] Add JWT claims validation
11. [ ] Audit OAuth state handling
12. [ ] Add security headers
13. [ ] Move database to secure location

---

## References

- **RFC 9700:** OAuth 2.0 Security Best Current Practice (Jan 2025) - https://www.rfc-editor.org/rfc/rfc9700
- **OWASP Password Storage:** https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- **JWT Best Practices:** https://jwt.app/blog/jwt-best-practices
- **NIST SP 800-63B:** Digital Identity Guidelines - https://pages.nist.gov/800-63-4/sp800-63b.html
