import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ApprovalsList } from "@/components/ApprovalsList";
import type { Order, OrderLine, Product, Profile } from "@/lib/types";

export default async function ApprovalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: drafts }, { data: products }] =
    await Promise.all([
      supabase.from("shamsy_profiles").select("*").eq("id", user.id).single(),
      supabase
        .from("shamsy_orders")
        .select(
          "*, shamsy_customers(name, city), shamsy_order_lines(*, shamsy_products(name, sku))",
        )
        .eq("status", "draft")
        .order("created_at", { ascending: false }),
      supabase.from("shamsy_products").select("*"),
    ]);

  if (!profile) redirect("/login");

  return (
    <ApprovalsList
      profile={profile as Profile}
      drafts={(drafts ?? []) as (Order & { shamsy_order_lines?: OrderLine[] })[]}
      products={(products ?? []) as Product[]}
    />
  );
}
