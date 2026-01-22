## 2024-05-23 - Loading States in Financial Transactions
**Learning:** Users need explicit feedback during financial actions (like settling up) to prevent anxiety about double-payment or failed transactions. A simple "Saving..." state with a disabled button prevents multiple submissions and provides reassurance.
**Action:** Always wrap async financial operations in a try/finally block that manages an `isSubmitting` state, and reflect this in the UI with a spinner and disabled inputs.
