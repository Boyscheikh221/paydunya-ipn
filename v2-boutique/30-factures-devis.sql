-- 30 — Factures et devis
--   * Chaque commande payée (site ou envoi manuel) reçoit un numéro de facture unique et continu : FA-2026-00001.
--     Pas de facture pour une commande offerte (0 FCFA). Le numéro ne change plus jamais, même si la commande est annulée.
--   * TVA : réglage invoice_vat_enabled (désactivé par défaut). Le taux est figé sur la facture au moment où elle est créée.
--     Les prix du site sont TTC : avec TVA, HT = TTC / 1,18.
--   * Devis (revendeurs, entreprises) : DE-2026-00001, convertibles en commande (et donc en facture) depuis l'admin.

create table if not exists public.doc_counters (
  kind text not null,          -- 'FA' facture, 'DE' devis
  year int not null,
  last int not null default 0,
  primary key (kind, year)
);
alter table public.doc_counters enable row level security;

create or replace function public.next_doc_no(p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare y int := extract(year from now() at time zone 'Africa/Dakar'); n int;
begin
  insert into public.doc_counters (kind, year, last) values (p_kind, y, 1)
  on conflict (kind, year) do update set last = public.doc_counters.last + 1
  returning last into n;
  return p_kind || '-' || y || '-' || lpad(n::text, 5, '0');
end $$;
revoke all on function public.next_doc_no(text) from public, anon, authenticated;
grant execute on function public.next_doc_no(text) to service_role;

alter table public.orders add column if not exists invoice_no text unique;
alter table public.orders add column if not exists invoice_at timestamptz;
alter table public.orders add column if not exists vat_rate numeric(5,2) not null default 0;
alter table public.orders add column if not exists billing_company text;   -- société du client (devis converti)
alter table public.orders add column if not exists billing_address text;

create or replace function public.orders_invoice_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.invoice_no is null and new.amount_fcfa > 0
     and new.status in ('paid','processing','installing','delivered') then
    new.invoice_no := public.next_doc_no('FA');
    new.invoice_at := now();
    new.vat_rate := case when coalesce((select (value)::text::boolean from public.settings where key = 'invoice_vat_enabled'), false)
                         then 18 else 0 end;
  end if;
  return new;
end $$;
drop trigger if exists orders_invoice_no on public.orders;
create trigger orders_invoice_no before insert or update of status, amount_fcfa on public.orders
  for each row execute function public.orders_invoice_no();

-- commandes déjà payées : numérotées dans l'ordre du paiement
do $$
declare r record;
begin
  for r in select id from public.orders
            where invoice_no is null and amount_fcfa > 0 and status in ('paid','processing','installing','delivered')
            order by coalesce(paid_at, created_at), created_at
  loop
    update public.orders set invoice_no = public.next_doc_no('FA'), invoice_at = coalesce(paid_at, created_at) where id = r.id;
  end loop;
end $$;

-- Devis
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  quote_no text unique not null default public.next_doc_no('DE'),
  public_token text unique not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  customer_name text not null,
  company text,
  email text,
  phone text,
  address text,
  items jsonb not null default '[]',    -- [{product_id, name, qty, unit_price}]
  total_fcfa int not null default 0,
  vat_rate numeric(5,2) not null default 0,
  notes text,
  valid_until date,
  status text not null default 'draft' check (status in ('draft','sent','accepted','converted','cancelled')),
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.quotes enable row level security;

-- réglages de facturation (vides par défaut : à remplir dans l'admin)
insert into public.settings (key, value) values
  ('invoice_legal_name', '"licenceoff"'),
  ('invoice_vat_enabled', 'false')
on conflict (key) do nothing;

select (select count(*) from public.orders where invoice_no is not null) as factures,
       (select max(invoice_no) from public.orders) as dernier_numero;

-- accès pour les fonctions du site (clé service)
grant select, insert, update, delete on public.quotes to service_role;
grant select, insert, update on public.doc_counters to service_role;
