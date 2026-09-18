# Custom settle-up amount

## What is actually locked

There is no settlement endpoint. A settlement is `POST /expenses` with
`is_settlement: true`, paid by the debtor, with one EQUAL split putting the
whole amount on the creditor. The backend accepts any positive amount, and the
plan-stability work (`utils/balances.py::plan_group_settlement`,
`test_partial_payment_only_shrinks_its_own_transaction`) already guarantees a
partial payment shrinks only its own transaction. So the restriction is
entirely in the two frontend surfaces that record a *group* payment, both of
which hardcode `Math.round(payment.amount)`:

| Surface | File | Records |
| --- | --- | --- |
| `/settle` (FAB, overview "Settle", mobile balances) | `routes/SettleUpPage.tsx::markPaid` | one plan payment inside one group |
| A group's **Settle up** | `SimplifyDebtsModal.tsx::handleMarkAsPaid` | one plan payment inside that group |

The third surface, `SettleUpModal.tsx` (a person's Settle up on `PersonPage`),
already takes a free-typed amount — but it records outside any group and has
no default, so it does not help with "Sam paid me $40 of the $54.35 from
Tahoe".

## Design

**One shared sheet, `components/settle/SettleAmountSheet.tsx`**, used by both
surfaces. "Mark as paid" stays a single tap for the full figure (the common
case, and the flow every existing test pins). Beside it, a quieter
**"Different amount…"** opens the sheet:

- Header: *You pay Sam* / *Sam pays you*, and *clears Tahoe*.
- One amount field, pre-filled with the full figure, typed through the
  existing `sanitizeAmountInput` (same rules as the add-expense hero:
  numeric keypad, comma-as-decimal, two decimals). Currency is shown as a
  fixed label — a settlement has to be in the debt's currency to cancel it
  exactly (the round trip through USD is not the identity, see
  `docs/FEATURES.md` → *Simplified Debts That Stay Put*), so the sheet does
  not offer a picker.
- A live line under the field: *Leaves $14.35 outstanding* / *Clears it* /
  the validation message.
- Venmo hand-off rebuilt from the typed amount (as `SettleUpModal` does), so
  "pay $40 with Venmo" and "record $40" agree.
- **Record** button, disabled until the entry is valid.

**Validation** (pure, in `utils/settleAmount.ts` so it is unit-testable):

- Must parse to a positive whole number of cents (`amountToCents`).
- May exceed the outstanding figure, but the sheet says what that means:
  the extra flips the debt ("Sam will then owe you $5.65"). Somebody who
  rounded up really did pay that much, and the ledger should say so —
  the group re-plans around a flipped pair, which is the correct answer.
- Whole cents only: plan amounts are quoted and recorded in whole cents so
  no fraction comes back as dust.

**Recording a partial payment**: same expense shape, custom amount, and the
note says so — `Recorded from Settle up · $40.00 of $54.35` — so the feed
row explains why the balance did not go to zero.

**A bug this exposes on `SettleUpPage`**: paid rows are hidden by key, and
the key is `${groupId}-${index}`. After a partial payment the plan reloads
with the same transaction at the same index (that is the stability
guarantee) and the hidden set would hide it. Even today, fully paying index
0 shifts index 1 into its key and hides the wrong row until the reload
lands. Fix: key payments by the pair (`groupId`, from, to, guest flags) —
stable across reloads, and a pair appears at most once in a plan — and only
add to the hidden set on a *full* payment.

## Files

- `frontend/src/utils/settleAmount.ts` — `validateSettleAmount(entry, outstandingCents)` → `{ cents, error, remaining }`; `centsToInput`.
- `frontend/src/components/settle/SettleAmountSheet.tsx` — the sheet.
- `frontend/src/routes/SettleUpPage.tsx` — "Different amount…", stable keys, partial recording.
- `frontend/src/SimplifyDebtsModal.tsx` — same, keeping the per-index processing state.
- `frontend/src/utils/settlement.ts` — `paymentsForUser` key change.
- `docs/FEATURES.md` — a short section under the settle-up material; `frontend/src/data/faq.ts` entry; `CHANGELOG.md`.

No backend changes: the API already does the right thing, and
`test_partial_payment_only_shrinks_its_own_transaction` plus
`test_off_plan_payment_still_reconciles` already pin it. I will add one
integration test that records a partial payment through `/expenses` and
asserts `/simplify_debts` shows the remainder from the same pair, so the
contract the sheet relies on is stated end-to-end.

## Tests

- `utils/__tests__/settleAmount.test.ts` — empty, zero, negative, over the
  figure, exactly the figure, a cent under, comma decimals, `centsToInput`
  round-trip.
- `utils/__tests__/settlement.test.ts` — stable key shape.
- `components/settle/__tests__/SettleAmountSheet.test.tsx` — opens pre-filled
  with the full amount; Record disabled on invalid entry; remaining line;
  Venmo link follows the typed figure; submits cents.
- `__tests__/SimplifyDebtsModal.test.tsx` and a new
  `routes/__tests__/SettleUpPage.test.tsx` — "Different amount…" opens the
  sheet; recording a partial posts the custom amount with the right
  payer/payee and note; the row stays after a partial and disappears after a
  full payment.
- Backend: `tests/test_settlement_stability.py` — partial payment end to end.

## Decisions (confirmed 2026-09-14)

1. One-tap "Mark as paid" stays for the full figure; "Different amount…"
   opens the sheet.
2. Overpayment is allowed with a warning that the debt flips, not refused.

## Addendum (same day): paying somebody the plan did not name

Asked for after the first pass. The row-bound sheet fixes the counterparty,
so "Maya was told to pay Sam but paid Dev" had no home on the settle screens
(only the Add-expense settlement checkbox, or the person-level modal which
records outside any group).

- `components/OffPlanPaymentSheet.tsx` — group picker (on `/settle`, when
  more than one), *Paid by* / *Paid to* pickers over the group's own roster
  (members + unclaimed guests, "You" for the signed-in user), amount, Venmo
  when you are the payer. Both sides pickable, matching the modal's existing
  third-party *Mark as paid*.
- Entry points: *Record a payment to someone else…* under the list on
  `/settle`; *Someone else…* in the Simplify Debts footer (also when empty).
- `settleAmount.ts::settlementExpense` now shapes the expense for all four
  recording paths. `PaymentAmountField.tsx` extracted so both sheets share
  the field.
- `SimplifyDebtsModal` gains a required `groupCurrency` prop: with an empty
  plan there is no transaction to read the currency from.
- Both surfaces re-fetch the plan after an off-plan payment rather than
  patching the list — it is the one case that legitimately re-plans.
