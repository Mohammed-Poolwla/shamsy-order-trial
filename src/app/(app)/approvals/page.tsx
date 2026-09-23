import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ApprovalsList } from "@/components/ApprovalsList";
import type { DiscountApproval, Product, Profile } from "@/lib/types";

export default async function ApprovalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: approvals }, { data: products }] =
    await Promise.all([
      supabase.from("shamsy_profiles").select("*").eq("id", user.id).single(),
      supabase
        .from("shamsy_discount_approvals")
        .select("*, shamsy_customers(name, city)")
        .order("created_at", { ascending: false }),
      supabase.from("shamsy_products").select("*"),
    ]);

  if (!profile) redirect("/login");

  return (
    <ApprovalsList
      profile={profile as Profile}
      approvals={(approvals ?? []) as DiscountApproval[]}
      products={(products ?? []) as Product[]}
    />
  );
}
