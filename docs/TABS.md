# Tabs

A tab is a one-off bill that people claim their own items from, using a link.
Nobody has to be invited, nobody has to have an account, and no group is
created.

The flow it replaces: one person scans a receipt, then taps through forty
checkboxes on everyone else's behalf while the table reads out what they had.
With a tab, the host scans once and sends a link; everyone else opens it, types
a first name, and ticks their own lines. Closing the tab turns it into one
ordinary expense.

**A tab is never a group.** It has no members, no permanent home, and it does
not appear under Groups. It shows up in Activity and in person balances once it
closes.

## Lifecycle

```
scan receipt → open tab → share link → people join and claim → close → one expense
```

1. **Open.** `POST /tabs` with the scanned lines, tax, tip and printed total.
   The response carries a `share_token` — the only credential for the link.
   The tip is set here, on the "Where are you?" sheet, because a receipt is
   printed before the tip is written on it — the scan almost never finds one,
   and everyone claiming from the link is shown their share *including* their
   part of the tip. Setting it at the start is what keeps the figures people
   see honest from the first claim; correcting it later (see below) is always
   possible, but everyone who has already looked saw the old number.

   The same sheet reconciles the scanned lines against the printed total and
   offers any shortfall as tip. That is where a service charge lands: the
   parser is told to keep tips and fees off the item list, but a line reading
   "Service Fee" is a tip in all but name and no prompt can tell the two apart
   reliably — so the host decides, and either way it belongs in the tip rather
   than as a line one person has to claim. The reconciliation is measured
   against the tip the *scan* found, not the live field, so writing a tip in
   never reads as overshooting the printed total.
2. **Claim.** Anyone with the link joins with a display name and ticks lines.
   Several people on the same line is sharing, not a conflict.
3. **Close.** `POST /tabs/{id}/close` computes what each person owes and writes
   a single direct expense (`group_id = NULL`, `split_type = "ITEMIZED"`).

Tax and tip stay correctable through `PATCH /tabs/{id}/amounts` for as long as
the tab is open, from the board on either posture. Nothing about the scan is
treated as final.

## Database Schema

**Tab**
- `id`, `name` (the venue, e.g. "Bar Sol"), `created_by_id`, `currency`
- `share_token` - high-entropy public token; unique, indexed
- `token_expires_at` - 7 days from creation (`TAB_LINK_LIFETIME`)
- `revoked` - kills the link without closing the tab
- `status` - `open` | `closed`
- `payer_id` - who fronted the bill; defaults to the creator at close
- `tax`, `tip`, `total` - cents. `total` is what the receipt printed until the
  host takes the numbers over — writing in a tip the scan did not find, or
  correcting either amount later — at which point it is the bill they will
  actually be charged (items + tax + tip).
- `receipt_image_path`, `created_at`, `closed_at`
- `expense_id` - set once the tab resolves into a real expense

**TabItem**
- `id`, `tab_id`, `description`, `price` (cents)
- `added_manually` - true for lines typed on the live board rather than scanned.
  The API will delete any line (dropping its claims with it); offering deletion
  only for hand-added lines is a UI convention, so the board does not drift
  from the paper receipt beside it.

**TabParticipant**
- `id`, `tab_id`, `display_name` - unique per tab, case-insensitively:
  `ux_tab_participants_tab_name` on `(tab_id, lower(display_name))`
- `joined_at`
- `user_id` - set when a signed-in user claims; `NULL` for anonymous claimers
- `claim_token` - the anonymous claimer's only handle on their own claims.
  Returned exactly once, at join. Never included in any listing.

Participants are created the moment somebody claims, not by invitation.

### One person, one row

The claim token is who somebody *is*; the name is a label on that row. Joining
seats a person exactly once, so changing a name renames the existing row
(`POST /public/tabs/{token}/rename`) rather than joining again — a second row
would leave everything already ticked stranded under a name nobody is
answering to, and show the table two people who are one.

An account is the same invariant on the other axis, held by
`ux_tab_participants_tab_user` on `(tab_id, user_id)`. `NULL` repeats freely
under a unique index, so anonymous seats are unaffected while a signed-in
person cannot be seated twice — which would put two splits for one user on the
closed expense.

