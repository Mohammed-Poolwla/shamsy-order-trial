"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  clampExchangeRate,
  computeLine,
  computeOrderTotals,
  formatBps,
  formatSdg,
  formatUsdFromCents,
  type DraftLine,
} from "@/lib/money";
import type { Customer, Product, Profile } from "@/lib/types";

type Props = {
  profile: Profile;
  products: Product[];
  customers: Customer[];
  minRate: number;
  defaultRate: number;
  approvalId?: string | null;
  initialCustomerId?: string | null;
  initialRate?: number | null;
  initialLines?: Array<{
    product_id: string;
    quantity: number;
    discount_cents: number;
  }> | null;
};

type UiLine = {
  key: string;
  productId: string;
  quantity: number;
  discountDollars: string;
};

function bandClass(band: string) {
  switch (band) {
    case "sand":
      return "band-sand";
    case "red":
      return "band-red";
    case "blocked":
      return "band-blocked";
    default:
      return "band-none";
  }
}

function BandBadge({ band }: { band: string }) {
  const label =
    band === "sand"
      ? "Sand ≤3%"
      : band === "red"
        ? "Red ≤5%"
        : band === "blocked"
          ? "Blocked >5%"
          : "No discount";
  return <span className={`band-badge band-badge-${band}`}>{label}</span>;
}

