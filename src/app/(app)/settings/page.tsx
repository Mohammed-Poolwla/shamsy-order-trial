import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "@/components/SettingsForm";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("shamsy_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "owner") redirect("/orders/new");

  const { data: settings } = await supabase
    .from("shamsy_app_settings")
    .select("key, value");

  const map = Object.fromEntries(
    (settings ?? []).map((s) => [
      s.key,
      typeof s.value === "number" ? s.value : Number(s.value),
    ]),
  );

  return (
    <SettingsForm
      minRate={map.min_exchange_rate || 8000}
      dayRate={map.default_exchange_rate || 8200}
    />
  );
}
