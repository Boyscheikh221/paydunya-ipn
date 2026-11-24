-- 28 : modèle « clé d'activation Office » de Cheikh, commun à tous les Office (version automatique)
insert into public.email_templates (name, subject, body, kind)
select 'Office — clé d''activation (modèle Cheikh)', $q$Votre clé d'activation Microsoft Office {version}$q$, $q$Bonjour {prenom},

Suite à votre demande, veuillez trouver ci-dessous votre clé d'activation Microsoft Office {version} ainsi que les instructions pour l'utiliser.

**Clé d'activation :**

{cles}

**Instructions d'activation standard :**
1. Ouvrez une application Microsoft Office (Word, Excel, PowerPoint, etc.).
2. Lorsque l'assistant d'activation s'affiche, cliquez sur « Activer ».
3. Saisissez la clé d'activation fournie ci-dessus.
4. Suivez les instructions à l'écran pour finaliser l'activation.

**Note :** si la fenêtre d'activation ne s'affiche pas automatiquement, allez dans « Fichier » > « Compte » > « Modifier la clé de produit ».

**En cas de limite d'activation atteinte (procédure d'activation autonome en ligne)**
Si une fenêtre indique que le nombre d'activations de la clé de produit a atteint la limite, suivez ces étapes simples pour valider l'activation via le portail officiel de Microsoft :
1. Dans la fenêtre d'activation d'Office, cliquez sur Précédent et choisissez « L'activation par téléphone ».
2. Ne passez pas d'appel. Un ID d'installation (une longue série de chiffres répartie en plusieurs blocs) va s'afficher sur votre écran d'ordinateur.
3. Rendez-vous sur le portail d'activation Microsoft : [https://visualsupport.microsoft.com/](https://visualsupport.microsoft.com/)
4. Répondez aux étapes sur le site et saisissez l'ID d'installation affiché sur votre écran.
5. Lorsque le système vous demande sur combien de postes la clé est installée, indiquez 1 (ou sélectionnez l'option confirmant qu'elle n'est utilisée que sur ce poste).
6. Le site générera un ID de confirmation (blocs A à H). Saisissez ces blocs dans la fenêtre d'activation d'Office sur votre ordinateur.
7. Cliquez sur Suivant pour valider définitivement l'activation.

Besoin d'aide ? Notre assistance reste à votre disposition sur [WhatsApp]({whatsapp}). Votre commande : [{commande}]({lien_commande})

Cordialement,
BC Digital Services
+221 77 786 07 77$q$, 'key'
where not exists (select 1 from public.email_templates where name = 'Office — clé d''activation (modèle Cheikh)');
-- tous les produits Office (2016, 2019, 2021, 2024), sauf Microsoft 365 (abonnement, activation différente)
update public.products set email_template_id = (select id from public.email_templates where name = 'Office — clé d''activation (modèle Cheikh)')
 where name ilike '%office%' and name !~* '365';
-- le modèle d'installation (lien de téléchargement) devient lui aussi commun : version automatique
update public.email_templates set name = 'Office — installation (modèle Cheikh)',
  subject = replace(subject, 'Office 2024', 'Office {version}'), body = replace(body, 'Office 2024', 'Office {version}'), updated_at = now()
 where name = 'Office 2024 — installation (modèle Cheikh)';
update public.products set install_template_id = (select id from public.email_templates where name = 'Office — installation (modèle Cheikh)')
 where name ilike '%office%' and name !~* '365';
select name, (select name from public.email_templates t where t.id = email_template_id) cle, (select name from public.email_templates t where t.id = install_template_id) install, two_step from public.products where name ilike '%office%' order by name;
