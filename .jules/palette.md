## 2026-01-09 - Accessibility in Complex Collapsible Headers
**Learning:** Collapsible headers that contain other interactive elements (like a currency toggle inside a header row) present a semantic challenge. Nesting buttons is invalid HTML.
**Action:** The solution is to split the visual row into a main `<button>` for the toggle action (occupying the majority of the space) and a separate container for the other interactive elements. Use `pointer-events-none` on the secondary container to prevent it from blocking the main button's click area, while re-enabling `pointer-events-auto` on the specific interactive children.

## 2024-05-23 - Modal Close Button Inconsistency
**Learning:** Inconsistent modal patterns (some missing top-right close buttons) create friction. Users expect a standard "X" to dismiss, regardless of bottom "Cancel" actions.
**Action:** Standardize all modals to include a top-right close icon button with `aria-label="Close modal"`.
