"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatUsdFromCents } from "@/lib/money";
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
  const productMap = new Map(products.map((p) => [p.id, p]));

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
        (allApproved ? "approved" : approval.status === "rejected" ? "rejected" : "pending");

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
      line_approved: l.needs_approval ? true : l.line_approved,
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

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-4">
      <header>
        <h1 className="text-xl font-semibold">Discount approvals</h1>
        <p className="text-sm text-zinc-600">
          Owner approves each blocked line (&gt;5%) individually, then the
          adviser can save.
        </p>
      </header>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {approvals.length === 0 && (
        <p className="text-sm text-zinc-500">No approval requests yet.</p>
      )}

      <ul className="space-y-3">
        {approvals.map((a) => {
          const lines = a.payload.lines as PayloadLine[];
          return (
            <li
              key={a.id}
              className="rounded-xl border border-zinc-200 bg-white p-3 space-y-2"
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
                  return (
                    <li
                      key={i}
                      className={`rounded-lg border p-2 ${
                        l.needs_approval
                          ? l.line_approved
                            ? "border-emerald-400 bg-emerald-50"
                            : "border-red-300 bg-red-50"
                          : "border-zinc-200"
                      }`}
                    >
                      <div className="flex justify-between gap-2">
                        <span>
                          {p?.name ?? l.product_id.slice(0, 8)} × {l.quantity}
                          {l.needs_approval ? " · >5%" : ""}
                        </span>
                        <span className="tabular-nums">
                          disc {formatUsdFromCents(l.discount_cents)}
                        </span>
                      </div>
                      {profile.role === "owner" &&
                        l.needs_approval &&
                        a.status !== "consumed" &&
                        a.status !== "rejected" && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => toggleLine(a, i)}
                            className="mt-2 w-full rounded-md border border-zinc-300 bg-white py-1.5 text-xs font-medium disabled:opacity-50"
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

              {profile.role === "owner" && a.status === "pending" && (
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => approveAll(a)}
                    className="flex-1 rounded-lg bg-emerald-700 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Approve all blocked
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
              )}

              {a.status === "approved" && (
                <Link
                  href={`/orders/new?approval=${a.id}`}
                  className="inline-block text-sm font-medium text-emerald-700 underline"
                >
                  Save order with these line approvals →
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
