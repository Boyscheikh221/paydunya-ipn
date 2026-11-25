-- 59 — Programme de fidélité (règles validées par Cheikh le 2026-11-25)
--   Gagner : 1 point par tranche de 1 000 FCFA payée (hors livraison), crédité quand la commande passe « livrée » ;
--            50 points par avis validé dans l'admin (1 avis par article acheté).
--   Utiliser : 1 point = 10 FCFA, à partir de 200 points, réduction plafonnée à 20 % des produits,
--              jamais sous le prix de gros ; cumulable avec un code parrain. Réservé au client connecté à son compte.
--   Expiration : 12 mois après le gain (les points les plus anciens sont utilisés en premier).
-- Un seul registre (loyalty_points). Le solde se recalcule à la volée :
--   - un gain d'achat ne compte que si la commande est toujours « livrée » (annulée = retiré) ;
--   - une dépense ne compte que si sa commande n'est pas annulée, ni en attente depuis plus de 48 h (points rendus).

create table if not exists public.loyalty_points (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  points int not null check (points <> 0),
  kind text not null check (kind in ('purchase', 'review', 'spend', 'adjust')),
  order_id uuid references public.orders(id) on delete cascade,
  review_id uuid references public.product_reviews(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists loyalty_points_email on public.loyalty_points (email, created_at);
create unique index if not exists loyalty_points_purchase_once on public.loyalty_points (order_id) where kind = 'purchase';
create unique index if not exists loyalty_points_spend_once on public.loyalty_points (order_id) where kind = 'spend';
create unique index if not exists loyalty_points_review_once on public.loyalty_points (review_id) where kind = 'review';
alter table public.loyalty_points enable row level security;
revoke all on public.loyalty_points from anon, authenticated;
grant all on public.loyalty_points to service_role;

alter table public.orders add column if not exists points_used int not null default 0;
alter table public.orders add column if not exists points_discount_fcfa int not null default 0;

-- Lignes qui comptent encore (voir les règles en tête de fichier)
create or replace function public.loyalty_valid_rows(p_email text)
returns table (points int, kind text, created_at timestamptz, note text, order_ref text)
language sql stable security definer set search_path = public as $$
  select l.points, l.kind, l.created_at, l.note, o.ref
  from public.loyalty_points l left join public.orders o on o.id = l.order_id
  where l.email = lower(p_email)
    and (l.kind <> 'purchase' or o.status = 'delivered')
    and (l.kind <> 'spend' or (o.status <> 'cancelled' and not (o.status = 'pending' and o.created_at < now() - interval '48 hours')))
  order by l.created_at, l.points desc;
$$;

-- Solde : gains des 12 derniers mois moins ce qui a été utilisé, les points les plus anciens partant en premier
create or replace function public.loyalty_balance(p_email text)
returns int language plpgsql stable security definer set search_path = public as $$
declare
  r record; exps timestamptz[] := '{}'; rems int[] := '{}'; need int; take int; i int; total int := 0;
begin
  for r in select * from public.loyalty_valid_rows(p_email) loop
    if r.points > 0 then
      exps := exps || (r.created_at + interval '12 months'); rems := rems || r.points;
    else
      need := -r.points;
      for i in 1 .. coalesce(array_length(rems, 1), 0) loop
        exit when need <= 0;
        if rems[i] > 0 and exps[i] > r.created_at then
          take := least(rems[i], need); rems[i] := rems[i] - take; need := need - take;
        end if;
      end loop;
    end if;
  end loop;
  for i in 1 .. coalesce(array_length(rems, 1), 0) loop
    if exps[i] > now() then total := total + rems[i]; end if;
  end loop;
  return total;
end $$;

-- Dépense de points à la commande, à l'abri des doubles clics (verrou par email). Renvoie false si le solde ne suffit plus.
create or replace function public.loyalty_spend(p_email text, p_order_id uuid, p_points int)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_points <= 0 then return true; end if;
  perform pg_advisory_xact_lock(hashtext('loyalty:' || lower(p_email)));
  if public.loyalty_balance(p_email) < p_points then return false; end if;
  insert into public.loyalty_points (email, points, kind, order_id, note)
  values (lower(p_email), -p_points, 'spend', p_order_id, 'Réduction sur la commande');
  return true;
end $$;

-- Gain d'achat : quand une commande devient « livrée » (site, admin, vente manuelle)
create or replace function public.loyalty_on_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare pts int;
begin
  if new.status = 'delivered' and (tg_op = 'INSERT' or old.status is distinct from 'delivered') and coalesce(new.email, '') like '%@%' then
    pts := floor(greatest(0, coalesce(new.amount_fcfa, 0) - coalesce(new.shipping_fee_fcfa, 0) - coalesce(new.fees_fcfa, 0)) / 1000.0);
    if pts > 0 then
      insert into public.loyalty_points (email, points, kind, order_id, note)
      values (lower(new.email), pts, 'purchase', new.id, 'Achat ' || new.ref)
      on conflict do nothing;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists loyalty_on_order on public.orders;
create trigger loyalty_on_order after insert or update of status on public.orders
  for each row execute function public.loyalty_on_order();

-- Gain d'avis : 50 points quand l'admin valide l'avis ; retirés si l'avis est masqué ou supprimé
create or replace function public.loyalty_on_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare mail text; pname text;
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    select o.email, i.product_name into mail, pname
      from public.order_items i join public.orders o on o.id = i.order_id where i.id = new.order_item_id;
    if coalesce(mail, '') like '%@%' then
      insert into public.loyalty_points (email, points, kind, review_id, note)
      values (lower(mail), 50, 'review', new.id, 'Avis sur ' || coalesce(pname, 'un produit'))
      on conflict do nothing;
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'approved' and new.status <> 'approved' then
    delete from public.loyalty_points where review_id = new.id and kind = 'review';
  end if;
  return new;
end $$;
drop trigger if exists loyalty_on_review on public.product_reviews;
create trigger loyalty_on_review after insert or update of status on public.product_reviews
  for each row execute function public.loyalty_on_review();

revoke all on function public.loyalty_valid_rows(text) from public, anon, authenticated;
revoke all on function public.loyalty_balance(text) from public, anon, authenticated;
revoke all on function public.loyalty_spend(text, uuid, int) from public, anon, authenticated;
grant execute on function public.loyalty_valid_rows(text) to service_role;
grant execute on function public.loyalty_balance(text) to service_role;
grant execute on function public.loyalty_spend(text, uuid, int) to service_role;
