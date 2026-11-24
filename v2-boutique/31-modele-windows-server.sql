-- 31 : modèle d'email d'installation de Cheikh pour Windows Server 2022 (étape 1 : lien de téléchargement)
--      Le lien est l'ISO officiel Microsoft (installer_path = lien https) ; la clé part avec le bouton « installation terminée ».
insert into public.email_templates (name, subject, body, kind)
select 'Windows Server 2022 — installation (modèle Cheikh)', $q$Votre commande Microsoft Windows Server 2022 Datacenter - Lien de téléchargement et instructions$q$, $q$Bonjour {prenom},

Suite à votre commande **{commande}**, voici votre lien de téléchargement pour Microsoft Windows Server 2022 Datacenter.

**Lien de téléchargement :**
Cliquez sur le bouton ci-dessous, puis sur « Télécharger le logiciel » : vous arrivez sur le fichier ISO officiel de Microsoft. Le lien ne fonctionne qu'une seule fois.

{bouton}

**Instructions d'installation :**
1. Téléchargez le fichier ISO à partir du lien ci-dessus.
2. Préparez votre support d'installation (clé USB bootable ou montage ISO sur votre serveur/hyperviseur).
3. Lors du processus d'installation, veillez à bien sélectionner la version Windows Server 2022 Datacenter (Expérience utilisateur) pour bénéficier de l'interface graphique.
4. Une fois l'installation terminée, cliquez sur le bouton vert ci-dessous : votre clé de licence vous est envoyée aussitôt par email pour procéder à l'activation. Ce bouton ne fonctionne qu'une seule fois.

{bouton_installation}

Après l'installation, nous vous accompagnons pour finaliser l'activation de votre licence.
Si vous rencontrez une difficulté lors du téléchargement ou de l'installation, n'hésitez pas à nous contacter sur [WhatsApp]({whatsapp}). Une assistance est disponible jusqu'à l'activation complète.

Cordialement,
BC Digital Services
+221 77 786 07 77$q$, 'install'
where not exists (select 1 from public.email_templates where name = 'Windows Server 2022 — installation (modèle Cheikh)');

update public.products
   set install_template_id = (select id from public.email_templates where name = 'Windows Server 2022 — installation (modèle Cheikh)'),
       installer_path = 'https://go.microsoft.com/fwlink/p/?LinkID=2195280&clcid=0x40c&culture=fr-fr&country=FR',
       two_step = true
 where slug = 'windows-server-2022-standard';

select p.name, p.active, p.delivery_type, p.two_step, p.installer_path, t.name tpl
  from public.products p left join public.email_templates t on t.id = p.install_template_id
 where p.slug = 'windows-server-2022-standard';
