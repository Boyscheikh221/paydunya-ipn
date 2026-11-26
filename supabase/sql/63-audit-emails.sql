-- =====================================================================
-- 63 — Audit des emails (26/11/2026)
--   • signature « BC Digital Services » → « L'équipe licenceoff.com »
--   • « Le lien ne fonctionne qu'une seule fois » → durée réelle (7 jours, nouvel essai 30 min)
--   • objets courts et pareils : « … — commande {commande} », sans « — licenceoff »
--   • nouveau modèle « Windows Server — clé d'activation » (étape 2 de Windows Server)
--   • suppression des anciens modèles Office qui ne servent plus (seulement s'ils ne sont liés à aucun produit)
-- À coller dans Supabase > SQL Editor > Run. Peut être relancé sans risque.
-- =====================================================================

-- 1. Signature
update public.email_templates
   set body = replace(body, 'BC Digital Services', 'L''équipe licenceoff.com'), updated_at = now()
 where body like '%BC Digital Services%';

-- 2. Durée réelle du lien de téléchargement
update public.email_templates
   set body = replace(replace(replace(replace(body,
         'Le lien ne fonctionne qu''une seule fois : ouvrez-le', 'Le lien est valable 7 jours, pour un seul téléchargement (s''il coupe, recliquez dans les 30 minutes). Ouvrez-le'),
         'Le lien ne fonctionne qu''une seule fois : lancez-le', 'Le lien est valable 7 jours, pour un seul téléchargement (s''il coupe, recliquez dans les 30 minutes). Lancez-le'),
         'Le lien ne fonctionne qu''une seule fois :', 'Le lien est valable 7 jours, pour un seul téléchargement (s''il coupe, recliquez dans les 30 minutes).'),
         'Le lien ne fonctionne qu''une seule fois.', 'Le lien est valable 7 jours, pour un seul téléchargement (s''il coupe, recliquez dans les 30 minutes).'),
       updated_at = now()
 where body like '%Le lien ne fonctionne qu''une seule fois%';

-- 3. Objets
update public.email_templates set subject = regexp_replace(subject, '\s*[—–-]\s*licenceoff(\.com)?\s*$', ''), updated_at = now()
 where subject ~ '[—–-]\s*licenceoff(\.com)?\s*$';
update public.email_templates set subject = 'Office {version} : téléchargement et installation — commande {commande}', updated_at = now()
 where name = 'Office — installation (modèle Cheikh)' and subject like 'Votre commande Microsoft Office%Lien de téléchargement%';
update public.email_templates set subject = 'Windows Server 2022 Datacenter : téléchargement et installation — commande {commande}', updated_at = now()
 where name = 'Windows Server 2022 — installation (modèle Cheikh)' and subject like 'Votre commande Microsoft Windows Server%';
update public.email_templates set subject = 'Votre licence Windows — commande {commande}', updated_at = now()
 where subject = 'Commande {commande} : votre licence Windows';
update public.email_templates set subject = 'Installez votre logiciel — commande {commande}', updated_at = now()
 where subject = 'Commande {commande} : installez votre logiciel';

-- 4. Windows Server : email de la clé avec les étapes d'activation
insert into public.email_templates (name, subject, body, is_default, kind)
select 'Windows Server — clé d''activation (modèle Windows Server)',
       'Votre clé Windows Server — commande {commande}',
$b$Bonjour {prenom},

Merci d'avoir installé Windows Server. Voici votre clé de licence :

{cles}

**Pour activer Windows Server :**
1. Ouvrez **Paramètres**, puis **Système** > **Activation** (ou Panneau de configuration > Système).
2. Cliquez sur **Modifier la clé de produit** et saisissez la clé ci-dessus.
3. Validez : Windows Server s'active en quelques secondes (connexion Internet nécessaire).

**Votre serveur affiche « Évaluation » (installé depuis le fichier ISO d'essai Microsoft) ?**
La clé ne peut pas être saisie directement. Ouvrez l'**Invite de commandes en administrateur** et tapez :

DISM /online /Set-Edition:ServerDatacenter /ProductKey:VOTRE-CLÉ /AcceptEula

(remplacez VOTRE-CLÉ par la clé ci-dessus), puis redémarrez le serveur quand il le demande. L'édition passe en Datacenter et s'active.

Gardez cet email précieusement. Nous vous accompagnons jusqu'à l'activation complète : écrivez-nous sur WhatsApp au moindre souci.$b$,
       false, 'key'
where not exists (select 1 from public.email_templates where name = 'Windows Server — clé d''activation (modèle Windows Server)');

update public.products
   set email_template_id = (select id from public.email_templates where name = 'Windows Server — clé d''activation (modèle Windows Server)')
 where slug like 'windows-server%' and email_template_id is null;

-- 5. Anciens modèles Office (remplacés par les modèles « (modèle Cheikh) ») : supprimés seulement s'ils ne servent à aucun produit
delete from public.email_templates t
 where t.name in ('Microsoft Office', 'Microsoft Office — clé', 'Microsoft Office — installation')
   and not t.is_default
   and not exists (select 1 from public.products p where p.email_template_id = t.id or p.install_template_id = t.id);

-- Contrôle
select name, kind, subject, position('BC Digital' in body) > 0 as ancienne_signature,
       position('une seule fois :' in body) > 0 as ancien_texte_lien
  from public.email_templates order by kind, name;
