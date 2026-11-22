-- ============================================================
-- 17 — Parrainage / revendeurs + CRM (22/11/2026)
-- Prix de gros par produit. Le parrain crée ses liens / codes et choisit
-- la remise du client (10 % par défaut), sans jamais passer sous le prix de gros.
-- Gain du parrain = prix payé − prix de gros. Seuil de versement : alerte admin.
-- Relançable sans danger.
-- ============================================================
alter table public.products add column if not exists wholesale_price_fcfa int check (wholesale_price_fcfa is null or wholesale_price_fcfa >= 0);

create table if not exists public.parrains (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null unique,
  phone       text,
  payout_info text,                                  -- ex : numéro Wave / Orange Money pour les versements
  status      text not null default 'active' check (status in ('active','suspended')),
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists public.referral_codes (
  id           uuid primary key default gen_random_uuid(),
  parrain_id   uuid not null references public.parrains(id) on delete cascade,
  code         text not null unique,                 -- en MAJUSCULES, ex : AMADOU10
  label        text,
  discount_pct numeric(5,2) not null default 10 check (discount_pct >= 0 and discount_pct <= 90),
  active       boolean not null default true,
  clicks       int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists referral_codes_parrain_idx on public.referral_codes (parrain_id);

-- connexion des parrains par lien envoyé par email (pas de mot de passe)
create table if not exists public.parrain_sessions (
  token_hash  text primary key,
  parrain_id  uuid not null references public.parrains(id) on delete cascade,
  kind        text not null check (kind in ('login','session')),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.payouts (
  id          uuid primary key default gen_random_uuid(),
  parrain_id  uuid not null references public.parrains(id) on delete cascade,
  amount_fcfa int not null check (amount_fcfa > 0),
  status      text not null default 'to_pay' check (status in ('to_pay','paid','cancelled')),
  notified_at timestamptz,
  paid_at     timestamptz,
  note        text,
  created_at  timestamptz not null default now()
);
create unique index if not exists payouts_one_open on public.payouts (parrain_id) where status = 'to_pay';

alter table public.orders add column if not exists parrain_id uuid references public.parrains(id) on delete set null;
alter table public.orders add column if not exists referral_code_id uuid references public.referral_codes(id) on delete set null;
alter table public.orders add column if not exists referral_code text;
alter table public.orders add column if not exists discount_fcfa int not null default 0;
alter table public.orders add column if not exists commission_fcfa int not null default 0;
create index if not exists orders_parrain_idx on public.orders (parrain_id);
create index if not exists orders_email_idx on public.orders (email);
alter table public.order_items add column if not exists list_price int;        -- prix public avant remise
alter table public.order_items add column if not exists wholesale_price int;   -- prix de gros au moment de la vente

alter table public.parrains enable row level security;
alter table public.referral_codes enable row level security;
alter table public.parrain_sessions enable row level security;
alter table public.payouts enable row level security;
revoke all on table public.parrains, public.referral_codes, public.parrain_sessions, public.payouts from anon, authenticated;
grant all on table public.parrains, public.referral_codes, public.parrain_sessions, public.payouts to service_role;

insert into public.settings (key, value) select 'payout_threshold', '10000'::jsonb
 where not exists (select 1 from public.settings where key = 'payout_threshold');
insert into public.settings (key, value) select 'default_discount_pct', '10'::jsonb
 where not exists (select 1 from public.settings where key = 'default_discount_pct');

-- Solde d'un parrain : gains des commandes payées − versements (payés ou à payer)
create or replace function public.parrain_balance(p_parrain uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select sum(commission_fcfa) from public.orders
                    where parrain_id = p_parrain and paid_at is not null and status <> 'cancelled'), 0)::int
       - coalesce((select sum(amount_fcfa) from public.payouts
                    where parrain_id = p_parrain and status in ('to_pay','paid')), 0)::int;
$$;

-- Seuil atteint → une demande de versement « à payer » (une seule ouverte à la fois)
create or replace function public.check_payout(p_parrain uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare bal int; thr int;
begin
  if p_parrain is null then return jsonb_build_object('created', false); end if;
  if exists (select 1 from public.payouts where parrain_id = p_parrain and status = 'to_pay') then
    -- la demande ouverte suit le solde
    update public.payouts set amount_fcfa = amount_fcfa + greatest(public.parrain_balance(p_parrain), 0)
     where parrain_id = p_parrain and status = 'to_pay' and public.parrain_balance(p_parrain) > 0;
    return jsonb_build_object('created', false);
  end if;
  bal := public.parrain_balance(p_parrain);
  select coalesce((select (value)::text::int from public.settings where key = 'payout_threshold'), 10000) into thr;
  if bal >= thr and bal > 0 then
    insert into public.payouts (parrain_id, amount_fcfa) values (p_parrain, bal) on conflict do nothing;
    return jsonb_build_object('created', true, 'amount', bal);
  end if;
  return jsonb_build_object('created', false, 'balance', bal);
end $$;

-- dès qu'une commande parrainée est payée : contrôle du seuil
create or replace function public.orders_paid_payout() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parrain_id is not null and new.paid_at is not null and (old.paid_at is null or old.status is distinct from new.status) then
    perform public.check_payout(new.parrain_id);
  end if;
  return new;
end $$;
drop trigger if exists orders_paid_payout on public.orders;
create trigger orders_paid_payout after update of paid_at, status on public.orders
  for each row execute function public.orders_paid_payout();

revoke all on function public.parrain_balance(uuid), public.check_payout(uuid) from public, anon, authenticated;
grant execute on function public.parrain_balance(uuid), public.check_payout(uuid) to service_role;

create or replace function public.referral_click(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.referral_codes set clicks = clicks + 1 where id = p_id;
$$;
revoke all on function public.referral_click(uuid) from public, anon, authenticated;
grant execute on function public.referral_click(uuid) to service_role;
