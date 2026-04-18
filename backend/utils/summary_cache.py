"""
Tiny bounded in-memory TTL cache for the public summary endpoint.

Keyed by ``share_link_id``. Values are fully-projected
:class:`schemas.PublicGroupSummaryResponse` objects — only responses for groups
that resolved AND were public are ever cached, so unknown share-link-ids
cannot be used to grow the dict.

Design notes:

* **60-second TTL.** Short enough to absorb viral-link bursts; short enough
  that a manual ``is_public`` flip off is visible within a minute without
  any invalidation machinery. Invalidation is still wired on mutation paths
  so privacy flips take effect immediately rather than up to 60s later.
* **Bounded at 1000 entries.** FIFO eviction via
  ``OrderedDict.popitem(last=False)``. A thousand distinct share links are
  orders of magnitude beyond expected cardinality; the bound exists to
  deny-list memory growth under adversarial traffic.
* **No stdlib deps beyond ``collections`` / ``time``.** Intentionally small
  and boring — if this ever needs to be distributed, swap for Redis at the
  call site, not in here.
"""

from __future__ import annotations

import time
from collections import OrderedDict
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    # Avoid importing schemas at module load time to keep this file dependency-free.
    from schemas import PublicGroupSummaryResponse


TTL_SECONDS = 60
MAX_ENTRIES = 1000


# Module-level singleton. Process-local; see docstring.
_cache: "OrderedDict[str, tuple[PublicGroupSummaryResponse, float]]" = OrderedDict()


def get(share_link_id: str) -> Optional["PublicGroupSummaryResponse"]:
    """
    Return the cached response for ``share_link_id`` iff present AND fresh
    (``now - inserted_at < TTL_SECONDS``). Otherwise return ``None`` and
    opportunistically purge the stale entry.
    """
    entry = _cache.get(share_link_id)
    if entry is None:
        return None

    response, inserted_at = entry
    if time.monotonic() - inserted_at < TTL_SECONDS:
        return response

    # Stale — drop it so the next call doesn't re-check.
    _cache.pop(share_link_id, None)
    return None


def set(share_link_id: str, response: "PublicGroupSummaryResponse") -> None:
    """
    Insert ``response`` under ``share_link_id``. Enforces the ``MAX_ENTRIES``
    cap via FIFO eviction (oldest-inserted first).

    Re-inserting an existing key refreshes the timestamp and moves the entry
    to the "newest" end of the FIFO queue, matching natural cache semantics.
    """
    if share_link_id in _cache:
        _cache.pop(share_link_id)

    _cache[share_link_id] = (response, time.monotonic())

    # Enforce size cap.
    while len(_cache) > MAX_ENTRIES:
        _cache.popitem(last=False)


def invalidate(share_link_id: str) -> None:
    """Remove the entry for ``share_link_id`` if present. No-op otherwise."""
    _cache.pop(share_link_id, None)


def _clear_for_tests() -> None:
    """Test-only helper: drop all entries. Not part of the public API."""
    _cache.clear()
