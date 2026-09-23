import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ApprovalsList } from "@/components/ApprovalsList";
import type { Order, OrderLine, Product, Profile } from "@/lib/types";

type DraftOrder = Order & { shamsy_order_lines?: OrderLine[] };

export default async function ApprovalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { data: profile },
    { data: drafts, error: draftsError },
    { data: products },
  ] = await Promise.all([
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

  const role = (profile as Profile).role;
  let visible = (drafts ?? []) as DraftOrder[];

  // Owner Approvals tab: only drafts that still need a line approval
  if (role === "owner") {
    visible = visible.filter((d) =>
      (d.shamsy_order_lines ?? []).some((l) => l.approval === "required"),
    );
  }

  return (
    <ApprovalsList
      profile={profile as Profile}
      drafts={visible}
      products={(products ?? []) as Product[]}
      loadError={draftsError?.message ?? null}
      mode={role === "owner" ? "approvals" : "drafts"}
    />
  );
}
