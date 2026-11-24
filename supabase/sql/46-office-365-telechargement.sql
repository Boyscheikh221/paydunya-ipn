-- 46 : Microsoft 365 — cas « pas installé » : boutons de téléchargement direct de l'installateur officiel Microsoft 365
--      (Windows 64 bits, Mac), connexion avec le compte sans clé, et rappel : pas Office 2021/2024.
update public.email_templates set subject = $q$Votre compte Microsoft 365 est prêt — commande {commande}$q$, body = $q$Bonjour {prenom},

Merci pour votre commande **{commande}** ({total}). Voici votre compte Microsoft 365. Il n'y a **aucune clé à saisir** : il suffit de vous connecter avec ce compte.

{cles}

**Pour copier sans erreur :** ouvrez votre page de commande avec le bouton ci-dessous. L'identifiant et le mot de passe y ont chacun leur bouton « Copier ». Sinon, copiez-les depuis les cadres ci-dessus (un double-clic sélectionne le texte).

{bouton}

**Étape 1 : première connexion**

- Ouvrez [www.microsoft365.com](https://www.microsoft365.com) et cliquez sur « Se connecter » (ou allez directement sur [login.microsoftonline.com](https://login.microsoftonline.com)).
- Collez l'identifiant, cliquez sur « Suivant », puis collez le mot de passe.
- Si Microsoft vous demande de changer le mot de passe, choisissez un mot de passe solide et **notez-le bien** : il ne pourra pas être réinitialisé s'il est perdu.

**Étape 2 : sur votre ordinateur — Office est-il déjà installé ?**

**Cas A : Word, Excel ou Microsoft 365 est déjà installé (PC ou Mac).** Inutile de le retélécharger.

- Ouvrez Word ou Excel.
- Allez dans Fichier > Compte (sur Mac : menu Word > Se déconnecter). Si un ancien compte apparaît, cliquez sur « Se déconnecter ».
- Cliquez sur « Se connecter » et entrez votre nouvel identifiant et votre mot de passe. Fermez puis rouvrez Word : c'est activé.

**Cas B : Office n'est pas installé.** Installez Microsoft 365 (et non Office 2021 ou 2024 : votre compte active uniquement les applications Microsoft 365). **Aucune clé à saisir** : la connexion avec votre compte suffit.

Téléchargez directement l'installateur officiel Microsoft :

{bouton_lien:⬇ Microsoft 365 pour Windows|https://c2rsetup.officeapps.live.com/c2r/download.aspx?ProductreleaseID=O365ProPlusRetail&platform=x64&language=fr-fr&version=O16GA}

{bouton_lien:⬇ Microsoft 365 pour Mac|https://go.microsoft.com/fwlink/?linkid=525133}

Vous pouvez aussi l'installer depuis votre espace : une fois connecté sur [www.microsoft365.com](https://www.microsoft365.com), cliquez sur « Installer les applications ».

**Sur PC Windows :**

- Lancez le fichier téléchargé et laissez l'installation se terminer (connexion internet nécessaire).
- Ouvrez Word ou Excel et connectez-vous avec votre identifiant et votre mot de passe.
- Une ancienne version d'Office (2016, 2019…) bloque l'installation ? Désinstallez-la (Paramètres > Applications > Applications installées), redémarrez l'ordinateur, puis recommencez.

**Sur Mac :**

- Vérifiez votre version de macOS (menu Pomme > À propos de ce Mac) : il faut une version récente de macOS.
- Ouvrez le fichier téléchargé (.pkg) et suivez l'installation, puis ouvrez Word ou Excel et connectez-vous avec votre compte.
- Une ancienne version pose problème ? Mettez les applications Office à la Corbeille, puis supprimez les anciens fichiers de licence avec [l'outil officiel Microsoft](https://go.microsoft.com/fwlink/?linkid=849815).

**Sur téléphone ou tablette**

- Installez l'application Microsoft 365 (ou Word, Excel, PowerPoint, OneDrive) depuis le [Google Play Store](https://play.google.com/store/apps/details?id=com.microsoft.office.officehubrow) ou l'[App Store](https://apps.apple.com/app/id541164041).
- Ouvrez-la et connectez-vous avec votre identifiant.

Un souci à n'importe quelle étape ? [Écrivez-nous sur WhatsApp]({whatsapp}), nous vous aidons jusqu'au bout.$q$,
       updated_at = now()
 where name = 'Microsoft 365 — compte (livraison)';

update public.products set
  description = $q$Microsoft 365 (Word, Excel, PowerPoint, Outlook, OneDrive…) livré sous forme de compte : vous recevez par email un identifiant et un mot de passe. Aucune clé à saisir.

Comment ça marche :
1. Après votre paiement, vous recevez votre identifiant et votre mot de passe par email et sur votre page de commande, avec un bouton « Copier » pour chacun.
2. Vous vous connectez sur microsoft365.com avec ce compte.
3. Office est déjà installé sur votre ordinateur ? Pas besoin de le retélécharger : connectez-vous simplement avec ce compte dans Word ou Excel. Sinon, téléchargez Microsoft 365 avec les liens officiels fournis (Windows ou Mac) et connectez-vous, sans clé. Vous pouvez aussi l'utiliser sur téléphone et tablette (Android, iPhone, iPad).

À noter : ce compte active les applications Microsoft 365, pas Office 2021 ni Office 2024.

Le mode d'emploi pas à pas est dans l'email de livraison. Une question ou un souci ? Notre assistance WhatsApp vous accompagne jusqu'à l'installation complète.$q$,
  seo_description = $q$Microsoft 365 livré par compte (identifiant + mot de passe) : Word, Excel, PowerPoint sur PC, Mac et mobile. Mode d'emploi et assistance WhatsApp.$q$
 where slug in ('microsoft-365-12-mois', 'microsoft-365-abonnement-1-an-5-appareils-pc-et-mac');

select p.name, p.delivery_type, length(p.description) descr, t.name modele, length(t.body) corps
  from public.products p left join public.email_templates t on t.id = p.email_template_id
 where p.slug in ('microsoft-365-12-mois', 'microsoft-365-abonnement-1-an-5-appareils-pc-et-mac');
