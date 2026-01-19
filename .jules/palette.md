## 2026-01-09 - Accessibility in Complex Collapsible Headers
**Learning:** Collapsible headers that contain other interactive elements (like a currency toggle inside a header row) present a semantic challenge. Nesting buttons is invalid HTML.
**Action:** The solution is to split the visual row into a main `<button>` for the toggle action (occupying the majority of the space) and a separate container for the other interactive elements. Use `pointer-events-none` on the secondary container to prevent it from blocking the main button's click area, while re-enabling `pointer-events-auto` on the specific interactive children.

## 2026-02-09 - Modal State Management and Linting
**Learning:** React hooks linter (`react-hooks/set-state-in-effect`) correctly flags when state updates are triggered synchronously inside `useEffect` based on prop changes, as this causes cascading renders.
**Action:** Instead of relying on `useEffect` to reset form state when a modal opens (`isOpen` becomes true), use a cleanup-on-close pattern. Implement a `resetForm` function and call it in the `onClose` handler and after successful submission. This ensures the form is fresh when reopened without triggering extra render cycles.
