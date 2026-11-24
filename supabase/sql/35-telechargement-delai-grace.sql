-- 35 : lien de téléchargement « usage unique » avec un délai de grâce de 30 minutes.
--      Si le téléchargement ne démarre pas ou s'interrompt (navigateur, antivirus, connexion),
--      le client peut recliquer pendant 30 minutes après le premier clic. Après, le lien est utilisé.
create or replace function public.consume_download(p_token text) returns text
language plpgsql security definer set search_path = public as $$
declare d public.downloads;
begin
  select * into d from public.downloads where token = p_token for update;
  if not found then return 'not_found'; end if;
  if d.status = 'revoked' then return 'revoked'; end if;
  if d.status = 'pending' then return 'pending'; end if;
  if d.expires_at < now() then return 'expired'; end if;
  if d.download_count >= d.max_downloads then
    if d.last_download_at is not null and d.last_download_at > now() - interval '30 minutes' then return 'ok'; end if;
    return 'limit';
  end if;
  update public.downloads set download_count = download_count + 1, last_download_at = now() where id = d.id;
  return 'ok';
end $$;
revoke all on function public.consume_download(text) from public, anon, authenticated;
grant execute on function public.consume_download(text) to service_role;

select 'ok' as resultat;
