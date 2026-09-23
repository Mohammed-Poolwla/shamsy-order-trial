"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SettingsForm({ minRate }: { minRate: number }) {
  const router = useRouter();
  const supabase = createClient();
  const [value, setValue] = useState(String(minRate));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const rate = parseInt(value, 10);
    startTransition(async () => {
      const { error: rpcError } = await supabase.rpc("shamsy_set_min_exchange_rate", {
        p_rate: rate,
      });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      setMessage(
        `Minimum rate set to ${rate.toLocaleString()}. Saved orders keep their own rate.`,
      );
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={save}
      className="mx-auto w-full max-w-lg space-y-4 px-4 py-4"
    >
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-zinc-600">
          Change the minimum exchange rate to prove that saved orders do not
          move. After saving an order at 8,200, set this to 9,000 and reopen the
          order — it must still show 8,200.
        </p>
      </header>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Minimum exchange rate (SDG/$)</span>
        <input
          type="number"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 tabular-nums"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          min={1}
        />
      </label>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-emerald-700 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Update minimum rate"}
      </button>
    </form>
  );
}
