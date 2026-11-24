-- ============================================================
-- 16 — Sous-catégories (22/11/2026)
-- Windows (10, 11, Server), Microsoft Office (2019, 2021, 2024, 365),
-- Logiciels, Solutions PC. Tout reste modifiable dans l'admin.
-- Relançable sans danger.
-- ============================================================
alter table public.categories add column if not exists parent_id uuid references public.categories(id) on delete set null;
alter table public.categories add column if not exists description text;

-- catégories principales (les anciennes sont renommées, leurs produits suivent)
update public.categories set slug = 'windows', name = 'Windows' where slug = 'licences-windows'
  and not exists (select 1 from public.categories where slug = 'windows');
update public.categories set slug = 'solutions-pc', name = 'Solutions PC' where slug = 'services-informatiques'
  and not exists (select 1 from public.categories where slug = 'solutions-pc');

insert into public.categories (slug, name, sort, description) values
  ('windows', 'Windows', 1, 'Licences Windows 10, Windows 11 et Windows Server authentiques, livrées en quelques minutes.'),
  ('microsoft-office', 'Microsoft Office', 2, 'Microsoft Office 2019, 2021, 2024 et Microsoft 365 : licences authentiques et logiciel à télécharger.'),
  ('logiciels', 'Logiciels', 3, 'Antivirus, utilitaires et logiciels professionnels avec licence officielle.'),
  ('solutions-pc', 'Solutions PC', 4, 'Installation, dépannage et assistance informatique à Dakar et à distance.')
on conflict (slug) do nothing;
update public.categories set sort = 1, parent_id = null, description = coalesce(description, 'Licences Windows 10, Windows 11 et Windows Server authentiques, livrées en quelques minutes.') where slug = 'windows';
update public.categories set sort = 2, parent_id = null, description = coalesce(description, 'Microsoft Office 2019, 2021, 2024 et Microsoft 365 : licences authentiques et logiciel à télécharger.') where slug = 'microsoft-office';
update public.categories set sort = 3, parent_id = null, description = coalesce(description, 'Antivirus, utilitaires et logiciels professionnels avec licence officielle.') where slug = 'logiciels';
update public.categories set sort = 4, parent_id = null, description = coalesce(description, 'Installation, dépannage et assistance informatique à Dakar et à distance.') where slug = 'solutions-pc';

-- sous-catégories
insert into public.categories (slug, name, sort, parent_id, description)
select s.slug, s.name, s.sort, (select id from public.categories where slug = s.parent), s.descr
from (values
  ('windows-10', 'Windows 10', 1, 'windows', 'Licences Windows 10 Professionnel et Famille.'),
  ('windows-11', 'Windows 11', 2, 'windows', 'Licences Windows 11 Professionnel et Famille.'),
  ('windows-server', 'Windows Server', 3, 'windows', 'Licences Windows Server pour entreprises.'),
  ('office-2019', 'Office 2019', 1, 'microsoft-office', 'Licences Microsoft Office 2019.'),
  ('office-2021', 'Office 2021', 2, 'microsoft-office', 'Licences Microsoft Office 2021.'),
  ('office-2024', 'Office 2024', 3, 'microsoft-office', 'Licences Microsoft Office 2024, la dernière version.'),
  ('microsoft-365', 'Microsoft 365', 4, 'microsoft-office', 'Abonnements Microsoft 365.')
) as s(slug, name, sort, parent, descr)
on conflict (slug) do nothing;

-- le produit Office 2024 va dans sa sous-catégorie
update public.products set category_id = (select id from public.categories where slug = 'office-2024')
 where slug = 'office-2024' and category_id = (select id from public.categories where slug = 'microsoft-office');

-- CRM : adresse IP et navigateur au moment de la commande (anti-fraude, parrainage)
alter table public.orders add column if not exists ip text;
alter table public.orders add column if not exists user_agent text;
