"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  computeLine,
  formatBps,
  formatSdg,
  formatUsdFromCents,
  usdCentsToSdg,
} from "@/lib/money";
import type { DiscountApproval, Product, Profile } from "@/lib/types";

type Props = {
  profile: Profile;
  approvals: DiscountApproval[];
  products: Product[];
};

type PayloadLine = DiscountApproval["payload"]["lines"][number] & {
  line_approved?: boolean;
};

export function ApprovalsList({ profile, approvals, products }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const productMap = new Map(products.map((p) => [p.id, p]));

  function orderTotals(a: DiscountApproval) {
    let totalUsd = 0;
    for (const l of a.payload.lines) {
      const p = productMap.get(l.product_id);
      if (!p) continue;
      const calc = computeLine({
        productId: p.id,
        quantity: l.quantity,
        unitPriceCents: p.unit_price_cents,
        discountCents: l.discount_cents,
      });
      totalUsd += calc.lineTotalCents;
    }
    return {
      totalUsd,
      totalSdg: usdCentsToSdg(totalUsd, a.exchange_rate),
    };
  }

  function updatePayload(
    approval: DiscountApproval,
    nextLines: PayloadLine[],
    status?: "approved" | "rejected" | "pending",
  ) {
    setError(null);
    startTransition(async () => {
      const needs = nextLines.filter((l) => l.needs_approval);
      const allApproved =
        needs.length > 0 && needs.every((l) => l.line_approved);
      const nextStatus =
        status ??
        (allApproved
          ? "approved"
          : approval.status === "rejected"
            ? "rejected"
            : "pending");

      const { error: updateError } = await supabase
        .from("shamsy_discount_approvals")
        .update({
          payload: { lines: nextLines },
          status: nextStatus,
          reviewed_by: profile.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", approval.id);

      if (updateError) {
        setError(updateError.message);
        return;
      }
      router.refresh();
    });
  }

  function toggleLine(approval: DiscountApproval, index: number) {
    const lines = (approval.payload.lines as PayloadLine[]).map((l, i) =>
      i === index ? { ...l, line_approved: !l.line_approved } : { ...l },
    );
    updatePayload(approval, lines);
  }

  function approveAll(approval: DiscountApproval) {
    const lines = (approval.payload.lines as PayloadLine[]).map((l) => ({
      ...l,
      line_approved: l.needs_approval ? true : !!l.line_approved,
    }));
    updatePayload(approval, lines, "approved");
  }

  function reject(approval: DiscountApproval) {
    updatePayload(
      approval,
      approval.payload.lines as PayloadLine[],
      "rejected",
    );
  }

  /** PDF flow: owner approves blocked line(s) and saves → $5,490 / 45,018,000 SDG */
  function approveAndSave(approval: DiscountApproval) {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const lines = (approval.payload.lines as PayloadLine[]).map((l) => ({
        ...l,
        line_approved: l.needs_approval ? true : !!l.line_approved,
      }));

      const { error: updateError } = await supabase
        .from("shamsy_discount_approvals")
        .update({
          payload: { lines },
          status: "approved",
          reviewed_by: profile.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", approval.id);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      const approvedProductIds = lines
        .filter((l) => l.needs_approval && l.line_approved)
        .map((l) => l.product_id);

      const { data: orderId, error: rpcError } = await supabase.rpc(
        "shamsy_create_order",
        {
          p_customer_id: approval.customer_id,
          p_exchange_rate: approval.exchange_rate,
          p_lines: lines.map((l) => ({
            product_id: l.product_id,
            quantity: l.quantity,
            discount_cents: l.discount_cents,
          })),
          p_approval_id: approval.id,
          p_owner_approved_product_ids: approvedProductIds,
        },
      );

      if (rpcError) {
        setError(rpcError.message);
        return;
      }

      setInfo("Order saved with owner-approved >5% line(s).");
      router.push(`/orders/${orderId}`);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-4 pb-10">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">Discount approvals</h1>
        <p className="text-sm text-zinc-600">
          PDF rule: above 5% is blocked until the <strong>owner</strong>{" "}
          approves that line. Then the full order can be saved (worked example:{" "}
          <strong>$5,490</strong> / <strong>45,018,000 SDG</strong>).
        </p>
        {profile.role === "adviser" && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
            You requested approval. Sign out → sign in as{" "}
            <strong>owner@shamsy.trial</strong> → open Approvals →{" "}
            <strong>Approve line &amp; save order</strong>.
          </p>
        )}
        {profile.role === "owner" && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            Approve each blocked line, then tap{" "}
            <strong>Approve line &amp; save order</strong> to complete the PDF
            flow.
          </p>
        )}
      </header>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {info && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {info}
        </p>
      )}

      {approvals.length === 0 && (
        <p className="text-sm text-zinc-500">
          No approval requests yet. As adviser: load the PDF example on New
          order → Request owner approval.
        </p>
      )}

      <ul className="space-y-3">
        {approvals.map((a) => {
          const lines = a.payload.lines as PayloadLine[];
          const { totalUsd, totalSdg } = orderTotals(a);
          const blocked = lines.filter((l) => l.needs_approval);
          const allBlockedApproved =
            blocked.length > 0 && blocked.every((l) => l.line_approved);
          const canOwnerSave =
            profile.role === "owner" &&
            (a.status === "pending" || a.status === "approved");

          return (
            <li
              key={a.id}
              className="rounded-xl border border-zinc-200 bg-white p-3 space-y-3"
            >
              <div className="flex justify-between text-sm">
                <span className="font-medium">
                  {a.shamsy_customers?.name ?? "Dealer"} ·{" "}
                  {a.exchange_rate.toLocaleString()} SDG/$
                </span>
                <span className="uppercase text-xs tracking-wide text-zinc-500">
                  {a.status}
                </span>
              </div>

              <ul className="space-y-2 text-xs text-zinc-700">
                {lines.map((l, i) => {
                  const p = productMap.get(l.product_id);
                  const calc = p
                    ? computeLine({
                        productId: p.id,
                        quantity: l.quantity,
                        unitPriceCents: p.unit_price_cents,
                        discountCents: l.discount_cents,
                      })
                    : null;
                  return (
                    <li
                      key={i}
                      className={`rounded-lg border p-2 space-y-1 ${
                        l.needs_approval
                          ? l.line_approved
                            ? "border-emerald-400 bg-emerald-50"
                            : "border-red-400 bg-red-50"
                          : "border-zinc-200"
                      }`}
                    >
                      <div className="flex justify-between gap-2 font-medium">
                        <span>
                          {p?.name ?? l.product_id.slice(0, 8)} × {l.quantity}
                        </span>
                        <span className="tabular-nums">
                          {calc
                            ? formatUsdFromCents(calc.lineTotalCents)
                            : formatUsdFromCents(l.discount_cents)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2 text-[11px]">
                        <span>
                          disc {formatUsdFromCents(l.discount_cents)}
                          {calc ? ` · ${formatBps(calc.bps)}` : ""}
                          {l.needs_approval ? " · needs owner approval" : ""}
                        </span>
                        {l.line_approved && (
                          <span className="text-emerald-800 font-semibold">
                            Approved
                          </span>
                        )}
                      </div>
                      {profile.role === "owner" &&
                        l.needs_approval &&
                        a.status !== "consumed" &&
                        a.status !== "rejected" && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => toggleLine(a, i)}
                            className="mt-1 w-full rounded-md border border-zinc-300 bg-white py-2 text-xs font-semibold disabled:opacity-50"
                          >
                            {l.line_approved
                              ? "Line approved ✓ (undo)"
                              : "Approve this line"}
                          </button>
                        )}
                    </li>
                  );
                })}
              </ul>

              <div className="rounded-lg bg-zinc-50 px-3 py-2 text-sm space-y-1">
                <div className="flex justify-between">
                  <span>Order total if saved</span>
                  <span className="tabular-nums font-semibold">
                    {formatUsdFromCents(totalUsd)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-zinc-600">
                  <span>At {a.exchange_rate.toLocaleString()} SDG/$</span>
                  <span className="tabular-nums font-medium">
                    {formatSdg(totalSdg)}
                  </span>
                </div>
              </div>

              {profile.role === "owner" && a.status === "pending" && (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => approveAndSave(a)}
                    className="w-full rounded-lg bg-emerald-700 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {pending
                      ? "Saving…"
                      : "Approve line & save order"}
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => approveAll(a)}
                      className="flex-1 rounded-lg border border-zinc-300 py-2 text-sm font-medium disabled:opacity-50"
                    >
                      Approve only (don&apos;t save yet)
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => reject(a)}
                      className="flex-1 rounded-lg border border-zinc-300 py-2 text-sm font-medium disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}

              {canOwnerSave && a.status === "approved" && (
                <button
                  type="button"
                  disabled={pending || !allBlockedApproved}
                  onClick={() => approveAndSave(a)}
                  className="w-full rounded-lg bg-emerald-700 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Save approved order now"}
                </button>
              )}

              {a.status === "approved" && profile.role === "adviser" && (
                <Link
                  href={`/orders/new?approval=${a.id}`}
                  className="block text-center rounded-lg border border-emerald-600 bg-emerald-50 py-3 text-sm font-semibold text-emerald-900"
                >
                  Owner approved — open &amp; save order →
                </Link>
              )}

              {a.status === "consumed" && (
                <p className="text-xs text-zinc-500">
                  Already saved. See Orders.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
