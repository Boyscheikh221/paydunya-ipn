-- 38 — Frais de transaction (Wave, Orange Money…) payés par le client : ligne à part sur la facture.
--   orders.amount_fcfa = prix des produits + frais ; orders.fees_fcfa = la part des frais.
alter table public.orders add column if not exists fees_fcfa int not null default 0;

-- Correction demandée par Cheikh (23/11/2026) : Office 2024 Pro Plus vendu 5 600 FCFA + 56 FCFA de frais.
update public.order_items set unit_price = 5600
 where order_id = (select id from public.orders where ref = 'LO-2311-ANWKX') and quantity = 1;
update public.orders set amount_fcfa = 5656, fees_fcfa = 56 where ref = 'LO-2311-ANWKX';

select o.ref, o.amount_fcfa, o.fees_fcfa, o.invoice_no, (select string_agg(i.product_name || ' ' || i.unit_price, ', ') from public.order_items i where i.order_id = o.id) as lignes
  from public.orders o where o.ref = 'LO-2311-ANWKX';
