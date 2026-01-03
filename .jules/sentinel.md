## 2024-05-23 - Hardcoded Secrets in Auth
**Vulnerability:** The `SECRET_KEY` used for JWT signing was hardcoded as a string literal in `backend/auth.py` and did not respect the `SECRET_KEY` environment variable.
**Learning:** Even when code comments say "In prod use env var", developers might forget to actually implement the logic to read from the environment.
**Prevention:** Always use `os.environ.get()` for sensitive configuration values, and ideally fail startup if critical secrets are missing in production. For this codebase, I added the environment variable lookup while maintaining the default for backward compatibility with dev environments.

## 2024-05-24 - Unrestricted File Upload Size
**Vulnerability:** The receipt scanning endpoint read the entire uploaded file into memory without checking its size, creating a Denial of Service (DoS) risk via memory exhaustion.
**Learning:** Frameworks like FastAPI/Starlette provide tools (`UploadFile`) that handle large files by spooling to disk, but application logic often inadvertently negates this by calling `await file.read()`, loading everything into RAM.
**Prevention:** Always enforce a `Content-Length` header check before reading, and/or stream the file reading with a size limit check. Added a 10MB limit to `scan_receipt`.
