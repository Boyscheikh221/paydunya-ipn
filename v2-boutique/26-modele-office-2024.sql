-- 26 : modèle d'email d'installation de Cheikh pour Office 2024 (étape 1)
insert into public.email_templates (name, subject, body, kind)
select 'Office 2024 — installation (modèle Cheikh)', $q$Votre commande Microsoft Office 2024 - Lien de téléchargement et instructions$q$, $q$Bonjour {prenom},

Suite à votre commande **{commande}**, voici le lien de téléchargement ainsi que la procédure d'installation pour Microsoft Office 2024.

**Important (prérequis) :**
Si une version antérieure d'Office (Office 2010, 2013, 2016, 2019, 2021 ou Microsoft 365) est actuellement installée sur votre ordinateur, vous devez impérativement la désinstaller avant de commencer :

1. Accédez au Panneau de configuration > Programmes > Désinstaller un programme (ou Paramètres > Applications).
2. Sélectionnez l'ancienne version de Microsoft Office et cliquez sur Désinstaller.
3. Redémarrez obligatoirement votre ordinateur une fois la désinstallation terminée.

**Lien de téléchargement :**
Cliquez sur le bouton ci-dessous, puis sur « Télécharger le logiciel ». Le lien ne fonctionne qu'une seule fois : ouvrez-le depuis l'ordinateur où vous installez Office.

{bouton}

**Instructions d'installation :**
1. Téléchargez le fichier d'installation via le bouton ci-dessus.
2. Exécutez le fichier téléchargé et suivez les instructions à l'écran.
3. Une fois l'installation terminée, cliquez sur le bouton vert ci-dessous : votre clé d'activation vous est envoyée aussitôt par email. Ce bouton ne fonctionne qu'une seule fois.

{bouton_installation}

Si vous rencontrez la moindre difficulté lors du téléchargement ou de la configuration, notre assistance reste à votre disposition sur [WhatsApp]({whatsapp}).

Cordialement,
BC Digital Services
+221 77 786 07 77$q$, 'install'
where not exists (select 1 from public.email_templates where name = 'Office 2024 — installation (modèle Cheikh)');
update public.products set install_template_id = (select id from public.email_templates where name = 'Office 2024 — installation (modèle Cheikh)')
 where slug = 'office-2024';
select p.name, p.two_step, p.auto_deliver, t.name tpl, length(t.body) from public.products p left join public.email_templates t on t.id = p.install_template_id where p.slug = 'office-2024';
