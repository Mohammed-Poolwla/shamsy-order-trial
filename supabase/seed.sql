-- Seed catalogue only (users via scripts/seed-users.mjs)
insert into public.shamsy_products (sku, name, unit_price_cents) values
  ('SPF-6000-ES-PLUS', 'SPF 6000 ES Plus — 6 kW inverter', 51500),
  ('SPE-12000-ES', 'SPE 12000 ES — 12 kW inverter', 97500),
  ('HOPE-5.0L-B1', 'Hope 5.0L-B1 — 5 kWh battery', 81000),
  ('HOPE-16.0LM-A1', 'Hope 16.0LM-A1 — 16 kWh battery', 207000)
on conflict (sku) do update
  set name = excluded.name,
      unit_price_cents = excluded.unit_price_cents,
      active = true;

insert into public.shamsy_customers (name, city)
select v.name, v.city
from (values
  ('Ahmed Trading', 'Khartoum'),
  ('Nile Solar', 'Omdurman'),
  ('Dongola Power', 'Dongola')
) as v(name, city)
where not exists (
  select 1 from public.shamsy_customers c where c.name = v.name and c.city = v.city
);
