"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  formatBps,
  formatSdg,
  formatUsdFromCents,
  lineDisplayBand,
  lineDisplayLabel,
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
  /** Owner queue: only items needing line approval. Adviser: all drafts. */
  mode?: "approvals" | "drafts";
};

export function ApprovalsList({
  profile,
  drafts,
  products,
  loadError = null,
  mode = "drafts",
}: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const isOwnerApprovals = mode === "approvals";

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
        "Line unblocked (green). Order leaves Approvals — open Drafts/Orders and Save as order.",
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
        <h1 className="text-xl font-semibold">
          {isOwnerApprovals ? "Approvals" : "Drafts"}
        </h1>
        <p className="text-sm text-zinc-600">
          {isOwnerApprovals ? (
            <>
              Only drafts with a &gt;5% line waiting for your approval. After you
              approve, the draft leaves this list — finalize from Orders or the
              adviser&apos;s Drafts.
            </>
          ) : (
            <>
              Your draft orders. Owner must approve blocked (&gt;5%) lines first;
              then tap <strong>Save as order</strong>.
            </>
          )}
        </p>
      </header>

      {loadError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          Could not load: {loadError}
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
          {isOwnerApprovals
            ? "Nothing waiting for approval."
            : "No drafts yet. Load PDF example → Save draft for approval."}
        </p>
      )}

      <ul className="space-y-3">
        {drafts.map((draft) => {
          const lines = draft.shamsy_order_lines ?? [];
          const needs = lines.filter((l) => l.approval === "required");
          const readyToSave = needs.length === 0;
          // Owner Approvals: focus on lines that still need approval
          const displayLines = isOwnerApprovals
            ? lines.filter(
                (l) => l.approval === "required" || l.approval === "approved",
              )
            : lines;

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
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-900">
                  {isOwnerApprovals
                    ? `${needs.length} need approval`
                    : "Draft"}
                </span>
              </div>

              <ul className="space-y-2 text-xs">
                {displayLines.map((line) => {
                  const p =
                    productMap.get(line.product_id) ?? line.shamsy_products;
                  const display = lineDisplayBand(
                    line.discount_bps,
                    line.approval,
                  );
                  const waiting = line.approval === "required";
                  const approved = line.approval === "approved";
                  return (
                    <li
                      key={line.id}
                      className={`rounded-lg border-2 p-2 space-y-1 ${
                        waiting
                          ? "band-blocked"
                          : approved
                            ? "band-unblocked"
                            : "border-zinc-200 bg-white text-zinc-800"
                      }`}
                    >
                      <div className="flex justify-between gap-2 font-medium">
                        <span>
                          {p?.name ?? "Product"} × {line.quantity}
                        </span>
                        <span
                          className={`band-badge band-badge-${display} shrink-0`}
                        >
                          {lineDisplayLabel(display)}
                        </span>
                      </div>
                      <div className="flex justify-between text-[11px] opacity-90">
                        <span>
                          disc {formatUsdFromCents(line.discount_cents)} ·{" "}
                          {formatBps(line.discount_bps)}
                        </span>
                        <span className="font-semibold uppercase">
                          {waiting
                            ? "Blocked"
                            : approved
                              ? "Unblocked"
                              : "OK"}
                        </span>
                      </div>
                      {profile.role === "owner" && waiting && (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => approveLine(draft.id, line.id)}
                          className="w-full rounded-md bg-white py-2 text-xs font-semibold text-red-950 disabled:opacity-50"
                        >
                          Approve this line
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>

              <div className="rounded-lg bg-zinc-50 px-3 py-2 text-sm space-y-1">
                <div className="flex justify-between">
                  <span>Order total</span>
                  <span className="tabular-nums font-semibold">
                    {formatUsdFromCents(draft.total_usd_cents)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-zinc-600">
                  <span>At {draft.exchange_rate.toLocaleString()} SDG/$</span>
                  <span className="tabular-nums">
                    {formatSdg(draft.total_sdg)}
                  </span>
                </div>
              </div>

              {isOwnerApprovals ? (
                <p className="text-center text-xs text-zinc-500">
                  Approve blocked line(s) above. This order stays a draft until
                  someone taps Save as order.
                </p>
              ) : readyToSave ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => finalize(draft.id)}
                  className="w-full rounded-lg bg-emerald-700 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Save as order"}
                </button>
              ) : (
                <p className="text-center text-xs text-zinc-500">
                  Waiting for owner to approve blocked line(s).
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
