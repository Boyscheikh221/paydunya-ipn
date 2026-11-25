-- 44 : Microsoft 365 livré par compte — modèle d'email avec liens Microsoft cliquables et bouton vers les boutons « Copier »,
--      et description du produit adaptée (pas de clé : un compte à son nom de connexion).
update public.email_templates set subject = $q$Votre compte Microsoft 365 est prêt — commande {commande}$q$, body = $q$Bonjour {prenom},

Merci pour votre commande **{commande}** ({total}). Voici votre compte Microsoft 365. Il n'y a **aucune clé à saisir** : il suffit de vous connecter avec ce compte.

{cles}

**Pour copier sans erreur :** ouvrez votre page de commande avec le bouton ci-dessous. L'identifiant et le mot de passe y ont chacun leur bouton « Copier ». Sinon, copiez-les depuis les cadres ci-dessus (un double-clic sélectionne le texte).

{bouton}

**Étape 1 : première connexion**

- Ouvrez [www.microsoft365.com](https://www.microsoft365.com) et cliquez sur « Se connecter » (ou allez directement sur [login.microsoftonline.com](https://login.microsoftonline.com)).
- Collez l'identifiant, cliquez sur « Suivant », puis collez le mot de passe.
- Si Microsoft vous demande de changer le mot de passe, choisissez un mot de passe solide et **notez-le bien** : il ne pourra pas être réinitialisé s'il est perdu.

**Étape 2 : installation sur un PC Windows**

- Une fois connecté sur [www.microsoft365.com](https://www.microsoft365.com), cliquez sur « Installer les applications » (ou « Installer Office »), puis lancez le fichier téléchargé.
- Ouvrez Word ou Excel et connectez-vous avec le même compte.
- Une ancienne version d'Office bloque l'installation ? Désinstallez-la (Paramètres > Applications > Applications installées), redémarrez l'ordinateur, puis recommencez.

**Étape 2 bis : installation sur un Mac**

- Vérifiez votre version de macOS (menu Pomme > À propos de ce Mac).
- Connectez-vous sur [www.microsoft365.com](https://www.microsoft365.com), lancez l'installation depuis « Applications et appareils », puis connectez-vous dans Word ou Excel.
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
3. Vous installez les applications sur votre PC Windows ou votre Mac, et sur votre téléphone ou tablette (Android, iPhone, iPad).

Le mode d'emploi pas à pas est dans l'email de livraison. Une question ou un souci ? Notre assistance WhatsApp vous accompagne jusqu'à l'installation complète.$q$,
  seo_description = $q$Microsoft 365 livré par compte (identifiant + mot de passe) : Word, Excel, PowerPoint sur PC, Mac et mobile. Mode d'emploi et assistance WhatsApp.$q$
 where slug = 'microsoft-365-12-mois';

select p.name, p.delivery_type, length(p.description) descr, t.name modele, length(t.body) corps
  from public.products p left join public.email_templates t on t.id = p.email_template_id
 where p.slug = 'microsoft-365-12-mois';
