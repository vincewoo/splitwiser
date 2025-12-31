## 2024-05-23 - Hardcoded Secrets in Auth
**Vulnerability:** The `SECRET_KEY` used for JWT signing was hardcoded as a string literal in `backend/auth.py` and did not respect the `SECRET_KEY` environment variable.
**Learning:** Even when code comments say "In prod use env var", developers might forget to actually implement the logic to read from the environment.
**Prevention:** Always use `os.environ.get()` for sensitive configuration values, and ideally fail startup if critical secrets are missing in production. For this codebase, I added the environment variable lookup while maintaining the default for backward compatibility with dev environments.
