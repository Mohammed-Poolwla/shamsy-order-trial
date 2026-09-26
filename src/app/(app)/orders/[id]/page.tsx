import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  formatBps,
  formatSdg,
  formatUsdFromCents,
  lineDisplayBand,
  lineDisplayLabel,
  type LineDisplayBand,
} from "@/lib/money";
import type { Order, OrderLine, Profile } from "@/lib/types";
import {
  ApproveDraftLineButton,
  FinalizeDraftButton,
  ReviseRejectedLine,
} from "@/components/DraftOrderActions";

function bandClass(band: LineDisplayBand) {
  switch (band) {
    case "sand":
      return "band-sand";
    case "red":
      return "band-red";
    case "blocked":
      return "band-blocked";
    case "unblocked":
      return "band-unblocked";
    case "rejected":
      return "band-rejected";
    default:
      return "band-none";
  }
}

function BandBadge({ band }: { band: LineDisplayBand }) {
  return (
    <span className={`band-badge band-badge-${band}`}>
      {lineDisplayLabel(band)}
    </span>
  );
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from("shamsy_profiles")
        .select("*")
        .eq("id", user.id)
        .single()
    : { data: null };

  const { data: order } = await supabase
    .from("shamsy_orders")
    .select("*, shamsy_customers(name, city)")
    .eq("id", id)
    .maybeSingle();

  if (!order) notFound();

  const { data: lines } = await supabase
    .from("shamsy_order_lines")
    .select("*, shamsy_products(name, sku)")
    .eq("order_id", id)
    .order("created_at");

  const o = order as Order;
  const orderLines = (lines ?? []) as OrderLine[];
  const isDraft = o.status === "draft";
  const needsApproval = orderLines.some((l) => l.approval === "required");
  const hasRejected = orderLines.some((l) => l.approval === "rejected");
  const canFinalize = isDraft && !needsApproval && !hasRejected;
  const isOwner = (profile as Profile | null)?.role === "owner";

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-4 pb-10">
      <Link href="/orders" className="text-sm text-emerald-700">
        ← Orders
      </Link>

      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">
            {o.shamsy_customers?.name ?? "Order"}
          </h1>
          {isDraft ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-900">
              Draft
            </span>
          ) : (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-900">
              Saved
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-600">
          {isDraft
            ? "This is a draft — not a final order. Owner can approve blocked lines here; then Save as order."
            : `Saved ${new Date(o.created_at).toLocaleString()}. Rate is frozen on this order.`}
        </p>
      </header>

      <section className="rounded-xl border border-zinc-300 bg-zinc-50 p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span>Exchange rate</span>
          <span className="tabular-nums font-semibold">
            {o.exchange_rate.toLocaleString()} SDG/$
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Total USD</span>
          <span className="tabular-nums font-semibold">
            {formatUsdFromCents(o.total_usd_cents)}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Total SDG</span>
          <span className="tabular-nums font-semibold">
            {formatSdg(o.total_sdg)}
          </span>
        </div>
      </section>

      {isDraft && (
        <FinalizeDraftButton
          orderId={o.id}
          canFinalize={canFinalize}
          hasRejected={hasRejected}
        />
      )}

      <ul className="space-y-2">
        {orderLines.map((line) => {
          const band = lineDisplayBand(line.discount_bps, line.approval);
          return (
            <li
              key={line.id}
              className={`rounded-xl border-2 p-3 space-y-2 ${bandClass(band)}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {line.shamsy_products?.name ?? "Product"} × {line.quantity}
                </p>
                <BandBadge band={band} />
              </div>
              <dl className="grid grid-cols-2 gap-1 text-xs">
                <div className="flex justify-between col-span-2">
                  <dt className="opacity-80">Unit (snapshotted)</dt>
                  <dd className="tabular-nums">
                    {formatUsdFromCents(line.unit_price_cents)}
                  </dd>
                </div>
                <div className="flex justify-between col-span-2">
                  <dt className="opacity-80">Discount</dt>
                  <dd className="tabular-nums">
                    {formatUsdFromCents(line.discount_cents)} (
                    {formatBps(line.discount_bps)})
                  </dd>
                </div>
                <div className="flex justify-between col-span-2">
                  <dt className="opacity-80">Line total</dt>
                  <dd className="tabular-nums font-semibold">
                    {formatUsdFromCents(line.line_total_cents)}
                  </dd>
                </div>
                {line.approval === "required" && (
                  <p className="col-span-2 font-semibold">
                    Status: Blocked — needs owner approval
                  </p>
                )}
                {line.approval === "approved" && (
                  <p className="col-span-2 font-semibold">
                    Status: Unblocked — ready to Save as order
                  </p>
                )}
                {line.approval === "rejected" && (
                  <p className="col-span-2 font-semibold">
                    Status: Rejected — update discount and send again
                  </p>
                )}
              </dl>
              {isDraft && line.approval === "required" && (
                <ApproveDraftLineButton
                  orderId={o.id}
                  lineId={line.id}
                  isOwner={isOwner}
                />
              )}
              {isDraft && line.approval === "rejected" && (
                <ReviseRejectedLine
                  orderId={o.id}
                  lineId={line.id}
                  discountCents={line.discount_cents}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
