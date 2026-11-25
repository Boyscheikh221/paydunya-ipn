-- 56 — Galerie : jusqu'à 3 photos en plus de la photo principale (4 photos par produit) (25/11/2026)
--   products.gallery : liens des photos supplémentaires (espace public product-images), dans l'ordre.
--   La photo principale reste products.image_url (catalogue, partage Facebook, flux Google/Meta).
-- À coller dans Supabase > SQL Editor > Run. Peut être relancé sans risque.
alter table public.products add column if not exists gallery text[] not null default '{}';
alter table public.products drop constraint if exists products_gallery_max;
alter table public.products add constraint products_gallery_max check (coalesce(array_length(gallery, 1), 0) <= 3);
select count(*) as produits, count(*) filter (where cardinality(gallery) > 0) as avec_galerie from public.products;

-- Contrôle de ce qui entre dans l'espace photos (côté serveur, en plus des contrôles de l'admin) :
-- seulement des images (JPG, PNG, WebP, GIF, AVIF), 5 Mo maximum par fichier.
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
       file_size_limit = 5242880
 where id = 'product-images';
select id, allowed_mime_types, file_size_limit from storage.buckets where id = 'product-images';
