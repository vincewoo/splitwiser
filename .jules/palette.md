## 2026-01-04 - Accessible Toggle States
**Learning:** Adding `aria-pressed` to toggle buttons (like participant selectors) is critical for screen reader users to understand state changes. Visual feedback alone (color change) is insufficient.
**Action:** When implementing custom toggle buttons or multi-select lists, always bind `aria-pressed={isSelected}` and ensure smooth transitions (`transition-all`) for better perceived responsiveness.
