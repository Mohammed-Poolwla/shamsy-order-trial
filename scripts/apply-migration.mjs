/**
 * Applies additive shamsy_* SQL to the linked Supabase Postgres.
 * Requires DATABASE_URL or SUPABASE_DB_PASSWORD in env / .env.local
 *
 * DATABASE_URL example (pooler):
 * postgresql://postgres.PROJECT_REF:PASSWORD@aws-1-us-east-1.pooler.supabase.com:6543/postgres
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    const key = trimmed.slice(0, i);
    let val = trimmed.slice(i + 1);
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvLocal();

function buildUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const password = process.env.SUPABASE_DB_PASSWORD;
  const ref =
    process.env.SUPABASE_PROJECT_REF ||
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "")
      .replace("https://", "")
      .replace(".supabase.co", "");
  if (!password || !ref) return null;
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-1-us-east-1.pooler.supabase.com:6543/postgres`;
}

const url = buildUrl();
if (!url) {
  console.error(
    "Set DATABASE_URL or SUPABASE_DB_PASSWORD (+ project URL) in .env.local",
  );
  console.error(
    "Find the DB password in Supabase → Project Settings → Database",
  );
  process.exit(1);
}

const migration = readFileSync(
  resolve("supabase/migrations/20260323100000_trial_order_schema.sql"),
  "utf8",
);
const migration2 = readFileSync(
  resolve("supabase/migrations/20260323110000_day_rate_and_inline_approval.sql"),
  "utf8",
);
const seed = readFileSync(resolve("supabase/seed.sql"), "utf8");

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log("Connected. Applying additive shamsy_* migrations...");
await client.query("begin");
try {
  await client.query(migration);
  await client.query(migration2);
  await client.query(seed);
  await client.query("commit");
  console.log("Migrations + seed applied.");
} catch (err) {
  await client.query("rollback");
  console.error("Failed, rolled back:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
