-- ============================================================
-- 24 : catégorie « Caméras de surveillance » (produits physiques, livraison Dakar)
-- À coller dans Supabase > SQL Editor > Run (une seule fois).
-- Les produits se créent ensuite dans l'admin : Produits > Nouveau, cocher « Produit physique ».
-- ============================================================
insert into public.categories (slug, name, sort, active, description)
values ('cameras-surveillance', 'Caméras de surveillance', 50, true,
  'Caméras de surveillance pour la maison et le commerce : Wi-Fi, intérieur et extérieur, vision de nuit, suivi sur téléphone. Livraison à domicile ou par bus dans Dakar ; hors de Dakar, contactez-nous sur WhatsApp.')
on conflict (slug) do nothing;
select id, slug, name from public.categories where slug = 'cameras-surveillance';
