-- 32 : le brouillon Windows Server 2022 devient l'édition Datacenter (Cheikh, 23/11/2026). Standard sera ajouté plus tard.
update public.products
   set slug = 'windows-server-2022-datacenter',
       name = 'Microsoft Windows Server 2022 Datacenter — Licence',
       description = replace(replace(description,
         '• Pour un serveur physique ou une machine virtuelle', '• Machines virtuelles Windows Server illimitées sur le serveur licencié (virtualisation, Hyper-V)'),
         'Standard', 'Datacenter'),
       seo_description = replace(seo_description, 'Standard', 'Datacenter')
 where slug = 'windows-server-2022-standard'
   and not exists (select 1 from public.products where slug = 'windows-server-2022-datacenter');

select slug, name, active, position('Datacenter' in description) > 0 as desc_ok, seo_description
  from public.products where slug like 'windows-server-2022%';