### Signed-in claimers

`POST /public/tabs/{token}/join` takes an *optional* bearer token, and an
account on the seat is what makes the difference at close: a participant with
`user_id` becomes an `ExpenseSplit`, so the bill lands in their balances and on
the payer's person page, where an anonymous one becomes an `ExpenseGuest` the
payer has to chase in person. So a signed-in caller is recognised three ways:

1. **Already seated** — the host opening their own link, or anyone returning on
   a second device — is handed back the seat they have, along with its claim
   token. The account, not the browser, says who they are, and without the
   token they could not amend the claims they came back for. It is not a leak:
   they proved the account it belongs to.
2. **Holding an anonymous seat's claim token** — they claimed first and signed
   in afterwards — has the account bound to that seat, keeping every line they
   already ticked. A seat already owned by a different account is never
   adopted.
3. **Otherwise** seated fresh, under the name on their account (`full_name`,
   falling back to the local part of their email).

Credentials that do not check out are a `401` rather than an anonymous join:
silently downgrading someone whose access token expired would seat them as a
guest and quietly lose the association they came for, where a `401` lets the
client refresh and retry. Absent credentials are simply anonymous — the link
must keep working for the four people at the table who have never heard of us.

Names are also unique per tab, enforced by the index above, because a name is
how everyone else at the table tells people apart and two "Maya"s are unusable
however they arose. A join under a name already present is refused with `409`
and a prompt to add a last initial. It is deliberately **not** resolved by
handing the newcomer the existing participant: the claim token is the
credential, and matching on name alone would let anyone holding the link edit
Maya's claims by typing "Maya".

**TabItemClaim**
- `id`, `tab_id`, `item_id`, `participant_id`
- `UNIQUE (item_id, participant_id)` — `ux_tab_item_claims_item_participant`.
  Claiming twice is idempotent at the API level and impossible at the schema
  level.

## Security Model

The public tab endpoints are the app's first *writable* unauthenticated
surface. `Group.share_link_id` is a permanent read-only UUID; a tab's token
lets a stranger create a participant and move money. So the token is:

- **High-entropy** — `secrets.token_urlsafe(32)`, not a UUID.
- **Scoped to one tab** — resolved by token alone. No caller-supplied tab id is
  ever consulted, so a token cannot reach a tab it does not belong to.
- **Expiring** — 7 days, returning `410 Gone` afterwards.
- **Separately revocable** — `POST /tabs/{id}/revoke` returns `404` from then
  on, and is independent of expiry and of closing.
- **Rate-limited** — 30 req/min on public reads and claims, 10 req/min on join.
- **Narrow** — the public payload omits the share token, every participant's
  claim token, the creator's user id, the tab id, and every other tab.

Claim tokens are scoped the same way: a claim token issued for one tab is
rejected on another (`403`).

Closing does **not** revoke the link. People are still holding it open on their
phones when the host closes, and a dead link would show them an error instead
of what they ended up owing. Writes are already refused once `status` is
`closed`, and the token still expires on its own.

## Share Computation

`backend/utils/tabs.py` — deliberately free of SQLAlchemy so the arithmetic can
be tested on plain data. Everything is in cents and every result sums *exactly*
to the bill.

1. **Items.** Each line splits evenly between whoever claimed it. The remainder
   goes one cent at a time to the earliest recipients, so 100¢ three ways is
   `[34, 33, 33]`, not `[33, 33, 33]` losing a cent.
2. **Orphans.** A line nobody claimed is spread across the whole table rather
   than dropped or charged to the payer. Closing a tab must not silently lose
   money.
3. **Tax and tip.** Distributed in proportion to each person's item total, so
   whoever ordered more carries more. Remaining cents go to the largest
   fractional parts. With no weight anywhere it falls back to an even split.

`frontend/src/utils/tabShares.ts` is a TypeScript port used for the live
preview on the board and the claim screen — round-tripping every tap would be
worse. **The server is the authority**; its numbers are the ones recorded at
close. The two test suites run the same cases so they cannot drift apart
unnoticed (`backend/tests/test_tabs_math.py`,
`frontend/src/utils/__tests__/tabShares.test.ts`).

