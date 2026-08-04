"""Tabs: a one-off bill people claim items from via a share link.

Security note. The public endpoints here are the app's first *writable*
unauthenticated surface — Group.share_link_id is a permanent read-only UUID,
whereas a tab's token lets a stranger create a participant and claim money.
So the token is:

  * high-entropy (secrets.token_urlsafe(32)) rather than a UUID,
  * scoped to exactly one tab — it is looked up by token, never combined with
    a caller-supplied tab id,
  * expiring, and revocable independently of expiry,
  * rate-limited on every public route,
  * unable to read anything but its own tab: the public payload omits the
    share token, participant claim tokens, user ids of the creator, and every
    other tab.

Claimers are identified by their own `claim_token`, issued on join. It is the
only thing that lets an anonymous person amend their own claims, so it is
never returned in a listing — only once, to the person who just joined.

That token, not the name, is who somebody *is* here. Joining seats a new
person exactly once; coming back under a different name renames the row the
token points at, so claims never strand under a name nobody is using. Names
are only labels, but they are the labels everyone else reads, so they are also
unique per tab (case-insensitively) — a second "Maya" is refused rather than
merged into the first, since merging on name alone would hand anyone holding
the link the power to edit her claims.
"""

import secrets
from datetime import datetime, timedelta
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from dependencies import get_current_user, get_optional_current_user
from utils.rate_limiter import RateLimiter
from utils.tabs import compute_tab_shares

router = APIRouter(tags=["tabs"])

# A tab link stays usable for a week past creation — long enough for stragglers
# to claim, short enough that a forwarded link goes stale.
TAB_LINK_LIFETIME = timedelta(days=7)

# Public routes are unauthenticated and writable, so they are limited harder
# than the authenticated surface.
public_tab_rate_limiter = RateLimiter(requests_limit=30, time_window=60)
tab_join_rate_limiter = RateLimiter(requests_limit=10, time_window=60)


def _load_tab_for_owner(db: Session, tab_id: int, user_id: int) -> models.Tab:
    tab = db.query(models.Tab).filter(models.Tab.id == tab_id).first()
    if not tab:
        raise HTTPException(status_code=404, detail="Tab not found")
    if tab.created_by_id != user_id:
        # Same shape as "not found": don't confirm a tab exists to a stranger.
        raise HTTPException(status_code=404, detail="Tab not found")
    return tab


def _load_tab_by_token(db: Session, share_token: str) -> models.Tab:
    """
    Resolve a tab from its token alone.

    The token *is* the identifier here — no caller-supplied tab id is consulted
    — so a token can only ever reach the tab it belongs to.
    """
    tab = (
        db.query(models.Tab)
        .filter(models.Tab.share_token == share_token)
        .first()
    )
    if not tab or tab.revoked:
        raise HTTPException(status_code=404, detail="This link is no longer valid")
    if tab.token_expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="This link has expired")
    return tab


# Said to whoever picks a name someone at the table is already using. It has
# to explain the fix, because "taken" reads as a bug to someone who has never
# seen this tab before.
NAME_TAKEN_DETAIL = (
    "Someone at this table is already claiming as that name. "
    "Add a last initial so everyone can tell you apart."
)


def _clean_name(raw: str) -> str:
    """Trim and collapse whitespace. ' Maya  B ' and 'Maya B' are one name."""
    return " ".join(raw.split())


def _name_is_taken(
    db: Session, tab_id: int, name: str, *, excluding_id: Optional[int] = None
) -> bool:
    query = db.query(models.TabParticipant.id).filter(
        models.TabParticipant.tab_id == tab_id,
        func.lower(models.TabParticipant.display_name) == name.lower(),
    )
    if excluding_id is not None:
        query = query.filter(models.TabParticipant.id != excluding_id)
    return db.query(query.exists()).scalar()


def _participant_for_claim_token(
    db: Session, tab: models.Tab, claim_token: str
) -> models.TabParticipant:
    """
    Resolve an anonymous claimer from the only credential they have.

    Scoped to this tab: a token issued for another tab must not work here.
    """
    participant = (
        db.query(models.TabParticipant)
        .filter(
            models.TabParticipant.claim_token == claim_token,
            models.TabParticipant.tab_id == tab.id,
        )
        .first()
    )
    if not participant:
        raise HTTPException(status_code=403, detail="Join the tab first")
    return participant


