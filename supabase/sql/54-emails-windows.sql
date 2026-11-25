-- =====================================================================
-- 54 — Emails Windows 10 / 11 (25/11/2026)
--   Beaucoup de clients pensent qu'il faut télécharger Windows alors qu'il est déjà sur leur PC.
--   Les emails Windows le disent clairement : le téléchargement sert SEULEMENT si le PC n'a pas
--   de système (PC neuf, disque vide, réinstallation complète). Sinon : clé directement.
--   Modifiables ensuite dans l'admin (Emails).
-- À coller dans Supabase > SQL Editor > Run. Peut être relancé sans risque.
-- =====================================================================
insert into public.email_templates (name, subject, body, is_default, kind)
select 'Windows — installation (modèle Windows)',
       'Commande {commande} : votre licence Windows — licenceoff',
$b$Bonjour {prenom},

Merci pour votre commande **{commande}** ({total}). Votre paiement est bien reçu.

**Windows est déjà installé sur votre ordinateur ? Ne téléchargez rien.**
C'est le cas de la plupart des ordinateurs. Cliquez directement sur le bouton vert ci-dessous, même sans rien installer : vous recevez votre clé d'activation par email, avec les étapes pour activer Windows.

{bouton_installation}

**Téléchargement : seulement si votre ordinateur n'a pas de système d'exploitation**
(ordinateur neuf sans Windows, disque dur vide, ou réinstallation complète). Dans ce cas seulement, téléchargez Windows ici. Le lien ne fonctionne qu'une seule fois :

{bouton}

Une fois Windows installé, revenez sur cet email et cliquez sur le bouton vert plus haut pour recevoir votre clé.

Un doute ? [Écrivez-nous sur WhatsApp]({whatsapp}) avant de télécharger, on vous guide.$b$,
       false, 'install'
where not exists (select 1 from public.email_templates where name = 'Windows — installation (modèle Windows)');

insert into public.email_templates (name, subject, body, is_default, kind)
select 'Windows — clé d''activation (modèle Windows)',
       'Votre clé d''activation Windows — commande {commande}',
$b$Bonjour {prenom},

Voici votre clé d'activation Windows :

{cles}

**Pour activer Windows (pas besoin de réinstaller) :**
1. Cliquez sur Démarrer, puis ouvrez **Paramètres**.
2. Allez dans **Système**, puis **Activation** (sur Windows 10 : **Mise à jour et sécurité**, puis **Activation**).
3. Cliquez sur **Modifier la clé de produit** et saisissez la clé ci-dessus.
4. Validez : Windows s'active en quelques secondes (connexion Internet nécessaire).

Votre PC est en Windows Famille ? La clé Professionnel le fait passer en version Pro, sans perdre vos fichiers.

Gardez cet email précieusement. Un souci pendant l'activation ? [Écrivez-nous sur WhatsApp]({whatsapp}).$b$,
       false, 'key'
where not exists (select 1 from public.email_templates where name = 'Windows — clé d''activation (modèle Windows)');

-- Windows 10 Pro et Windows 11 Pro utilisent ces modèles (seulement s'ils sont encore sur les modèles généraux)
update public.products set
  install_template_id = coalesce(install_template_id, (select id from public.email_templates where name = 'Windows — installation (modèle Windows)')),
  email_template_id   = coalesce(email_template_id,   (select id from public.email_templates where name = 'Windows — clé d''activation (modèle Windows)'))
 where slug in ('microsoft-windows-10-professionnel-licence-1-pc', 'microsoft-windows-11-professionnel-licence-1-pc');

select p.slug, (select name from public.email_templates t where t.id = p.install_template_id) installation, (select name from public.email_templates t where t.id = p.email_template_id) cle
  from public.products p where p.slug in ('microsoft-windows-10-professionnel-licence-1-pc', 'microsoft-windows-11-professionnel-licence-1-pc');
