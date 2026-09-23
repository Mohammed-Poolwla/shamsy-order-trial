"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Props = {
  minRate: number;
  dayRate: number;
};

export function SettingsForm({ minRate, dayRate }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [minValue, setMinValue] = useState(String(minRate));
  const [dayValue, setDayValue] = useState(String(dayRate));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const nextMin = parseInt(minValue, 10);
    const nextDay = parseInt(dayValue, 10);
    startTransition(async () => {
      const { error: minError } = await supabase.rpc(
        "shamsy_set_min_exchange_rate",
        { p_rate: nextMin },
      );
      if (minError) {
        setError(minError.message);
        return;
      }
      const { error: dayError } = await supabase.rpc(
        "shamsy_set_day_exchange_rate",
        { p_rate: nextDay },
      );
      if (dayError) {
        setError(dayError.message);
        return;
      }
      setMessage(
        `Day's rate ${nextDay.toLocaleString()} · minimum ${nextMin.toLocaleString()}. Saved orders keep their own snapshotted rate.`,
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
        <h1 className="text-xl font-semibold">Rate settings</h1>
        <p className="text-sm text-zinc-600">
          PDF check: save an order at 8,200, then set the day&apos;s rate (or
          minimum) to 9,000 and reopen — the order must still show 8,200 and the
          same SDG total.
        </p>
      </header>

      <label className="block space-y-1">
        <span className="text-sm font-medium">
          Today&apos;s exchange rate (SDG/$)
        </span>
        <input
          type="number"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 tabular-nums"
          value={dayValue}
          onChange={(e) => setDayValue(e.target.value)}
          min={1}
        />
        <span className="text-xs text-zinc-500">
          Default filled into new orders. Changing this never rewrites saved
          orders.
        </span>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Minimum exchange rate (SDG/$)</span>
        <input
          type="number"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 tabular-nums"
          value={minValue}
          onChange={(e) => setMinValue(e.target.value)}
          min={1}
        />
        <span className="text-xs text-zinc-500">
          Advisers cannot enter below this (e.g. 7,900 resets to 8,000).
        </span>
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
        {pending ? "Saving…" : "Update rate settings"}
      </button>
    </form>
  );
}
