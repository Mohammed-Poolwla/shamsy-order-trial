/**
 * Worked-example acceptance checks (PDF trial).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    const key = trimmed.slice(0, i);
    let val = trimmed.slice(i + 1);
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

function discountBps(discountCents, lineValueCents) {
  if (lineValueCents <= 0) return 0;
  return Math.floor((discountCents * 10000) / lineValueCents);
}
function lineBand(bps) {
  if (bps === 0) return "none";
  if (bps <= 300) return "sand";
  if (bps <= 500) return "red";
  return "blocked";
}
function usdCentsToSdg(usdCents, rate) {
  return Math.floor((usdCents * rate) / 100);
}
function computeLine(line) {
  const lineValueCents = line.unitPriceCents * line.quantity;
  const discountCents = Math.max(0, Math.min(line.discountCents, lineValueCents));
  const lineTotalCents = lineValueCents - discountCents;
  const bps = discountBps(discountCents, lineValueCents);
  const band = lineBand(bps);
  return { lineValueCents, discountCents, lineTotalCents, bps, band, needsApproval: band === "blocked" };
}
function computeOrderTotals(lines, exchangeRate) {
  const computed = lines.map(computeLine);
  const totalUsdCents = computed.reduce((s, l) => s + l.lineTotalCents, 0);
  const totalSdg = usdCentsToSdg(totalUsdCents, exchangeRate);
  const hasBlocked = computed.some((l) => l.band === "blocked");
  return { computed, totalUsdCents, totalSdg, hasBlocked };
}
function clampExchangeRate(rate, minRate) {
  if (!Number.isFinite(rate) || rate < minRate) {
    return { rate: minRate, refused: true };
  }
  return { rate: Math.floor(rate), refused: false };
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL", msg);
    failed++;
  } else {
    console.log("OK  ", msg);
  }
}

const line1 = computeLine({ quantity: 4, unitPriceCents: 51500, discountCents: 4000 });
assert(line1.lineValueCents === 206000 && line1.bps === 194 && line1.band === "sand", "line1 sand 1.94% $2020");
assert(line1.lineTotalCents === 202000, "line1 total");

const line2 = computeLine({ quantity: 2, unitPriceCents: 81000, discountCents: 7000 });
assert(line2.bps === 432 && line2.band === "red" && line2.lineTotalCents === 155000, "line2 red 4.32%");

const line3 = computeLine({ quantity: 1, unitPriceCents: 207000, discountCents: 15000 });
assert(line3.bps === 724 && line3.band === "blocked" && line3.lineTotalCents === 192000, "line3 blocked 7.25%");

const without3 = computeOrderTotals(
  [
    { quantity: 4, unitPriceCents: 51500, discountCents: 4000 },
    { quantity: 2, unitPriceCents: 81000, discountCents: 7000 },
  ],
  8200,
);
assert(without3.totalUsdCents === 357000 && without3.totalSdg === 29274000, "without line3 $3570 / 29,274,000 SDG");

const with3 = computeOrderTotals(
  [
    { quantity: 4, unitPriceCents: 51500, discountCents: 4000 },
    { quantity: 2, unitPriceCents: 81000, discountCents: 7000 },
    { quantity: 1, unitPriceCents: 207000, discountCents: 15000 },
  ],
  8200,
);
assert(with3.totalUsdCents === 549000 && with3.totalSdg === 45018000, "with line3 $5490 / 45,018,000 SDG");

const refused = clampExchangeRate(7900, 8000);
assert(refused.refused && refused.rate === 8000, "7900 refused → 8000");
assert(lineBand(300) === "sand" && lineBand(301) === "red", "3% boundary");
assert(lineBand(500) === "red" && lineBand(501) === "blocked", "5% boundary");

async function serverChecks() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    console.log("SKIP server checks (missing env)");
    return;
  }

  const adviser = createClient(url, anon);
  const { error: signError } = await adviser.auth.signInWithPassword({
    email: "adviser@shamsy.trial",
    password: "trial-adviser-123",
  });
  if (signError) {
    assert(false, `adviser login: ${signError.message}`);
    return;
  }

  const { data: products } = await adviser.from("shamsy_products").select("id, sku");
  const { data: customers } = await adviser.from("shamsy_customers").select("id").limit(1);
  const hope16 = (products ?? []).find((p) => p.sku === "HOPE-16.0LM-A1");
  const customerId = customers?.[0]?.id;
  assert(!!hope16 && !!customerId, "seed products/customers present");

  const { error: blockedError } = await adviser.rpc("shamsy_create_order", {
    p_customer_id: customerId,
    p_exchange_rate: 8200,
    p_lines: [{ product_id: hope16.id, quantity: 1, discount_cents: 15000 }],
    p_approval_id: null,
    p_owner_approved_product_ids: null,
  });
  assert(
    !!blockedError && /SAVE_BLOCKED|5%/i.test(blockedError.message),
    `server blocks >5% (${blockedError?.message ?? "no error"})`,
  );

  const userId = (await adviser.auth.getUser()).data.user?.id;
  const { error: insertError } = await adviser.from("shamsy_orders").insert({
    customer_id: customerId,
    created_by: userId,
    exchange_rate: 8200,
    total_usd_cents: 100,
    total_sdg: 8200,
  });
  assert(!!insertError, `RLS blocks direct order insert`);

  const { data: drafts } = await adviser
    .from("shamsy_orders")
    .select("id")
    .eq("status", "draft")
    .limit(1);
  let draftId = drafts?.[0]?.id;
  let createdDraft = false;
  if (!draftId) {
    const { data, error } = await adviser.rpc("shamsy_create_draft_order", {
      p_customer_id: customerId,
      p_exchange_rate: 8200,
      p_lines: [{ product_id: hope16.id, quantity: 1, discount_cents: 15000 }],
    });
    assert(!error && !!data, `adviser can save >5% as draft (${error?.message ?? "ok"})`);
    draftId = data;
    createdDraft = true;
  }

  if (draftId) {
    const { data: patched } = await adviser
      .from("shamsy_orders")
      .update({ status: "saved" })
      .eq("id", draftId)
      .select("id");
    const { data: after } = await adviser
      .from("shamsy_orders")
      .select("status")
      .eq("id", draftId)
      .single();
    assert(
      (patched ?? []).length === 0 && after?.status === "draft",
      "RLS blocks PATCH draft → saved",
    );

    const { data: patchedLines } = await adviser
      .from("shamsy_order_lines")
      .update({ approval: "approved" })
      .eq("order_id", draftId)
      .select("id");
    assert((patchedLines ?? []).length === 0, "RLS blocks direct line approval");

    if (createdDraft) {
      const { error: finalizeError } = await adviser.rpc("shamsy_finalize_draft_order", {
        p_order_id: draftId,
      });
      assert(
        !!finalizeError && /SAVE_BLOCKED/.test(finalizeError.message),
        `finalize blocks unapproved >5% draft (${finalizeError?.message ?? "no error"})`,
      );
    }
  }

  const { error: forgeError } = await adviser.from("shamsy_discount_approvals").insert({
    requested_by: userId,
    customer_id: customerId,
    exchange_rate: 8200,
    status: "approved",
    payload: { lines: [{ product_id: hope16.id, needs_approval: true }] },
  });
  assert(!!forgeError, "RLS blocks self-approved approval request");

  await adviser.auth.signOut();
}

await serverChecks();

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll acceptance checks passed.");
