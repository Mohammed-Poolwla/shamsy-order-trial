# Value-Add & Technical Architectural Note  
**Shamsy trial task — Order entry (discount tiers, FX floor, owner approval)**  
**Role:** Principal Solution Architect / Business Systems Consultant  
**Stack alignment:** Next.js App Router · TypeScript · Supabase (PostgreSQL + RLS)

---

## Why this note exists

The trial screen is not a CRUD form. It is the first control point in a cash cycle where **USD catalogue prices**, **SDG collections under banking caps**, and **EUR reporting** must stay reconcilable months later—while advisers work on phones over fragile 3G.  

What follows is how we would harden that control point into the foundation for Finance, Stock, and dealer multi-tenancy—without rewriting the order model twice.

---

## 1. Financial integrity & zero-loss currency accounting

### The risk you are actually buying down

In a market where the pound can move from ~6,050 to >8,000 per dollar in a few months, any design that **re-derives** historical order amounts from today’s rate will silently rewrite margins. That is not a rounding annoyance; it is a **books integrity failure**. Month-end then becomes archaeology (screenshots, spreadsheets, exchanger chats)—exactly the operating pain described in the brief.

### Snapshot-first money model (what the trial already encodes)

Every commercial event must freeze four facts at write time, as **integers in the smallest unit**—never IEEE floats:

| Field (illustrative) | Meaning | Why it cannot be looked up later |
|---|---|---|
| `unit_price_cents` | USD catalogue price × 100 | Owner may change list price tomorrow |
| `discount_cents` | USD discount on the line | Discount is a decision, not a formula from a rate |
| `exchange_rate` (integer SDG per USD) | Rate the adviser committed | Tomorrow’s “day rate” must not rewrite yesterday |
| `line_total_cents` / `total_usd_cents` | Net USD after discount | Derived once, then immutable |
| `total_sdg` (whole pounds) | `floor(total_usd_cents × rate / 100)` | Stored, not recalculated for reports |

**Rule we treat as non-negotiable:**  
`historical_amount = f(snapshotted inputs)` — never `f(current settings)`.

A report for August must return the **same pound and cent totals** whether run today or in six months, even if the minimum rate is raised to 9,000 or 11,000.

### From order lines to a real ledger (Phase 2–4 readiness)

Orders alone do not close the books. Collections hit **four exchangers**, each with daily intake ceilings, then move through pass-through and UAE accounts into EUR. That requires a **double-entry money movement** model:

- Every transfer is one immutable line: `origin_account_id`, `destination_account_id`, `amount_minor`, `currency`, `rate_snapshot`, `occurred_at`.
- Pass-through accounts must **net to zero**; contradictions surface as exceptions, never “smoothed.”
- Receipts (unique bank transaction codes) allocate to one or many orders **without mutating** the original order totals—allocation is a separate ledger fact.

**Business effect:** margin views (gross, currency result by exchanger route, net after FX) become reproducible. Reconciliation stops being a multi-week reconstruction of WhatsApp screenshots and becomes a timed close against account balances.

### Trial → product bridge

The trial’s `draft → approve line → finalize (saved)` flow is intentional: **approval is a control event**, not a silent UI unlock. Finalizing writes the locked rate and money fields once. From there, Step 3 (receipts) attaches cash without reopening history.

---

## 2. Operational optimization for Sudan’s banking bottlenecks

### Transfer chunking at order creation (eliminate WhatsApp arithmetic)

Customers often must pay large SDG totals as a **sequence of transfers capped at 3,000,000 SDG**. Today that plan is verbal or typed into chats—easy to miscount, easy to forget which exchanger was instructed.

On finalize (or even on draft), the system should emit a deterministic payment instruction:

```
total_sdg = 45_018_000
cap = 3_000_000
full_transfers = floor(total_sdg / cap)   → 15
remainder = total_sdg % cap               → 18_000
```

**Instruction card (example):** “Pay **15 × 3,000,000** + **1 × 18,000** SDG into account **[exchanger / spelling variants]**.”

That single artifact removes a class of coordination errors: wrong number of transfers, wrong remainder, or payment sent to an exchanger who was never told the money is yours.

### Daily 15M exchanger ceilings (prevent trapped funds)

Each exchanger account absorbing ~15,000,000 SDG/day creates a **capacity constraint**, not just a balance. Without live intake tracking:

- Advisers keep routing into an account that is already full → money sits unrecognized.
- Ops discovers the bottleneck only when goods or confirmation stall.

Architecturally, Step 4 binds every receipt to an account and maintains:

- `intake_today_sdg` vs `daily_limit_sdg`
- Outstanding per exchanger
- Soft block / warn when a new order’s payment plan would exceed remaining capacity **on the chosen route**

