## 2026-01-09 - Accessibility in Complex Collapsible Headers
**Learning:** Collapsible headers that contain other interactive elements (like a currency toggle inside a header row) present a semantic challenge. Nesting buttons is invalid HTML.
**Action:** The solution is to split the visual row into a main `<button>` for the toggle action (occupying the majority of the space) and a separate container for the other interactive elements. Use `pointer-events-none` on the secondary container to prevent it from blocking the main button's click area, while re-enabling `pointer-events-auto` on the specific interactive children.

## 2026-01-20 - Explicit Close Buttons in Modals
**Learning:** Users expect an explicit "Close" (X) button in the top-right corner of modals, even when a "Cancel" button exists at the bottom. This is especially critical for full-screen or large modals on mobile devices to provide a clear, standard escape hatch.
**Action:** Ensure all future modals include a top-right close icon button with `aria-label="Close modal"` to improve accessibility and usability.