### Showing the working

`computeTabBreakdowns` is the same computation with its intermediate steps
kept: each person's lines, their item subtotal, their tax and tip, their total.
`computeItemShares` and the breakdown both derive from one internal walk
(`allocateLines`), so a person's lines always add up to the figure printed
beside their name — the working can never contradict the total.

Tax and tip are reported separately even though the server distributes them as
a single figure. The combined share is computed first and the tax is carved out
of it, rather than distributing each independently, so the two halves always
add back to the cent that actually gets charged. With one of them zero the
other takes the whole share exactly.

`payerParticipantId` exists because both sides of "is this seat the payer?" are
nullable and mean unrelated things: an open tab has no payer, and an anonymous
claimer has no account. Comparing them directly labels the first guest at every
open tab as having paid the bill.

## Closing

Closing writes one ordinary direct expense on the existing `group_id IS NULL`
path:

- Registered participants become `ExpenseSplit` rows, so the bill shows up in
  their balances and on the payer's person page as an ordinary shared expense.
- Anonymous participants become `ExpenseGuest` rows — the same records a direct
  expense with guests already uses.
- The expense gets `split_type = "ITEMIZED"`, icon `🧾`, and a note naming the
  venue. `Tab.expense_id` points at it.

Refused with `409` if the tab is already closed, has no items, or nobody has
joined. Refused with `400` if the chosen payer is anonymous — an expense must
be paid by a real account for balances to work.

### Getting back to a closed tab

Closed tabs are not listed anywhere — `GET /tabs` is filtered to `open` by
every caller — so the expense is the only handle on one. `GET
/expenses/{id}` therefore carries `tab_id`, derived from `Tab.expense_id`, and
the expense detail view turns it into a "View tab" action.

Only for the tab's owner. `GET /tabs/{id}` answers everyone else with `404`
precisely so it never confirms a tab exists, so `tab_id` is filtered on
`created_by_id` to avoid both leaking that and offering a link that dead-ends.
Anonymous claimers never had an account to read the expense with in the first
place.

Deleting that expense is the only way to be rid of a tab, and it clears
`Tab.expense_id` on the way out. It has to: the id is a SQLite rowid, freed the
moment the row goes and handed straight to the next insert, so a tab left
holding one ends up answering for an unrelated expense — its owner offered a
trip back to a bill they had already thrown away, with the wrong people on it.
The tab stays `closed` rather than reopening, since its claims are spent and
reopening would put a writable link back in circulation; it is simply
unreachable, which is what deleting it meant.
`migrations/detach_tabs_from_deleted_expenses.py` clears the links written
before this held, and runs on every boot.

## API Endpoints

### Owner (authenticated)
- `POST /tabs` - open a tab from scanned lines
- `GET /tabs` - your tabs; `?status_filter=open`
- `GET /tabs/{tab_id}` - full view, including the share token
- `POST /tabs/{tab_id}/items` - add a line the scan missed
- `DELETE /tabs/{tab_id}/items/{item_id}` - remove a line, dropping its claims.
  The UI only offers this for hand-added lines.
- `PATCH /tabs/{tab_id}/amounts` - correct the tax or the tip. Either field may
  be omitted to leave it alone. The scan is a convenience, not the authority:
  a receipt prints before the tip is written on it, a "Service Fee" line is a
  tip in all but name, and a tax line can be missed outright — whoever is
  holding the bill can see what it really says. `total` follows the correction
  (items + tax + tip), since once the host takes the numbers over what matters
  is the figure the table is being asked for. Refused with `409` on a closed
  tab: the expense is already written, and moving the tax underneath it would
  leave the two disagreeing with no way to tell which was meant. Claimers pick
  the new figures up on their next poll.
- `POST /tabs/{tab_id}/participants` - seat somebody the owner is claiming on
  behalf of. A guest seat: joining otherwise needs the link, which is no use to
  the person at the table with a flat phone. Grants nothing the owner did not
  already have, since they can already tick any seat. Same name rules as
  joining, and a `409` on a collision either way round.
