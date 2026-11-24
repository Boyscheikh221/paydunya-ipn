-- 36 — Annuler une commande depuis l'admin, quel que soit son état (pas seulement « en attente »).
--   * La commande et ses articles passent à « annulée » : elle ne compte plus dans les ventes, les stats,
--     le solde des parrains ni la fiche client. Son numéro de facture reste (la facture affiche « ANNULÉE »).
--   * Les liens de téléchargement encore valables sont désactivés.
--   * p_restock = true : les clés envoyées reviennent dans le stock
--       - clé à usage unique → de nouveau « disponible » ;
--       - copie d'une clé multi-postes / réutilisable → supprimée, l'activation est rendue à la clé d'origine.
--     Les produits physiques retrouvent leur quantité en stock.
create or replace function public.cancel_order(p_order_id uuid, p_restock boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders;
  restocked int := 0;
  k record;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if o.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'deja_annulee'); end if;

  update public.downloads set status = 'revoked'
   where order_id = o.id and status <> 'revoked';

  if p_restock then
    for k in select lk.* from public.license_keys lk
              join public.order_items i on i.id = lk.order_item_id
             where i.order_id = o.id for update of lk loop
      if k.source_key_id is null then
        update public.license_keys set status = 'available', order_item_id = null, order_id = null, sent_at = null where id = k.id;
      else
        delete from public.license_keys where id = k.id;
        update public.license_keys set status = 'available' where id = k.source_key_id and status = 'sent';
      end if;
      restocked := restocked + 1;
    end loop;
    update public.products p set stock_qty = p.stock_qty + i.quantity
      from public.order_items i
     where i.order_id = o.id and i.product_id = p.id and i.delivery_type = 'physical'
       and i.status not in ('pending','cancelled') and p.stock_qty is not null;
  end if;

  update public.order_items set status = 'cancelled' where order_id = o.id;
  update public.orders set status = 'cancelled',
         note = trim(both ' ' from coalesce(note, '') || ' Annulée le ' || to_char(now() at time zone 'Africa/Dakar', 'DD/MM/YYYY HH24:MI')
                || case when restocked > 0 then ' (' || restocked || ' clé(s) remise(s) en stock)' else '' end || '.')
   where id = o.id;
  return jsonb_build_object('ok', true, 'restocked', restocked, 'was', o.status);
end $$;
revoke all on function public.cancel_order(uuid, boolean) from public, anon, authenticated;
grant execute on function public.cancel_order(uuid, boolean) to service_role;

select 'cancel_order prête' as resultat;
