import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  formatBps,
  formatSdg,
  formatUsdFromCents,
  lineBand,
} from "@/lib/money";
import type { Order, OrderLine } from "@/lib/types";

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

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

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

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-4">
      <Link href="/orders" className="text-sm text-emerald-700">
        ← Orders
      </Link>

      <header className="space-y-1">
        <h1 className="text-xl font-semibold">
          {o.shamsy_customers?.name ?? "Order"}
        </h1>
        <p className="text-sm text-zinc-600">
          Saved {new Date(o.created_at).toLocaleString()}. This rate is frozen
          on the order — changing today’s settings cannot alter these amounts.
        </p>
      </header>

      <section className="rounded-xl border border-zinc-300 bg-zinc-50 p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span>Locked exchange rate</span>
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

      <ul className="space-y-2">
        {((lines ?? []) as OrderLine[]).map((line) => {
          const band = lineBand(line.discount_bps);
          return (
            <li
              key={line.id}
              className={`rounded-xl border-2 p-3 space-y-1 ${bandClass(band)}`}
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
                  <dt className="opacity-80">Line value</dt>
                  <dd className="tabular-nums">
                    {formatUsdFromCents(line.line_value_cents)}
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
                {line.approval === "approved" && (
                  <p className="col-span-2 font-medium">
                    Owner approved (&gt;5% discount)
                  </p>
                )}
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