- `POST /tabs/{tab_id}/items/{item_id}/claim` - claim as yourself. The host is a
  participant like anyone else, and their claim token is never handed out, so
  identity comes from the session. Open to any signed-in participant.
- `POST /tabs/{tab_id}/items/{item_id}/claim/{participant_id}` - set anyone's
  claim. Owner only. Somebody at the table always leaves early or never opens
  the link; without this the desktop grid would be read-only. Grants nothing the
  owner did not already have — they can close the tab and decide who paid.
- `POST /tabs/{tab_id}/revoke` - kill the link without closing
- `POST /tabs/{tab_id}/close` - resolve into one expense

### Public (no auth, rate-limited)
- `GET /public/tabs/{share_token}` - read the tab
- `POST /public/tabs/{share_token}/join` - join with a name; returns a claim
  token. `409` if that name is already at the table. Takes an optional bearer
  token: a signed-in caller is seated as their account, and an optional
  `claim_token` binds that account to the anonymous seat they have been
  claiming from.
- `POST /public/tabs/{share_token}/rename` - change the name you claim under,
  keeping your claims and your claim token. Authenticated by `claim_token`.
- `POST /public/tabs/{share_token}/items/{item_id}/claim` - claim or release,
  authenticated by `claim_token` in the body

## Frontend

**Routes**
- `TabBoardPage.tsx` - the host's view. Picks a posture with `useIsDesktop`.
- `TabClaimPage.tsx` - `/t/:shareToken`. No auth, no shell: the token is the
  only credential and most people opening it have no account.
- `TabPassPage.tsx` - `/tabs/:tabId/pass`. Signed in, but no shell — see
  *Passing the phone*.
- `TabClosePage.tsx` - confirm who paid, see the final shares.

**Components** (`src/components/tab/`)
- `TabBoardDesktop.tsx` - the two-pane board
- `ReceiptPaper.tsx` - the bill as paper, printed from the tab's own lines
  rather than the scanned photo, since a photo cannot show which lines are
  still nobody's. Fixed to the light palette in both themes.
- `TabMatrix.tsx` - every item against every person, with per-person totals
- `TabBreakdown.tsx` - what each person owes and why: their lines, their share
  of anything unclaimed, their tax and tip. Rows expand; the viewer's own opens
  first. Exports `TabWorking`, the one-person half of it, for the claim screen.
- `TabProgress.tsx` - how much of the bill is spoken for. Item value only, on
  both sides of the counter: tax and tip are never claimed, they ride along on
  whatever each person picked, so a fully claimed tab reads 100%
- `ClaimerStack.tsx` - overlapping avatars on a claimed line
- `QrCode.tsx` - the share link as a QR. Everyone is at the same table, so a
  code on the host's screen beats sending four messages.

### Two postures

**Mobile** sorts lines into "needs a home" and "sorted" — a phone can only show
one axis at a time, so unclaimed lines lead. A segmented control switches the
same space to what everyone owes; the answer to "what do I owe?" used to live
behind *Close the tab*, a button that reads like a commitment.

**Desktop** shows both axes at once: the receipt on the left, the item × person
grid on the right. Hovering a row in the grid rings the same line on the paper.
The per-person footer totals are what closing *right now* would record, so they
include each person's share of the unclaimed lines; the outstanding amount is
called out separately. The breakdown sits below the grid, so the totals and
their working are on one screen.

## Passing the phone

For the table where the others have no phone on them. The host's device goes
round and each person claims their own lines on it — `/tabs/:tabId/pass`.

It is **the claim screen with a seat picker on top**, not the board with a
person dropdown. The board is the host's surface: share link, close button, and
the whole signed-in app in a tab bar underneath. So the route is signed in like
any owner surface but sits *outside* `ShellRoute`, next to the public claim
page. That placement is the design, not a routing detail.

It is not a kiosk and does not pretend to be — a browser always has a back
gesture. What the shell-less route removes is every path that *invites* you
into the account while somebody else is holding the phone.

