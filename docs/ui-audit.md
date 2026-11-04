# UI audit and rebuild direction

> The visual direction below (warm white, forest green, serif titles) was replaced by the white-to-black system in [DESIGN.md](../DESIGN.md). The functional findings and paper-derived UX contract still apply.

Audit completed from the full legacy source before rebuilding. Scope: every `app/**/*.tsx`, `components/**/*.tsx`, `hooks/*`, `styles/*`, `app/*.css`, root configuration, existing tests and public assets. No legacy source was changed for this audit.

## Product direction

Build a React + TypeScript client and Node API. Use a calm warm-white canvas, forest-green actions, clear dense tables, restrained editorial page titles, small status pills, strong numeric hierarchy and an anchored retailer sidebar. Overview combines actual sales, unit availability, reservations and operational exceptions. Inventory combines catalog and serialized units. Orders separates payment review from completed sales. Intelligence explains recommendations using current store data; model availability must be explicit. Tag studio exports per-unit manifests. Customer pages prioritize tap confirmation, expiring cart ownership and a thumb-accessible checkout. Admin pages prioritize approval decisions and account visibility.

## Functional findings

- Customer cart saves an empty initial state before restoration finishes, risking loss; NFC callbacks close over stale cart state, have no scan abort and can install duplicate readers. Separate lookup paths duplicate logic.
- Current tags identify SKU/custom ID; the paper requires a UUID for each physical unit. A quantity-one SKU cart cannot represent two different units of the same SKU.
- Payment confirmation can be asserted from query parameters; checkout displays payment confirmed for desk orders. No pending/reconciliation/refund UI exists. Repeated checkout has no client idempotency key or submission lock.
- Phone can change after OTP verification without invalidating verification. Coupon discounts remain stale after cart changes. Client sends price/discount totals.
- Product edits/deletes ignore HTTP failures and imply success. Loading/error states often collapse to empty data. Deletion has no review step. Low-stock values are calculated but inventory rows always say in stock.
- Sidebar omits overview/customers/purchases, duplicates inventory/all-products and uses unlabeled mobile buttons without focus containment. Several large card rows cannot fit mobile widths.
- Legacy CSS has two incompatible token sources. Actual app stylesheet omits secondary/chart tokens still used by primitives; stale style file has different fonts. Cards and buttons all move on hover, including structural panels. No reduced-motion rule.
- Multiple toast implementations/hooks and per-page + root toast renderers duplicate infrastructure. Progress still depends on DaisyUI classes even though active stylesheet does not enable that plugin.
- Tests assert obsolete DaisyUI class names on rewritten primitives. They cover utilities and primitive rendering only; no reservation, checkout, role access, errors or user flow.
- Exports hardcode a deployment origin, fail to escape embedded CSV quotes, retain object URLs and have stale select-all state after filtering. Export-all counts refer to filtered data but export the full stock list.
- Admin approval opens Gmail compose without actually delivering promised notifications; status copy says an email will be sent. Revocation behavior differs between admin screens.
- Root dynamic flag has no meaningful framework effect. Next imports/server-component data access couple UI to framework and prevent a standalone React client.

## Paper-derived UX contract

`nfc.tex` sections System Model, Unit Identity, Transaction Protocol and Security require: per-unit UUID deep links; authenticated ownership; `AVAILABLE → RESERVED → SOLD` unit state separate from `CREATED/PAYMENT_PENDING/PAID/COMPLETED/PAYMENT_FAILED/REFUND_PENDING/REFUNDED` order states; a visible reservation expiry, conflict and stale-version recovery; stable idempotency keys for retries; removal blocked during checkout protection; server-authoritative availability/totals; explicit payment pending and recovery. Opening an ordinary HTTPS NDEF URI is the primary cross-device interaction; native Web NFC is optional. A static tag identifies a record and must not be described as proof of authenticity. Returns create a new sale epoch.

## Recommended screens and interactions

| Screen       | Main task                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------- |
| Overview     | Actual revenue trend, order summary, stock health, low-stock action list, recent transactions |
| Inventory    | Search/filter catalog, add/edit/archive, CSV import/export, receive serialized units          |
| Orders       | Search and filter payment state, approve desk payment, invoice, return units                  |
| Customers    | Purchase-derived customer directory, spend and order totals                                   |
| Intelligence | Evidence-backed insights and contextual assistant, clear local/model mode                     |
| Tag studio   | Serialized unit status, copy/open unit link, export NFC provisioning manifest                 |
| Customer     | Open tag link, reserve exact unit, manage owned cart, checkout, payment result/history        |
| Admin        | Pending store approvals, account list, revoke/approve decisions                               |

## Full legacy file inventory

