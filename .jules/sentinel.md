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

## 2025-02-19 - Missing Rate Limiting Implementation
**Vulnerability:** Although rate limiting was planned and even documented for OCR endpoints, the actual dependency `Depends(ocr_rate_limiter)` was missing from the router code.
**Learning:** Documentation and intent do not equal code. Verification must be done on the actual implementation.
**Prevention:** Ensure that security features are verified by automated tests (like `test_ocr_rate_limit.py`) that specifically check for the presence and function of the control, rather than just functional tests that might mock it out.

## 2025-02-19 - IDOR in In-Memory Cache
**Vulnerability:** The OCR caching mechanism used a random UUID as a key but did not store or validate the user ownership of the cached data. Knowing the UUID allowed any user to access another user's receipt data (IDOR).
**Learning:** Random tokens (like UUIDs) provide unpredictability but not authorization. If the token is leaked or shared, access control is lost unless explicit ownership checks are enforced.
**Prevention:** Always associate cached sensitive data with an owner (user_id) and verify `current_user.id == owner_id` upon retrieval, even for temporary or cached resources.

## 2025-02-19 - Insecure Default Configuration
**Vulnerability:** The application fell back to a hardcoded "weak" secret key if the `SECRET_KEY` environment variable was missing. This "convenience" feature meant that production deployments could silently run with a known compromised key if configuration was missed.
**Learning:** "Secure by default" means the application should fail to start if critical security configuration is missing, rather than falling back to an insecure state. Convenience for developers (not setting env vars) should not compromise production security.
**Prevention:** Enforce strict configuration checks at startup. If the environment is production, raise a fatal error if secrets are missing. Only allow weak defaults when explicitly in a development environment.

## 2025-05-26 - DoS via Memory Exhaustion in Size Check
**Vulnerability:** The file size check for OCR uploads was implemented *after* reading the entire file into memory (`await file.read()`), allowing a large file upload to exhaust server memory before the check could reject it.
**Learning:** Checking `len(content) > LIMIT` is too late for memory exhaustion protection. The check must happen *during* the read process (streaming) or rely on `Content-Length` (which can be spoofed) combined with a hard limit on the read operation.
**Prevention:** Use a utility that reads the file stream in chunks and enforces the limit incrementally, raising an exception immediately when the limit is exceeded, preventing the full file from loading into RAM.

## 2025-02-21 - Unauthorized User Addition to Expenses
**Vulnerability:** The expense creation and update logic checked that participant users existed in the database, but failed to verify that the `current_user` was authorized to add them. This allowed an attacker to create expenses involving arbitrary users (spamming them/IDOR).
**Learning:** Checking for existence (`db.query(...).first()`) is not the same as checking for authorization. Authorization context (friendship, group membership) must be explicitly verified for every relationship.
**Prevention:** In `validate_expense_participants`, I added explicit checks:
1. For group expenses: All participants must be members of the group.
2. For personal expenses: All participants must be friends of the creator.

## 2025-05-27 - Stored XSS via Email Injection
**Vulnerability:** User-provided names (e.g. `full_name`) were injected directly into HTML email templates without sanitization. An attacker could register with a malicious name containing script tags, which would be executed in the victim's email client if it supports HTML rendering (e.g., via friend requests).
**Learning:** Never trust user input, even in email templates. String formatting (`f"{user_name}"`) is not safe for HTML generation.
**Prevention:** Use `html.escape()` for all user-controlled variables inserted into HTML content.
