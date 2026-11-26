-- 62 : droits manquants pour les fonctions du serveur (service_role)
-- Audit admin du 26/11/2026 : l'onglet Avis affichait « permission denied for table product_reviews ».
-- Ces deux tables avaient été créées sans « grant ... to service_role ». Aucune donnée n'est modifiée.

grant all on table public.product_reviews   to service_role;
grant all on table public.payment_providers to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Vérification : les deux lignes doivent afficher true / true
select c.relname,
       has_table_privilege('service_role', c.oid, 'SELECT') as lecture,
       has_table_privilege('service_role', c.oid, 'UPDATE') as ecriture
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('product_reviews', 'payment_providers');
