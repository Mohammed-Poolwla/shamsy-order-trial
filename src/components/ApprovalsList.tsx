"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  formatBps,
  formatSdg,
  formatUsdFromCents,
  lineBand,
} from "@/lib/money";
import type { Order, OrderLine, Product, Profile } from "@/lib/types";

type DraftOrder = Order & {
  shamsy_order_lines?: OrderLine[];
};

type Props = {
  profile: Profile;
  drafts: DraftOrder[];
  products: Product[];
  loadError?: string | null;
};

export function ApprovalsList({
  profile,
  drafts,
  products,
  loadError = null,
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const productMap = new Map(products.map((p) => [p.id, p]));

  function approveLine(orderId: string, lineId: string) {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const { error: rpcError } = await supabase.rpc(
        "shamsy_approve_draft_line",
        { p_order_id: orderId, p_line_id: lineId },
      );
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      setInfo(
        "Line approved. Order is still a DRAFT — not saved as a final order yet.",
      );
      router.refresh();
    });
  }

  function finalize(orderId: string) {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const { data, error: rpcError } = await supabase.rpc(
        "shamsy_finalize_draft_order",
        { p_order_id: orderId },
      );
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      setInfo("Draft saved as order.");
      router.push(`/orders/${data}`);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-4 pb-10">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">Draft approvals</h1>
        <p className="text-sm text-zinc-600">
          PDF flow: adviser saves a <strong>draft</strong> with a &gt;5% line →
          owner <strong>approves that line</strong> (still draft) → then{" "}
          <strong>Save as order</strong> finalizes it ($5,490 / 45,018,000 SDG
          in the worked example).
        </p>
      </header>

      {loadError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          Could not load drafts: {loadError}
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {info && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {info}
        </p>
      )}

      {drafts.length === 0 && (
        <p className="text-sm text-zinc-500">
          No drafts waiting. As adviser: Load PDF example →{" "}
          <strong>Save draft for approval</strong>.
        </p>
      )}

      <ul className="space-y-3">
        {drafts.map((draft) => {
          const lines = draft.shamsy_order_lines ?? [];
          const needs = lines.filter((l) => l.approval === "required");
          const readyToSave = needs.length === 0;

          return (
            <li
              key={draft.id}
              className="rounded-xl border border-zinc-200 bg-white p-3 space-y-3"
            >
              <div className="flex justify-between text-sm">
                <span className="font-medium">
                  {draft.shamsy_customers?.name ?? "Dealer"} ·{" "}
                  {draft.exchange_rate.toLocaleString()} SDG/$
                </span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                  Draft
                </span>
              </div>

              <ul className="space-y-2 text-xs">
                {lines.map((line) => {
                  const p =
                    productMap.get(line.product_id) ?? line.shamsy_products;
                  const band = lineBand(line.discount_bps);
                  const waiting = line.approval === "required";
                  const approved = line.approval === "approved";
                  return (
                    <li
                      key={line.id}
                      className={`rounded-lg border p-2 space-y-1 ${
                        waiting
                          ? "border-red-400 bg-red-50"
                          : approved
                            ? "border-emerald-400 bg-emerald-50"
                            : "border-zinc-200"
                      }`}
                    >
                      <div className="flex justify-between gap-2 font-medium text-zinc-800">
                        <span>
                          {p?.name ?? "Product"} × {line.quantity}
                        </span>
                        <span className="tabular-nums">
                          {formatUsdFromCents(line.line_total_cents)}
                        </span>
                      </div>
                      <div className="flex justify-between text-[11px] text-zinc-600">
                        <span>
                          disc {formatUsdFromCents(line.discount_cents)} ·{" "}
                          {formatBps(line.discount_bps)} · {band}
                        </span>
                        <span className="font-semibold uppercase">
                          {waiting
                            ? "Needs approval"
                            : approved
                              ? "Line approved"
                              : "OK"}
                        </span>
                      </div>
                      {profile.role === "owner" && waiting && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => approveLine(draft.id, line.id)}
                          className="w-full rounded-md bg-emerald-800 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Approve this line (keep as draft)
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>

              <div className="rounded-lg bg-zinc-50 px-3 py-2 text-sm space-y-1">
                <div className="flex justify-between">
                  <span>Draft total</span>
                  <span className="tabular-nums font-semibold">
                    {formatUsdFromCents(draft.total_usd_cents)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-zinc-600">
                  <span>Status</span>
                  <span className="font-medium">
                    {readyToSave
                      ? "Draft — ready to save as order"
                      : "Draft — waiting for owner line approval"}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-zinc-600">
                  <span>At {draft.exchange_rate.toLocaleString()} SDG/$</span>
                  <span className="tabular-nums">
                    {formatSdg(draft.total_sdg)}
                  </span>
                </div>
              </div>

              {readyToSave ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => finalize(draft.id)}
                  className="w-full rounded-lg bg-emerald-700 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Save as order"}
                </button>
              ) : profile.role === "adviser" ? (
                <p className="text-center text-xs text-zinc-500">
                  Waiting for owner to approve blocked line(s). Order stays in
                  draft until then.
                </p>
              ) : (
                <p className="text-center text-xs text-zinc-500">
                  Approve each blocked line above. Order remains a draft until
                  you (or the adviser) tap Save as order.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