**Business effect:** fewer “forgotten forwards,” less idle cash at the wrong exchanger, faster release against paid orders (Step 5).

---

## 3. Field-ready resilience for 3G networks

### Failure mode in the field

Advisers in Khartoum and Dongola will lose the radio mid-entry. If “Save” requires a healthy round-trip with no local durability, you lose quotes and recreate the spreadsheet culture this platform is meant to replace.

### Patterns we recommend (and would ship next on this stack)

1. **Optimistic draft state** — UI commits line math locally first; server finalize is authoritative for money.
2. **IndexedDB outbox** — queue `create_draft` / `approve_line` / `finalize` with idempotency keys so a double-tap or retry cannot create duplicate commercial documents.
3. **Lightweight JSON payloads** — no catalogue blobs on write; product identity + integers only (matches how the trial RPC already works).
4. **Session durability** — Supabase auth refresh via cookies; avoid shared logins so audit trails stay personal under weak networks.

### Arabic / RTL without a rebuild (Phase 11)

Phase 11 must be **translation and layout mirror**, not a second app:

- No hard-coded user strings in components; message catalogues from day one.
- Logical CSS (`margin-inline`, `ps`/`pe`, flex without hardcoded left/right).
- Number and date formatting via `Intl` with locale, while **money integers remain locale-agnostic storage**.

The trial UI is intentionally plain; the structure is already compatible with that path.

---

## 4. Hardened security & multi-tenant future-proofing

### Margin secrecy and the 5% gate are server facts

Hiding a cost column in React is not control. An adviser with the anon key must still be unable to:

- read cost / margin fields (when those tables exist), or  
- finalize an order with an unapproved >5% line.

**Enforcement layers we treat as mandatory:**

| Control | Mechanism |
|---|---|
| Discount band >5% | Computed in Postgres; draft lines marked `approval = required` |
| Finalize | RPC refuses while any line remains `required` (`SAVE_BLOCKED`) |
| Direct inserts | RLS denies client inserts into `orders` / `order_lines`; writes via security-definer RPCs |
| Role | `owner` vs `adviser` in DB profiles; owner-only approve RPC |
| Immutability | Saved orders have no update path for money/rate fields |

Client colour bands (sand / red / blocked) are **operator UX**, not the control system.

### Tenant isolation for 570 dealers (Phase 12) without a rewrite

Dealer access is a **tenancy switch**, not a new product. From day one the schema should carry:

- `tenant_id` / `environment_id` on every commercial row (orders, lines, receipts, stock moves).
- Membership table: `user_id → tenant_id → role`.
- RLS of the form: `tenant_id = any(user_tenant_ids())`.

Shamsy’s internal team is tenant `shamsy`; each dealer org is its own tenant on the **same catalogue**, with permissions that never expose group cost or other dealers’ books.

The trial’s role + RPC pattern is the same shape: **authorization in Postgres**, screens as thin clients.

---

## What the trial already proves (submission anchors)

1. **Exact arithmetic** — worked example totals ($3,570 / 29,274,000 SDG without line 3; $5,490 / 45,018,000 SDG with approved line 3).  
2. **>5% cannot be bypassed via the API** — finalize/create paths enforce approval server-side.  
3. **History does not move** — rate and USD/SDG totals snapshotted on the order; settings changes do not rewrite saved documents.  
4. **Draft ≠ order** — owner line approval leaves status `draft`; **Save as order** is an explicit second control step.  
5. **Phone-first** — single-column flow suitable for adviser handsets.

---

## Candid gaps / decisions we would lock with your technical lead

1. **SDG subunits** — we store SDG as whole pounds from integer USD×rate division. Confirm whether a minor unit is required for bank matching.  
2. **Day rate vs minimum** — both are settings; the commercial rate on the order is always the snapshotted applied rate.  
3. **Approval binding** — production should hash the draft line set so discounts cannot be raised after approval without a new approval.  
4. **Exchanger identity** — account-holder alias tables (“Mogtaba / Mujtaba / Motgaba”) belong in Foundation before OCR fantasies; matching humans beats parsing screenshots first.

---

## Commercial bottom line

This platform succeeds if it makes **cash truth** cheaper than WhatsApp and spreadsheets under FX chaos and banking caps. The order screen is where that truth starts: **integer money, frozen rates, server-enforced discount control, draft-then-commit workflow, and a schema that can absorb receipts, exchanger limits, and 570 dealer tenants without a rewrite.**

We are not proposing more UI chrome. We are proposing a control system that still balances when the pound moves—and when the radio drops.

---

*Prepared to accompany the paid trial deliverable (working order screen, repository, walkthrough recording).*
