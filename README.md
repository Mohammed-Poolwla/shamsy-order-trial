# Shamsy trial task — order screen

Paid trial for the Shamsy all-in-one business platform: the phone screen where a sales adviser records an order with **fixed USD prices**, **per-line discounts**, a **whole-order FX rate**, and **immutable saved amounts**.

## What it implements

| Rule | How |
|------|-----|
| Prices fixed in USD | Unit price always loaded from `products`; `create_order` re-reads the DB price and ignores any client spoof |
| Discount bands | 0% none · ≤3% sand · ≤5% red · >5% blocked until owner approval |
| Min rate 8,000 | UI clamps on blur; Postgres `create_order` rejects below `app_settings.min_exchange_rate` |
| Saved order never moves | `exchange_rate`, line prices and totals stored on insert; orders have no update policy |
| Money as integers | USD in **cents**; SDG in whole pounds; discount % as **basis points** |
| Server enforcement | Save only via `create_order` RPC (security definer). Direct inserts denied by RLS |

### Worked example (must match PDF)

Rate **8,200** SDG/$:

| Line | Qty × price | Discount | % | Colour | Total |
|------|-------------|----------|---|--------|-------|
| SPF 6000 ES Plus | 4 × $515 | $40 | 1.94% | sand | $2,020 |
| Hope 5.0L-B1 | 2 × $810 | $70 | 4.32% | red | $1,550 |
| Hope 16.0LM-A1 | 1 × $2,070 | $150 | 7.25% | blocked | $1,920 |

- Without line 3 → **$3,570** = **29,274,000 SDG** (saveable)
- Owner approves line 3 → **$5,490** = **45,018,000 SDG**
- Change min rate to 9,000 and reopen → still **8,200** and **45,018,000 SDG**
- Typing rate **7,900** → refused, reset to **8,000**

## Stack

- Next.js App Router + TypeScript + Tailwind CSS
- Supabase (Auth, Postgres, RLS, RPC)
- Mobile-first UI

## Setup

### 1. Use the restaurant-network Supabase project (shared)

This trial **adds only** `shamsy_*` tables/functions. It does **not** drop or alter
Restaurant Network tables (`spaces`, `members`, etc.).

Copy API keys from that project into `.env.local`, plus the **database password**
(Project Settings → Database) so migrations can be applied:

```bash
cp .env.example .env.local
# fill NEXT_PUBLIC_SUPABASE_URL, anon, service_role, SUPABASE_DB_PASSWORD, SUPABASE_PROJECT_REF
```

### 2. Apply additive schema + seed catalogue

```bash
npm run db:apply    # creates shamsy_* objects only
npm run seed        # adviser/owner auth users + products/dealers
```

`seed` creates:

| Email | Password | Role |
|-------|----------|------|
| `adviser@shamsy.trial` | `trial-adviser-123` | adviser |
| `owner@shamsy.trial` | `trial-owner-123` | owner |

Plus the four products and three dealers from the brief.

### 3. Run locally

```bash
npm run verify:money   # asserts PDF arithmetic
npm run dev
```

Open http://localhost:3000 → sign in as adviser.

### 4. Walkthrough for the recording

1. Adviser → New order → Ahmed Trading · rate **8200**
2. Line 1: SPF ×4, discount **40** → sand 1.94%
3. Line 2: Hope 5.0 ×2, discount **70** → red 4.32%
4. Line 3: Hope 16 ×1, discount **150** → blocked; **Save** disabled
5. Remove line 3 → totals **$3,570 / 29,274,000 SDG** → Save
6. Re-add line 3 → Request approval → Owner signs in → Approvals → Approve
7. Adviser → Approvals → “Save order with this approval” → **$5,490 / 45,018,000 SDG**
8. Owner → Settings → set minimum rate to **9000** → reopen the order → still **8200**
9. New order → type rate **7900** → blur → resets to **8000**

## Deploy (Vercel)

**Live trial:** https://demo-upwork-beta.vercel.app

Env vars set on Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

```bash
npm run test:acceptance   # PDF arithmetic + server 5% block
```

## Proof: 7.25% without approval is refused by the server

`bash scripts/prove-5pct-block.sh` logs in as the adviser and calls the Supabase API directly with cURL (no UI), trying every way to save the 7.25% Hope 16.0LM-A1 line without owner approval:

| # | Direct call | Server response |
|---|---|---|
| 1 | `POST /rest/v1/rpc/shamsy_create_order` | 400 `SAVE_BLOCKED` |
| 2 | same, claiming owner inline approval | 400 `Only owner can pass inline line approvals` |
| 3 | same, with a made-up approval id | 400 `Approval request not found` |
| 4 | `POST /rest/v1/shamsy_discount_approvals` with `status=approved` | 403 row-level security |
| 5 | `POST /rest/v1/shamsy_orders` (saved order) | 403 row-level security |
| 6 | `POST /rest/v1/shamsy_order_lines` (7.25% line marked approved) | 403 row-level security |
| 7 | `PATCH /rest/v1/shamsy_orders` draft → `saved` | 0 rows changed, stays draft |
| 8 | `PATCH /rest/v1/shamsy_order_lines` → `approved` | 0 rows changed |
| 9 | `POST /rest/v1/rpc/shamsy_finalize_draft_order` | 400 `SAVE_BLOCKED` |

It then checks the adviser's saved-order count is unchanged. Behind these, the database itself rejects any line over 5% stored with no approval (CHECK constraint) and any saved order containing an unapproved line (trigger) — see `supabase/migrations/20260323140000_harden_discount_guards.sql`.

The single call a reviewer would make:

```bash
TOKEN=$(curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H "Content-Type: application/json" \
  -d '{"email":"adviser@shamsy.trial","password":"trial-adviser-123"}' | jq -r .access_token)

curl -s "$SUPABASE_URL/rest/v1/rpc/shamsy_create_order" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"p_customer_id":"<customer id>","p_exchange_rate":8200,
       "p_lines":[{"product_id":"<HOPE-16.0LM-A1 id>","quantity":1,"discount_cents":15000}]}'
# → 400 {"code":"P0001","message":"SAVE_BLOCKED: one or more lines exceed 5% discount without owner approval"}
```

## Repo layout

```
src/app/(app)/orders/new   # adviser order screen
src/app/(app)/orders/[id]  # immutable saved order
src/app/(app)/approvals    # >5% owner approval flow
src/app/(app)/settings     # owner: change min rate
src/lib/money.ts           # integer money helpers
supabase/migrations/       # schema + RLS + create_order
scripts/seed-users.mjs     # auth users + catalogue
scripts/verify-money.mjs   # PDF number checks
```

## Note for Shamsy (what we’d do differently on the real system)

See [TRIAL_NOTES.md](./TRIAL_NOTES.md).

