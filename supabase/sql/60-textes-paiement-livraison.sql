-- 60 : textes honnêtes (paiement en ligne en pause) + article de test dépublié
-- 1) descriptions produits : plus de « carte bancaire » tant que le paiement par carte n'existe pas
update public.products
   set description = replace(description, 'Paiement : Wave, Orange Money ou carte bancaire.', 'Paiement : Wave ou Orange Money.')
 where description like '%Paiement : Wave, Orange Money ou carte bancaire.%';

-- 2) FAQ : même explication de la livraison et du paiement que sur les fiches produits
update public.faqs
   set answer = 'Dès que votre paiement est confirmé, vous recevez un email. Pour un logiciel à installer, vous recevez d''abord le lien de téléchargement et le guide ; quand l''installation est terminée, cliquez sur « J''ai fini l''installation » et votre clé d''activation s''affiche. Tout reste disponible sur votre page de commande : gardez bien ce lien.'
 where question = 'Comment vais-je recevoir ma licence ?';
update public.faqs
   set answer = 'Wave et Orange Money. Après votre commande, WhatsApp s''ouvre avec un message déjà prêt : nous confirmons le paiement avec vous, puis votre commande vous est envoyée par email.'
 where question = 'Quels moyens de paiement acceptez-vous ?';

-- 3) article « test » : repassé en brouillon (il reste dans l'admin, rien n'est supprimé)
update public.posts set published = false where slug = 'test';

select (select count(*) from public.products where description like '%carte bancaire%') as produits_avec_carte,
       (select count(*) from public.posts where slug = 'test' and published) as test_publie;