export function OrderForm({
  profile,
  products,
  customers,
  minRate,
  defaultRate,
  approvalId = null,
  initialCustomerId = null,
  initialRate = null,
  initialLines = null,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState(
    initialCustomerId ?? customers[0]?.id ?? "",
  );
  const [rateInput, setRateInput] = useState(
    String(initialRate ?? defaultRate),
  );
  const [exchangeRate, setExchangeRate] = useState(initialRate ?? defaultRate);
  /** Owner inline approvals keyed by product id */
  const [ownerApprovedProductIds, setOwnerApprovedProductIds] = useState<
    Set<string>
  >(new Set());
  const [lines, setLines] = useState<UiLine[]>(() => {
    if (initialLines?.length) {
      return initialLines.map((l, i) => ({
        key: `init-${i}`,
        productId: l.product_id,
        quantity: l.quantity,
        discountDollars: (l.discount_cents / 100).toFixed(2),
      }));
    }
    return [
      {
        key: crypto.randomUUID(),
        productId: products[0]?.id ?? "",
        quantity: 1,
        discountDollars: "0",
      },
    ];
  });

  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    products.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);

  const draftLines: DraftLine[] = lines
    .filter((l) => l.productId && l.quantity > 0)
    .map((l) => {
      const product = productMap.get(l.productId)!;
      const discountCents = Math.round(
        (parseFloat(l.discountDollars || "0") || 0) * 100,
      );
      return {
        productId: l.productId,
        quantity: l.quantity,
        unitPriceCents: product.unit_price_cents,
        discountCents,
      };
    });

  const { computed, totalUsdCents, totalSdg, hasBlocked } = computeOrderTotals(
    draftLines,
    exchangeRate,
  );

  const blockedUnresolved =
    hasBlocked &&
    !approvalId &&
    computed.some(
      (c, i) =>
        c.band === "blocked" &&
        !ownerApprovedProductIds.has(draftLines[i].productId),
    );

  function onRateBlur() {
    const parsed = parseInt(rateInput, 10);
    const { rate, refused } = clampExchangeRate(
      Number.isFinite(parsed) ? parsed : minRate,
      minRate,
    );
    setExchangeRate(rate);
    setRateInput(String(rate));
    if (refused) {
      setInfo(
        `Rate below minimum ${minRate.toLocaleString()} was refused and reset to ${minRate.toLocaleString()}.`,
      );
    } else {
      setInfo(null);
    }
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        productId: products[0]?.id ?? "",
        quantity: 1,
        discountDollars: "0",
      },
    ]);
  }

  /** PDF worked example: sand + red + blocked on one order */
  function loadWorkedExample() {
    const bySku = (sku: string) =>
      products.find((p) => p.sku === sku)?.id ?? products[0]?.id ?? "";
    setExchangeRate(8200);
    setRateInput("8200");
    setOwnerApprovedProductIds(new Set());
    setLines([
      {
        key: crypto.randomUUID(),
        productId: bySku("SPF-6000-ES-PLUS"),
        quantity: 4,
        discountDollars: "40",
      },
      {
        key: crypto.randomUUID(),
        productId: bySku("HOPE-5.0L-B1"),
        quantity: 2,
        discountDollars: "70",
      },
      {
        key: crypto.randomUUID(),
        productId: bySku("HOPE-16.0LM-A1"),
        quantity: 1,
        discountDollars: "150",
      },
    ]);
    setInfo(
      "Worked example loaded: sand (1.94%), red (4.32%), blocked (7.25%). Save is blocked until line 3 is removed or owner-approved.",
    );
    setError(null);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function updateLine(key: string, patch: Partial<UiLine>) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  }

  function approveLine(productId: string) {
    setOwnerApprovedProductIds((prev) => new Set(prev).add(productId));
    setInfo("Line approved by owner. You can save once all blocked lines are approved.");
  }

  function unapproveLine(productId: string) {
    setOwnerApprovedProductIds((prev) => {
      const next = new Set(prev);
      next.delete(productId);
      return next;
    });
  }

  async function requestApproval() {
    setError(null);
    setInfo(null);
    const payload = {
      lines: draftLines.map((l, i) => ({
        product_id: l.productId,
        quantity: l.quantity,
        discount_cents: computed[i].discountCents,
        needs_approval: computed[i].needsApproval,
        line_approved: false,
      })),
    };

    const { data, error: insertError } = await supabase
      .from("shamsy_discount_approvals")
      .insert({
        requested_by: profile.id,
        customer_id: customerId,
        exchange_rate: exchangeRate,
        payload,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setInfo(
      `Approval requested (${data.id.slice(0, 8)}…). Owner must approve each blocked line, then you can save.`,
    );
    router.push("/approvals");
    router.refresh();
  }

  function saveOrder() {
    setError(null);
    setInfo(null);

    if (!customerId) {
      setError("Pick a dealer.");
      return;
    }
    if (draftLines.length === 0) {
      setError("Add at least one product line.");
      return;
    }
    if (blockedUnresolved) {
      setError(
        profile.role === "owner"
          ? "Approve each blocked line (>5%) before saving, or remove it."
          : "One or more lines exceed 5% discount. Remove them or request owner approval.",
      );
      return;
    }

    startTransition(async () => {
      const linesPayload = draftLines.map((l) => ({
        product_id: l.productId,
        quantity: l.quantity,
        discount_cents: l.discountCents,
      }));

      const ownerIds =
        profile.role === "owner" ? Array.from(ownerApprovedProductIds) : [];

      const { data, error: rpcError } = await supabase.rpc("shamsy_create_order", {
        p_customer_id: customerId,
        p_exchange_rate: exchangeRate,
        p_lines: linesPayload,
        p_approval_id: approvalId,
        p_owner_approved_product_ids: ownerIds.length ? ownerIds : null,
      });

      if (rpcError) {
        setError(rpcError.message);
        return;
      }

      router.push(`/orders/${data}`);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-4 pb-28">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-zinc-500">
          New order · {profile.role}
        </p>
        <h1 className="text-xl font-semibold text-zinc-900">Record order</h1>
        <p className="text-sm text-zinc-600">
          Prices are fixed in USD. Discount is per line. Rate converts the whole
          order to SDG and is locked when you save.
        </p>
      </header>

      <label className="block space-y-1">
        <span className="text-sm font-medium text-zinc-700">Dealer</span>
        <select
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
        >
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {c.city}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium text-zinc-700">
          Today&apos;s exchange rate (SDG per USD)
        </span>
        <input
          type="number"
          inputMode="numeric"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base tabular-nums"
          value={rateInput}
          onChange={(e) => setRateInput(e.target.value)}
          onBlur={onRateBlur}
          min={minRate}
        />
        <span className="text-xs text-zinc-500">
          Floor: {minRate.toLocaleString()} SDG/$ (owner minimum). Typing below
          it is refused and reset to the minimum. Day&apos;s default from
          settings: {defaultRate.toLocaleString()}.
        </span>
      </label>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-800">Lines</h2>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={loadWorkedExample}
              className="text-sm font-medium text-amber-800 underline"
            >
              Load PDF example
            </button>
            <button
              type="button"
              onClick={addLine}
              className="text-sm font-medium text-emerald-700"
            >
              + Add line
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] text-zinc-600">
          <span className="band-badge band-badge-sand">Sand 0–3%</span>
          <span className="band-badge band-badge-red">Red 3–5%</span>
          <span className="band-badge band-badge-blocked">Blocked &gt;5%</span>
        </div>

        {lines.map((line, index) => {
          const product = productMap.get(line.productId);
          const draft: DraftLine | null = product
            ? {
                productId: line.productId,
                quantity: line.quantity,
                unitPriceCents: product.unit_price_cents,
                discountCents: Math.round(
                  (parseFloat(line.discountDollars || "0") || 0) * 100,
                ),
              }
            : null;
          const calc = draft ? computeLine(draft) : null;
          const lineApproved =
            !!product && ownerApprovedProductIds.has(product.id);

          return (
            <div
              key={line.key}
              className={`space-y-2 rounded-xl border-2 p-3 ${bandClass(calc?.band ?? "none")}`}
            >
              <div className="flex items-center justify-between gap-2">
                {calc ? <BandBadge band={calc.band} /> : <span />}
                {lines.length > 1 && (
                  <button
                    type="button"
                    className="text-xs underline opacity-80"
                    onClick={() => removeLine(line.key)}
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="flex items-start justify-between gap-2">
                <label className="flex-1 space-y-1">
                  <span className="text-xs font-medium opacity-80">
                    Product
                  </span>
                  <select
                    className="w-full rounded-md border border-black/20 bg-white px-2 py-2 text-sm text-zinc-900"
                    value={line.productId}
                    onChange={(e) =>
                      updateLine(line.key, { productId: e.target.value })
                    }
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-xs font-medium opacity-80">Qty</span>
                  <input
                    type="number"
                    min={1}
                    className="w-full rounded-md border border-black/20 bg-white px-2 py-2 text-sm tabular-nums text-zinc-900"
                    value={line.quantity}
                    onChange={(e) =>
                      updateLine(line.key, {
                        quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                      })
                    }
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium opacity-80">
                    Unit price (fixed)
                  </span>
                  <input
                    readOnly
                    className="w-full rounded-md border border-black/10 bg-white/70 px-2 py-2 text-sm tabular-nums text-zinc-700"
                    value={
                      product
                        ? formatUsdFromCents(product.unit_price_cents)
                        : "—"
                    }
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium opacity-80">
                  Discount (USD)
                </span>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  className="w-full rounded-md border border-black/20 bg-white px-2 py-2 text-sm tabular-nums text-zinc-900"
                  value={line.discountDollars}
                  onChange={(e) =>
                    updateLine(line.key, { discountDollars: e.target.value })
                  }
                />
              </label>

              {calc && (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div className="flex justify-between gap-2 col-span-2">
                    <dt className="opacity-80">Line value</dt>
                    <dd className="tabular-nums font-medium">
                      {formatUsdFromCents(calc.lineValueCents)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 col-span-2 items-center">
                    <dt className="opacity-80">Discount %</dt>
                    <dd className="flex items-center gap-2 tabular-nums font-medium">
                      {formatBps(calc.bps)}
                      <BandBadge band={calc.band} />
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 col-span-2">
                    <dt className="opacity-80">Line total</dt>
                    <dd className="tabular-nums font-semibold">
                      {formatUsdFromCents(calc.lineTotalCents)}
                    </dd>
                  </div>
                  {calc.band === "sand" && (
                    <p className="col-span-2 text-xs font-medium">
                      Sand band: discount allowed, save OK.
                    </p>
                  )}
                  {calc.band === "red" && (
                    <p className="col-span-2 text-xs font-semibold">
                      Red band: discount allowed (3–5%), save still OK.
                    </p>
                  )}
                  {calc.band === "blocked" && (
                    <div className="col-span-2 space-y-2 pt-1">
                      <p className="text-xs font-semibold">
                        Line {index + 1} BLOCKED (&gt;5%). Cannot save until this
                        line is removed or owner-approved.
                      </p>
                      {profile.role === "owner" && product && (
                        <button
                          type="button"
                          onClick={() =>
                            lineApproved
                              ? unapproveLine(product.id)
                              : approveLine(product.id)
                          }
                          className={`w-full rounded-lg py-2 text-sm font-medium ${
                            lineApproved
                              ? "border border-white/60 bg-white/20"
                              : "bg-white text-red-900"
                          }`}
                        >
                          {lineApproved
                            ? "Line approved ✓ (tap to undo)"
                            : "Approve this line"}
                        </button>
                      )}
                    </div>
                  )}
                </dl>
              )}
            </div>
          );
        })}
      </section>

      <section className="rounded-xl border border-zinc-300 bg-zinc-50 p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span>Order total (USD)</span>
          <span className="tabular-nums font-semibold">
            {formatUsdFromCents(totalUsdCents)}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span>At {exchangeRate.toLocaleString()} SDG/$</span>
          <span className="tabular-nums font-semibold">
            {formatSdg(totalSdg)}
          </span>
        </div>
        {approvalId && (
          <p className="text-xs text-emerald-800">
            Saving with owner approval {approvalId.slice(0, 8)}…
          </p>
        )}
      </section>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {info && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {info}
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-zinc-200 bg-white/95 p-4 backdrop-blur">
        <div className="mx-auto flex max-w-lg gap-2">
          {hasBlocked && !approvalId && profile.role !== "owner" && (
            <button
              type="button"
              onClick={() => startTransition(() => requestApproval())}
              disabled={pending}
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-3 text-sm font-medium text-zinc-800 disabled:opacity-50"
            >
              Request approval
            </button>
          )}
          <button
            type="button"
            onClick={saveOrder}
            disabled={pending || blockedUnresolved}
            className="flex-1 rounded-lg bg-emerald-700 px-3 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {pending ? "Saving…" : "Save order"}
          </button>
        </div>
      </div>
    </div>
  );
}
