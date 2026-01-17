# Palette's Journal

## 2025-02-12 - Navigation Accessibility Patterns
**Learning:** The application was using `div` and `li` elements with `onClick` handlers for main navigation. This is a common anti-pattern that breaks keyboard navigation (tabbing) and screen reader support (semantic roles).
**Action:** When implementing sidebars or lists that navigate, always use `<Link>` or `<button>` elements. If styling constraints make this hard, revisit the CSS, don't degrade the semantic HTML. Interactive lists should wrap content in interactive elements, not make the list item itself interactive via generic handlers.
