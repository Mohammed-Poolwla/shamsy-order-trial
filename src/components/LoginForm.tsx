"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const TRIAL_USERS = [
  {
    role: "Adviser",
    name: "Sara Adviser",
    email: "adviser@shamsy.trial",
    password: "trial-adviser-123",
    hint: "Create drafts with >5% lines",
  },
  {
    role: "Owner",
    name: "Omar Owner",
    email: "owner@shamsy.trial",
    password: "trial-owner-123",
    hint: "Approvals + Settings",
  },
] as const;

export function LoginForm() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState<string>(TRIAL_USERS[0].email);
  const [password, setPassword] = useState<string>(TRIAL_USERS[0].password);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function fillUser(user: (typeof TRIAL_USERS)[number]) {
    setEmail(user.email);
    setPassword(user.password);
    setError(null);
  }

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
    <form
      onSubmit={onSubmit}
      className="mx-auto w-full max-w-sm space-y-4 px-4 py-10"
    >
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-emerald-800">
          Shamsy
        </p>
        <h1 className="text-2xl font-semibold text-zinc-900">Sign in</h1>
        <p className="text-sm text-zinc-600">
          Paid trial demo — use the accounts below (shown here so credentials
          need not be shared on Upwork).
        </p>
      </div>

      <section
        aria-label="Trial demo accounts"
        className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-900">
          Demo accounts
        </p>
        <ul className="space-y-2">
          {TRIAL_USERS.map((user) => (
            <li
              key={user.email}
              className="rounded-lg border border-emerald-200/80 bg-white p-2.5 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-zinc-900">
                    {user.role}
                  </p>
                  <p className="text-[11px] text-zinc-500">{user.hint}</p>
                </div>
                <button
                  type="button"
                  onClick={() => fillUser(user)}
                  className="shrink-0 rounded-md bg-emerald-800 px-2.5 py-1.5 text-[11px] font-semibold text-white"
                >
                  Use
                </button>
              </div>
              <dl className="space-y-0.5 font-mono text-[11px] text-zinc-700">
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-zinc-500">Email</dt>
                  <dd className="break-all select-all">{user.email}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-zinc-500">Pass</dt>
                  <dd className="select-all">{user.password}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Email</span>
        <input
          type="email"
          required
          autoComplete="username"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Password</span>
        <input
          type="text"
          required
          autoComplete="current-password"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 font-mono text-sm"
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
    </form>
  );
}
