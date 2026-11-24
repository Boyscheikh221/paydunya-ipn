-- 43 : Office 365 livré par COMPTE (adresse + mot de passe), pas par clé.
--      Le compte est rangé dans le stock du produit (type « Identifiants ») : 1 compte = 1 vente.
--      Modèle d'email avec la procédure de connexion / installation (Windows, macOS, mobile).
insert into public.email_templates (name, subject, body, kind)
select 'Microsoft 365 — compte (livraison)', $q$Votre compte Microsoft 365 est prêt — commande {commande}$q$, $q$Bonjour {prenom},

Merci pour votre commande **{commande}** ({total}). Voici votre compte Microsoft 365 : il n'y a aucune clé à saisir, tout se fait en vous connectant avec ce compte.

{cles}

**1. Première connexion**

- Allez sur [microsoft365.com](https://www.microsoft365.com) et cliquez sur « Se connecter ».
- Saisissez l'identifiant puis le mot de passe ci-dessus (le copier-coller évite les erreurs de frappe).
- Si Microsoft vous demande de changer le mot de passe, choisissez un mot de passe solide et notez-le bien : il ne pourra pas être réinitialisé s'il est perdu.

**2. Installation sur Windows**

- Dans votre espace en ligne, cliquez sur « Installer les applications » (ou « Installer Office »), puis lancez le fichier téléchargé.
- Ouvrez Word ou Excel et connectez-vous avec le même compte.
- En cas de conflit avec une ancienne version d'Office : désinstallez-la (Paramètres > Applications > Applications installées), redémarrez, puis recommencez.

**3. Installation sur Mac**

- Vérifiez votre version de macOS (menu Pomme > À propos de ce Mac).
- Connectez-vous sur microsoft365.com, lancez l'installation depuis « Applications et appareils », puis connectez-vous dans l'application.
- Si une ancienne version pose problème : mettez les applications Office à la Corbeille et supprimez les anciens fichiers de licence avec [l'outil officiel Microsoft](https://go.microsoft.com/fwlink/?linkid=849815).

**4. Téléphone et tablette (Android, iPhone, iPad)**

- Installez les applications officielles Microsoft (Microsoft 365, Word, Excel, PowerPoint, OneDrive) depuis le Play Store ou l'App Store.
- Ouvrez-en une et connectez-vous avec votre identifiant.

{bouton}

Un souci pendant l'installation ? [Écrivez-nous sur WhatsApp]({whatsapp}), nous vous aidons jusqu'au bout.$q$, 'key'
where not exists (select 1 from public.email_templates where name = 'Microsoft 365 — compte (livraison)');

update public.products
   set delivery_type = 'stock', two_step = false,
       email_template_id = (select id from public.email_templates where name = 'Microsoft 365 — compte (livraison)')
 where slug = 'microsoft-365-12-mois';

select p.name, p.active, p.delivery_type, p.two_step, t.name modele
  from public.products p left join public.email_templates t on t.id = p.email_template_id
 where p.slug = 'microsoft-365-12-mois';
