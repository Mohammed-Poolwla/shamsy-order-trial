"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

type Props = {
  orderId: string;
  lineId: string;
  isOwner: boolean;
};

export function ApproveDraftLineButton({ orderId, lineId, isOwner }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!isOwner) return null;

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const { error: rpcError } = await supabase.rpc(
                "shamsy_approve_draft_line",
                { p_order_id: orderId, p_line_id: lineId },
              );
              if (rpcError) {
                setError(rpcError.message);
                return;
              }
              router.refresh();
            });
          }}
          className="rounded-lg bg-white py-2 text-sm font-semibold text-red-950 disabled:opacity-50"
        >
          {pending ? "…" : "Approve"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const { error: rpcError } = await supabase.rpc(
                "shamsy_reject_draft_line",
                { p_order_id: orderId, p_line_id: lineId },
              );
              if (rpcError) {
                setError(rpcError.message);
                return;
              }
              router.refresh();
            });
          }}
          className="rounded-lg border border-white/50 bg-black/25 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "…" : "Reject"}
        </button>
      </div>
      {error && <p className="text-xs text-red-100">{error}</p>}
    </div>
  );
}

export function ReviseRejectedLine({
  orderId,
  lineId,
  discountCents,
}: {
  orderId: string;
  lineId: string;
  discountCents: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [discount, setDiscount] = useState(
    (discountCents / 100).toFixed(discountCents % 100 === 0 ? 0 : 2),
  );

  return (
    <div className="space-y-2">
      <label className="block space-y-1">
        <span className="text-xs font-medium">New discount (USD)</span>
        <input
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-zinc-900"
        />
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          const dollars = Number(discount);
          if (!Number.isFinite(dollars) || dollars < 0) {
            setError("Enter a valid discount in dollars.");
            return;
          }
          startTransition(async () => {
            const { error: rpcError } = await supabase.rpc(
              "shamsy_revise_draft_line",
              {
                p_order_id: orderId,
                p_line_id: lineId,
                p_discount_cents: Math.round(dollars * 100),
              },
            );
            if (rpcError) {
              setError(rpcError.message);
              return;
            }
            router.refresh();
          });
        }}
        className="w-full rounded-lg bg-amber-800 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Sending…" : "Update & send again for approval"}
      </button>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}

export function FinalizeDraftButton({
  orderId,
  canFinalize,
  hasRejected,
}: {
  orderId: string;
  canFinalize: boolean;
  hasRejected?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canFinalize) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
        {hasRejected
          ? "Draft only — owner rejected a line. Update the discount and send again for approval."
          : "Draft only — waiting for owner to unblock blocked line(s). Not a saved order yet."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
        All blocked lines are <strong>Unblocked</strong>. Save to finalize the
        order.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const { data, error: rpcError } = await supabase.rpc(
              "shamsy_finalize_draft_order",
              { p_order_id: orderId },
            );
            if (rpcError) {
              setError(rpcError.message);
              return;
            }
            router.push(`/orders/${data}`);
            router.refresh();
          });
        }}
        className="w-full rounded-lg bg-emerald-700 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save as order"}
      </button>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