def _account_name(user: Optional[models.User]) -> str:
    """What to call a signed-in claimer who did not type a name."""
    if not user:
        return ""
    # The local part of the email is a poor label, but it beats "You" on a
    # board where it sits next to four real names.
    return _clean_name(user.full_name or "") or user.email.split("@")[0]


def _adopt_anonymous_seat(
    db: Session,
    tab: models.Tab,
    claim_token: Optional[str],
    user: models.User,
) -> Optional[models.TabParticipant]:
    """
    Bind a signed-in account to the anonymous seat the caller is claiming from.

    Someone claims half the bill, then signs in — on this page or on the offer
    to make an account. Seating them again would leave those claims on a guest
    row, so the seat they are already using becomes theirs instead. Returns
    None when there is nothing to adopt, leaving the caller to seat them fresh.
    """
    if not claim_token:
        return None
    seat = (
        db.query(models.TabParticipant)
        .filter(
            models.TabParticipant.claim_token == claim_token,
            models.TabParticipant.tab_id == tab.id,
        )
        .first()
    )
    # A seat already spoken for by a different account is not theirs to take.
    if not seat or seat.user_id is not None:
        return None
    seat.user_id = user.id
    db.commit()
    db.refresh(seat)
    return seat


def _join_response(
    db: Session, tab: models.Tab, participant: models.TabParticipant
) -> "schemas.TabJoinResponse":
    return schemas.TabJoinResponse(
        participant=schemas.TabParticipantOut(
            id=participant.id,
            display_name=participant.display_name,
            user_id=participant.user_id,
        ),
        claim_token=participant.claim_token,
        tab=_public_tab_out(db, tab),
    )


def _claims_by_item(db: Session, tab_id: int) -> dict:
    claims = (
        db.query(models.TabItemClaim)
        .filter(models.TabItemClaim.tab_id == tab_id)
        .all()
    )
    by_item: dict = {}
    for claim in claims:
        by_item.setdefault(claim.item_id, []).append(claim.participant_id)
    return by_item


def _serialize_items(db: Session, tab_id: int) -> List[schemas.TabItemOut]:
    items = (
        db.query(models.TabItem)
        .filter(models.TabItem.tab_id == tab_id)
        .order_by(models.TabItem.id)
        .all()
    )
    by_item = _claims_by_item(db, tab_id)
    return [
        schemas.TabItemOut(
            id=item.id,
            description=item.description,
            price=item.price,
            added_manually=item.added_manually,
            claimed_by=sorted(by_item.get(item.id, [])),
        )
        for item in items
    ]


def _serialize_participants(db: Session, tab_id: int) -> List[schemas.TabParticipantOut]:
    participants = (
        db.query(models.TabParticipant)
        .filter(models.TabParticipant.tab_id == tab_id)
        .order_by(models.TabParticipant.id)
        .all()
    )
    # Note the absence of claim_token: it never appears in a listing.
    return [
        schemas.TabParticipantOut(
            id=p.id,
            display_name=p.display_name,
            user_id=p.user_id,
            paid=bool(p.paid),
            venmo_username=p.venmo_username,
        )
        for p in participants
    ]


def _tab_out(db: Session, tab: models.Tab) -> schemas.TabOut:
    return schemas.TabOut(
        id=tab.id,
        name=tab.name,
        currency=tab.currency,
        status=tab.status,
        tax=tab.tax,
        tip=tab.tip,
        total=tab.total,
        created_by_id=tab.created_by_id,
        payer_id=tab.payer_id,
        payer_participant_id=tab.payer_participant_id,
        expense_id=tab.expense_id,
        items=_serialize_items(db, tab.id),
        participants=_serialize_participants(db, tab.id),
        receipt_image_path=tab.receipt_image_path,
        share_token=tab.share_token,
        token_expires_at=tab.token_expires_at,
    )


