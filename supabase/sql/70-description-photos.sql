-- 70 : description de chaque photo produit (texte alternatif « alt » : lu aux malvoyants, utilisé par Google Images et les IA)
-- Même ordre que [image_url, ...gallery]. Vide = le site utilise le nom du produit.
alter table public.products add column if not exists image_alts jsonb not null default '[]'::jsonb;
