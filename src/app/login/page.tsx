import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/orders/new");

  return (
    <main className="min-h-full bg-[linear-gradient(180deg,#ecfdf5_0%,#ffffff_40%)]">
      <LoginForm />
    </main>
  );
}
