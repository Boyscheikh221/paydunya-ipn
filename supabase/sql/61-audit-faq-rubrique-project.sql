-- 61 : suite de l'audit UX (26/11/2026)
-- 1) FAQ : 3 questions fréquentes en plus (aucune promesse de remboursement : à décider par Cheikh)
insert into public.faqs (question, answer, sort)
select q, a, s from (values
  ('Combien de temps pour recevoir une caméra ou un produit physique ?',
   'À Dakar, nous livrons sous 48 h ouvrées après la confirmation du paiement, à domicile ou par bus. Hors de Dakar, écrivez-nous sur WhatsApp : nous organisons l''envoi avec vous.', 10),
  ('Mon PC est-il compatible avec Windows 11 ?',
   'Windows 11 demande un processeur récent et une puce TPM 2.0. En cas de doute, envoyez-nous le modèle de votre PC sur WhatsApp avant d''acheter : nous vérifions pour vous.', 11),
  ('Ma clé ne fonctionne pas, que faire ?',
   'Écrivez-nous sur WhatsApp avec votre numéro de commande et une capture de l''écran d''erreur. Nous vous aidons à activer pas à pas et trouvons une solution avec vous.', 12)
) as v(q, a, s)
where not exists (select 1 from public.faqs f where f.question = v.q);

-- 2) blog : rubrique « Antivirus » masquée tant qu'aucun antivirus n'est vendu (rien n'est supprimé)
update public.rubriques set active = false where slug = 'antivirus';

-- 3) Microsoft Project : rangé dans « Logiciels » au lieu de « Windows »
update public.products set category_id = (select id from public.categories where slug = 'logiciels')
 where slug = 'microsoft-project-2024-professionnel-licence-1-pc'
   and exists (select 1 from public.categories where slug = 'logiciels');

select (select count(*) from public.faqs where active) as faq_actives,
       (select active from public.rubriques where slug = 'antivirus') as antivirus_active,
       (select c.slug from public.products p join public.categories c on c.id = p.category_id where p.slug = 'microsoft-project-2024-professionnel-licence-1-pc') as categorie_project;