def _payer_seat(db: Session, tab: models.Tab) -> Optional[models.TabParticipant]:
    """
    The seat that fronted the bill.

    Whoever the host named, falling back to the person who opened the tab —
    which is right far more often than not, but not always: the organiser and
    the payer are different people whenever somebody without the app picks up
    the cheque and the table's Splitwiser user does the arithmetic.
    """
    if tab.payer_participant_id is not None:
        seat = (
            db.query(models.TabParticipant)
            .filter(
                models.TabParticipant.id == tab.payer_participant_id,
                models.TabParticipant.tab_id == tab.id,
            )
            .first()
        )
        if seat:
            return seat

    return (
        db.query(models.TabParticipant)
        .filter(
            models.TabParticipant.tab_id == tab.id,
            models.TabParticipant.user_id == tab.created_by_id,
        )
        .first()
    )


def _tab_host(db: Session, tab: models.Tab) -> tuple[Optional[str], Optional[str]]:
    """
    Whoever the table owes: their name, and their Venmo handle if they have one.

    The name comes from their seat rather than their account, so it matches
    what the rest of the page calls them. The handle comes from their account
    when they have one, and from the seat when they do not — the case this
    exists for, since a payer who has never used Splitwiser has no User row to
    hold a handle but is still the person everybody owes.
    """
    seat = _payer_seat(db, tab)
    if seat is None:
        return None, None

    if seat.user_id is not None:
        host = (
            db.query(models.User).filter(models.User.id == seat.user_id).first()
        )
        if host is not None:
            return seat.display_name or host.full_name, host.venmo_username

    return seat.display_name, seat.venmo_username


def _public_tab_out(db: Session, tab: models.Tab) -> schemas.PublicTabOut:
    host_name, host_venmo_username = _tab_host(db, tab)
    return schemas.PublicTabOut(
        name=tab.name,
        currency=tab.currency,
        status=tab.status,
        tax=tab.tax,
        tip=tab.tip,
        total=tab.total,
        items=_serialize_items(db, tab.id),
        participants=_serialize_participants(db, tab.id),
        host_name=host_name,
        host_venmo_username=host_venmo_username,
    )


# ---------------------------------------------------------------------------
# Owner surface
# ---------------------------------------------------------------------------


