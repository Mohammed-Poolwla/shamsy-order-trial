/**
 * Creates trial users + profiles in the linked Supabase project.
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const users = [
  {
    email: "adviser@shamsy.trial",
    password: "trial-adviser-123",
    full_name: "Sara Adviser",
    role: "adviser",
  },
  {
    email: "owner@shamsy.trial",
    password: "trial-owner-123",
    full_name: "Omar Owner",
    role: "owner",
  },
];

async function upsertUser(u) {
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listError) throw listError;

  const existing = listed.users.find(
    (x) => x.email?.toLowerCase() === u.email.toLowerCase(),
  );

  let userId;
  if (existing) {
    userId = existing.id;
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password: u.password,
      email_confirm: true,
    });
    if (error) throw error;
    console.log(`Updated auth user ${u.email}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`Created auth user ${u.email}`);
  }

  const { error: profileError } = await admin.from("shamsy_profiles").upsert({
    id: userId,
    full_name: u.full_name,
    role: u.role,
  });
  if (profileError) throw profileError;
  console.log(`Upserted profile ${u.role}`);
}

async function seedCatalogue() {
  const products = [
    {
      sku: "SPF-6000-ES-PLUS",
      name: "SPF 6000 ES Plus — 6 kW inverter",
      unit_price_cents: 51500,
    },
    {
      sku: "SPE-12000-ES",
      name: "SPE 12000 ES — 12 kW inverter",
      unit_price_cents: 97500,
    },
    {
      sku: "HOPE-5.0L-B1",
      name: "Hope 5.0L-B1 — 5 kWh battery",
      unit_price_cents: 81000,
    },
    {
      sku: "HOPE-16.0LM-A1",
      name: "Hope 16.0LM-A1 — 16 kWh battery",
      unit_price_cents: 207000,
    },
  ];

  for (const p of products) {
    const { error } = await admin.from("shamsy_products").upsert(p, {
      onConflict: "sku",
    });
    if (error) throw error;
  }
  console.log("Seeded products");

  const customers = [
    { name: "Ahmed Trading", city: "Khartoum" },
    { name: "Nile Solar", city: "Omdurman" },
    { name: "Dongola Power", city: "Dongola" },
  ];

  for (const c of customers) {
    const { data: existing } = await admin
      .from("shamsy_customers")
      .select("id")
      .eq("name", c.name)
      .eq("city", c.city)
      .maybeSingle();
    if (!existing) {
      const { error } = await admin.from("shamsy_customers").insert(c);
      if (error) throw error;
    }
  }
  console.log("Seeded customers");
}

async function main() {
  for (const u of users) await upsertUser(u);
  await seedCatalogue();
  console.log("\nDone. Sign in with:");
  console.log("  adviser@shamsy.trial / trial-adviser-123");
  console.log("  owner@shamsy.trial   / trial-owner-123");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
