"""Exports router: the group balance sheet as CSV.

Authorization mirrors ``routers/summary.py`` exactly — authenticated, and a
member of the group. The sheet names every member and states their full
financial position, so it deliberately has no public share-link counterpart.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

import models
from database import get_db
from dependencies import get_current_user
from utils.balance_sheet import build_balance_sheet
from utils.csv_export import filename_for, iter_csv
from utils.validation import get_group_or_404, verify_group_membership

router = APIRouter(tags=["groups"])


@router.get("/groups/{group_id}/balance_sheet.csv")
def get_group_balance_sheet(
    group_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """
    Download the group's balance sheet: the settlement calculation, step by step.

    Authorization:
        * 401 if the caller is unauthenticated.
        * 404 if the group does not exist.
        * 403 if the caller is authenticated but not a member of the group.

    The response always renders. A group whose data fails an internal
    consistency check still downloads, with the failure named in the CHECKS
    section — an export that refuses to open is useless exactly when somebody
    needs it to explain a number that looks wrong.
    """
    get_group_or_404(db, group_id)
    verify_group_membership(db, group_id, current_user.id)

    sheet = build_balance_sheet(db, group_id, generated_for=current_user.email)

    return StreamingResponse(
        iter_csv(sheet),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename_for(sheet)}"',
            # The browser fetches this with credentials and hands it straight
            # to the user; nothing should keep a copy.
            "Cache-Control": "no-store",
        },
    )
