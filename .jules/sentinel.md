## 2024-05-23 - Hardcoded Secrets in Auth
**Vulnerability:** The `SECRET_KEY` used for JWT signing was hardcoded as a string literal in `backend/auth.py` and did not respect the `SECRET_KEY` environment variable.
**Learning:** Even when code comments say "In prod use env var", developers might forget to actually implement the logic to read from the environment.
**Prevention:** Always use `os.environ.get()` for sensitive configuration values, and ideally fail startup if critical secrets are missing in production. For this codebase, I added the environment variable lookup while maintaining the default for backward compatibility with dev environments.

## 2024-05-24 - Unrestricted File Upload Size
**Vulnerability:** The receipt scanning endpoint read the entire uploaded file into memory without checking its size, creating a Denial of Service (DoS) risk via memory exhaustion.
**Learning:** Frameworks like FastAPI/Starlette provide tools (`UploadFile`) that handle large files by spooling to disk, but application logic often inadvertently negates this by calling `await file.read()`, loading everything into RAM.
**Prevention:** Always enforce a `Content-Length` header check before reading, and/or stream the file reading with a size limit check. Added a 10MB limit to `scan_receipt`.

## 2025-02-18 - Input Validation Vulnerability
**Vulnerability:** Input fields in schemas (like user full_name, expense description, etc.) lacked length constraints, allowing for potentially unbounded strings which could lead to DoS or database issues.
**Learning:** Pydantic models by default validate types but not lengths. Explicit `Field(..., max_length=X)` is required.
**Prevention:** Always define `min_length` and `max_length` for string fields in Pydantic schemas. Use `EmailStr` for emails.

## 2025-02-18 - Information Leakage in Error Handling
**Vulnerability:** The receipt OCR endpoint caught generic exceptions and returned their string representation `str(e)` in the HTTP 500 response body. This could potentially expose sensitive internal details (path structures, DB connection strings, library versions) to attackers.
**Learning:** Developers often return raw error messages to debug easier, but forget to sanitize them for production.
**Prevention:** Catch exceptions and log the full traceback to server logs (stderr/stdout), but return a generic "Something went wrong" message to the API client.

## 2025-02-18 - Missing Rate Limiting on Expensive Endpoint
**Vulnerability:** The receipt scanning endpoint (`/ocr/scan-receipt`) was not rate-limited, allowing potential Cost Denial of Service (DoS) by exhausting the Google Cloud Vision API quota or incurring high costs.
**Learning:** Authentication rate limits are often insufficient for resource-intensive or costly operations. Expensive endpoints require dedicated, stricter limits.
**Prevention:** Identify endpoints that trigger external API calls or heavy processing and apply specific rate limiters (e.g., 5 requests/minute) distinct from general API limits.

## 2025-02-18 - Rate Limiting Bypass via Reverse Proxy
**Vulnerability:** The rate limiter used `request.client.host` to identify users. Since the application runs behind an Nginx reverse proxy (on the same machine/container), all requests appeared to come from `127.0.0.1`. This meant all users shared the same rate limit bucket, leading to a self-inflicted Denial of Service where one active user could block everyone else.
**Learning:** In containerized or proxied environments, `request.client.host` often reflects the proxy's IP, not the actual user. Trusting it blindly effectively disables per-user rate limiting.
**Prevention:** Always check for `X-Forwarded-For` or `X-Real-IP` headers when deployed behind a proxy. Configure the application middleware (like `ProxyHeadersMiddleware`) or manually handle these headers in security-critical components like rate limiters.

## 2025-02-18 - Missing Rate Limiting on Sensitive Auth Endpoints
**Vulnerability:** The `/auth/refresh` and `/auth/logout` endpoints lacked rate limiting, allowing potential DoS attacks on the database or token verification logic.
**Learning:** While login endpoints are usually protected, secondary auth endpoints like refresh token exchange are often overlooked but can be equally expensive (DB lookups, crypto operations).
**Prevention:** Apply consistent rate limiting to all authentication-related endpoints, not just the primary login route.

## 2024-05-23 - PII Leak in Public Endpoints
**Vulnerability:** User email addresses were exposed in public group endpoints (`/groups/public/*`). The `GroupMember` schema included `email`, and the display logic fell back to `user.email` if `full_name` was missing.
**Learning:** Defaulting to email as a display name is dangerous for public-facing views. Even if the schema excludes it, logic might inadvertently expose it.
**Prevention:**
1. Use separate schemas for public vs. private data (e.g., `PublicGroupMember`).
2. Create dedicated display helpers (e.g., `get_public_user_display_name`) that enforce masking logic centrally.
3. Verify public endpoints with tests that explicitly check for sensitive field presence.

## 2025-02-18 - Stored XSS / File Upload Bypass
**Vulnerability:** The receipt upload endpoint trusted the user-provided `Content-Type` header and file extension, allowing attackers to upload malicious files (e.g., HTML/JS) disguised as images, which could lead to Stored XSS when served back to users.
**Learning:** `Content-Type` headers and filenames are user-controlled input and should never be trusted for security decisions. Validating them is insufficient.
**Prevention:** Use a library like `PIL` (Python Imaging Library) to inspect the actual file content (magic numbers) to verify it is a valid image. Derive the file extension from the detected format, not the uploaded filename.
