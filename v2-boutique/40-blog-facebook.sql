-- 40 — Blog : publication sur la page Facebook (comme WordPress).
--   Secrets Supabase à ajouter par Cheikh (jamais dans le chat) : FB_PAGE_ID et FB_PAGE_TOKEN (jeton de page longue durée).
alter table public.posts add column if not exists fb_post_id text;
alter table public.posts add column if not exists fb_posted_at timestamptz;
select 'colonnes facebook ajoutées' as resultat;
