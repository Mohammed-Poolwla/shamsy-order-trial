"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

export function AppNav({ profile }: { profile: Profile }) {
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-lg items-center justify-between gap-2 px-4 py-2.5">
        <Link href="/orders/new" className="text-sm font-semibold text-emerald-800">
          Shamsy
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-zinc-600">
          <Link href="/orders/new" className="hover:text-zinc-900">
            New order
          </Link>
          <Link href="/orders" className="hover:text-zinc-900">
            Orders
          </Link>
          {(profile.role === "owner" || profile.role === "adviser") && (
            <Link href="/approvals" className="hover:text-zinc-900">
              Drafts
            </Link>
          )}
          {profile.role === "owner" && (
            <Link href="/settings" className="hover:text-zinc-900">
              Settings
            </Link>
          )}
          <span className="text-zinc-400">
            {profile.full_name} ({profile.role})
          </span>
          <button type="button" onClick={signOut} className="underline">
            Out
          </button>
        </div>
      </div>
    </nav>
  );
}
