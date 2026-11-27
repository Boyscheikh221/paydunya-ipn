-- ============================================================
-- 68 : « Antivirus » devient une catégorie principale (27/11/2026, demande de Cheikh)
-- La sous-catégorie « Antivirus et sécurité » (créée par le SQL 66 dans Logiciels)
-- est sortie de Logiciels et renommée « Antivirus ». AVG Ultimate y reste rangé.
-- À coller dans Supabase > SQL Editor > Run. Peut être relancé sans risque.
-- ============================================================
update public.categories set slug = 'antivirus', name = 'Antivirus', parent_id = null, sort = 5,
  description = 'Antivirus avec licence officielle : protection contre les virus, les ransomwares et le piratage, code livré par email.'
 where slug = 'antivirus-securite' and not exists (select 1 from public.categories where slug = 'antivirus');

insert into public.categories (slug, name, sort, parent_id, description)
values ('antivirus', 'Antivirus', 5, null, 'Antivirus avec licence officielle : protection contre les virus, les ransomwares et le piratage, code livré par email.')
on conflict (slug) do nothing;

update public.products set category_id = (select id from public.categories where slug = 'antivirus')
 where slug = 'avg-ultimate-2025-1-appareil-1-an';

select p.slug, p.active, c.slug as cat_slug, c.name as categorie, c.parent_id
  from public.products p join public.categories c on c.id = p.category_id where p.slug = 'avg-ultimate-2025-1-appareil-1-an';
