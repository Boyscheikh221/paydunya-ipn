-- 47 : demande d'avis par email aux clients livrés (date du dernier envoi, pour ne jamais relancer deux fois en groupé)
alter table public.orders add column if not exists review_asked_at timestamptz;
