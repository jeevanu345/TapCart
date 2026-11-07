# TapCart design system

Strictly white to black with a selective radius scale. Every colour token is neutral; there is no accent hue. Shape follows function rather than a global square-corner rule. Tokens live in `client/src/styles.css`, primitives in `client/src/ui.tsx`.

- **Corners:** 4px for small details and checkboxes; 8px for buttons, inputs, search fields and navigation items; 12px for panels, product images, menus and toasts; 16px for dialogs and exposed sheet corners. Status labels and counts are pills; avatars, radio buttons, status dots and chart points are circles. Attention markers retain their diamond shape. Tables, metric strips, frame edges, receipts and printed QR labels remain square. No universal radius reset.

- **Themes:** white and black, chosen by toggle or system preference, stored in `tapcart.theme`, applied before paint by `public/theme.js`. Switching runs a circle wipe from the toggle with the View Transitions API.
- **Logo:** the dotted triangle from `public/image.png`, redrawn as `LogoMark` and `public/favicon.svg`. Loading states march its dots.
- **Type:** Geist Variable, self-hosted. Geist Mono only for codes, IDs and SQL. Tabular numerals in all data.
- **State without colour:** a filled dot means settled, a ring means open, a muted dot means past, an inverted pill with a diamond means it needs attention. Labels are always present.
- **Hierarchy:** the only inverted surfaces are the primary action, the active nav item, next-action banners, alerts, tooltips and toasts. Metrics sit in one ruled strip, not a row of cards.
- **Product photos:** rendered in grayscale so catalog images stay inside the system.
- **Landing:** white hero, a gradient band from white to black, then black. It forces its own tokens and ignores the theme.
- **Motion:** strong ease-out `cubic-bezier(0.23, 1, 0.32, 1)`, under 300ms for UI. Buttons scale to 0.97 on press. The command palette has no entrance animation because it opens constantly. Hover effects are gated to fine pointers. Reduced motion removes travel and keeps the final state.
- **Layout:** sidebar 232px, collapsible to 60px, drawer under 860px. Dialogs become bottom sheets under 860px. Tables scroll inside `.table-wrap`.

- **Dropdowns:** shared monochrome Select menus across every screen, with a checkmark for the selected value, keyboard navigation, typeahead and focus return. Popup menus use 12px corners; triggers and options use 8px corners. Touch targets grow to 44px. Category suggestions use the same menu surface while allowing free text. Native controls remain hidden solely for form submission, validation and reset behavior. Background controls are inert while a Select menu is open.
- **Focused workflows:** NFC tools separate encoding, authenticated tags and field testing into tabs, with advanced hardware guidance behind disclosures. Account security uses a 960px content column, compact status badges and 480px form widths.
