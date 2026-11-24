-- ============================================================
-- 14 — Clés / sérialiseurs RÉUTILISABLES (22/11/2026)
-- Une clé « réutilisable » n'est jamais épuisée : elle est envoyée à chaque
-- commande du produit. Les clés normales restent à usage unique (prioritaires).
-- Relançable sans danger.
-- ============================================================
alter table public.license_keys add column if not exists reusable boolean not null default false;
alter table public.license_keys add column if not exists source_key_id uuid; -- copie envoyée d'une clé réutilisable

-- le même sérialiseur peut maintenant apparaître dans plusieurs commandes (copies)
do $$ declare c text; begin
  for c in select conname from pg_constraint
            where conrelid = 'public.license_keys'::regclass and contype = 'u'
              and pg_get_constraintdef(oid) ilike 'UNIQUE (product_id, key_value)%' loop
    execute format('alter table public.license_keys drop constraint %I', c);
  end loop;
end $$;
create unique index if not exists license_keys_stock_uniq on public.license_keys (product_id, key_value) where source_key_id is null;

create or replace function public.deliver_order_v3(p_order_id uuid, p_tokens text[], p_days int default 7, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  it record;
  needed int;
  got int;
  ti int := 1;
  waiting int := 0;
  manual int := 0;
  p public.products;
  global_auto boolean;
  rk public.license_keys;
begin
  select coalesce((select (value)::text::boolean from public.settings where key = 'auto_delivery'), true) into global_auto;
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'cancelled'); end if;
  if o.status = 'delivered' then return jsonb_build_object('ok', true, 'reason', 'already_delivered'); end if;

  update public.orders set paid_at = coalesce(paid_at, now()) where id = o.id;

  for it in select * from public.order_items where order_id = o.id
      and (status in ('pending','waiting_stock') or (p_force and status = 'to_process' and delivery_type <> 'manual'))
      order by created_at loop
    select * into p from public.products where id = it.product_id;

    -- service à faire à la main, ou livraison automatique désactivée : l'admin s'en occupe
    if it.delivery_type = 'manual' or (not p_force and not (global_auto and coalesce(p.auto_deliver, true))) then
      update public.order_items set status = 'to_process' where id = it.id;
      manual := manual + 1;
      continue;
    end if;

    -- clés / identifiants : 1 par unité achetée.
    -- D'abord les clés à usage unique (jamais réutilisées), puis, s'il en manque,
    -- une clé « réutilisable » du stock : elle reste disponible, on en garde une copie pour la commande.
    if it.delivery_type in ('key','key_file','stock') then
      select count(*) into got from public.license_keys where order_item_id = it.id;
      needed := it.quantity - got;
      if needed > 0 then
        with picked as (
          select id from public.license_keys
           where product_id = it.product_id and status = 'available' and not reusable
           order by added_at, id
           for update skip locked
           limit needed
        )
        update public.license_keys k
           set status = 'sent', order_item_id = it.id, order_id = null, sent_at = now()
          from picked where k.id = picked.id;
        select count(*) into got from public.license_keys where order_item_id = it.id;
      end if;
      if got < it.quantity then
        select * into rk from public.license_keys
         where product_id = it.product_id and status = 'available' and reusable
         order by added_at, id limit 1;
        if found then
          insert into public.license_keys (product_id, key_value, status, reusable, source_key_id, order_item_id, sent_at)
          select it.product_id, rk.key_value, 'sent', true, rk.id, it.id, now()
            from generate_series(1, it.quantity - got);
          update public.license_keys set sent_at = now() where id = rk.id;
          got := it.quantity;
        end if;
      end if;
      if got < it.quantity then
        update public.order_items set status = 'waiting_stock' where id = it.id;
        waiting := waiting + 1;
        continue;
      end if;
    end if;

    -- logiciel : un lien à usage unique
    if it.delivery_type in ('key_file','file') and coalesce(p.installer_path, '') <> ''
       and not exists (select 1 from public.downloads where order_item_id = it.id) then
      if ti > coalesce(array_length(p_tokens, 1), 0) then
        return jsonb_build_object('ok', false, 'reason', 'tokens_missing');
      end if;
      insert into public.downloads (token, email, note, status, max_downloads, expires_at, activated_at, order_id, order_item_id, product_id)
      values (p_tokens[ti], o.email, o.ref, 'active', 1, now() + make_interval(days => greatest(1, least(p_days, 90))), now(), o.id, it.id, it.product_id);
      ti := ti + 1;
    end if;

    update public.order_items set status = 'delivered', delivered_at = now() where id = it.id;
  end loop;

  -- état global de la commande
  select count(*) filter (where status = 'waiting_stock'),
         count(*) filter (where status = 'to_process')
    into waiting, manual
    from public.order_items where order_id = o.id;

  update public.orders set
    status = case when waiting > 0 then 'paid' when manual > 0 then 'processing' else 'delivered' end,
    delivered_at = case when waiting = 0 and manual = 0 then now() else null end
  where id = o.id;

  return jsonb_build_object('ok', waiting = 0, 'reason',
    case when waiting > 0 then 'out_of_stock' when manual > 0 then 'to_process' else 'delivered' end);
end;
$$;

revoke all on function public.deliver_order_v3(uuid, text[], int, boolean) from public, anon, authenticated;
grant execute on function public.deliver_order_v3(uuid, text[], int, boolean) to service_role;
