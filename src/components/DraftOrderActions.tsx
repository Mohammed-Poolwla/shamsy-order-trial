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
        className="w-full rounded-lg bg-white py-2 text-sm font-semibold text-red-950 disabled:opacity-50"
      >
        {pending ? "Approving…" : "Approve this line (keep as draft)"}
      </button>
      {error && <p className="text-xs text-red-100">{error}</p>}
    </div>
  );
}

export function FinalizeDraftButton({
  orderId,
  canFinalize,
}: {
  orderId: string;
  canFinalize: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canFinalize) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
        Draft only — waiting for owner to unblock blocked line(s). Not a saved
        order yet.
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