**The loop.** Picker → one person's turn → *Done — pass it on* → picker.

- The picker leads with the **orphan count**, not a roster: an unclaimed line
  is what gets spread across the whole table at close, so that is the number
  that says whether you are finished. Mixed tables are the normal case, so
  whoever already used the link shows their count and gets skipped.
- A turn opens with the name in a tinted band. The one failure mode here is
  ticking items onto the wrong person, so identity is something you cannot
  miss rather than a control you have to read. The host takes a turn like
  anyone else and is addressed as "you".
- `+ Someone else` seats a name inline and drops straight into their list.
  Half the table never opened the link, so it cannot be a detour.

**Idle returns to the picker, never out.** After `IDLE_MS` (45s) a quiet turn
falls back to "who's got the phone?". That is the real mis-attribution risk:
the phone goes face-up when Maya finishes and the next person picks it up.

**Polling stops mid-turn.** The picker refreshes every 5s because somebody may
still be claiming from their own phone; a poll landing between taps would move
the list under the person using it.

**Getting in and out.** Sending the link, showing a QR and passing the phone
are three mechanisms for one question — how do everyone's picks get in? — so
they share a sheet behind *Get picks*. It costs one tap on the commonest path.
The exit is deliberately **not** called "Done": that is what ends a turn, one
screen over, and somebody finishing their items must not drop the host back
into their own account by reflex. It confirms through `AlertDialog` with
`destructive={false}` — nothing is lost by stopping, and a red warning would
say otherwise.

Nothing is ever mid-edit: claims save on every tap, as on the claim link, so
the phone can come back at any moment with nothing pending.

**Not built.** Handing a seat over. A hand-seated person's claim token is never
returned, so they cannot later claim from their own phone — acceptable while
the premise is that they have not got one, and a per-seat handoff link is a
separate feature.

### Where the breakdown appears

The same component on four surfaces, so a person's number is explained wherever
they meet it:

- **The board**, live, for the host — mobile behind the toggle, desktop under
  the grid.
- **The close screen**, where every row opens onto its lines. It is the last
  look before the money becomes real balances, so it is the last chance to
  notice somebody was charged for a bottle they never claimed.
- **The claim screen**, for the one person reading it: *Your bit* expands into
  their own lines, their share of anything spare, and the tax and tip that
  arrived without ever being ticked. Recomputed on every tap.
- **The expense detail modal**, for a closed tab. Closing writes no expense
  items — the item detail only ever existed on the tab — so the recorded splits
  flatten to one figure per person and the modal reads the tab back in to
  explain them. `Tab.expense_id` is only exposed to the tab's owner, so only
  they can make that request. The recorded *Split breakdown* stays below it:
  the expense remains editable after the fact, and it is the record.

The board polls every 5 seconds while the tab is open, because claims arrive
from other people's phones.

## Migrations

`backend/migrations/add_tabs.py` — additive, idempotent, four new tables.
Supports `--dry-run`.

`backend/migrations/add_tab_participant_name_uniqueness.py` — adds
`ux_tab_participants_tab_name` and `ux_tab_participants_tab_user`. Databases
written before the rename endpoint existed can hold duplicate names, so it
suffixes the later of each pair ("Maya" → "Maya (2)") first; a repeated account
(which no released code path produces, but which would stop the container
booting) has the account detached from the later seat, leaving it a guest seat
with its claims. Runs from `start.sh`; idempotent, and supports `--dry-run`.

## Not Built

- **Nudging** a participant who has not claimed. They are link-holders and
  often have no account, so there is no address to reach them at.
- **Retroactive group promotion.** Offering to turn recurring tab participants
  into a real group needs recurrence data across closed tabs.
- **Retroactive account linking.** Someone who claims anonymously and signs up
  a week later does not get their old tabs; the account starts counting from
  the next one. Deliberate, not a gap — a tab is ephemeral, and reaching back
  into settled bills to reassign guest lines would rewrite balances other
  people have already acted on. Signing in mid-tab is a different thing and is
  supported: the seat is adopted from the claim token this browser is holding
  (see *Signed-in claimers*), so nothing settled is disturbed.