| File                                   | Responsibility / assessment                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `app/admin/dashboard/page.tsx`         | Approval queue and active-store revocation.                                                                               |
| `app/admin/login/page.tsx`             | Admin email/password login.                                                                                               |
| `app/admin/users/page.tsx`             | Server session and store user list.                                                                                       |
| `app/customer/layout.tsx`              | Pass-through client wrapper.                                                                                              |
| `app/customer/page.tsx`                | NFC/URL product lookup, local cart, OTP, coupon and checkout dialog; no physical-unit reservations.                       |
| `app/layout.tsx`                       | Next font, metadata, analytics, theme and global toast root; must migrate to client root.                                 |
| `app/page.tsx`                         | Marketing entry with three role links; repeated CTAs and unverified static metrics.                                       |
| `app/setup/page.tsx`                   | Database initialization UI exposing credential details; replace with operator CLI.                                        |
| `app/store/all-products/page.tsx`      | Separate stock/zero-stock catalog; zero stock incorrectly described as sold history.                                      |
| `app/store/customers/page.tsx`         | Contact cards; monthly activity and contact rate fabricated from total count.                                             |
| `app/store/dashboard/page.tsx`         | Server-session inventory counts and table; currency is USD despite INR elsewhere.                                         |
| `app/store/export/page.tsx`            | Bulk product links with hardcoded deployment host; no serialized unit identity.                                           |
| `app/store/layout.tsx`                 | Dynamic pass-through layout.                                                                                              |
| `app/store/login/page.tsx`             | Store ID/password login, password visibility and inline error.                                                            |
| `app/store/orders/page.tsx`            | Desk payment approval and all order cards; pending rows repeated.                                                         |
| `app/store/page.tsx`                   | Redirect to products.                                                                                                     |
| `app/store/products/page.tsx`          | Catalog CRUD, CSV upload, grid/table views; add/upload forms dominate first viewport.                                     |
| `app/store/purchases/page.tsx`         | Older purchase table and USD metrics, disconnected from navigation.                                                       |
| `app/store/sales/page.tsx`             | Completed orders, payment breakdown, CSV export; icon comparison case bug.                                                |
| `app/store/signup/page.tsx`            | Store signup/approval result, weak password rule and promised email delivery.                                             |
| `components/admin-sidebar.tsx`         | Admin navigation and logout; duplicate shell implementation.                                                              |
| `components/admin-users-client.tsx`    | Store account metrics and revocation list.                                                                                |
| `components/approval-actions.tsx`      | Approval/denial API mutation and Gmail compose side effect.                                                               |
| `components/layout/page-header.tsx`    | Page/layout presentational primitive; shared shell, heading, statistics or section composition.                           |
| `components/layout/page-shell.tsx`     | Page/layout presentational primitive; shared shell, heading, statistics or section composition.                           |
| `components/layout/section-card.tsx`   | Page/layout presentational primitive; shared shell, heading, statistics or section composition.                           |
| `components/layout/stat-card.tsx`      | Page/layout presentational primitive; shared shell, heading, statistics or section composition.                           |
| `components/store-sidebar.tsx`         | Store navigation, mobile overlay and logout; route omissions and mobile accessibility issues.                             |
| `components/theme-provider.tsx`        | next-themes wrapper; migrate if theme support is retained.                                                                |
| `components/ui/accordion.tsx`          | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/alert-dialog.tsx`       | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/alert.tsx`              | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/aspect-ratio.tsx`       | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/avatar.tsx`             | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/badge.tsx`              | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/breadcrumb.tsx`         | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/button.tsx`             | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/calendar.tsx`           | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/card.tsx`               | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/carousel.tsx`           | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/chart.tsx`              | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/checkbox.tsx`           | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/collapsible.tsx`        | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/command.tsx`            | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/context-menu.tsx`       | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/dialog.tsx`             | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/drawer.tsx`             | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/dropdown-menu.tsx`      | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/form.tsx`               | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/hover-card.tsx`         | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/input-otp.tsx`          | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/input.tsx`              | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/label.tsx`              | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/menubar.tsx`            | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/navigation-menu.tsx`    | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/pagination.tsx`         | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/popover.tsx`            | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/progress.tsx`           | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/radio-group.tsx`        | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/resizable.tsx`          | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/scroll-area.tsx`        | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/select.tsx`             | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/separator.tsx`          | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/sheet.tsx`              | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/sidebar.tsx`            | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/skeleton.tsx`           | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/slider.tsx`             | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/sonner.tsx`             | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/switch.tsx`             | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/table.tsx`              | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/tabs.tsx`               | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/textarea.tsx`           | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/theme-toggle.tsx`       | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/toast.tsx`              | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/toaster.tsx`            | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/toggle-group.tsx`       | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/toggle.tsx`             | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/tooltip.tsx`            | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `components/ui/use-mobile.tsx`         | Reusable UI primitive inspected; retain interaction semantics where useful, replace stale styling/framework dependencies. |
| `hooks/use-mobile.ts`                  | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `hooks/use-toast.ts`                   | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `styles/globals.css`                   | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `app/globals.css`                      | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `components/ui/use-toast.ts`           | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `package.json`                         | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `package-lock.json`                    | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `tsconfig.json`                        | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `next.config.mjs`                      | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `postcss.config.mjs`                   | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `vitest.config.ts`                     | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `vitest.setup.ts`                      | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `components.json`                      | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `.eslintrc.json`                       | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `__tests__/lib/utils.test.ts`          | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `__tests__/components/button.test.tsx` | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `__tests__/components/input.test.tsx`  | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |
| `__tests__/components/card.test.tsx`   | Configuration, styling, hook or test source inspected; dependencies and legacy expectations recorded above.               |

## Public asset inventory

| File                          | Inspection                                                                 |
| ----------------------------- | -------------------------------------------------------------------------- |
| `public/image.png`            | 256×144 indexed PNG, used as tiny logo with mismatched aspect ratio.       |
| `public/placeholder-logo.png` | 256×144 indexed PNG.                                                       |
| `public/placeholder-logo.svg` | 215×48 SVG text paths for generic Acme Inc. brand; unsuitable for TapCart. |
| `public/placeholder.svg`      | 1200×1200 gray generic image placeholder.                                  |
| `public/placeholder-user.jpg` | 200×200 JPEG avatar placeholder.                                           |
| `public/placeholder.jpg`      | 1×1 JPEG placeholder.                                                      |

## Design supply

Read the 21st UI build skill and generated `.21st` context. The generated context merges conflicting inactive legacy styles, so source facts take precedence. No installed `21st` CLI or 21st MCP tools were available to this audit agent. No hosted generation or credits were used. Existing Radix interaction patterns, Lucide icons and Recharts are sufficient for the rebuild; the new client has independent, coherent CSS tokens.
