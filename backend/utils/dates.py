"""Date-string utilities shared across the backend.

Kept deliberately stdlib-only and side-effect-free so any layer (routers,
utils, tests) can import without triggering framework or DB coupling.
"""


def normalize_date(date_str: str) -> str:
    """Normalize a date string to ``YYYY-MM-DD`` for consistent sorting.

    Accepts both a bare ISO date and an ISO datetime with a ``T`` separator
    (e.g. ``"2025-12-27T00:00:00.000Z"``) and returns the date-only prefix.
    Malformed input is passed through unchanged so callers that need
    validation can wrap the result in ``date.fromisoformat`` inside a
    try/except.
    """
    if not date_str:
        return date_str
    # Already YYYY-MM-DD — return as-is.
    if len(date_str) == 10 and date_str[4] == '-' and date_str[7] == '-':
        return date_str
    # ISO datetime: drop the time portion.
    if 'T' in date_str:
        return date_str.split('T')[0]
    return date_str
