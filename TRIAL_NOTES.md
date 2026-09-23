# Trial delivery note — Shamsy order screen

## What this trial proves

1. **Arithmetic** — USD cents × locked integer rate → SDG pounds matches the PDF worked example exactly (`npm run verify:money`).
2. **>5% cannot be bypassed** — `create_order` refuses blocked lines without an owner-approved `discount_approvals` row; RLS blocks direct `orders` / `order_lines` inserts.
3. **History does not move** — rate and money fields are written once; there is no update path on `orders`.
4. **Phone-first** — single-column layout, large inputs, sticky save bar.

## What I would do differently on the real system

1. **Nx monorepo** as specified (apps for web, shared `money` / domain libs, e2e). This trial is a single Next app to ship the screen in 6–8 hours.
2. **Multi-tenant `environment_id` / `tenant_id` on every row from day one**, with RLS scoped by membership — dealers become a switch, not a rewrite.
3. **i18n keys for every string** (English files now) so Arabic RTL is translation + layout mirror, not a rebuild.
4. **Approval workflow as first-class order lines in `pending` status** rather than a separate JSON payload — better audit trail when advisers iterate discounts.
5. **Idempotent save + offline queue** (IndexedDB) for 3G drops: optimistic local draft, replay `create_order` when online.
6. **Property / acceptance tests** generated from the tech lead’s goal prompts (Playwright for the worked example; SQL tests for RLS).
7. **Ledger foundation early** — every future receipt/conversion as origin→destination lines with snapshotted rates, even before Step 3 UI.

## Anything unclear or I’d challenge

1. **Discount “above 0% and up to 3%”** — exact 0% is uncoloured; exact 3% is sand; exact 5% is red. Confirmed in code via basis-point thresholds (≤300 / ≤500). Worth locking in the brief as inclusive bounds.
2. **SDG “cents”** — the brief says store money in cents; Sudanese pounds in the examples are whole. I store USD in cents and SDG as whole pounds derived by integer division. For the full ledger I’d confirm whether SDG needs a subunit.
3. **Who may save after approval** — trial lets the adviser (or owner) save with a consumed approval token. In production I’d bind approval to a specific draft hash so the adviser cannot raise the discount after approval.
4. **Minimum rate vs “day’s rate”** — Step 2 mentions a day’s rate separate from the minimum. Trial only enforces the floor; the real system should snapshot both the applied rate and the minimum that applied that day for audit.

## Accounts (after `npm run seed`)

- Adviser: `adviser@shamsy.trial` / `trial-adviser-123`
- Owner: `owner@shamsy.trial` / `trial-owner-123`
