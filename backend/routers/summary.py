"""Summary router: group spending summary (authenticated endpoint).

This is the authenticated counterpart to the aggregation primitive in
``utils.summary``. It enforces group membership (403 on non-members, 404 on
missing groups, 401 on missing/invalid auth — the last two handled upstream
by ``get_current_user`` and ``get_group_or_404`` respectively) and projects
the ``ConsumptionSummary`` dataclass onto the ``GroupSummaryResponse``
Pydantic shape consumed by the frontend.

The narrower public endpoint lives in ``routers/groups.py`` (added in Unit 4)
and shares the same underlying primitive.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from dependencies import get_current_user
from utils.summary import calculate_consumption_summary
from utils.validation import get_group_or_404, verify_group_membership


logger = logging.getLogger(__name__)

router = APIRouter(tags=["groups"])


@router.get(
    "/groups/{group_id}/summary",
    response_model=schemas.GroupSummaryResponse,
)
def get_group_summary(
    group_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> schemas.GroupSummaryResponse:
    """
    Return a read-only spending summary for ``group_id`` in the group's default
    currency.

    Authorization:
        * 401 if the caller is unauthenticated.
        * 404 if the group does not exist.
        * 403 if the caller is authenticated but not a member of the group.

    Response shape (see :class:`schemas.GroupSummaryResponse`):
        * ``group_total`` — integer cents, Σ converted split amounts.
        * ``currency``    — the group's default currency (pass-through).
        * ``granularity`` — ``"week"`` | ``"month"`` | ``"quarter"``.
        * ``has_synthesized_historical_rate`` — True iff leg-1 of the hybrid
          conversion fell back to current rates for any non-USD expense.
        * ``members[]``   — sorted by ``total`` descending; managed members
          folded into managers with an expandable breakdown.
        * ``series[]``    — one bucket per period between min and max expense
          date (empty buckets zero-filled).

    The aggregation layer's ``skipped_unparseable_dates`` counter is
    intentionally NOT surfaced in the response — it's an internal
    observability signal. When > 0 we log at warning level so bad production
    data surfaces in the logs without reaching end users.
    """
    group = get_group_or_404(db, group_id)
    verify_group_membership(db, group_id, current_user.id)

    target_currency = group.default_currency or "USD"
    summary = calculate_consumption_summary(
        db,
        group_id,
        target_currency=target_currency,
    )

    if summary.skipped_unparseable_dates > 0:
        # Observability hook. Not user-facing — group members shouldn't see
        # "we silently dropped 3 expenses" in the UI. A future metric can sub
        # in here without changing the response shape.
        logger.warning(
            "calculate_consumption_summary: skipped %d expense(s) with unparseable dates in group %d",
            summary.skipped_unparseable_dates,
            group_id,
        )

    # Project the internal dataclass onto the response schema. The dataclass
    # already sorts ``members`` by total descending — do NOT re-sort here,
    # the primitive's test suite pins the ordering.
    return schemas.GroupSummaryResponse(
        group_total=summary.group_total,
        currency=summary.currency,
        granularity=summary.granularity,
        has_synthesized_historical_rate=summary.has_synthesized_historical_rate,
        members=[
            schemas.GroupSummaryMember(
                user_id=m.user_id,
                is_guest=m.is_guest,
                display_name=m.display_name,
                total=m.total,
                managed_members=[
                    schemas.GroupSummaryManagedMember(
                        display_name=mm["display_name"],
                        total=mm["total"],
                    )
                    for mm in m.managed_members
                ],
            )
            for m in summary.members
        ],
        series=[
            schemas.GroupSummarySeriesPoint(
                period_label=s.period_label,
                period_start=s.period_start,
                total=s.total,
                per_member=[
                    schemas.GroupSummarySeriesPointMember(
                        user_id=pm.user_id,
                        is_guest=pm.is_guest,
                        amount=pm.amount,
                    )
                    for pm in s.per_member
                ],
            )
            for s in summary.series
        ],
    )
