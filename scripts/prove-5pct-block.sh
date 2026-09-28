#!/usr/bin/env bash
# Calls the live Supabase API directly (no UI) as the adviser and tries every
# path to save a 7.25% discount without owner approval. Every attempt must be
# refused by the server, and the adviser's saved-order count must not change.
#
# Usage: bash scripts/prove-5pct-block.sh
# Env:   SUPABASE_URL / SUPABASE_ANON_KEY (falls back to NEXT_PUBLIC_* in .env.local)
set -uo pipefail

cd "$(dirname "$0")/.."
env_get() { [ -f .env.local ] && grep -E "^$1=" .env.local | cut -d= -f2- | tr -d '"' || true; }
URL="${SUPABASE_URL:-$(env_get NEXT_PUBLIC_SUPABASE_URL)}"
ANON="${SUPABASE_ANON_KEY:-$(env_get NEXT_PUBLIC_SUPABASE_ANON_KEY)}"
[ -n "$URL" ] && [ -n "$ANON" ] || { echo "Set SUPABASE_URL and SUPABASE_ANON_KEY"; exit 1; }

FAILED=0
TOKEN=""

call() {
  local method=$1 path=$2 body=${3:-} out
  out=$(curl -sS -X "$method" "$URL$path" \
    -H "apikey: $ANON" -H "Authorization: Bearer ${TOKEN:-$ANON}" \
    -H "Content-Type: application/json" -H "Prefer: return=representation" \
    ${body:+--data "$body"} -w $'\n%{http_code}')
  CODE=${out##*$'\n'}
  BODY=${out%$'\n'*}
}

show() {
  echo
  echo "── $1"
  echo "   $2"
  echo "   → HTTP $CODE  $(echo "$BODY" | jq -c '.message // .' 2>/dev/null || echo "$BODY")"
}

verdict() {
  if [ "$1" = "ok" ]; then echo "   REFUSED ✔"; else echo "   NOT REFUSED ✘"; FAILED=$((FAILED + 1)); fi
}

echo "Target: $URL"

call POST "/auth/v1/token?grant_type=password" \
  '{"email":"adviser@shamsy.trial","password":"trial-adviser-123"}'
TOKEN=$(echo "$BODY" | jq -r '.access_token // empty')
ADVISER_ID=$(echo "$BODY" | jq -r '.user.id // empty')
[ -n "$TOKEN" ] || { echo "Adviser login failed: $BODY"; exit 1; }
echo "Logged in as adviser@shamsy.trial ($ADVISER_ID)"

call GET "/rest/v1/shamsy_profiles?select=role&id=eq.$ADVISER_ID"
echo "Role: $(echo "$BODY" | jq -r '.[0].role')"

call GET "/rest/v1/shamsy_products?select=id,unit_price_cents&sku=eq.HOPE-16.0LM-A1"
HOPE=$(echo "$BODY" | jq -r '.[0].id')
PRICE=$(echo "$BODY" | jq -r '.[0].unit_price_cents')
call GET "/rest/v1/shamsy_customers?select=id&limit=1"
CUSTOMER=$(echo "$BODY" | jq -r '.[0].id')
echo "Line: Hope 16.0LM-A1, 1 × \$$((PRICE / 100)), discount \$150 = 7.25% (stored as 724 bps)"

LINE="[{\"product_id\":\"$HOPE\",\"quantity\":1,\"discount_cents\":15000}]"

call GET "/rest/v1/shamsy_orders?select=id&status=eq.saved"
SAVED_BEFORE=$(echo "$BODY" | jq 'length')

call POST "/rest/v1/rpc/shamsy_create_order" \
  "{\"p_customer_id\":\"$CUSTOMER\",\"p_exchange_rate\":8200,\"p_lines\":$LINE,\"p_approval_id\":null,\"p_owner_approved_product_ids\":null}"
show "1. Save order via RPC, no approval" "POST /rest/v1/rpc/shamsy_create_order"
[ "$CODE" -ge 400 ] && echo "$BODY" | grep -q SAVE_BLOCKED && verdict ok || verdict fail

call POST "/rest/v1/rpc/shamsy_create_order" \
  "{\"p_customer_id\":\"$CUSTOMER\",\"p_exchange_rate\":8200,\"p_lines\":$LINE,\"p_approval_id\":null,\"p_owner_approved_product_ids\":[\"$HOPE\"]}"
show "2. Save order claiming owner inline approval" "POST /rest/v1/rpc/shamsy_create_order (p_owner_approved_product_ids)"
[ "$CODE" -ge 400 ] && verdict ok || verdict fail

call POST "/rest/v1/rpc/shamsy_create_order" \
  "{\"p_customer_id\":\"$CUSTOMER\",\"p_exchange_rate\":8200,\"p_lines\":$LINE,\"p_approval_id\":\"$(uuidgen | tr 'A-Z' 'a-z')\",\"p_owner_approved_product_ids\":null}"
show "3. Save order with a made-up approval id" "POST /rest/v1/rpc/shamsy_create_order (random p_approval_id)"
[ "$CODE" -ge 400 ] && verdict ok || verdict fail

call POST "/rest/v1/shamsy_discount_approvals" \
  "{\"requested_by\":\"$ADVISER_ID\",\"customer_id\":\"$CUSTOMER\",\"exchange_rate\":8200,\"status\":\"approved\",\"payload\":{\"lines\":[{\"product_id\":\"$HOPE\",\"needs_approval\":true}]}}"
show "4. Forge an already-approved approval request" "POST /rest/v1/shamsy_discount_approvals (status=approved)"
[ "$CODE" = "403" ] && verdict ok || verdict fail

call POST "/rest/v1/shamsy_orders" \
  "{\"customer_id\":\"$CUSTOMER\",\"created_by\":\"$ADVISER_ID\",\"exchange_rate\":8200,\"total_usd_cents\":192000,\"total_sdg\":15744000,\"status\":\"saved\"}"
show "5. Insert a saved order directly into the table" "POST /rest/v1/shamsy_orders"
[ "$CODE" = "403" ] && verdict ok || verdict fail

call GET "/rest/v1/shamsy_orders?select=id&limit=1"
ANY_ORDER=$(echo "$BODY" | jq -r '.[0].id // empty')
call POST "/rest/v1/shamsy_order_lines" \
  "{\"order_id\":\"${ANY_ORDER:-$(uuidgen | tr 'A-Z' 'a-z')}\",\"product_id\":\"$HOPE\",\"quantity\":1,\"unit_price_cents\":$PRICE,\"discount_cents\":15000,\"line_value_cents\":$PRICE,\"line_total_cents\":$((PRICE - 15000)),\"discount_bps\":724,\"approval\":\"approved\"}"
show "6. Insert a 7.25% 'approved' line directly into the table" "POST /rest/v1/shamsy_order_lines"
[ "$CODE" = "403" ] && verdict ok || verdict fail

call GET "/rest/v1/shamsy_orders?select=id,shamsy_order_lines(approval)&status=eq.draft&created_by=eq.$ADVISER_ID"
DRAFT=$(echo "$BODY" | jq -r '[.[] | select(any(.shamsy_order_lines[]; .approval == "required" or .approval == "rejected"))][0].id // empty')
if [ -z "$DRAFT" ]; then
  call POST "/rest/v1/rpc/shamsy_create_draft_order" \
    "{\"p_customer_id\":\"$CUSTOMER\",\"p_exchange_rate\":8200,\"p_lines\":$LINE}"
  DRAFT=$(echo "$BODY" | jq -r '. // empty')
  echo
  echo "── (setup) Saved a 7.25% DRAFT via shamsy_create_draft_order → HTTP $CODE, draft $DRAFT"
  echo "   Drafts are allowed by design; the line is stored with approval = required."
fi

call PATCH "/rest/v1/shamsy_orders?id=eq.$DRAFT" '{"status":"saved"}'
show "7. Flip the unapproved draft to 'saved' directly" "PATCH /rest/v1/shamsy_orders?id=eq.<draft>"
PATCHED=$(echo "$BODY" | jq 'if type == "array" then length else 0 end' 2>/dev/null || echo 0)
call GET "/rest/v1/shamsy_orders?select=status&id=eq.$DRAFT"
echo "   draft status afterwards: $(echo "$BODY" | jq -r '.[0].status') (rows changed: $PATCHED)"
[ "$PATCHED" = "0" ] && [ "$(echo "$BODY" | jq -r '.[0].status')" = "draft" ] && verdict ok || verdict fail

call PATCH "/rest/v1/shamsy_order_lines?order_id=eq.$DRAFT" '{"approval":"approved"}'
show "8. Mark the draft's 7.25% line approved directly" "PATCH /rest/v1/shamsy_order_lines?order_id=eq.<draft>"
PATCHED=$(echo "$BODY" | jq 'if type == "array" then length else 0 end' 2>/dev/null || echo 0)
echo "   rows changed: $PATCHED"
[ "$PATCHED" = "0" ] && verdict ok || verdict fail

call POST "/rest/v1/rpc/shamsy_finalize_draft_order" "{\"p_order_id\":\"$DRAFT\"}"
show "9. Finalize the unapproved draft into an order" "POST /rest/v1/rpc/shamsy_finalize_draft_order"
[ "$CODE" -ge 400 ] && echo "$BODY" | grep -q SAVE_BLOCKED && verdict ok || verdict fail

call GET "/rest/v1/shamsy_orders?select=id&status=eq.saved"
SAVED_AFTER=$(echo "$BODY" | jq 'length')
echo
echo "── Adviser's saved orders: before $SAVED_BEFORE, after $SAVED_AFTER"
[ "$SAVED_BEFORE" = "$SAVED_AFTER" ] && echo "   UNCHANGED ✔" || { echo "   CHANGED ✘"; FAILED=$((FAILED + 1)); }

echo
if [ "$FAILED" -eq 0 ]; then
  echo "RESULT: every direct server attempt to save 7.25% without approval was refused."
else
  echo "RESULT: $FAILED check(s) were NOT refused."
  exit 1
fi
