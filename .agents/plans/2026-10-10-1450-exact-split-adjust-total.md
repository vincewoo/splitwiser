# Exact split: offer to adopt the summed amount as the new total

Feature request from Clinton. When an EXACT split's amounts do not sum to the
entered total, the "Invalid Split" dialog is a dead end: the only way out is
to go back and retype something. Instead, offer a one-tap path: update the
total to the sum of the entered amounts and save.

## Current flow

- `frontend/src/utils/expenseCalculations.ts:47` `calculateExactSplit` rounds
  each typed amount to cents, sums them, and returns
  `{ splits, error }` when `|sum - total| > 1` cent.
- `frontend/src/utils/expenseTransformations.ts:282` `assembleSplitsPayload`
  dispatches by split type; EXACT passes the result straight through.
- `frontend/src/AddExpenseModal.tsx:401` and
  `frontend/src/ExpenseDetailModal.tsx:435` both call it on save and, on
  `error`, open `AlertDialog` as a plain `type: 'error'` dead end.
- `frontend/src/components/AlertDialog.tsx` already supports
  `type: 'confirm'` with `onConfirm`, `confirmText`, `cancelText`, and
  `destructive: false` for a non-scary primary confirm. The modals just do
  not pass those fields through yet.

## Plan

1. `expenseCalculations.ts`: on the mismatch branch, also return
   `exactSumCents` (the already-rounded integer-cent sum), so no caller
   re-derives it from floats. Widen `assembleSplitsPayload`'s return type.
2. New `frontend/src/utils/exactTotalAdjustment.ts`:
   `getExactTotalAdjustment(splitType, splitResult, enteredTotalCents,
   currency)` returns `{ newTotalCents, title, message, confirmText,
   cancelText }` or `null`. Null when: not EXACT, no error, no sum, or
   sum <= 0 (a zero or negative total is not an expense; keep the dead-end
   error there). Copy states the old total and the new total explicitly,
   via `formatMoney`. No em dashes.
3. Both modals:
   - Extract the post-validation save into `submitExpense(totalAmountCents,
     splits)` (add) / `submitUpdate(totalAmountCents, splits)` (edit) so the
     confirm can save with the adjusted figure in one tap.
   - On EXACT mismatch, open the confirm dialog; `onConfirm` sets the amount
     field to the new total (so a failed save leaves the form consistent)
     and calls the save with `newTotalCents` and the already-computed
     splits, which are exact-by-construction for that total.
   - Extend the `alertDialog` state with optional `confirmText`,
     `cancelText`, `destructive`, and pass them to `<AlertDialog>`.
4. Tests (Vitest, existing patterns):
   - Extend `utils/__tests__/expenseCalculations.test.ts` for
     `exactSumCents`.
   - New `utils/__tests__/exactTotalAdjustment.test.ts` for offer/decline
     cases and copy content.
   - New `__tests__/AddExpenseModal.exactTotal.test.tsx` and
     `__tests__/ExpenseDetailModal.exactTotal.test.tsx`: full flow through
     the dialog to the API payload (amount = sum, splits intact), the
     cancel path, and the zero-sum dead end.

## Edge cases

- Sum 0 or negative: no offer, plain error.
- 1-cent discrepancies are already tolerated upstream and never reach this.
- Rounding: everything is integer cents by the time the offer is built;
  re-running `calculateExactSplit` with the adopted total would pass with
  zero discrepancy.
- Save failure after confirm: amount field already shows the adopted total,
  and the error dialog reopens over a consistent form.
