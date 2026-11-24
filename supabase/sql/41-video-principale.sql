-- 41 — Vidéo principale d'un article de blog (lien YouTube), à la place ou en plus de l'image principale.
alter table public.posts add column if not exists cover_video text;
select 'posts.cover_video prête' as resultat;
