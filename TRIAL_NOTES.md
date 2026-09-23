# Trial delivery note — Shamsy order screen

## How you judge it — and why it matters

| What you check | Why it matters | Proven in this trial |
|---|---|---|
| Exact worked-example numbers | Every future report depends on correct arithmetic | $3,570 → 29,274,000 SDG; $5,490 → 45,018,000 SDG (`test:acceptance`, Load PDF example) |
| 5% block not bypassable via server | Discount control is money control | Draft finalize blocked until owner approves line; RLS denies direct inserts |
| Saved order unchanged when rate changes | The rule the whole administration rests on | Rate + amounts snapshotted; settings → 9,000 leaves saved order at 8,200 |
| Cents + rate on the order | Rounding drift and moving history are the costliest bugs | Integer USD cents; integer rate; SDG stored, never re-derived |
| Works on a phone | Advisers work on phones / weak connections | Mobile-first layout; draft/save sticky actions |
| Note shows understanding | You want someone who thinks along | See `VALUE_ADD_ARCHITECTURAL_NOTE.md` |

## What this trial proves (mechanics)

1. **Arithmetic** — USD cents × locked integer rate → SDG pounds matches the PDF worked example.
2. **>5% cannot be bypassed** — finalize refuses unapproved blocked lines; RLS blocks direct order inserts.
3. **Draft ≠ order** — owner approves the line while status stays `draft`; **Save as order** is a second step.
4. **History does not move** — rate and money fields written once on save; no update path for saved money.
5. **Phone-first** — single-column layout for adviser handsets.

## What I would do differently on the real system

1. **Nx monorepo** as specified (shared `money` / domain libs, e2e).
2. **Multi-tenant `tenant_id` on every row** from day one — 570 dealers as a switch, not a rewrite.
3. **i18n keys + logical CSS** so Arabic RTL is translation work.
4. **Idempotent save + IndexedDB outbox** for 3G drops.
5. **Ledger early** — receipts/conversions as origin→destination lines with snapshotted rates.
6. **Transfer plan on finalize** — N × 3,000,000 SDG + remainder; exchanger daily 15M capacity warnings.
7. **Approval bound to draft hash** so discounts cannot rise after approval without a new approval.

## Anything unclear or I’d challenge

1. **Band bounds** — 0% uncoloured; ≤3% sand; ≤5% red; >5% blocked (basis points).
2. **SDG subunits** — USD in cents; SDG as whole pounds from integer division until you confirm a minor unit.
3. **Day rate vs minimum** — both configurable; applied rate on the order is always the snapshot.
4. **Exchanger aliases before OCR** — match “Mogtaba / Mujtaba” in data before auto-reading screenshots.

## Accounts (after `npm run seed`)

- Adviser: `adviser@shamsy.trial` / `trial-adviser-123`
- Owner: `owner@shamsy.trial` / `trial-owner-123`
