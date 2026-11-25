-- =====================================================================
-- 51 — Gestionnaire de pages et blog (25/11/2026)
--   • Rubriques (thèmes) pour classer les articles du blog et les pages libres :
--       Caméras de surveillance · Licences › Licences Windows et Office · Licences › Antivirus
--     (modifiables, et on peut en créer d'autres dans l'admin : 📄 Pages & blog › Rubriques)
--   • Compteur de vues par article (pour trier le blog par « les plus lus »)
--   • Lectures d'articles : temps passé, lu jusqu'au bout, clic vers la boutique (sans nom, sans IP)
--   • content_stats(jours) : chiffres du tableau de bord « Pages & blog »
--   • blog_list() : liste publique des articles avec vues totales et vues des 7 derniers jours
-- À coller dans Supabase > SQL Editor > Run. Peut être relancé sans risque.
-- =====================================================================

-- ---------- Rubriques ----------
create table if not exists public.rubriques (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  description   text,
  parent_id     uuid references public.rubriques(id) on delete set null,
  category_slug text,                 -- catégorie de produits liée (bouton « Voir les produits » sous l'article)
  sort          int  not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table public.rubriques enable row level security;
revoke all on table public.rubriques from anon, authenticated;
grant all on table public.rubriques to service_role;

insert into public.rubriques (slug, name, sort, category_slug, description) values
  ('cameras-surveillance', 'Caméras de surveillance', 1, 'cameras-surveillance', 'Conseils pour choisir, installer et utiliser vos caméras de surveillance.'),
  ('licences', 'Licences', 2, null, 'Tout sur les licences logicielles : bureautique, Windows, antivirus.')
on conflict (slug) do nothing;
insert into public.rubriques (slug, name, sort, parent_id, category_slug, description)
select s.slug, s.name, s.sort, (select id from public.rubriques where slug = 'licences'), s.cat, s.descr
from (values
  ('licences-windows', 'Licences Windows et Office', 1, 'windows', 'Activer Windows et Office, choisir la bonne version, résoudre les erreurs.'),
  ('antivirus', 'Antivirus', 2, 'logiciels', 'Protéger son ordinateur : choisir et installer un antivirus.')
) as s(slug, name, sort, cat, descr)
on conflict (slug) do nothing;

-- ---------- Articles et pages : rubrique + vues ----------
alter table public.posts add column if not exists rubrique_id uuid references public.rubriques(id) on delete set null;
alter table public.posts add column if not exists views int not null default 0;
alter table public.pages add column if not exists rubrique_id uuid references public.rubriques(id) on delete set null;
create index if not exists posts_rubrique_idx on public.posts (rubrique_id);

-- articles déjà écrits : rubrique devinée d'après le titre (modifiable ensuite dans l'admin)
update public.posts set rubrique_id = (select id from public.rubriques where slug = 'cameras-surveillance')
 where rubrique_id is null and (title ilike '%caméra%' or title ilike '%camera%' or title ilike '%surveillance%');
update public.posts set rubrique_id = (select id from public.rubriques where slug = 'antivirus')
 where rubrique_id is null and title ilike '%antivirus%';
update public.posts set rubrique_id = (select id from public.rubriques where slug = 'licences-windows')
 where rubrique_id is null and (title ilike '%windows%' or title ilike '%office%' or title ilike '%microsoft%' or title ilike '%licence%');

-- vues déjà enregistrées par les statistiques du site (une seule fois : seulement si le compteur est encore à 0)
update public.posts p set views = x.n
  from (select page, count(*) n from public.page_views where page like '/blog/%' group by page) x
 where x.page = '/blog/' || p.slug and p.views = 0;

-- +1 vue (appelé à chaque visite d'un article)
create or replace function public.post_view(p_slug text)
returns void language sql security definer set search_path = public as $$
  update public.posts set views = views + 1 where slug = p_slug and published;
$$;
revoke all on function public.post_view(text) from public, anon, authenticated;
grant execute on function public.post_view(text) to service_role;

-- ---------- Lectures d'articles ----------
create table if not exists public.post_reads (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  post_slug  text not null,
  seconds    int  not null default 0,      -- temps passé sur l'article (onglet visible)
  scroll     int  not null default 0,      -- jusqu'où il a lu (0 à 100 %)
  clicked    boolean not null default false, -- a cliqué vers la boutique / un produit
  visitor    text,                          -- identifiant anonyme (seulement si cookies acceptés)
  referrer   text
);
create index if not exists post_reads_time_idx on public.post_reads (created_at desc);
create index if not exists post_reads_slug_idx on public.post_reads (post_slug);
alter table public.post_reads enable row level security;
revoke all on table public.post_reads from anon, authenticated;
grant all on table public.post_reads to service_role;
grant usage, select on sequence public.post_reads_id_seq to service_role;

-- ---------- Liste publique du blog ----------
create or replace function public.blog_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', p.slug, 'title', p.title, 'excerpt', p.excerpt, 'cover_url', p.cover_url, 'cover_video', p.cover_video,
    'published_at', p.published_at, 'views', p.views,
    'views_7d', (select count(*) from public.page_views v where v.page = '/blog/' || p.slug and v.created_at >= now() - interval '7 days'),
    'words', coalesce(array_length(regexp_split_to_array(trim(p.content), '\s+'), 1), 0),
    'rubrique', r.slug, 'rubrique_name', r.name) order by p.published_at desc), '[]'::jsonb)
  from public.posts p left join public.rubriques r on r.id = p.rubrique_id
  where p.published;
