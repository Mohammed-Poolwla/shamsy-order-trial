import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatSdg, formatUsdFromCents } from "@/lib/money";
import type { Order } from "@/lib/types";

export default async function OrdersPage() {
  const supabase = await createClient();
  const { data: orders } = await supabase
    .from("shamsy_orders")
    .select("*, shamsy_customers(name, city)")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 px-4 py-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Orders</h1>
        <Link
          href="/orders/new"
          className="text-sm font-medium text-emerald-700"
        >
          + New
        </Link>
      </header>

      {!orders?.length && (
        <p className="text-sm text-zinc-500">No orders yet.</p>
      )}

      <ul className="space-y-2">
        {(orders as Order[] | null)?.map((o) => (
          <li key={o.id}>
            <Link
              href={`/orders/${o.id}`}
              className={`block rounded-xl border p-3 hover:border-emerald-300 ${
                o.status === "draft"
                  ? "border-amber-300 bg-amber-50"
                  : "border-zinc-200 bg-white"
              }`}
            >
              <div className="flex justify-between text-sm font-medium">
                <span className="flex items-center gap-2">
                  {o.shamsy_customers?.name ?? "Dealer"}
                  {o.status === "draft" && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-900">
                      Draft
                    </span>
                  )}
                </span>
                <span className="tabular-nums">
                  {formatUsdFromCents(o.total_usd_cents)}
                </span>
              </div>
              <div className="mt-1 flex justify-between text-xs text-zinc-500">
                <span>
                  Rate {o.exchange_rate.toLocaleString()} ·{" "}
                  {formatSdg(o.total_sdg)}
                </span>
                <span>{new Date(o.created_at).toLocaleString()}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