@router.post("/tabs", response_model=schemas.TabOut)
def create_tab(
    payload: schemas.TabCreate,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Open a tab, usually straight from a scanned receipt."""
    tab = models.Tab(
        name=payload.name,
        created_by_id=current_user.id,
        currency=payload.currency.upper(),
        share_token=secrets.token_urlsafe(32),
        token_expires_at=datetime.utcnow() + TAB_LINK_LIFETIME,
        status="open",
        tax=payload.tax,
        tip=payload.tip,
        total=payload.total,
        receipt_image_path=payload.receipt_image_path,
    )
    db.add(tab)
    db.commit()
    db.refresh(tab)

    for item in payload.items:
        db.add(
            models.TabItem(
                tab_id=tab.id, description=item.description, price=item.price
            )
        )

    # The opener is at the table too, and is the default payer.
    db.add(
        models.TabParticipant(
            tab_id=tab.id,
            display_name=_clean_name(current_user.full_name or "") or "You",
            user_id=current_user.id,
            claim_token=secrets.token_urlsafe(32),
        )
    )
    db.commit()

    return _tab_out(db, tab)


@router.get("/tabs", response_model=List[schemas.TabOut])
def list_tabs(
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db),
    status_filter: Optional[str] = None,
):
    query = db.query(models.Tab).filter(models.Tab.created_by_id == current_user.id)
    if status_filter:
        query = query.filter(models.Tab.status == status_filter)
    tabs = query.order_by(models.Tab.created_at.desc()).all()
    return [_tab_out(db, tab) for tab in tabs]


@router.get("/tabs/{tab_id}", response_model=schemas.TabOut)
def get_tab(
    tab_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    return _tab_out(db, _load_tab_for_owner(db, tab_id, current_user.id))


@router.post("/tabs/{tab_id}/items", response_model=schemas.TabOut)
def add_tab_item(
    tab_id: int,
    payload: schemas.TabItemCreate,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Add a line by hand to a live tab — a round the scan never saw."""
    tab = _load_tab_for_owner(db, tab_id, current_user.id)
    if tab.status != "open":
        raise HTTPException(status_code=409, detail="This tab is already closed")

    db.add(
        models.TabItem(
            tab_id=tab.id,
            description=payload.description,
            price=payload.price,
            added_manually=True,
        )
    )
    db.commit()
    return _tab_out(db, tab)


@router.patch("/tabs/{tab_id}/amounts", response_model=schemas.TabOut)
def update_tab_amounts(
    tab_id: int,
    payload: schemas.TabAmountsUpdate,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """
    Correct the tax or the tip on an open tab.

    The scan is a convenience tool, not the authority — a receipt prints
    before the tip is written on it, a "Service Fee" line is a tip in all but
    name, and a tax line can be missed outright. Whoever is holding the bill
    is in a better position to say, so they can say it at any point while the
    tab is open.

    A closed tab is refused: it has already been written out as an expense
    with everyone's shares recorded, and moving the tax underneath that would
    leave the two disagreeing with no way to tell which was meant.

    `total` follows the correction. It is the receipt's printed total until
    the host takes the numbers over, at which point what matters is the figure
    the table is actually being asked for.
    """
    tab = _load_tab_for_owner(db, tab_id, current_user.id)
    if tab.status != "open":
        raise HTTPException(status_code=409, detail="This tab is already closed")

    if payload.tax is not None:
        tab.tax = payload.tax
    if payload.tip is not None:
        tab.tip = payload.tip

    items_total = (
        db.query(func.coalesce(func.sum(models.TabItem.price), 0))
        .filter(models.TabItem.tab_id == tab.id)
        .scalar()
    )
    tab.total = items_total + tab.tax + tab.tip

    db.commit()
    return _tab_out(db, tab)


@router.post("/tabs/{tab_id}/participants", response_model=schemas.TabOut)
def add_tab_participant(
    tab_id: int,
    payload: schemas.TabParticipantCreate,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """
    Seat somebody the owner is claiming on behalf of.

    Joining is otherwise the only way a participant comes into being, and it
    needs the link — which is no use for the person sitting at the table with a
    flat phone. The owner can already tick any seat and decide who paid, so
    creating one grants nothing they did not have; what it removes is the need
    for everybody to hold a device before their order can be recorded.

    The seat is a guest seat. Passing the owner's own account here would be
    wrong twice over: they already have a seat, and `ux_tab_participants_tab_user`
    would refuse the second one.

    A claim token is generated and never returned. Nobody is holding it, so
    this person cannot later claim from their own phone — the owner has the
    device that speaks for them. Handing a seat over is a separate feature.
    """
    tab = _load_tab_for_owner(db, tab_id, current_user.id)
    if tab.status != "open":
        raise HTTPException(status_code=409, detail="This tab is already closed")

    name = _clean_name(payload.display_name)
    if not name:
        raise HTTPException(status_code=400, detail="Please give a name")
    if _name_is_taken(db, tab.id, name):
        raise HTTPException(status_code=409, detail=NAME_TAKEN_DETAIL)

    db.add(
        models.TabParticipant(
            tab_id=tab.id,
            display_name=name,
            user_id=None,
            claim_token=secrets.token_urlsafe(32),
            # Set when this seat is the one being owed: an off-app payer needs
            # somewhere to carry a handle, having no account to hold one.
            venmo_username=payload.venmo_username or None,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        # Somebody opened the link under this name in the same moment.
        db.rollback()
        raise HTTPException(status_code=409, detail=NAME_TAKEN_DETAIL) from None

    return _tab_out(db, tab)


@router.patch(
    "/tabs/{tab_id}/participants/{participant_id}", response_model=schemas.TabOut
)
def update_tab_participant(
    tab_id: int,
    participant_id: int,
    payload: schemas.TabParticipantUpdate,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """
    Tick somebody off as settled, or give a seat a Venmo handle.

    Marking paid is a claim about the world, not about this database: the money
    moves through Venmo, cash or a bank transfer, and nothing here can see any
    of it. The host at the table is the only witness there is, which is why
    this is theirs to set and why it stays available after the tab closes —
    people wander off owing, and settle days later.

    A handle is refused on a seat that has an account. That person's handle
    lives on their User row, is theirs to change, and copying it here would
    fork it: edit one and the other goes stale.
    """
    tab = _load_tab_for_owner(db, tab_id, current_user.id)
    seat = (
        db.query(models.TabParticipant)
        .filter(
            models.TabParticipant.id == participant_id,
            models.TabParticipant.tab_id == tab.id,
        )
        .first()
    )
    if seat is None:
        raise HTTPException(status_code=404, detail="Nobody by that id at this tab")

    if payload.venmo_username is not None:
        if seat.user_id is not None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "This person has an account — their Venmo handle comes "
                    "from their own profile"
                ),
            )
        seat.venmo_username = payload.venmo_username or None

    if payload.paid is not None:
        seat.paid = payload.paid
        seat.paid_at = datetime.utcnow() if payload.paid else None

    db.commit()
    return _tab_out(db, tab)


@router.post("/tabs/{tab_id}/payer", response_model=schemas.TabOut)
def set_tab_payer(
    tab_id: int,
    payload: schemas.TabPayerUpdate,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """
    Name whoever fronted the bill, while the tab is still open.

    Until now this was decided at close and had to be someone with an account.
    Both were wrong for the common case where the person who paid is not the
    person doing the organising — a friend with no Splitwiser account picks up
    the cheque, and everybody owes *them*, directly, outside the app.

    Naming them early is what makes the claim page useful: it is their Venmo
    handle the table needs, not the organiser's.
    """
    tab = _load_tab_for_owner(db, tab_id, current_user.id)
    if tab.status != "open":
        raise HTTPException(status_code=409, detail="This tab is already closed")

    if payload.participant_id is None:
        tab.payer_participant_id = None
        db.commit()
        return _tab_out(db, tab)

    seat = (
        db.query(models.TabParticipant)
        .filter(
            models.TabParticipant.id == payload.participant_id,
            models.TabParticipant.tab_id == tab.id,
        )
        .first()
    )
    if seat is None:
        raise HTTPException(status_code=404, detail="Nobody by that id at this tab")

    tab.payer_participant_id = seat.id
    db.commit()
    return _tab_out(db, tab)


@router.delete("/tabs/{tab_id}/items/{item_id}", response_model=schemas.TabOut)
def delete_tab_item(
    tab_id: int,
    item_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    tab = _load_tab_for_owner(db, tab_id, current_user.id)
    if tab.status != "open":
        raise HTTPException(status_code=409, detail="This tab is already closed")

    item = (
        db.query(models.TabItem)
        .filter(models.TabItem.id == item_id, models.TabItem.tab_id == tab.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    # Claims on a deleted line would otherwise linger and be counted.
    db.query(models.TabItemClaim).filter(
        models.TabItemClaim.item_id == item.id
    ).delete()
    db.delete(item)
    db.commit()
    return _tab_out(db, tab)


@router.post("/tabs/{tab_id}/items/{item_id}/claim", response_model=schemas.TabOut)
def claim_own_tab_item(
    tab_id: int,
    item_id: int,
    payload: schemas.TabSelfClaimRequest,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """
    Claim a line as a signed-in participant.

    The host is a participant like anyone else and has to be able to say what
    they had. They cannot use the public claim route — that needs a claim
    token, and theirs is never handed out — so identity comes from the session
    instead. Open to any signed-in participant, not just the owner.
    """
    tab = db.query(models.Tab).filter(models.Tab.id == tab_id).first()
    if not tab:
        raise HTTPException(status_code=404, detail="Tab not found")

    participant = (
        db.query(models.TabParticipant)
        .filter(
            models.TabParticipant.tab_id == tab.id,
            models.TabParticipant.user_id == current_user.id,
        )
        .first()
    )
    if not participant:
        # Not at this table; same shape as a missing tab.
        raise HTTPException(status_code=404, detail="Tab not found")

    if tab.status != "open":
        raise HTTPException(status_code=409, detail="This tab is already closed")

    item = (
        db.query(models.TabItem)
        .filter(models.TabItem.id == item_id, models.TabItem.tab_id == tab.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    existing = (
        db.query(models.TabItemClaim)
        .filter(
            models.TabItemClaim.item_id == item.id,
            models.TabItemClaim.participant_id == participant.id,
        )
        .first()
    )

    if payload.claimed and not existing:
        db.add(
            models.TabItemClaim(
                tab_id=tab.id, item_id=item.id, participant_id=participant.id
            )
        )
        db.commit()
    elif not payload.claimed and existing:
        db.delete(existing)
        db.commit()

    return _tab_out(db, tab)


@router.post(
    "/tabs/{tab_id}/items/{item_id}/claim/{participant_id}",
    response_model=schemas.TabOut,
)
def set_tab_item_claim(
    tab_id: int,
    item_id: int,
    participant_id: int,
    payload: schemas.TabSelfClaimRequest,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """
    Set any participant's claim on a line. Owner only.

    Not every claim happens on a phone: someone leaves early, someone never
    opens the link, someone just says "that was mine" across the table. The
    owner can already close the tab and decide who paid, so letting them tick
    a box on another participant's behalf grants nothing they did not have —
    and without it the desktop board is a grid you can only read.
    """
    tab = _load_tab_for_owner(db, tab_id, current_user.id)

    if tab.status != "open":
        raise HTTPException(status_code=409, detail="This tab is already closed")

    participant = (
        db.query(models.TabParticipant)
        .filter(
            models.TabParticipant.id == participant_id,
            models.TabParticipant.tab_id == tab.id,
        )
        .first()
    )
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")

    item = (
        db.query(models.TabItem)
        .filter(models.TabItem.id == item_id, models.TabItem.tab_id == tab.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    existing = (
        db.query(models.TabItemClaim)
        .filter(
            models.TabItemClaim.item_id == item.id,
            models.TabItemClaim.participant_id == participant.id,
        )
        .first()
    )

    if payload.claimed and not existing:
        db.add(
            models.TabItemClaim(
                tab_id=tab.id, item_id=item.id, participant_id=participant.id
            )
        )
        db.commit()
    elif not payload.claimed and existing:
        db.delete(existing)
        db.commit()

    return _tab_out(db, tab)


@router.post("/tabs/{tab_id}/revoke", response_model=schemas.TabOut)
def revoke_tab_link(
    tab_id: int,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Kill the share link without closing the tab."""
    tab = _load_tab_for_owner(db, tab_id, current_user.id)
    tab.revoked = True
    db.commit()
    db.refresh(tab)
    return _tab_out(db, tab)


@router.post("/tabs/{tab_id}/close", response_model=schemas.TabOut)
def close_tab(
    tab_id: int,
    payload: schemas.TabCloseRequest,
    current_user: Annotated[models.User, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """
    Resolve the tab — into an expense, or into a plain record.

    An expense when somebody with an account fronted the bill: registered
    participants become expense splits, anonymous ones expense guests, all on
    the existing group_id NULL path. Nothing about a tab appears under Groups.

    A plain record when the payer has no account. There is genuinely no debt
    for Splitwiser to hold there — everyone settles with that person directly,
    outside the app — and inventing one would put a balance in the organiser's
    name that nobody owes them. The tab keeps the shares and the paid ticks as
    a record of what happened, and `expense_id` stays null.
    """
    tab = _load_tab_for_owner(db, tab_id, current_user.id)
    if tab.status == "closed":
        raise HTTPException(status_code=409, detail="This tab is already closed")

    participants = (
        db.query(models.TabParticipant)
        .filter(models.TabParticipant.tab_id == tab.id)
        .order_by(models.TabParticipant.id)
        .all()
    )
    if not participants:
        raise HTTPException(
            status_code=409, detail="Nobody has joined this tab yet"
        )

    items = (
        db.query(models.TabItem)
        .filter(models.TabItem.tab_id == tab.id)
        .order_by(models.TabItem.id)
        .all()
    )
    if not items:
        raise HTTPException(status_code=409, detail="This tab has no items")

    # Who fronted the bill. Named at close if the caller says so, otherwise
    # whoever was named while the tab was open, otherwise the tab's creator.
    if payload.payer_participant_id is not None:
        payer = next(
            (p for p in participants if p.id == payload.payer_participant_id), None
        )
        if not payer:
            raise HTTPException(status_code=400, detail="Unknown payer")
    else:
        payer = _payer_seat(db, tab)
    if payer is None:
        raise HTTPException(status_code=400, detail="This tab has no payer")

    shares = compute_tab_shares(
        [(item.id, item.price) for item in items],
        _claims_by_item(db, tab.id),
        [p.id for p in participants],
        tax=tab.tax,
        tip=tab.tip,
    )
    amount = sum(shares.values())

    if payer.user_id is None:
        # Nobody in this app is owed anything: the payer is not in it. Close to
        # a record and stop — see the docstring.
        tab.status = "closed"
        tab.closed_at = datetime.utcnow()
        tab.payer_participant_id = payer.id
        tab.payer_id = None
        tab.expense_id = None
        db.commit()
        db.refresh(tab)
        return _tab_out(db, tab)

    expense = models.Expense(
        description=tab.name,
        amount=amount,
        currency=tab.currency,
        date=payload.date or datetime.utcnow().date().isoformat(),
        payer_id=payer.user_id,
        payer_is_guest=False,
        group_id=None,  # A tab never becomes a group.
        created_by_id=current_user.id,
        split_type="ITEMIZED",
        receipt_image_path=tab.receipt_image_path,
        icon="🧾",
        notes=f"Closed from a tab at {tab.name}",
        is_settlement=False,
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)

    for participant in participants:
        owed = shares.get(participant.id, 0)
        if participant.user_id is not None:
            db.add(
                models.ExpenseSplit(
                    expense_id=expense.id,
                    user_id=participant.user_id,
                    is_guest=False,
                    amount_owed=owed,
                )
            )
        else:
            # Anonymous claimers land as expense guests, the same records a
            # direct expense with guests already uses.
            db.add(
                models.ExpenseGuest(
                    expense_id=expense.id,
                    name=participant.display_name,
                    amount_owed=owed,
                    created_by_id=current_user.id,
                )
            )

    tab.status = "closed"
    tab.closed_at = datetime.utcnow()
    tab.payer_id = payer.user_id
    tab.payer_participant_id = payer.id
    tab.expense_id = expense.id
    # The link is deliberately NOT revoked here. People are still holding it
    # open on their phones when the host closes, and a revoked link would show
    # them an error instead of what they ended up owing. Writes are already
    # refused once status is "closed", and the token still expires on its own.
    # Revoking stays a separate, explicit action.
    db.commit()
    db.refresh(tab)

    return _tab_out(db, tab)


# ---------------------------------------------------------------------------
# Public surface — unauthenticated, token-scoped, rate-limited
# ---------------------------------------------------------------------------


@router.get(
    "/public/tabs/{share_token}",
    response_model=schemas.PublicTabOut,
    dependencies=[Depends(public_tab_rate_limiter)],
)
def read_public_tab(share_token: str, db: Session = Depends(get_db)):
    return _public_tab_out(db, _load_tab_by_token(db, share_token))


@router.post(
    "/public/tabs/{share_token}/join",
    response_model=schemas.TabJoinResponse,
    dependencies=[Depends(tab_join_rate_limiter)],
)
def join_public_tab(
    share_token: str,
    payload: schemas.TabJoinRequest,
    current_user: Annotated[
        Optional[models.User], Depends(get_optional_current_user)
    ] = None,
    db: Session = Depends(get_db),
):
    """
    Take a seat at the table. Anonymously, or as your account.

    Returns a claim token that identifies this person on later requests. For
    someone with no account it is the only handle they have on their claims.

    Signing in matters here: an account on the participant is what turns their
    share into an `ExpenseSplit` at close, so the bill lands in their balances
    and on the payer's person page, rather than an `ExpenseGuest` the payer has
    to chase in person. So a signed-in caller is recognised three ways:

      * already seated on this tab — the host opening their own link, or anyone
        coming back on a second device — is handed back the seat they have,
        since the account, not the browser, says who they are;
      * holding the claim token of an anonymous seat — they claimed first and
        signed in afterwards — has the account bound to that seat, keeping
        every line they already ticked;
      * otherwise seated fresh, under the name on their account.

    Seating is otherwise a one-time act: a caller who already holds a claim
    token renames rather than joining again (see
    `rename_public_tab_participant`), and joining under a name already at the
    table is refused rather than merged — matching on name alone would let
    anyone with the link claim to be somebody who is already here.
    """
    tab = _load_tab_by_token(db, share_token)
    if tab.status != "open":
        raise HTTPException(status_code=409, detail="This tab is closed")

    if current_user:
        seated = (
            db.query(models.TabParticipant)
            .filter(
                models.TabParticipant.tab_id == tab.id,
                models.TabParticipant.user_id == current_user.id,
            )
            .first()
        )
        if seated:
            # Handing back their own claim token is not a leak: they proved the
            # account it belongs to, and without it they could not amend the
            # claims they came back to amend.
            return _join_response(db, tab, seated)

        adopted = _adopt_anonymous_seat(db, tab, payload.claim_token, current_user)
        if adopted:
            return _join_response(db, tab, adopted)

    name = _clean_name(payload.display_name or _account_name(current_user))
    if not name:
        raise HTTPException(status_code=400, detail="Please give a name")
    if _name_is_taken(db, tab.id, name):
        raise HTTPException(status_code=409, detail=NAME_TAKEN_DETAIL)

    participant = models.TabParticipant(
        tab_id=tab.id,
        display_name=name,
        user_id=current_user.id if current_user else None,
        claim_token=secrets.token_urlsafe(32),
    )
    db.add(participant)
    try:
        db.commit()
    except IntegrityError:
        # Two phones typing the same name at once: the index decides.
        db.rollback()
        raise HTTPException(status_code=409, detail=NAME_TAKEN_DETAIL) from None
    db.refresh(participant)

    return _join_response(db, tab, participant)


@router.post(
    "/public/tabs/{share_token}/rename",
    response_model=schemas.TabIdentityResponse,
    dependencies=[Depends(public_tab_rate_limiter)],
)
def rename_public_tab_participant(
    share_token: str,
    payload: schemas.TabRenameRequest,
    db: Session = Depends(get_db),
):
    """
    Change the name you are claiming under, keeping the claims you made.

    People correct a typo or add a last initial *after* ticking half the bill,
    and the row they are already claiming from is the one that has to change.
    Rejoining under the new name would seat a stranger and leave their items
    under a name nobody is answering to — so it renames in place, and the claim
    token stays the same because it is the claimer's only way back.
    """
    tab = _load_tab_by_token(db, share_token)
    if tab.status != "open":
        raise HTTPException(status_code=409, detail="This tab is closed")

    participant = _participant_for_claim_token(db, tab, payload.claim_token)

    name = _clean_name(payload.display_name)
    if not name:
        raise HTTPException(status_code=400, detail="Please give a name")
    if _name_is_taken(db, tab.id, name, excluding_id=participant.id):
        raise HTTPException(status_code=409, detail=NAME_TAKEN_DETAIL)

    participant.display_name = name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=NAME_TAKEN_DETAIL) from None
    db.refresh(participant)

    return schemas.TabIdentityResponse(
        participant=schemas.TabParticipantOut(
            id=participant.id,
            display_name=participant.display_name,
            user_id=participant.user_id,
        ),
        tab=_public_tab_out(db, tab),
    )


@router.post(
    "/public/tabs/{share_token}/items/{item_id}/claim",
    response_model=schemas.PublicTabOut,
    dependencies=[Depends(public_tab_rate_limiter)],
)
def claim_public_tab_item(
    share_token: str,
    item_id: int,
    payload: schemas.TabClaimRequest,
    db: Session = Depends(get_db),
):
    """
    Claim or release one line.

    Several people on the same line is sharing, not a conflict — the line
    splits between them at close. Claiming twice is idempotent.
    """
    tab = _load_tab_by_token(db, share_token)
    if tab.status != "open":
        raise HTTPException(status_code=409, detail="This tab is closed")

    participant = _participant_for_claim_token(db, tab, payload.claim_token)

    item = (
        db.query(models.TabItem)
        .filter(models.TabItem.id == item_id, models.TabItem.tab_id == tab.id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    existing = (
        db.query(models.TabItemClaim)
        .filter(
            models.TabItemClaim.item_id == item.id,
            models.TabItemClaim.participant_id == participant.id,
        )
        .first()
    )

    if payload.claimed and not existing:
        db.add(
            models.TabItemClaim(
                tab_id=tab.id, item_id=item.id, participant_id=participant.id
            )
        )
        db.commit()
    elif not payload.claimed and existing:
        db.delete(existing)
        db.commit()

    return _public_tab_out(db, tab)