$$;
revoke all on function public.blog_list() from public, anon, authenticated;
grant execute on function public.blog_list() to service_role;

-- ---------- Tableau de bord « Pages & blog » ----------
create or replace function public.content_stats(p_days int default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  with
  since as (select now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 3650))) t),
  pv as (select * from public.page_views where created_at >= (select t from since)),
  bv as (select substr(page, 7) slug, visitor, referrer, device, created_at from pv where page like '/blog/_%' and page not like '/blog/rubrique/%'),
  rd as (select * from public.post_reads where created_at >= (select t from since)),
  per_post as (
    select p.id, p.slug, p.title, p.published, p.published_at, p.views total_views, p.rubrique_id,
      (p.excerpt is null or p.excerpt = '') no_excerpt, (p.cover_url is null and p.cover_video is null) no_cover,
      coalesce(array_length(regexp_split_to_array(trim(p.content), '\s+'), 1), 0) words,
      (select count(*) from bv where bv.slug = p.slug) views,
      (select count(distinct visitor) from bv where bv.slug = p.slug and visitor is not null) visitors,
      (select count(*) from rd where rd.post_slug = p.slug) reads,
      (select round(avg(least(seconds, 1800))) from rd where rd.post_slug = p.slug and seconds > 0) avg_sec,
      (select round(100.0 * count(*) filter (where scroll >= 90) / nullif(count(*), 0)) from rd where rd.post_slug = p.slug) finish_pct,
      (select count(*) filter (where clicked) from rd where rd.post_slug = p.slug) clicks
    from public.posts p
  )
  select jsonb_build_object(
    'days', p_days,
    'counts', jsonb_build_object(
      'posts_pub',    (select count(*) from public.posts where published),
      'posts_draft',  (select count(*) from public.posts where not published),
      'pages_pub',    (select count(*) from public.pages where published),
      'pages_draft',  (select count(*) from public.pages where not published),
      'products',     (select count(*) from public.products where active),
      'categories',   (select count(*) from public.categories where active),
      'rubriques',    (select count(*) from public.rubriques where active)),
    'blog', jsonb_build_object(
      'views',     (select count(*) from bv),
      'visitors',  (select count(distinct visitor) from bv where visitor is not null),
      'mobile_pct',(select round(100.0 * count(*) filter (where device = 'mobile') / nullif(count(*), 0)) from bv),
      'avg_sec',   (select round(avg(least(seconds, 1800))) from rd where seconds > 0),
      'finish_pct',(select round(100.0 * count(*) filter (where scroll >= 90) / nullif(count(*), 0)) from rd),
      'click_pct', (select round(100.0 * count(*) filter (where clicked) / nullif(count(*), 0)) from rd),
      'clicks',    (select count(*) filter (where clicked) from rd),
      'site_views',(select count(*) from pv),
      'per_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'views', n) order by d)
                   from (select date_trunc('day', created_at)::date d, count(*) n from bv group by 1) x), '[]'::jsonb),
      'sources', coalesce((select jsonb_agg(jsonb_build_object('ref', ref, 'views', n) order by n desc)
                   from (select coalesce(referrer, 'direct') ref, count(*) n from bv group by 1 order by 2 desc limit 8) x), '[]'::jsonb)),
    'posts', coalesce((select jsonb_agg(to_jsonb(x) order by x.views desc, x.total_views desc) from per_post x), '[]'::jsonb),
    'rubriques', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name, 'parent_id', r.parent_id,
                   'posts', (select count(*) from public.posts p where p.rubrique_id = r.id and p.published),
                   'pages', (select count(*) from public.pages g where g.rubrique_id = r.id and g.published),
                   'views', (select coalesce(sum(views), 0) from per_post p where p.rubrique_id = r.id)) order by r.sort, r.name)
                 from public.rubriques r), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'slug', g.slug, 'title', g.title, 'published', g.published,
                   'no_seo', (g.seo_description is null or g.seo_description = ''),
                   'views', (select count(*) from pv where pv.page = '/page/' || g.slug)) order by g.title)
                 from public.pages g), '[]'::jsonb),
    'top_pages', coalesce((select jsonb_agg(jsonb_build_object('page', page, 'views', n) order by n desc)
                 from (select page, count(*) n from pv group by 1 order by 2 desc limit 10) x), '[]'::jsonb)
  );
$$;
revoke all on function public.content_stats(int) from public, anon, authenticated;
grant execute on function public.content_stats(int) to service_role;
