# TapCart design system

Strictly white to black. Every token is a neutral; there is no accent hue. Tokens live in `client/src/styles.css`, primitives in `client/src/ui.tsx`.

- **Themes:** white and black, chosen by toggle or system preference, stored in `tapcart.theme`, applied before paint by `public/theme.js`. Switching runs a circle wipe from the toggle with the View Transitions API.
- **Logo:** the dotted triangle from `public/image.png`, redrawn as `LogoMark` and `public/favicon.svg`. Loading states march its dots.
- **Type:** Geist Variable, self-hosted. Geist Mono only for codes, IDs and SQL. Tabular numerals in all data.
- **State without colour:** a filled dot means settled, a ring means open, a muted dot means past, an inverted pill with a diamond means it needs attention. Labels are always present.
- **Hierarchy:** the only inverted surfaces are the primary action, the active nav item, next-action banners, alerts, tooltips and toasts. Metrics sit in one ruled strip, not a row of cards.
- **Product photos:** rendered in grayscale so catalog images stay inside the system.
- **Landing:** white hero, a gradient band from white to black, then black. It forces its own tokens and ignores the theme.
- **Motion:** strong ease-out `cubic-bezier(0.23, 1, 0.32, 1)`, under 300ms for UI. Buttons scale to 0.97 on press. The command palette has no entrance animation because it opens constantly. Hover effects are gated to fine pointers. Reduced motion removes travel and keeps the final state.
- **Layout:** sidebar 232px, collapsible to 60px, drawer under 860px. Dialogs become bottom sheets under 860px. Tables scroll inside `.table-wrap`.
