-- 48 : nouveau produit « Pack Office 2024 + Windows 11 » (masqué tant que Cheikh n'a pas vérifié)
insert into public.products (name, slug, price_fcfa, delivery_type, active, category_id, description, seo_description)
select 'Pack Microsoft Office 2024 Professionnel Plus + Windows 11 Professionnel — 1 PC',
       'pack-office-2024-windows-11-professionnel',
       8450, 'key', false,
       (select id from public.categories where slug = 'office-2024'),
$d$Le pack complet pour un PC prêt à travailler : Windows 11 Professionnel activé et la suite Office 2024 à vie, à un prix groupé.

Ce qui est inclus :
• 1 clé Windows 11 Professionnel
• 1 clé Microsoft Office 2024 Professionnel Plus : Word, Excel, PowerPoint, Outlook, Access, Publisher, OneNote

Pourquoi ce pack ?
• Un seul achat pour activer Windows et installer Office
• Licences à vie : vous payez une fois, sans abonnement
• Windows Pro : chiffrement BitLocker, Bureau à distance, plus de message « Activer Windows »

Caractéristiques :
• Licences pour 1 PC
• Office 2024 : compatible Windows 10 et Windows 11 (non compatible Mac), 64 bits, en français
• Windows 11 Pro fonctionne aussi pour passer de Windows 11 Famille à Professionnel
• Le PC doit être compatible Windows 11 (processeur récent, TPM 2.0) : en cas de doute, demandez-nous avant d'acheter

Livraison : après le paiement, vous recevez par email vos deux clés et le guide d'installation.

Paiement : Wave, Orange Money ou carte bancaire.
Assistance : besoin d'aide pour installer ou activer ? Écrivez-nous sur WhatsApp ou à contact@licenceoff.com, on vous accompagne.$d$,
'Pack Office 2024 Professionnel Plus + Windows 11 Professionnel pour 1 PC : licences à vie, livraison par email, paiement Wave ou Orange Money.'
where not exists (select 1 from public.products where slug = 'pack-office-2024-windows-11-professionnel');
select concat_ws(' ~ ', name, slug, price_fcfa, delivery_type, active, category_id is not null) from public.products where slug = 'pack-office-2024-windows-11-professionnel';
