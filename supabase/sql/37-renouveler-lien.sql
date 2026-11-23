-- 37 — « Renouveler le lien » : aussi pour un logiciel en cours d'installation (livraison en 2 temps),
--   pas seulement pour une commande livrée. L'email du client pointe vers sa page de commande,
--   qui affiche toujours le lien actif : le client réutilise le même lien, rien à renvoyer.
create or replace function public.new_item_link(p_item_id uuid, p_token text, p_days int default 7)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare it public.order_items; o public.orders; p public.products;
begin
  select * into it from public.order_items where id = p_item_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if it.status not in ('delivered', 'awaiting_install') then return jsonb_build_object('ok', false, 'reason', 'not_delivered'); end if;
  select * into p from public.products where id = it.product_id;
  if coalesce(p.installer_path, '') = '' then return jsonb_build_object('ok', false, 'reason', 'no_installer'); end if;
  select * into o from public.orders where id = it.order_id;
  if o.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'cancelled'); end if;
  update public.downloads set status = 'revoked'
   where order_item_id = it.id and status <> 'revoked' and download_count < max_downloads;
  insert into public.downloads (token, email, note, status, max_downloads, expires_at, activated_at, order_id, order_item_id, product_id)
  values (p_token, o.email, o.ref, 'active', 1, now() + make_interval(days => greatest(1, least(p_days, 90))), now(), o.id, it.id, it.product_id);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.new_item_link(uuid, text, int) from public, anon, authenticated;
grant execute on function public.new_item_link(uuid, text, int) to service_role;
select 'new_item_link mise à jour' as resultat;
