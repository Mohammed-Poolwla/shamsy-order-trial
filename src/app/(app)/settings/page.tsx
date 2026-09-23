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

  const { data: setting } = await supabase
    .from("shamsy_app_settings")
    .select("value")
    .eq("key", "min_exchange_rate")
    .single();

  const minRate =
    typeof setting?.value === "number"
      ? setting.value
      : Number(setting?.value ?? 8000);

  return <SettingsForm minRate={minRate} />;
}
