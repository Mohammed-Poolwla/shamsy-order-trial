import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrderForm } from "@/components/OrderForm";
import type { Customer, Product, Profile } from "@/lib/types";

type SearchParams = Promise<{ approval?: string }>;

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: products }, { data: customers }, { data: settings }] =
    await Promise.all([
      supabase.from("shamsy_profiles").select("*").eq("id", user.id).single(),
      supabase
        .from("shamsy_products")
        .select("*")
        .eq("active", true)
        .order("unit_price_cents"),
      supabase.from("shamsy_customers").select("*").eq("active", true).order("name"),
      supabase.from("shamsy_app_settings").select("key, value"),
    ]);

  if (!profile) redirect("/login");

  const settingsMap = Object.fromEntries(
    (settings ?? []).map((s) => [
      s.key,
      typeof s.value === "number" ? s.value : Number(s.value),
    ]),
  );
  const minRate = settingsMap.min_exchange_rate || 8000;
  const defaultRate = settingsMap.default_exchange_rate || 8200;

  let approvalId: string | null = null;
  let initialCustomerId: string | null = null;
  let initialRate: number | null = null;
  let initialLines: Array<{
    product_id: string;
    quantity: number;
    discount_cents: number;
  }> | null = null;

  if (params.approval) {
    const { data: approval } = await supabase
      .from("shamsy_discount_approvals")
      .select("*")
      .eq("id", params.approval)
      .eq("status", "approved")
      .maybeSingle();

    if (approval) {
      approvalId = approval.id;
      initialCustomerId = approval.customer_id;
      initialRate = approval.exchange_rate;
      initialLines = approval.payload.lines;
    }
  }

  return (
    <OrderForm
      profile={profile as Profile}
      products={(products ?? []) as Product[]}
      customers={(customers ?? []) as Customer[]}
      minRate={minRate}
      defaultRate={defaultRate}
      approvalId={approvalId}
      initialCustomerId={initialCustomerId}
      initialRate={initialRate}
      initialLines={initialLines}
    />
  );
}
