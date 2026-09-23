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

export function ApprovalsList({ profile, approvals, products }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const productMap = new Map(products.map((p) => [p.id, p]));

  function review(id: string, status: "approved" | "rejected") {
    setError(null);
    startTransition(async () => {
      const { error: updateError } = await supabase
        .from("shamsy_discount_approvals")
        .update({
          status,
          reviewed_by: profile.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (updateError) {
        setError(updateError.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-4">
      <header>
        <h1 className="text-xl font-semibold">Discount approvals</h1>
        <p className="text-sm text-zinc-600">
          Lines above 5% need owner approval before the order can be saved.
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
        {approvals.map((a) => (
          <li
            key={a.id}
            className="rounded-xl border border-zinc-200 bg-white p-3 space-y-2"
          >
            <div className="flex justify-between text-sm">
              <span className="font-medium">
                {a.shamsy_customers?.name ?? "Dealer"} · {a.exchange_rate.toLocaleString()}{" "}
                SDG/$
              </span>
              <span className="uppercase text-xs tracking-wide text-zinc-500">
                {a.status}
              </span>
            </div>
            <ul className="space-y-1 text-xs text-zinc-700">
              {a.payload.lines.map((l, i) => {
                const p = productMap.get(l.product_id);
                return (
                  <li key={i} className="flex justify-between gap-2">
                    <span>
                      {p?.name ?? l.product_id.slice(0, 8)} × {l.quantity}
                      {l.needs_approval ? " · needs approval" : ""}
                    </span>
                    <span className="tabular-nums">
                      disc {formatUsdFromCents(l.discount_cents)}
                    </span>
                  </li>
                );
              })}
            </ul>

            {profile.role === "owner" && a.status === "pending" && (
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => review(a.id, "approved")}
                  className="flex-1 rounded-lg bg-emerald-700 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => review(a.id, "rejected")}
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
                Save order with this approval →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
