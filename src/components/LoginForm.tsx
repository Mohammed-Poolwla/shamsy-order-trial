"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("adviser@shamsy.trial");
  const [password, setPassword] = useState("trial-adviser-123");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const { error: signError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signError) {
        setError(signError.message);
        return;
      }
      router.push("/orders/new");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-sm space-y-4 px-4 py-10">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-emerald-800">Shamsy</p>
        <h1 className="text-2xl font-semibold text-zinc-900">Sign in</h1>
        <p className="text-sm text-zinc-600">
          Trial accounts: adviser or owner. Password is in the README.
        </p>
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Email</span>
        <input
          type="email"
          required
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Password</span>
        <input
          type="password"
          required
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-emerald-700 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <div className="space-y-1 text-xs text-zinc-500">
        <p>Quick fill:</p>
        <button
          type="button"
          className="underline"
          onClick={() => {
            setEmail("adviser@shamsy.trial");
            setPassword("trial-adviser-123");
          }}
        >
          Adviser
        </button>
        {" · "}
        <button
          type="button"
          className="underline"
          onClick={() => {
            setEmail("owner@shamsy.trial");
            setPassword("trial-owner-123");
          }}
        >
          Owner
        </button>
      </div>
    </form>
  );
}
