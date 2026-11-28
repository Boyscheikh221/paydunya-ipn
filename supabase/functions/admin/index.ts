// ============================================================
// Fonction "admin" : back-office de la boutique licenceoff.
// Tableau de bord, commandes, stock, catégories, produits,
// blog, fichiers, liens de téléchargement, visites.
// Protégée par mot de passe (secret ADMIN_PASSWORD).
// Remplace le code de la fonction "admin" existante.
// IMPORTANT : "Verify JWT" reste désactivé pour cette fonction.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-password, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// ================= Journal (table app_logs, onglet « Journal » de l'admin) =================
// Jamais de clé ni de secret : les champs sensibles sont masqués avant l'écriture.
const SECRET_RE = /key|token|secret|password|passwd|authorization|cle|serial|apikey/i;
function cleanDetail(v: unknown, depth = 0): unknown {
  if (v == null) return v;
  if (typeof v === "string") return v.replace(/Bearer\s+\S+/gi, "Bearer ***").replace(/\b(re|sk|pk|live|test)_[A-Za-z0-9_-]{8,}/g, "***").slice(0, 800);
  if (typeof v !== "object") return v;
  if (depth > 3) return "…";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => cleanDetail(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 30)) out[k] = SECRET_RE.test(k) ? "***" : cleanDetail(x, depth + 1);
  return out;
}
// ---------- Paiements : intégrateurs et clés API chiffrées ----------
// Les clés saisies dans la page « Paiements » sont chiffrées ici (AES-GCM 256) avant d'aller en base, et ne repartent
// jamais vers le navigateur. La clé de chiffrement est dérivée d'un secret du serveur (PAYMENT_KEYS_SECRET s'il existe,
// sinon la clé de service Supabase). Si ce secret change, il suffit de ressaisir les clés des intégrateurs.
const PAY_PROVIDERS: Record<string, { name: string; ready: boolean; doc: string; fields: [string, string][] }> = {
  wave: { name: "Wave", ready: false, doc: "https://docs.wave.com/checkout",
    fields: [["api_key", "Clé API Wave Checkout (commence par wave_sn_)"], ["webhook_secret", "Secret du webhook Wave"]] },
  paytech: { name: "PayTech", ready: false, doc: "https://docs.intech.sn/doc_paytech.php",
    fields: [["api_key", "API_KEY PayTech"], ["api_secret", "API_SECRET PayTech"]] },
  orange_money: { name: "Orange Money", ready: false, doc: "https://developer.orange-sonatel.com",
    fields: [["client_id", "Client ID"], ["client_secret", "Client secret"], ["merchant_code", "Code marchand"]] },
  paydunya: { name: "PayDunya", ready: false, doc: "https://developers.paydunya.com",
    fields: [["master_key", "Master key"], ["private_key", "Private key"], ["token", "Token"]] },
};
let _payKey: CryptoKey | null = null;
async function payCryptoKey() {
  if (_payKey) return _payKey;
  const base = (Deno.env.get("PAYMENT_KEYS_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (base.length < 20) throw new Error("secret_serveur_absent");
  const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(base), "HKDF", false, ["deriveKey"]);
  _payKey = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("licenceoff-paiements-v1"), info: new TextEncoder().encode("cles-integrateurs") },
    raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return _payKey;
}
const b64e = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function sealSecret(plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await payCryptoKey(), new TextEncoder().encode(plain)));
  return "v1:" + b64e(iv) + ":" + b64e(ct);
}
// pour les futurs branchements (Wave, PayTech…) : relit une clé en clair, côté serveur uniquement
async function openSecret(sealed: string): Promise<string | null> {
  try {
    const [v, iv, ct] = String(sealed).split(":");
    if (v !== "v1") return null;
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(iv) }, await payCryptoKey(), b64d(ct)));
  } catch { return null; }
}
async function payPublicState() {
  const [{ data: rows }, { data: m }] = await Promise.all([
    db.from("payment_providers").select("provider, live, secrets, updated_at"),
    db.from("settings").select("value").eq("key", "payment_mode").maybeSingle(),
  ]);
  const by = Object.fromEntries((rows ?? []).map((r) => [r.provider, r]));
  const providers = [];
  for (const [id, p] of Object.entries(PAY_PROVIDERS)) {
    const r = by[id] ?? { live: false, secrets: {}, updated_at: null };
    const fields = [];
    // une clé « enregistrée » doit aussi pouvoir être déchiffrée (sinon : à ressaisir)
    for (const [key, label] of p.fields) {
      const sealed = (r.secrets ?? {})[key];
      fields.push({ key, label, set: !!sealed, readable: sealed ? (await openSecret(sealed)) !== null : false });
    }
    providers.push({ id, name: p.name, ready: p.ready, doc: p.doc, live: !!r.live, updated_at: r.updated_at, fields,
      complete: fields.every((f) => f.set && f.readable) });
  }
  return { mode: typeof m?.value === "string" ? m.value : "whatsapp", providers };
}

async function logEvent(level: "info" | "warn" | "error", source: string, message: string, detail?: unknown, orderRef?: string | null) {
  if (level === "error") console.error(source, message);
  try {
    const d = detail instanceof Error ? { erreur: detail.message, pile: String(detail.stack ?? "").slice(0, 800) } : detail;
    await db.from("app_logs").insert({ level, source, message: String(message).slice(0, 300), detail: d === undefined ? null : cleanDetail(d), order_ref: orderRef ?? null });
  } catch (_) { /* le journal ne doit jamais bloquer la boutique */ }
}

const DAY = 86400000;
const LINK_DAYS = 7;
const STOCK_TYPES = ["key", "key_file", "stock"];
const DELIVERY_TYPES = ["key", "key_file", "file", "stock", "manual", "physical"];

function newToken(n = 18): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function newRef(): string {
  const abc = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const b = new Uint8Array(5);
  crypto.getRandomValues(b);
  const d = new Date();
  const dm = String(d.getUTCDate()).padStart(2, "0") + String(d.getUTCMonth() + 1).padStart(2, "0");
  return "LO-" + dm + "-" + Array.from(b, (x) => abc[x % abc.length]).join("");
}
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const safeFileName = (s: string) => str(s, 150).normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "");

// ================= Email automatique de livraison (Resend) =================
// Secrets : RESEND_API_KEY (obligatoire pour envoyer), RESEND_FROM (facultatif,
// ex. « licenceoff <commandes@licenceoff.com> »), SITE_URL, WHATSAPP_NUMBER (facultatif).
// Sans RESEND_API_KEY, rien n'est envoyé et la boutique marche normalement.
// Modèles : table email_templates (un modèle par produit, sinon le modèle par défaut).
// Variables utilisables dans un modèle :
//   {prenom} {nom} {commande} {total} {produits} {cles} {bouton} {lien_commande} {whatsapp}
//   + pour l'email d'installation (livraison en 2 temps) : {bouton_installation} {lien_installation}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fcfaTxt = (n: number) => new Intl.NumberFormat("fr-FR").format(n).replace(/[\s\u202f]/g, "\u00a0") + "\u00a0FCFA"; // espaces insécables : « 15 000 FCFA » ne se coupe jamais
// prénom pour « Bonjour Moussa, » ; nom absent ou par défaut (« Client », « Client WhatsApp »…) → « Bonjour, »
const firstName = (n: unknown) => { const t = String(n ?? "").trim(); return /^(client( (whatsapp|facebook|wa|fb))?|inconnu|n\/a)?$/i.test(t) ? "" : t.split(/\s+/)[0]; };
const hello = (n: unknown) => { const f = firstName(n); return "Bonjour" + (f ? " " + f : "") + ","; };
const SLOGAN = "licenceoff.com — Solutions numériques rapides et fiables";
// Windows 10 / 11 (pas Server) : déjà installé sur la plupart des PC → le bouton dit « recevoir ma clé », pas « j'ai fini l'installation »
const isWindowsDesktop = (items: { product_name?: string }[]) => items.length > 0 && items.every((i) => /windows\s*(10|11)\b/i.test(String(i.product_name ?? "")) && !/server|office|pack/i.test(String(i.product_name ?? "")));
const EM = { B: "#1E4FB8", N: "#0F2A6B", O: "#F5A21B", C: "#FBF7EE" };

type Tpl = { id: string | null; subject: string; body: string };
// durée réelle du lien de téléchargement (LINK_DAYS = 7 ; nouvel essai possible 30 min si le téléchargement coupe)
const LINK_TXT = "Le lien est valable 7 jours, pour un seul téléchargement (s'il coupe, recliquez dans les 30 minutes).";
const BUILTIN_TPL: Tpl = {
  id: null,
  subject: "Votre commande {commande} est prête",
  body: "Bonjour {prenom},\n\nMerci pour votre commande **{commande}** ({total}). Elle est prête !\n\n{produits}\n\n{cles}\n\n{bouton}\n\nGardez cet email : votre page de commande regroupe vos clés et vos téléchargements.\n\nBesoin d'aide pour installer ou activer ? Écrivez-nous sur WhatsApp.",
};

const BUILTIN_INSTALL_TPL: Tpl = {
  id: null,
  subject: "Installez votre logiciel — commande {commande}",
  body: "Bonjour {prenom},\n\nMerci pour votre commande **{commande}** ({total}). Votre paiement est bien reçu.\n\n**Étape 1 : téléchargez et installez le logiciel.** " + LINK_TXT + "\n\n{bouton}\n\n**Étape 2 : recevez votre clé de licence.** Une fois l'installation terminée, cliquez sur ce bouton. Il ne fonctionne qu'une fois.\n\n{bouton_installation}\n\nUn souci ? Écrivez-nous sur WhatsApp.",
};

// deno-lint-ignore no-explicit-any
type Item = any;
// deno-lint-ignore no-explicit-any
type Ctx = { o: any; items: Item[]; link: string; wa: string; install?: string };

// Compte (Office 365…) rangé dans le stock sous la forme « Identifiant : x | Mot de passe : y »
const acctParts = (v: string) => { const m = String(v ?? "").match(/^Identifiant : (.+?) \| Mot de passe : (.+)$/); return m ? [m[1], m[2]] : null; };
const keyBox = (v: string) => `<div style="font-family:Consolas,Menlo,monospace;font-weight:700;font-size:15px;background:#eff5ff;border:2px dashed ${EM.B};border-radius:8px;padding:10px 12px;margin:6px 0;word-break:break-all;color:${EM.N};-webkit-user-select:all;user-select:all">${esc(v)}</div>`;
// pack : chaque clé porte le nom du produit dont elle vient (ex. « Windows 11 Professionnel »)
// deno-lint-ignore no-explicit-any
const keyLabel = (i: Item, k: any) => k?.products?.name && k.products.name !== i.product_name ? String(k.products.name) : "";
function keysHtml(items: Item[]) {
  return items.map((i) => {
    const ks = (i.license_keys ?? []) as { key_value: string }[];
    if (!ks.length) return "";
    const label = i.delivery_type === "stock" ? "Vos identifiants" : ks.length > 1 ? "Vos clés d'activation" : "Votre clé d'activation";
    return `<div style="margin:10px 0"><div style="font-size:13px;color:#5b6b86">${label} — ${esc(i.product_name)} :</div>` +
      ks.map((k) => {
        const a = acctParts(k.key_value);
        const lbl = keyLabel(i, k);
        return (lbl ? `<div style="font-size:13px;color:#5b6b86;margin-top:8px;font-weight:700">${esc(lbl)}</div>` : "") +
          (a ? `<div style="font-size:13px;color:#5b6b86;margin-top:6px">Identifiant (adresse de connexion)</div>${keyBox(a[0])}<div style="font-size:13px;color:#5b6b86">Mot de passe</div>${keyBox(a[1])}` : keyBox(k.key_value));
      }).join("") + "</div>";
  }).join("");
}
function keysText(items: Item[]) {
  return items.filter((i) => (i.license_keys ?? []).length).map((i) => i.product_name + " :\n" + i.license_keys.map((k: { key_value: string }) => { const a = acctParts(k.key_value), lbl = keyLabel(i, k); return (lbl ? "  " + lbl + " :\n" : "") + (a ? "  Identifiant : " + a[0] + "\n  Mot de passe : " + a[1] : "  " + k.key_value); }).join("\n")).join("\n");
}
const productsHtml = (items: Item[]) => "<ul style=\"margin:6px 0;padding-left:20px\">" + items.map((i) => `<li><b>${i.quantity > 1 ? i.quantity + " × " : ""}${esc(i.product_name)}</b>${["key_file", "file"].includes(i.delivery_type) ? " — logiciel à télécharger depuis votre page de commande" : ""}${i.status === "to_process" ? " — notre équipe vous contacte sur WhatsApp" : ""}</li>`).join("") + "</ul>";
const productsText = (items: Item[]) => items.map((i) => "- " + (i.quantity > 1 ? i.quantity + " x " : "") + i.product_name).join("\n");
const installButtonHtml = (link: string, windows = false) => `<p style="text-align:center;margin:22px 0 6px"><a href="${esc(link)}" style="display:inline-block;background:#15803d;color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">${windows ? "✅ Recevoir ma clé Windows" : "✅ J'ai fini l'installation : recevoir ma clé"}</a></p><p style="text-align:center;margin:0 0 14px;font-size:12px;color:#5b6b86">Bouton à usage unique</p>`;
// bouton « Assistance WhatsApp » (remplace le numéro de téléphone dans les signatures)
const waButtonHtml = (wa: string) => `<p style="margin:18px 0 12px"><a href="https://wa.me/${esc(wa)}" style="display:inline-block;background:#25D366;color:#fff;font-weight:800;text-decoration:none;padding:11px 18px;border-radius:10px">💬 Assistance WhatsApp</a></p>`;
// produits livrés par compte : le bouton mène à la page de commande où chaque identifiant a son bouton « Copier »
const buttonLabel = (items: Item[]) => items.length && items.every((i) => i.delivery_type === "stock") ? "Ouvrir ma commande" : "Voir ma commande et télécharger";
const buttonHtml = (link: string, label = "Voir ma commande et télécharger") => `<p style="text-align:center;margin:22px 0"><a href="${esc(link)}" style="display:inline-block;background:${EM.O};color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">${esc(label)}</a></p>`;

function vars(c: Ctx) {
  // nom pas encore donné (« Client », « Client WhatsApp »…) : « Bonjour, » plutôt que « Bonjour Client, »
  const real = !/^(client( (whatsapp|facebook|wa|fb))?|inconnu|n\/a)?$/i.test(String(c.o.customer_name ?? "").trim());
  const parts = real ? String(c.o.customer_name ?? "").trim().split(/\s+/) : [];
  return { prenom: parts[0] || "", nom: real ? String(c.o.customer_name ?? "") : "", commande: String(c.o.ref), total: fcfaTxt(c.o.amount_fcfa), lien_commande: c.link, lien_installation: c.install ?? c.link, whatsapp: "https://wa.me/" + c.wa,
    // {version} : 2024, 2021, 2019, 2016, 365… lue dans le nom du produit ; {produit} : nom(s) du produit
    version: (c.items.map((i) => String(i.product_name ?? "").match(/\b(20(?:07|10|13|16|19|21|24|25|26)|365)\b/)).find(Boolean) ?? [""])[0],
    produit: c.items.map((i) => String(i.product_name ?? "")).filter(Boolean).join(", ") };
}
// Texte simple → HTML : paragraphes, **gras**, listes « - », [lien](url), et les blocs {produits} {cles} {bouton}
function renderBody(body: string, c: Ctx) {
  const v = vars(c) as Record<string, string>;
  let b = String(body ?? "");
  const hasKeys = c.items.some((i) => (i.license_keys ?? []).length);
  if (hasKeys && !b.includes("{cles}")) b += "\n\n{cles}";
  if (!b.includes("{bouton}") && !b.includes("{lien_commande}")) b += "\n\n{bouton}";
  if (c.install && !b.includes("{bouton_installation}") && !b.includes("{lien_installation}")) b += "\n\n{bouton_installation}";
  if (!c.install) b = b.replace(/\{bouton_installation\}/g, "");
  if (!b.includes("{bouton_whatsapp}")) b += "\n\n{bouton_whatsapp}"; // toujours un bouton d'assistance
  b = b.replace(/\[([^\]]+)\]\(\{whatsapp\}\)/g, "$1"); // le bouton suffit : pas de lien WhatsApp en double
  const sub = (s: string) => s.replace(/\{(prenom|nom|commande|total|lien_commande|lien_installation|whatsapp|version|produit)\}/g, (_, k) => v[k]).replace(/ {2,}/g, " ").replace(/(Bonjour|Rebonjour|Merci) ([,!.])/g, "$1$2");
  // HTML
  const blocks = b.replace(/\r/g, "").split(/\n{2,}/).map((para) => {
    const t = para.trim();
    if (t === "{produits}") return productsHtml(c.items);
    if (t === "{cles}") return keysHtml(c.items);
    if (t === "{bouton}") return buttonHtml(c.link, buttonLabel(c.items));
    if (t === "{bouton_installation}") return installButtonHtml(c.install ?? c.link, isWindowsDesktop(c.items));
    if (t === "{bouton_whatsapp}") return waButtonHtml(c.wa);
    // bouton lien libre dans un modèle : {bouton_lien:Texte du bouton|https://…} (seul sur sa ligne)
    const bl = t.match(/^\{bouton_lien:([^|}]{1,80})\|(https:\/\/[^\s}]+)\}$/);
    if (bl) return `<p style="text-align:center;margin:14px 0"><a href="${esc(bl[2])}" style="display:inline-block;background:${EM.B};color:#fff;font-weight:800;text-decoration:none;padding:12px 20px;border-radius:10px">${esc(bl[1])}</a></p>`;
    const inline = (s: string) => esc(sub(s))
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, `<a href="$2" style="color:${EM.B};font-weight:700">$1</a>`);
    const lines = t.split("\n");
    if (lines.every((l) => /^\s*-\s+/.test(l))) return "<ul style=\"margin:6px 0;padding-left:20px\">" + lines.map((l) => "<li>" + inline(l.replace(/^\s*-\s+/, "")) + "</li>").join("") + "</ul>";
    return `<p style="margin:0 0 12px;line-height:1.6">${lines.map(inline).join("<br>")}</p>`;
  }).join("");
  const html = blocks.replace(/\{produits\}/g, productsHtml(c.items)).replace(/\{cles\}/g, keysHtml(c.items)).replace(/\{bouton\}/g, buttonHtml(c.link, buttonLabel(c.items))).replace(/\{bouton_installation\}/g, installButtonHtml(c.install ?? c.link, isWindowsDesktop(c.items))).replace(/\{bouton_whatsapp\}/g, waButtonHtml(c.wa));
  // Texte
  const text = sub(b).replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 : $2")
    .replace(/\{produits\}/g, productsText(c.items)).replace(/\{cles\}/g, keysText(c.items)).replace(/\{bouton\}/g, "Votre commande : " + c.link)
    .replace(/\{bouton_installation\}/g, (isWindowsDesktop(c.items) ? "Recevoir ma clé Windows" : "Installation terminée ? Recevez votre clé") + " (bouton à usage unique) : " + (c.install ?? c.link))
    .replace(/\{bouton_whatsapp\}/g, "Assistance WhatsApp : https://wa.me/" + c.wa)
    .replace(/\{bouton_lien:([^|}]{1,80})\|(https:\/\/[^\s}]+)\}/g, "$1 : $2");
  return { html, text };
}
// Email « transactionnel » sobre (fond blanc, peu d'images, pas de slogan) : Gmail le classe
// plus souvent dans « Principal » que dans « Promotions ».
function wrapHtml(inner: string, ref?: string, invoiceUrl?: string, tip = false) {
  const { B, N, O } = EM;
  const why = ref ? `Commande <b>${esc(ref)}</b> · ` : "";
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#ffffff;font-family:Segoe UI,Arial,sans-serif;color:${N}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="padding:0 0 12px;border-bottom:2px solid ${O}"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
  <td style="padding-right:10px;vertical-align:middle"><img src="https://www.licenceoff.com/img/profil-64.png" width="40" height="40" alt="" style="display:block;border:0;width:40px;height:40px"></td>
  <td style="vertical-align:middle;font-size:20px;font-weight:800;color:${B}">licence<span style="color:${O}">off</span><span style="font-size:14px;font-weight:700">.com</span></td></tr></table></td></tr>
<tr><td style="padding:20px 0;font-size:15px;line-height:1.5">${inner}</td></tr>
<tr><td style="border-top:1px solid #e3e8f0;padding:12px 0;color:#6b7690;font-size:12px;line-height:1.6">
  ${why}Une question ? Répondez simplement à cet email.<br>
  ${invoiceUrl ? `Votre facture : <a href="${esc(invoiceUrl)}" style="color:${B}">voir et télécharger</a><br>` : ""}${tip ? "Ajoutez commandes@licenceoff.com à vos contacts pour bien recevoir nos emails.<br>" : ""}
  ${esc(SLOGAN)} · Dakar, Sénégal</td></tr>
</table></td></tr></table></body></html>`;
}
// même pied de page, version texte
function footerText(ref?: string, invoiceUrl?: string, tip = false) {
  return "\n\n" + (ref ? "Commande " + ref + " · " : "") + "Une question ? Répondez simplement à cet email." +
    (invoiceUrl ? "\nVotre facture : " + invoiceUrl : "") + (tip ? "\nAjoutez commandes@licenceoff.com à vos contacts pour bien recevoir nos emails." : "") + "\n" + SLOGAN + " · Dakar, Sénégal";
}
function renderEmail(tpl: Tpl, c: Ctx) {
  const { html, text } = renderBody(tpl.body, c);
  const v = vars(c) as Record<string, string>;
  const subject = String(tpl.subject || BUILTIN_TPL.subject).replace(/\{(prenom|nom|commande|total|version|produit)\}/g, (_, k) => v[k]).replace(/ {2,}/g, " ").replace(/(Bonjour|Rebonjour|Merci) ([,!.])/g, "$1$2")
    .replace(/\s*[—–-]\s*licenceoff(\.com)?\s*$/i, "").trim().slice(0, 200); // l'expéditeur s'appelle déjà « licenceoff.com »
  const ref = String(c.o.ref || "");
  const hasRef = ref && ref !== "—";
  // lien vers la facture (commande payée avec un numéro de facture)
  const inv = c.o.invoice_no && c.o.public_token ? siteCtx().site + "/facture.html?o=" + encodeURIComponent(c.o.public_token) : undefined;
  const subj = hasRef && !subject.includes(ref) ? (subject + " — commande " + ref).slice(0, 200) : subject;
  return {
    subject: subj, html: wrapHtml(html, hasRef ? ref : undefined, inv, true),
    text: text + footerText(hasRef ? ref : undefined, inv, true),
    headers: hasRef ? { "X-Entity-Ref-ID": ref } : undefined,
  };
}
// Modèle d'email → instructions « neutres » pour un client final de revendeur :
// on retire tout ce qui parle de la commande, du prix, de la page de commande, du site ou de l'assistance licenceoff.
function neutralInstructions(body: string, product: string) {
  const version = (product.match(/\b(20(?:07|10|13|16|19|21|24|25|26)|365)\b/) ?? [""])[0];
  const drop = /\{(commande|total|bouton|lien_commande|whatsapp|bouton_whatsapp|bouton_installation|lien_installation|produits)\}|licenceoff|commande|wa\.me|whatsapp/i;
  return body.replace(/\r/g, "").split(/\n{2,}/)
    .filter((p) => p.trim() && !drop.test(p) && !/^\s*(\{cles\}|Bonjour\b[^\n]*)\s*$/i.test(p))
    .map((p) => p.trim()
      .replace(/\{prenom\}|\{nom\}/g, "").replace(/Bonjour\s*,/, "Bonjour,")
      .replace(/\{version\}/g, version).replace(/\{produit\}/g, product)
      .replace(/^\{bouton_lien:([^|}]+)\|(https:\/\/[^\s}]+)\}$/, "[[$1]]($2)"))
    .join("\n\n");
}
function siteCtx() {
  return {
    site: (Deno.env.get("SITE_URL") ?? "https://www.licenceoff.com").trim().replace(/\/$/, ""),
    wa: (Deno.env.get("WHATSAPP_NUMBER") ?? "221777860777").replace(/\D/g, ""),
  };
}
async function resendSend(to: string, mail: { subject: string; html: string; text: string; headers?: Record<string, string>; attachments?: { filename: string; content: string }[] }, replyTo?: string, from?: string) {
  const key = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  if (!key) { await logEvent("warn", "email", "Email non envoyé : clé Resend absente dans Supabase (secret RESEND_API_KEY)", { destinataire: to }); return { ok: false, reason: "resend_non_configure" }; }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: (from ?? (Deno.env.get("RESEND_FROM") ?? "licenceoff.com <commandes@licenceoff.com>")).trim().replace(/^"?licenceoff"?\s*</i, "licenceoff.com <"),
      // les réponses des clients arrivent dans l'admin (onglet Messages) via contact@licenceoff.com
      to: [to], reply_to: replyTo ?? ((Deno.env.get("RESEND_REPLY_TO") ?? "").trim() || "contact@licenceoff.com"),
      subject: mail.subject, html: mail.html, text: mail.text, headers: mail.headers, attachments: mail.attachments,
    }),
  }).catch(() => null);
  if (!r || !r.ok) {
    const rep = r ? (await r.text().catch(() => "")).slice(0, 500) : "pas de réponse (réseau)";
    await logEvent("error", "email", "Email non envoyé à " + to + " : « " + mail.subject + " »", { statut_http: r?.status ?? null, reponse_resend: rep });
    return { ok: false, reason: "envoi_echoue" };
  }
  await logEvent("info", "email", "Email envoyé à " + to + " : « " + mail.subject + " »");
  // compteur des emails envoyés (gardé sans limite de durée)
  try { await db.from("email_sends").insert({ to_email: to.toLowerCase(), subject: mail.subject.slice(0, 200) }); } catch (_) { /* le compteur ne bloque jamais l'envoi */ }
  return { ok: true };
}

// Envoie l'email de livraison UNE fois (force = renvoi manuel depuis l'admin).
// Si la commande contient des produits avec des modèles différents : un email par modèle.
async function sendDeliveryEmail(orderId: string, force = false, templateId?: string): Promise<{ sent: boolean; count?: number; reason?: string }> {
  if (!(Deno.env.get("RESEND_API_KEY") ?? "").trim()) return { sent: false, reason: "resend_non_configure" };
  const { data: o } = await db.from("orders")
    .select("id, ref, public_token, invoice_no, customer_name, email, amount_fcfa, status, emailed_at, order_items(id, product_name, delivery_type, quantity, status, created_at, license_keys(key_value, products(name)), products(email_template_id))")
    .eq("id", orderId).maybeSingle();
  if (!o || !o.email) return { sent: false, reason: "commande_introuvable" };
  if (!force && o.status !== "delivered") return { sent: false, reason: "pas_encore_livree" };
  if (!force && o.emailed_at) return { sent: false, reason: "deja_envoye" };
  if (!force) { // réserve l'envoi (évite les doublons si PayDunya prévient 2 fois)
    const { data: claim } = await db.from("orders").update({ emailed_at: new Date().toISOString() }).eq("id", o.id).is("emailed_at", null).select("id");
    if (!claim?.length) return { sent: false, reason: "deja_envoye" };
  }
  const items: Item[] = ((o.order_items ?? []) as Item[]).filter((i) => i.status !== "cancelled")
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const { data: tpls } = await db.from("email_templates").select("id, subject, body, is_default, kind");
  const byId = Object.fromEntries((tpls ?? []).map((t) => [t.id, t]));
  const def: Tpl = (tpls ?? []).find((t) => t.is_default && t.kind !== "install") ?? BUILTIN_TPL;
  const groups = new Map<string, { tpl: Tpl; items: Item[] }>();
  for (const i of items) {
    const t: Tpl = (templateId && byId[templateId]) || byId[i.products?.email_template_id] || def;
    const k = t.id ?? "builtin";
    if (!groups.has(k)) groups.set(k, { tpl: t, items: [] });
    groups.get(k)!.items.push(i);
  }
  const { site, wa } = siteCtx();
  const link = site + "/commande.html?o=" + encodeURIComponent(o.public_token);
  let sent = 0;
  for (const g of groups.values()) {
    const r = await resendSend(o.email, renderEmail(g.tpl, { o, items: g.items, link, wa }));
    if (r.ok) sent++;
  }
  if (!sent) {
    if (!force) await db.from("orders").update({ emailed_at: null }).eq("id", o.id);
    return { sent: false, reason: "envoi_echoue" };
  }
  if (force) await db.from("orders").update({ emailed_at: new Date().toISOString() }).eq("id", o.id);
  return { sent: true, count: sent };
}

// Livraison en 2 temps, étape 1 : email d'installation (lien de téléchargement + bouton
// à usage unique « J'ai fini l'installation »). Une fois par article (force = renvoi admin).
async function sendInstallEmail(orderId: string, force = false): Promise<{ sent: boolean; count?: number; reason?: string }> {
  if (!(Deno.env.get("RESEND_API_KEY") ?? "").trim()) return { sent: false, reason: "resend_non_configure" };
  const { data: o } = await db.from("orders")
    .select("id, ref, public_token, invoice_no, customer_name, email, amount_fcfa, status, order_items(id, product_name, delivery_type, quantity, status, created_at, install_emailed_at, products(install_template_id, manual_key, manual_link, installer_path))")
    .eq("id", orderId).maybeSingle();
  if (!o || !o.email) return { sent: false, reason: "commande_introuvable" };
  let items: Item[] = ((o.order_items ?? []) as Item[]).filter((i) => i.status === "awaiting_install" && (force || !i.install_emailed_at));
  if (!items.length) return { sent: false, reason: "rien_a_envoyer" };
  if (!force) { // réserve l'envoi (pas de doublon)
    const { data: claim } = await db.from("order_items").update({ install_emailed_at: new Date().toISOString() })
      .in("id", items.map((i) => i.id)).is("install_emailed_at", null).select("id");
    const ok = new Set((claim ?? []).map((r) => r.id));
    items = items.filter((i) => ok.has(i.id));
    if (!items.length) return { sent: false, reason: "deja_envoye" };
  }
  items.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const { site: site0, wa: wa0 } = siteCtx();
  const link0 = site0 + "/commande.html?o=" + encodeURIComponent(o.public_token);
  // clé envoyée à la main : pas de bouton « J'ai fini l'installation », on annonce que la clé arrive
  // deno-lint-ignore no-explicit-any
  const manualKey = items.filter((i) => (i as any).products?.manual_key);
  let sent0 = 0;
  if (manualKey.length) {
    // deno-lint-ignore no-explicit-any
    const withDl = manualKey.some((i) => (i as any).products?.installer_path && !(i as any).products?.manual_link);
    const names = manualKey.map((i) => (Number(i.quantity) > 1 ? i.quantity + " × " : "") + i.product_name);
    const P = (t: string) => `<p style="margin:0 0 12px;line-height:1.6">${t}</p>`;
    const html = P(esc(hello(o.customer_name))) +
      P(`Merci pour votre commande <b>${esc(o.ref)}</b> (${esc(fcfaTxt(o.amount_fcfa))}). Votre paiement est bien reçu.`) +
      `<ul style="margin:0 0 12px;padding-left:20px;line-height:1.6">${names.map((x) => "<li>" + esc(x) + "</li>").join("")}</ul>` +
      (withDl ? P("<b>Étape 1 :</b> téléchargez et installez le logiciel depuis votre page de commande (bouton ci-dessous). " + LINK_TXT) : "") +
      P(`🔑 <b>Votre clé d'activation vous est envoyée par notre équipe</b>, par email et sur votre page de commande, dans les plus brefs délais (jours ouvrés). Vous n'avez rien à faire.`) +
      `<p style="text-align:center;margin:22px 0"><a href="${esc(link0)}" style="display:inline-block;background:${EM.O};color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">Voir ma commande</a></p>` +
      P("Une question ? Répondez à cet email ou écrivez-nous sur WhatsApp.") + waButtonHtml(wa0);
    const text = hello(o.customer_name) + "\n\nMerci pour votre commande " + o.ref + " (" + fcfaTxt(o.amount_fcfa) + "). Votre paiement est bien reçu.\n\n" + names.join("\n") +
      (withDl ? "\n\nÉtape 1 : téléchargez et installez le logiciel depuis votre page de commande." : "") +
      "\n\nVotre clé d'activation vous est envoyée par notre équipe, par email et sur votre page de commande, dans les plus brefs délais.\n\nVoir ma commande : " + link0 + "\n\nAssistance WhatsApp : https://wa.me/" + wa0 + footerText(o.ref, undefined, true);
    const r = await resendSend(o.email, { subject: "Paiement reçu, votre clé arrive — commande " + o.ref, html: wrapHtml(html, o.ref, undefined, true), text, headers: { "X-Entity-Ref-ID": o.ref + "-cle-manuelle" } });
    if (r.ok) sent0++;
    else if (!force) await db.from("order_items").update({ install_emailed_at: null }).in("id", manualKey.map((i) => i.id));
    items = items.filter((i) => !manualKey.includes(i));
    if (!items.length) return sent0 ? { sent: true, count: sent0 } : { sent: false, reason: "envoi_echoue" };
  }
  const { data: tpls } = await db.from("email_templates").select("id, subject, body, is_default, kind").eq("kind", "install");
  const byId = Object.fromEntries((tpls ?? []).map((t) => [t.id, t]));
  const def: Tpl = (tpls ?? []).find((t) => t.is_default) ?? BUILTIN_INSTALL_TPL;
  const groups = new Map<string, { tpl: Tpl; items: Item[] }>();
  for (const i of items) {
    const t: Tpl = byId[i.products?.install_template_id] || def;
    const k = t.id ?? "builtin";
    if (!groups.has(k)) groups.set(k, { tpl: t, items: [] });
    groups.get(k)!.items.push(i);
  }
  const { site, wa } = siteCtx();
  const link = site + "/commande.html?o=" + encodeURIComponent(o.public_token);
  let sent = 0;
  for (const g of groups.values()) {
    const r = await resendSend(o.email, renderEmail(g.tpl, { o, items: g.items, link, wa, install: link + "&installe=1" }));
    if (r.ok) sent++;
  }
  if (!sent) {
    if (!force) await db.from("order_items").update({ install_emailed_at: null }).in("id", items.map((i) => i.id));
    return { sent: false, reason: "envoi_echoue" };
  }
  if (force) await db.from("order_items").update({ install_emailed_at: new Date().toISOString() }).in("id", items.map((i) => i.id));
  return { sent: true, count: sent };
}

// Parrainage : un parrain a atteint le seuil → email à l'admin (réglage « admin_email »), une fois par demande
async function notifyPayouts() {
  const { data: ps } = await db.from("payouts").select("id, amount_fcfa, parrains(name, phone, payout_info)").eq("status", "to_pay").is("notified_at", null).limit(20);
  if (!ps?.length) return;
  const { data: st } = await db.from("settings").select("value").eq("key", "admin_email").maybeSingle();
  const to = String(st?.value ?? "").replace(/"/g, "").trim();
  if (!to.includes("@")) return; // pas d'adresse : l'alerte reste visible dans l'admin
  const { site } = siteCtx();
  for (const p of ps) {
    // deno-lint-ignore no-explicit-any
    const pr = (p as any).parrains ?? {};
    const { data: claim } = await db.from("payouts").update({ notified_at: new Date().toISOString() }).eq("id", p.id).is("notified_at", null).select("id");
    if (!claim?.length) continue;
    const r = await resendSend(to, {
      subject: `Parrainage : ${fcfaTxt(p.amount_fcfa)} à verser à ${pr.name ?? "un parrain"}`,
      html: wrapHtml(`<p style="margin:0 0 12px">Le parrain <b>${esc(pr.name)}</b> a atteint le seuil de versement.</p><p style="margin:0 0 12px">Montant à lui verser : <b>${esc(fcfaTxt(p.amount_fcfa))}</b><br>Versement sur : ${esc(pr.payout_info || "non indiqué")}${pr.phone ? "<br>Téléphone : " + esc(pr.phone) : ""}</p><p style="margin:0 0 12px">Une fois payé, cliquez « Marquer payé » dans l'admin, onglet Parrains : ${esc(site)}/admin</p>`),
      text: `Le parrain ${pr.name} a atteint le seuil. À verser : ${fcfaTxt(p.amount_fcfa)} sur ${pr.payout_info || "?"}. Admin : ${site}/admin`,
    });
    if (!r.ok) await db.from("payouts").update({ notified_at: null }).eq("id", p.id);
  }
}

// Après chaque livraison : email d'installation (étape 1) et/ou email de la clé (commande livrée), alerte parrainage
async function orderRefOf(orderId: string) {
  const { data } = await db.from("orders").select("ref").eq("id", orderId).maybeSingle();
  return data?.ref ?? null;
}
const DELIVERY_LOG: Record<string, ["info" | "warn", string]> = {
  delivered: ["info", "Commande livrée au client"],
  out_of_stock: ["warn", "Commande payée mais stock vide : elle attend des clés (ajoutez du stock)"],
  to_process: ["info", "Commande payée : des articles sont à traiter par vous"],
  awaiting_install: ["info", "Lien de téléchargement envoyé, le client installe"],
};
async function sendOrderEmails(orderId: string, reason?: string) {
  const lg = reason ? DELIVERY_LOG[reason] : undefined;
  if (lg) await logEvent(lg[0], "livraison", lg[1], { etape: reason }, await orderRefOf(orderId));
  await sendInstallEmail(orderId).catch((e) => logEvent("error", "email", "Erreur pendant l'email d'installation", e));
  if (reason === "delivered") await sendDeliveryEmail(orderId).catch((e) => logEvent("error", "email", "Erreur pendant l'email de livraison", e));
  // produits physiques : « commande payée, livraison sous 48 h ouvrées » (une seule fois)
  await sendShipEmail(orderId, "paid").catch((e) => logEvent("error", "email", "Erreur pendant l'email « commande payée »", e));
  await notifyPayouts().catch((e) => logEvent("error", "parrainage", "Erreur pendant l'alerte de versement parrain", e));
}

// Vente faite par WhatsApp / en direct : crée la commande (plusieurs articles possibles)
// deno-lint-ignore no-explicit-any
async function createAdminOrder(body: any): Promise<Response | { o: any }> {
  const name = str(body.name, 100);
  const email = str(body.email, 200).toLowerCase();
  if (name.length < 2) return json({ error: "nom_invalide" }, 400);
  if (!email.includes("@")) return json({ error: "email_invalide" }, 400);
  const lines = (Array.isArray(body.items) ? body.items : []).slice(0, 20)
    // unit_price : prix par ligne imposé (devis converti) ; sinon prix du site, ramené au montant réellement payé
    .map((i: { product_id: string; qty: number; unit_price?: number }) => ({ id: str(i.product_id, 40), qty: clamp(Math.floor(Number(i.qty) || 1), 1, 1000),
      up: i.unit_price != null && Number.isFinite(Number(i.unit_price)) ? clamp(Math.round(Number(i.unit_price)), 0, 100_000_000) : null }))
    .filter((i: { id: string }) => i.id);
  if (!lines.length) return json({ error: "panier_vide" }, 400);
  const { data: prods } = await db.from("products").select("id, name, price_fcfa, delivery_type").in("id", lines.map((l: { id: string }) => l.id));
  if (!prods?.length) return json({ error: "produit_introuvable" }, 400);
  const byId = Object.fromEntries(prods.map((p) => [p.id, p]));
  const items = lines.filter((l: { id: string }) => byId[l.id]);
  const computed = items.reduce((s: number, l: { id: string; qty: number }) => s + byId[l.id].price_fcfa * l.qty, 0);
  const amount = body.amount_fcfa !== "" && body.amount_fcfa != null && Number.isFinite(Number(body.amount_fcfa))
    ? clamp(Number(body.amount_fcfa), 0, 100_000_000) : computed;
  // frais de transaction payés par le client (Wave, OM…) : ajoutés au total, ligne à part sur la facture
  const fees = Number.isFinite(Number(body.fees_fcfa)) ? clamp(Math.round(Number(body.fees_fcfa) || 0), 0, 1_000_000) : 0;
  const ref = newRef();
  const MANUAL_CHANNELS = ["wa_manuel", "fb_manuel", "tel_manuel", "autre_manuel"];
  const { data: o, error } = await db.from("orders").insert({
    ref, public_token: newToken(24), customer_name: name, email,
    phone: str(body.phone, 30).replace(/[^\d+]/g, "") || null, amount_fcfa: amount + fees, fees_fcfa: fees,
    // n° de transaction : celui de Wave/OM s'il est donné, sinon un numéro automatique
    payment_method: str(body.payment_method, 30) || null, payment_ref: str(body.payment_ref, 100) || ("TX-" + ref.slice(3)),
    note: str(body.note, 300) || null, source: "admin",
    channel: MANUAL_CHANNELS.includes(body.channel) ? body.channel : "wa_manuel", campaign: str(body.campaign, 80) || null,
    billing_company: str(body.company, 120) || null, billing_address: str(body.address, 300) || null,
  }).select().single();
  if (error) return json({ error: error.message }, 500);
  const { error: e2 } = await db.from("order_items").insert(items.map((l: { id: string; qty: number }) => ({
    order_id: o.id, product_id: l.id, product_name: byId[l.id].name, delivery_type: byId[l.id].delivery_type,
    // prix réellement payé (vente WhatsApp à un autre prix) : réparti sur les lignes pour des stats justes
    unit_price: (l as { up: number | null }).up != null ? (l as { up: number }).up
      : amount === computed ? byId[l.id].price_fcfa
      : computed > 0 ? Math.round(byId[l.id].price_fcfa * amount / computed)
      : Math.round(amount / items.reduce((n: number, x: { qty: number }) => n + x.qty, 0)),
    quantity: l.qty,
    list_price: byId[l.id].price_fcfa, // prix du site au moment de la vente : la facture affiche la remise s'il a été baissé
  })));
  if (e2) { await db.from("orders").delete().eq("id", o.id); return json({ error: e2.message }, 500); }
  return { o };
}

// ---------- Page Facebook (secrets FB_PAGE_ID + FB_PAGE_TOKEN, ajoutés par Cheikh dans Supabase) ----------
function fbReady() { return !!(Deno.env.get("FB_PAGE_ID") ?? "").trim() && !!(Deno.env.get("FB_PAGE_TOKEN") ?? "").trim(); }
// deno-lint-ignore no-explicit-any
const ytId = (u: string) => { const m = String(u || "").trim().match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/); return m ? m[1] : null; };
// deno-lint-ignore no-explicit-any
async function postToFacebook(p: any): Promise<{ ok: boolean; reason?: string; id?: string }> {
  const page = (Deno.env.get("FB_PAGE_ID") ?? "").trim(), token = (Deno.env.get("FB_PAGE_TOKEN") ?? "").trim();
  if (!page || !token) return { ok: false, reason: "fb_non_configure" };
  const link = siteCtx().site + "/blog/" + encodeURIComponent(p.slug);
  // Facebook : seulement un extrait (le résumé, sinon le début de l'article) + le lien, jamais l'article entier
  const plain = (t: string) => String(t || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^-{3,}$/gm, "").replace(/[#*>_`]/g, "").replace(/\s+/g, " ").trim();
  const short = (t: string, n: number) => t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, "") + "…";
  const intro = short(plain(p.excerpt) || plain(p.content), 155);
  const vid = ytId(p.cover_video);
  const message = p.title + (intro ? "\n\n" + intro : "") + "\n\n" + (vid ? "▶ Regarder la vidéo et lire l'article : " : "👉 Lire l'article : ") + link;
  // image principale ; si l'article a une vidéo YouTube sans image, on prend sa miniature
  const img = p.cover_url || (vid ? "https://i.ytimg.com/vi/" + vid + "/hqdefault.jpg" : null);
  // avec une image : publication photo (l'image s'affiche en grand) ; sinon : lien
  const params = img ? { url: img, caption: message, access_token: token } : { message, link, access_token: token };
  const r = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(page)}/${img ? "photos" : "feed"}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params),
  }).catch(() => null);
  // deno-lint-ignore no-explicit-any
  const d: any = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok || !(d.post_id || d.id)) {
    await logEvent("error", "facebook", "Publication Facebook refusée : « " + p.title + " »", { statut_http: r?.status ?? null, erreur: d?.error?.message ?? "pas de réponse", code: d?.error?.code ?? null });
    return { ok: false, reason: "fb_erreur" };
  }
  const id = String(d.post_id || d.id);
  await db.from("posts").update({ fb_post_id: id, fb_posted_at: new Date().toISOString() }).eq("id", p.id);
  await logEvent("info", "facebook", "Article publié sur Facebook : « " + p.title + " »");
  return { ok: true, id };
}

// Clé verrouillée : email « votre clé vous attend » (la clé n'y figure pas), bouton vers la page de commande
async function sendLockedEmail(orderId: string): Promise<{ sent: boolean; kind: string; reason?: string }> {
  const { data: o } = await db.from("orders").select("ref, public_token, customer_name, email, amount_fcfa, order_items(product_name, quantity)").eq("id", orderId).maybeSingle();
  if (!o) return { sent: false, kind: "locked", reason: "not_found" };
  const { site, wa } = siteCtx();
  const link = site + "/commande.html?o=" + encodeURIComponent(o.public_token);
  const pay = "https://wa.me/" + wa + "?text=" + encodeURIComponent("Bonjour, je veux régler ma commande " + o.ref + " (" + fcfaTxt(o.amount_fcfa) + ").");
  // deno-lint-ignore no-explicit-any
  const prods = ((o.order_items ?? []) as any[]).map((i) => (i.quantity > 1 ? i.quantity + " × " : "") + i.product_name);
  const P = (t: string) => `<p style="margin:0 0 12px;line-height:1.6">${t}</p>`;
  const html = P(esc(hello(o.customer_name))) + P("Votre clé de licence est prête et réservée pour vous :") + P(`<b>${prods.map(esc).join("<br>")}</b>`) +
    P(`<b>Pour la recevoir, réglez ${esc(fcfaTxt(o.amount_fcfa))} par Wave ou Orange Money.</b> Écrivez-nous sur WhatsApp (bouton vert ci-dessous) : nous vous donnons le numéro, puis nous confirmons votre paiement.`) +
    P("Dès que le paiement est confirmé, la clé s'affiche sur votre page de commande et vous la recevez aussi par email.") +
    `<p style="text-align:center;margin:22px 0"><a href="${esc(link)}" style="display:inline-block;background:${EM.O};color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">Voir ma commande</a></p>` +
    `<p style="margin:18px 0 12px"><a href="${esc(pay)}" style="display:inline-block;background:#25D366;color:#fff;font-weight:800;text-decoration:none;padding:11px 18px;border-radius:10px">💬 Régler sur WhatsApp</a></p>`;
  const text = hello(o.customer_name) + "\n\nVotre clé de licence est prête et réservée pour vous :\n" + prods.join("\n") +
    "\n\nPour la recevoir, réglez " + fcfaTxt(o.amount_fcfa) + " par Wave ou Orange Money. Écrivez-nous sur WhatsApp : nous vous donnons le numéro, puis nous confirmons votre paiement.\n" +
    "Dès que le paiement est confirmé, la clé s'affiche sur votre page de commande et vous la recevez aussi par email.\n\nVoir ma commande : " + link +
    "\nRégler sur WhatsApp : " + pay + footerText(o.ref, undefined, true);
  const r = await resendSend(o.email, { subject: "Votre clé vous attend — commande " + o.ref, html: wrapHtml(html, o.ref, undefined, true), text, headers: { "X-Entity-Ref-ID": o.ref } });
  return r.ok ? { sent: true, kind: "locked" } : { sent: false, kind: "locked", reason: r.reason };
}

// ================= Demande d'avis (commandes livrées) =================
// Un email par commande : bouton vers la page de commande où le formulaire d'avis s'ouvre (?avis=1).
// orders.review_asked_at retient la date d'envoi (l'envoi groupé ne relance jamais deux fois).
const REVIEW_BATCH = 40;
// deno-lint-ignore no-explicit-any
async function reviewables(orders: any[]) {
  const items = orders.flatMap((o) => (o.order_items ?? []).filter((i: Item) => i.status === "delivered" && i.product_id));
  const ids = items.map((i: Item) => i.id);
  const done = new Set<string>();
  for (let k = 0; k < ids.length; k += 200) {
    const { data } = await db.from("product_reviews").select("order_item_id").in("order_item_id", ids.slice(k, k + 200));
    for (const r of data ?? []) done.add(r.order_item_id);
  }
  return orders.map((o) => ({ o, items: (o.order_items ?? []).filter((i: Item) => i.status === "delivered" && i.product_id && !done.has(i.id)) }))
    .filter((x) => x.items.length && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x.o.email ?? "")) && !/@licenceoff\.com$/i.test(String(x.o.email)));
}
// deno-lint-ignore no-explicit-any
async function sendReviewRequest(o: any, items: Item[]) {
  const { site, wa } = siteCtx();
  const link = site + "/commande.html?o=" + encodeURIComponent(o.public_token) + "&avis=1";
  const names = [...new Set(items.map((i) => String(i.product_name)))];
  const html = `<p style="margin:0 0 12px">${esc(hello(o.customer_name))}</p>
<p style="margin:0 0 12px;line-height:1.6">Merci encore pour votre achat : <b>${names.map(esc).join(", ")}</b>. Nous espérons que tout fonctionne bien.</p>
<p style="margin:0 0 12px;line-height:1.6">Votre avis aide d'autres clients à acheter en confiance. Cela prend 30 secondes : une note de 1 à 5 étoiles et, si vous le souhaitez, quelques mots.</p>
<p style="margin:0 0 12px;line-height:1.6">🎁 En plus, votre avis validé vous rapporte 50 points fidélité : jusqu'à 20 % de réduction sur vos prochaines commandes.</p>
<p style="text-align:center;margin:22px 0"><a href="${esc(link)}" style="display:inline-block;background:${EM.O};color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">⭐ Donner mon avis</a></p>
<p style="margin:0 0 12px;line-height:1.6">Un souci avec votre clé ou votre installation ? Répondez à cet email ou écrivez-nous sur WhatsApp, on s'en occupe.</p>
${waButtonHtml(wa)}`;
  const text = hello(o.customer_name) + "\n\nMerci encore pour votre achat : " + names.join(", ") + ". Nous espérons que tout fonctionne bien.\n\n" +
    "Votre avis aide d'autres clients à acheter en confiance. Cela prend 30 secondes : une note de 1 à 5 étoiles et, si vous le souhaitez, quelques mots.\nVotre avis validé vous rapporte 50 points fidélité : jusqu'à 20 % de réduction sur vos prochaines commandes.\n\nDonner mon avis : " + link +
    "\n\nUn souci avec votre clé ou votre installation ? Répondez à cet email ou écrivez-nous sur WhatsApp : https://wa.me/" + wa +
    footerText(o.ref);
  const r = await resendSend(o.email, { subject: "Votre avis sur " + (names.length === 1 ? names[0] : "votre commande") + " ? — commande " + o.ref, html: wrapHtml(html, o.ref), text, headers: { "X-Entity-Ref-ID": o.ref + "-avis" } });
  if (r.ok) await db.from("orders").update({ review_asked_at: new Date().toISOString() }).eq("id", o.id);
  return r;
}

// Produits physiques : un email au client à chaque étape (payée → expédition en cours → livrée + avis)
const SHIP_DAYS_TXT = "48 h (jours ouvrés)";
async function sendShipEmail(orderId: string, stage: "paid" | "shipping" | "done"): Promise<{ sent: boolean; reason?: string }> {
  const { data: o } = await db.from("orders")
    .select("id, ref, public_token, customer_name, email, amount_fcfa, status, shipping_method, shipping_address, shipping_zone, ship_paid_mail_at, ship_note, order_items(id, product_id, product_name, delivery_type, quantity, status)")
    .eq("id", orderId).maybeSingle();
  if (!o || !o.email) return { sent: false, reason: "commande_introuvable" };
  // deno-lint-ignore no-explicit-any
  const phys = ((o.order_items ?? []) as any[]).filter((i) => i.delivery_type === "physical" && i.status !== "cancelled");
  if (!phys.length) return { sent: false, reason: "pas_de_produit_physique" };
  if (["pending", "cancelled"].includes(o.status)) return { sent: false, reason: "paiement_non_valide" };
  if (!(Deno.env.get("RESEND_API_KEY") ?? "").trim()) return { sent: false, reason: "resend_non_configure" };
  if (stage === "paid") { // réserve l'envoi (pas de doublon)
    const { data: claim } = await db.from("orders").update({ ship_paid_mail_at: new Date().toISOString() }).eq("id", o.id).is("ship_paid_mail_at", null).select("id");
    if (!claim?.length) return { sent: false, reason: "deja_envoye" };
  }
  const { site, wa } = siteCtx();
  const link = site + "/commande.html?o=" + encodeURIComponent(o.public_token);
  const first = firstName(o.customer_name);
  const list = phys.map((i) => (i.quantity > 1 ? i.quantity + " × " : "") + i.product_name);
  const where = [o.shipping_address, o.shipping_zone].filter(Boolean).join(", ");
  const how = o.shipping_method === "bus" ? "par bus (vous récupérez le colis à la gare routière)" : o.shipping_method === "home" ? "à domicile" : "";
  const btn = (href: string, label: string) => `<p style="text-align:center;margin:22px 0"><a href="${esc(href)}" style="display:inline-block;background:${EM.O};color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">${esc(label)}</a></p>`;
  const P = (t: string) => `<p style="margin:0 0 12px;line-height:1.6">${t}</p>`;
  const items = `<ul style="margin:0 0 12px;padding-left:20px;line-height:1.6">${list.map((x) => "<li>" + esc(x) + "</li>").join("")}</ul>`;
  const hello = P("Bonjour" + (first ? " " + esc(first) : "") + ",");
  let subject = "", html = "", text = "";
  if (stage === "paid") {
    subject = "Commande payée : livraison sous " + SHIP_DAYS_TXT + " — commande " + o.ref;
    html = hello + P(`Votre paiement de <b>${esc(fcfaTxt(o.amount_fcfa))}</b> est bien reçu : votre commande <b>${esc(o.ref)}</b> est confirmée.`) + items +
      P(`📦 <b>Livraison sous ${SHIP_DAYS_TXT}</b>${how ? " " + esc(how) : ""}${where ? ", à : <b>" + esc(where) + "</b>" : ""}. Nous vous appelons sur WhatsApp avant de passer.`) +
      btn(link, "Suivre ma commande") + P("Une erreur dans l'adresse ? Répondez à cet email ou écrivez-nous sur WhatsApp.") + waButtonHtml(wa);
    text = "Bonjour" + (first ? " " + first : "") + ",\n\nVotre paiement de " + fcfaTxt(o.amount_fcfa) + " est bien reçu : votre commande " + o.ref + " est confirmée.\n\n" + list.join("\n") +
      "\n\nLivraison sous " + SHIP_DAYS_TXT + (how ? " " + how : "") + (where ? ", à : " + where : "") + ".\n\nSuivre ma commande : " + link + "\n\nWhatsApp : https://wa.me/" + wa;
  } else if (stage === "shipping") {
    subject = "Votre commande est en route 🚚 — commande " + o.ref;
    html = hello + P(`Bonne nouvelle : votre commande <b>${esc(o.ref)}</b> est en cours d'expédition.`) + items +
      (o.ship_note ? P("ℹ️ " + esc(o.ship_note)) : "") +
      P(`${where ? "Adresse de livraison : <b>" + esc(where) + "</b>. " : ""}Gardez votre téléphone à portée de main : le livreur vous appelle avant de passer.`) +
      btn(link, "Suivre ma commande") + waButtonHtml(wa);
    text = "Bonjour" + (first ? " " + first : "") + ",\n\nVotre commande " + o.ref + " est en cours d'expédition.\n\n" + list.join("\n") + (o.ship_note ? "\n\n" + o.ship_note : "") +
      (where ? "\n\nAdresse de livraison : " + where : "") + "\n\nSuivre ma commande : " + link;
  } else {
    const avis = link + "&avis=1";
    subject = "Commande livrée ✔ Votre avis compte — commande " + o.ref;
    html = hello + P(`Votre commande <b>${esc(o.ref)}</b> a bien été livrée. Merci pour votre confiance !`) + items +
      P("Votre avis aide d'autres clients à acheter en confiance. Cela prend 30 secondes : une note de 1 à 5 étoiles et, si vous le souhaitez, quelques mots.") +
      P("🎁 En plus, votre avis validé vous rapporte 50 points fidélité : jusqu'à 20 % de réduction sur vos prochaines commandes.") +
      btn(avis, "⭐ Donner mon avis") + P("Un souci avec votre produit ? Répondez à cet email ou écrivez-nous sur WhatsApp, on s'en occupe.") + waButtonHtml(wa);
    text = "Bonjour" + (first ? " " + first : "") + ",\n\nVotre commande " + o.ref + " a bien été livrée. Merci pour votre confiance !\n\n" + list.join("\n") +
      "\n\nDonner mon avis (30 secondes) : " + avis + "\nVotre avis validé vous rapporte 50 points fidélité : jusqu'à 20 % de réduction sur vos prochaines commandes." + "\n\nUn souci ? WhatsApp : https://wa.me/" + wa;
  }
  text += footerText(o.ref);
  const r = await resendSend(o.email, { subject, html: wrapHtml(html, o.ref), text, headers: { "X-Entity-Ref-ID": o.ref + "-" + stage } });
  if (!r.ok) { if (stage === "paid") await db.from("orders").update({ ship_paid_mail_at: null }).eq("id", o.id); return { sent: false, reason: "envoi_echoue" }; }
  if (stage === "done") await db.from("orders").update({ review_asked_at: new Date().toISOString() }).eq("id", o.id);
  await logEvent("info", "livraison", stage === "paid" ? "Email « commande payée » envoyé" : stage === "shipping" ? "Email « expédition en cours » envoyé" : "Email « livrée + avis » envoyé", {}, o.ref);
  return { sent: true };
}

// Livre une commande : clés / identifiants du stock + liens à usage unique + services à traiter
async function deliver(orderId: string, force = false, emails = true) {
  const tokens = Array.from({ length: 30 }, () => newToken());
  const { data, error } = await db.rpc("deliver_order_v3", { p_order_id: orderId, p_tokens: tokens, p_days: LINK_DAYS, p_force: force });
  if (error) throw new Error(error.message);
  // commande entièrement livrée → email automatique au client (une seule fois)
  if (emails) await sendOrderEmails(orderId, data?.reason);
  return data as { ok: boolean; reason: string };
}

// Livre les commandes payées qui attendaient du stock pour ce produit (les plus anciennes d'abord)
// Unités de stock par produit : clés à usage unique + activations restantes des clés multi-postes.
// Une clé réutilisable sans limite rend le produit « illimité » (unlimited).
async function keyUnitsRaw(ids: string[]) {
  const out: Record<string, { units: number; unlimited: boolean }> = {};
  if (!ids.length) return out;
  const { data } = await db.from("license_keys").select("id, product_id, reusable, max_uses")
    .in("product_id", ids).eq("status", "available").is("source_key_id", null).limit(20000);
  const multi = (data ?? []).filter((k) => k.reusable && k.max_uses);
  const used: Record<string, number> = {};
  if (multi.length) {
    const { data: cp } = await db.from("license_keys").select("source_key_id").in("source_key_id", multi.map((k) => k.id)).limit(100000);
    for (const c of cp ?? []) used[c.source_key_id] = (used[c.source_key_id] ?? 0) + 1;
  }
  for (const k of data ?? []) {
    const o = out[k.product_id] ??= { units: 0, unlimited: false };
    if (!k.reusable) o.units += 1;
    else if (k.max_uses) o.units += Math.max(0, k.max_uses - (used[k.id] ?? 0));
    else o.unlimited = true;
  }
  return out;
}

// Packs : un produit « pack » regroupe plusieurs produits (table product_bundle_items).
// Unités d'un pack = le plus petit stock de ses produits (divisé par la quantité de chacun).
async function keyUnits(ids: string[]) {
  const out: Record<string, { units: number; unlimited: boolean; pack?: boolean }> = {};
  if (!ids.length) return out;
  const { data: b } = await db.from("product_bundle_items").select("bundle_id, component_id, qty").in("bundle_id", ids);
  const packs: Record<string, { component_id: string; qty: number }[]> = {};
  for (const r of b ?? []) (packs[r.bundle_id] ??= []).push(r);
  // stock commun : un produit peut prendre ses clés dans le stock d'un autre (products.key_source_id)
  const need = [...new Set([...ids.filter((id) => !packs[id]), ...(b ?? []).map((r) => r.component_id)])];
  const { data: srcRows } = need.length ? await db.from("products").select("id, key_source_id").in("id", need) : { data: [] };
  const srcOf: Record<string, string> = Object.fromEntries((srcRows ?? []).map((p) => [p.id, p.key_source_id || p.id]));
  const raw0 = await keyUnitsRaw([...new Set(need.map((id) => srcOf[id] ?? id))]);
  const raw: Record<string, { units: number; unlimited: boolean }> = {};
  for (const id of need) if (raw0[srcOf[id] ?? id]) raw[id] = raw0[srcOf[id] ?? id];
  for (const id of ids) {
    if (packs[id]) {
      let units = Infinity, unlimited = true;
      for (const r of packs[id]) {
        const u = raw[r.component_id] ?? { units: 0, unlimited: false };
        if (!u.unlimited) { unlimited = false; units = Math.min(units, Math.floor(u.units / Math.max(1, r.qty))); }
      }
      out[id] = { units: unlimited ? 0 : units, unlimited, pack: true };
    } else if (raw[id]) out[id] = raw[id];
  }
  return out;
}
async function deliverWaiting(productId: string) {
  // les packs qui contiennent ce produit attendent peut-être aussi ces clés
  // stock commun : les produits qui prennent leurs clés dans ce stock attendent peut-être aussi
  const { data: sh } = await db.from("products").select("id").eq("key_source_id", productId);
  const prods = [productId, ...(sh ?? []).map((r) => r.id)];
  const { data: pk } = await db.from("product_bundle_items").select("bundle_id").in("component_id", prods);
  const { data } = await db.from("order_items").select("order_id, orders!inner(paid_at, status)")
    .in("product_id", [...prods, ...(pk ?? []).map((r) => r.bundle_id)]).eq("status", "waiting_stock").limit(200);
  // deno-lint-ignore no-explicit-any
  const ids = [...new Set((data ?? []).sort((a: any, b: any) => String(a.orders.paid_at).localeCompare(String(b.orders.paid_at))).map((r) => r.order_id))];
  let n = 0;
  for (const id of ids) {
    const r = await deliver(id);
    if (r.reason === "out_of_stock") break;
    n++;
  }
  return n;
}

// ================= Notifications : ce qui attend une action de l'admin =================
type Notif = { kind: string; level: "urgent" | "info"; text: string; count: number; tab: string };
// ================= Boîte de réception : type de l'expéditeur =================
// Client (adresse dans la base clients) · Ancien client (« Avant le site ») · Partenaire (parrain ou domaine partenaire) · Visiteur (le reste).
// Un type choisi à la main dans l'admin (table inbox_contacts, SQL 69) passe toujours avant le type automatique.
const CONTACT_KINDS = ["client", "ancien", "partenaire", "visiteur"];
const DEFAULT_PARTNER_DOMAINS = ["facebookmail.com", "facebook.com", "meta.com", "instagram.com", "google.com", "cloudflare.com", "supabase.com", "resend.com"];
async function partnerDomains(): Promise<string[]> {
  const { data } = await db.from("settings").select("value").eq("key", "inbox_partner_domains").maybeSingle();
  return Array.isArray(data?.value) ? (data!.value as unknown[]).map((d) => String(d).toLowerCase()).filter(Boolean) : DEFAULT_PARTNER_DOMAINS;
}
function cleanDomains(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.map(String) : String(v ?? "").split(/[\s,;]+/);
  const out = raw.map((d) => d.trim().toLowerCase().replace(/^.*@/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
    .filter((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d));
  return [...new Set(out)].slice(0, 200);
}
function domainIsPartner(email: string, domains: string[]) {
  const d = email.split("@")[1] ?? "";
  return domains.find((p) => d === p || d.endsWith("." + p)) ?? null;
}
// deno-lint-ignore no-explicit-any
async function inChunks(table: string, cols: string, col: string, values: string[]): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (let i = 0; i < values.length; i += 80) {
    const { data } = await db.from(table).select(cols).in(col, values.slice(i, i + 80)).limit(20000);
    out.push(...(data ?? []));
  }
  return out;
}
type ContactInfo = { type: string; auto: string; manual: string | null; purchases: number; orders: number; account: boolean; legacy: string | null; parrain: string | null; domain: string | null };
async function classifyContacts(emailsIn: string[]): Promise<{ info: Record<string, ContactInfo>; domains: string[] }> {
  const emails = [...new Set(emailsIn.map((e) => String(e).toLowerCase()).filter(Boolean))];
  const domains = await partnerDomains();
  if (!emails.length) return { info: {}, domains };
  const [orders, accs, legacy, prs, manual] = await Promise.all([
    inChunks("orders", "email, status, paid_at", "email", emails),
    inChunks("customers", "email", "email", emails),
    inChunks("legacy_customers", "email, category, category_label", "email", emails),
    inChunks("parrains", "email, name", "email", emails),
    inChunks("inbox_contacts", "email, kind", "email", emails), // table absente avant le SQL 69 : liste vide, rien ne casse
  ]);
  const info: Record<string, ContactInfo> = {};
  for (const e of emails) info[e] = { type: "visiteur", auto: "visiteur", manual: null, purchases: 0, orders: 0, account: false, legacy: null, parrain: null, domain: null };
  for (const o of orders) { const c = info[String(o.email).toLowerCase()]; if (!c) continue; c.orders++; if (o.paid_at && o.status !== "cancelled") c.purchases++; }
  for (const a of accs) { const c = info[String(a.email).toLowerCase()]; if (c) c.account = true; }
  for (const l of legacy) { const c = info[String(l.email).toLowerCase()]; if (c) c.legacy = (l.category + " " + (l.category_label ?? "")).trim(); }
  for (const p of prs) { const c = info[String(p.email).toLowerCase()]; if (c) c.parrain = p.name || "parrain"; }
  for (const m of manual) { const c = info[String(m.email).toLowerCase()]; if (c && CONTACT_KINDS.includes(m.kind)) c.manual = m.kind; }
  for (const [e, c] of Object.entries(info)) {
    c.domain = domainIsPartner(e, domains);
    c.auto = c.orders || c.account ? "client" : c.legacy ? "ancien" : (c.parrain || c.domain) ? "partenaire" : "visiteur";
    c.type = c.manual ?? c.auto;
  }
  return { info, domains };
}

async function buildNotifications(): Promise<Notif[]> {
  const n: Notif[] = [];
  const [{ data: items }, { data: prods }, { data: pays }, { count: revs }, { count: errs }, { data: st }, { data: manualPaid }] = await Promise.all([
    db.from("order_items").select("status, product_name, claim_requested_at, orders!inner(ref, status)").in("status", ["waiting_stock", "to_process"]).neq("orders.status", "cancelled").limit(2000),
    db.from("products").select("id, name, active, delivery_type, low_stock_threshold, stock_qty"),
    db.from("payouts").select("amount_fcfa").eq("status", "to_pay"),
    db.from("product_reviews").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("app_logs").select("id", { count: "exact", head: true }).eq("level", "error").eq("seen", false),
    db.from("settings").select("key, value").in("key", ["admin_email", "auto_delivery"]),
    db.from("orders").select("ref").eq("status", "pending").not("payment_ref", "is", null).neq("payment_method", "paydunya").limit(200),
  ]);
  const set = Object.fromEntries((st ?? []).map((r) => [r.key, r.value]));
  const toProcess = (items ?? []).filter((i) => i.status === "to_process");
  const waiting = (items ?? []).filter((i) => i.status === "waiting_stock");
  // deno-lint-ignore no-explicit-any
  const refs = (arr: any[]) => [...new Set(arr.map((i) => i.orders?.ref).filter(Boolean))];
  if (manualPaid?.length) n.push({ kind: "manual_payment", level: "urgent", count: manualPaid.length, tab: "orders",
    text: manualPaid.length + " client(s) disent avoir payé par Wave / Orange Money : vérifiez et validez (" + manualPaid.slice(0, 3).map((o) => o.ref).join(", ") + ")" });
  if (toProcess.length) n.push({ kind: "to_process", level: "urgent", count: refs(toProcess).length, tab: "orders",
    text: refs(toProcess).length + " commande(s) à traiter par vous (service, produit physique ou livraison auto coupée)" });
  if (waiting.length) {
    const byProd: Record<string, number> = {};
    for (const i of waiting) byProd[i.product_name] = (byProd[i.product_name] ?? 0) + 1;
    n.push({ kind: "key_requests", level: "urgent", count: waiting.length, tab: "keys",
      text: waiting.length + " demande(s) de clé en attente faute de stock : " + Object.entries(byProd).map(([p, c]) => p + " (" + c + ")").join(", ") });
  }
  // stock bas : clés (non réutilisables) et produits physiques
  const stockProds = (prods ?? []).filter((p) => p.active && STOCK_TYPES.includes(p.delivery_type));
  const units = await keyUnits(stockProds.map((p) => p.id));
  const low: string[] = [];
  for (const p of stockProds) {
    const u = units[p.id] ?? { units: 0, unlimited: false };
    if (u.unlimited || u.pack) continue; // pack : l'alerte vient de ses produits
    if (u.units <= (p.low_stock_threshold ?? 0)) low.push(p.name + " (" + u.units + ")");
  }
  for (const p of (prods ?? []).filter((p) => p.active && p.delivery_type === "physical" && p.stock_qty != null)) {
    if (p.stock_qty <= (p.low_stock_threshold ?? 0)) low.push(p.name + " (" + p.stock_qty + " en stock)");
  }
  if (low.length) n.push({ kind: "low_stock", level: "urgent", count: low.length, tab: "keys", text: "Stock bas : " + low.join(", ") });
  if (pays?.length) n.push({ kind: "payouts", level: "urgent", count: pays.length, tab: "parrains",
    text: pays.length + " versement(s) parrain à faire : " + fcfaTxt(pays.reduce((s, p) => s + (p.amount_fcfa || 0), 0)) });
  const { data: unread } = await db.from("inbox_messages").select("customer_email").eq("direction", "in").eq("status", "new").limit(1000);
  const who = [...new Set((unread ?? []).map((m) => m.customer_email))];
  if (who.length) {
    const { info } = await classifyContacts(who);
    const cnt: Record<string, number> = {};
    for (const e of who) { const t = info[e]?.type ?? "visiteur"; cnt[t] = (cnt[t] ?? 0) + 1; }
    const LBL: Record<string, string> = { client: "client", ancien: "ancien client", partenaire: "partenaire", visiteur: "visiteur" };
    const parts = CONTACT_KINDS.filter((k) => cnt[k]).map((k) => cnt[k] + " " + LBL[k] + (cnt[k] > 1 ? "s" : ""));
    n.push({ kind: "messages", level: cnt.client || cnt.ancien ? "urgent" : "info", count: who.length, tab: "messages", text: "Message(s) non lu(s) : " + parts.join(", ") });
  }
  if (revs) n.push({ kind: "reviews", level: "info", count: revs, tab: "reviews", text: revs + " avis client(s) à valider" });
  if (errs) n.push({ kind: "errors", level: "urgent", count: errs, tab: "logs", text: errs + " erreur(s) non lue(s) dans le journal" });
  if (!(Deno.env.get("PAYDUNYA_MASTER_KEY") ?? "").trim()) n.push({ kind: "paydunya", level: "info", count: 1, tab: "settings",
    text: "Paiement en ligne pas encore actif : les clés PayDunya ne sont pas dans Supabase" });
  if (!set.admin_email) n.push({ kind: "admin_email", level: "info", count: 1, tab: "settings",
    text: "Ajoutez votre email d'alerte dans Réglages pour recevoir le rapport du lundi et les alertes" });
  if (set.auto_delivery === false) n.push({ kind: "auto_off", level: "info", count: 1, tab: "settings", text: "La livraison automatique est désactivée" });
  return n;
}

// ================= Rapport de la semaine (email du lundi) =================
async function buildReport() {
  const now = Date.now(), since = new Date(now - 7 * DAY).toISOString(), prev = new Date(now - 14 * DAY).toISOString();
  const paidSt = ["paid", "processing", "installing", "delivered"];
  const [{ data: ords }, { data: items }, { data: views }, { count: newCust }, { count: errs }, notifs] = await Promise.all([
    db.from("orders").select("ref, status, amount_fcfa, paid_at, created_at").gte("created_at", prev).limit(10000),
    db.from("order_items").select("product_name, quantity, unit_price, status, orders!inner(paid_at)").gte("orders.paid_at", since).limit(10000),
    db.from("page_views").select("visitor, created_at").gte("created_at", since).limit(50000),
    db.from("customers").select("id", { count: "exact", head: true }).gte("created_at", since),
    db.from("app_logs").select("id", { count: "exact", head: true }).eq("level", "error").gte("created_at", since),
    buildNotifications(),
  ]);
  const paid = (ords ?? []).filter((o) => paidSt.includes(o.status) && o.paid_at);
  const week = paid.filter((o) => o.paid_at >= since), before = paid.filter((o) => o.paid_at < since && o.paid_at >= prev);
  const sum = (a: { amount_fcfa: number }[]) => a.reduce((s, o) => s + (o.amount_fcfa || 0), 0);
  const ca = sum(week), caPrev = sum(before);
  const agg: Record<string, { q: number; ca: number }> = {};
  for (const i of items ?? []) if (i.status !== "cancelled") { agg[i.product_name] ??= { q: 0, ca: 0 }; agg[i.product_name].q += i.quantity; agg[i.product_name].ca += i.quantity * i.unit_price; }
  const top = Object.entries(agg).sort((a, b) => b[1].ca - a[1].ca).slice(0, 5);
  const visitors = new Set((views ?? []).map((v) => v.visitor)).size;
  const unpaid = (ords ?? []).filter((o) => o.status === "pending" && o.created_at >= since).length;
  const evo = caPrev ? Math.round((ca - caPrev) / caPrev * 100) : null;
  const d = (iso: number) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  const period = "du " + d(now - 7 * DAY) + " au " + d(now - DAY);
  const kpi = (l: string, v: string) => `<td style="padding:10px;background:#eff5ff;border-radius:10px;text-align:center"><div style="font-size:12px;color:#5b6b86">${esc(l)}</div><div style="font-size:20px;font-weight:900">${esc(v)}</div></td>`;
  const html = `<h2 style="margin:0 0 4px">Votre semaine sur licenceoff.com</h2><p style="margin:0 0 16px;color:#5b6b86">${esc(period)}</p>
<table role="presentation" width="100%" cellspacing="6" cellpadding="0"><tr>${kpi("Ventes", fcfaTxt(ca))}${kpi("Commandes payées", String(week.length))}</tr><tr>${kpi("Visiteurs", String(visitors))}${kpi("Nouveaux comptes clients", String(newCust ?? 0))}</tr></table>
<p style="margin:12px 0">${evo === null ? "" : (evo >= 0 ? "📈 +" : "📉 ") + evo + " % par rapport à la semaine d'avant (" + esc(fcfaTxt(caPrev)) + "). "}${unpaid ? unpaid + " commande(s) créée(s) mais pas payée(s)." : ""}</p>
<h3 style="margin:18px 0 6px">Produits les plus vendus</h3>${top.length ? "<ol style=\"margin:0;padding-left:20px\">" + top.map(([p, v]) => `<li><b>${esc(p)}</b> : ${v.q} vendu(s), ${esc(fcfaTxt(v.ca))}</li>`).join("") + "</ol>" : "<p style=\"margin:0\">Pas de vente cette semaine.</p>"}
<h3 style="margin:18px 0 6px">À faire</h3>${notifs.length ? "<ul style=\"margin:0;padding-left:20px\">" + notifs.map((x) => `<li style="margin-bottom:4px">${x.level === "urgent" ? "🔴 " : "🔵 "}${esc(x.text)}</li>`).join("") + "</ul>" : "<p style=\"margin:0\">Rien à faire, tout est en ordre ✔</p>"}
${errs ? `<p style="margin:14px 0 0">⚠️ ${errs} erreur(s) cette semaine : voir l'onglet Journal de l'admin.</p>` : ""}
<p style="text-align:center;margin:22px 0 0"><a href="${esc(siteCtx().site)}/admin" style="display:inline-block;background:${EM.O};color:#fff;font-weight:800;text-decoration:none;padding:12px 20px;border-radius:10px">Ouvrir l'admin</a></p>`;
  const text = "Votre semaine sur licenceoff.com (" + period + ")\nVentes : " + fcfaTxt(ca) + " (" + week.length + " commandes payées)\nVisiteurs : " + visitors +
    "\nNouveaux comptes : " + (newCust ?? 0) + "\n\nProduits les plus vendus :\n" + (top.map(([p, v]) => "- " + p + " : " + v.q + " vendu(s)").join("\n") || "- aucun") +
    "\n\nÀ faire :\n" + (notifs.map((x) => "- " + x.text).join("\n") || "- rien") + "\n\nAdmin : " + siteCtx().site + "/admin";
  return { subject: "Rapport de la semaine : " + fcfaTxt(ca) + " de ventes — licenceoff.com", html: wrapHtml(html), text };
}
async function sendReport(trigger: string) {
  const { data: st } = await db.from("settings").select("value").eq("key", "admin_email").maybeSingle();
  const to = String(st?.value ?? "").trim();
  if (!to) { await logEvent("warn", "rapport", "Rapport de la semaine non envoyé : aucun email d'alerte dans Réglages"); return { ok: false, reason: "pas_d_email" }; }
  const mail = await buildReport();
  const r = await resendSend(to, mail);
  if (r.ok) {
    await db.from("settings").upsert({ key: "report_last_sent", value: new Date().toISOString(), updated_at: new Date().toISOString() });
    await logEvent("info", "rapport", "Rapport de la semaine envoyé (" + trigger + ")");
  }
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch (_) { return json({ error: "bad_json" }, 400); }

  // Tâche planifiée du lundi (pg_cron) : jeton interne aléatoire stocké dans settings.cron_secret
  if (body?.action === "weekly_report" && body.cron) {
    const { data: cs } = await db.from("settings").select("value").eq("key", "cron_secret").maybeSingle();
    const secret = String(cs?.value ?? "");
    if (!secret || !safeEqual(String(body.cron), secret)) return json({ error: "unauthorized" }, 401);
    const { data: on } = await db.from("settings").select("key, value").in("key", ["weekly_report", "report_last_sent"]);
    const set = Object.fromEntries((on ?? []).map((r) => [r.key, r.value]));
    if (set.weekly_report === false) return json({ ok: true, skipped: "desactive" });
    if (set.report_last_sent && Date.now() - new Date(String(set.report_last_sent)).getTime() < 5 * DAY) return json({ ok: true, skipped: "deja_envoye" });
    try { return json(await sendReport("automatique, lundi")); } catch (e) { await logEvent("error", "rapport", "Le rapport du lundi a échoué", e); return json({ error: "erreur" }, 500); }
  }

  const expected = (Deno.env.get("ADMIN_PASSWORD") ?? "").trim();
  const given = (req.headers.get("x-admin-password") ?? "").trim();
  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim().slice(0, 64);
  // Anti-essais en rafale : 10 mauvais mots de passe en 15 min depuis une adresse → cette adresse est bloquée 15 min ;
  // 100 en 1 h au total (attaque depuis beaucoup d'adresses) → l'admin est fermé 1 h pour tout le monde.
  // Même le bon mot de passe est refusé pendant le blocage (sinon le blocage ne servirait à rien).
  const [{ count: ipFails }, { count: allFails }] = await Promise.all([
    db.from("admin_login_failures").select("id", { count: "exact", head: true }).eq("ip", ip || "?").gte("created_at", new Date(Date.now() - 15 * 60_000).toISOString()),
    db.from("admin_login_failures").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 3600_000).toISOString()),
  ]);
  if ((ipFails ?? 0) >= 10 || (allFails ?? 0) >= 100) {
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: "bloque", detail: (allFails ?? 0) >= 100 ? "global" : "adresse" }, 429);
  }
  if (!expected || !safeEqual(given, expected)) {
    if (given) await db.from("admin_login_failures").insert({ ip: ip || "?" }).then(() => {}, () => {});
    // on note les mauvais mots de passe (au plus 1 ligne par minute pour ne pas remplir le journal)
    if (given) {
      const { count } = await db.from("app_logs").select("id", { count: "exact", head: true }).eq("source", "connexion").eq("level", "warn")
        .like("message", "Mot de passe admin%").gte("created_at", new Date(Date.now() - 60_000).toISOString());
      if (!count) await logEvent("warn", "connexion", "Mot de passe admin incorrect", { adresse_ip: ip || null, navigateur: (req.headers.get("user-agent") ?? "").slice(0, 160) });
    }
    await new Promise((r) => setTimeout(r, 800));
    return json({ error: "unauthorized" }, 401);
  }

  try {
    switch (body.action) {
      // ================= Tableau de bord =================
      case "dashboard": {
        const { data: prods } = await db.from("products").select("id, name, active, delivery_type, low_stock_threshold").order("name");
        const stockProds = (prods ?? []).filter((p) => STOCK_TYPES.includes(p.delivery_type));
        const { data: keys } = await db.from("license_keys").select("product_id, status")
          .in("product_id", stockProds.map((p) => p.id)).limit(20000);
        const units = await keyUnits(stockProds.map((p) => p.id));
        const stock = stockProds.map((p) => ({
          id: p.id, name: p.name, active: p.active, threshold: p.low_stock_threshold,
          available: units[p.id]?.units ?? 0, // clés à usage unique + activations restantes des clés multi-postes
          sent: (keys ?? []).filter((k) => k.product_id === p.id && k.status === "sent").length,
          reusable: !!units[p.id]?.unlimited,
        }));
        const since = new Date(Date.now() - 31 * DAY).toISOString();
        const { data: recent } = await db.from("orders")
          .select("ref, customer_name, status, amount_fcfa, created_at, paid_at, delivered_at, channel, campaign").gte("created_at", since)
          .order("created_at", { ascending: false }).limit(5000);
        const { data: top } = await db.from("order_items").select("product_name, quantity, unit_price, status, orders!inner(paid_at)")
          .gte("orders.paid_at", since).limit(5000);
        const { data: visits } = await db.rpc("visit_stats");
        const { data: openPay } = await db.from("payouts").select("amount_fcfa, parrains(name)").eq("status", "to_pay");
        const { count: reviewsPending } = await db.from("product_reviews").select("id", { count: "exact", head: true }).eq("status", "pending");
        const notifications = await buildNotifications().catch((e) => { logEvent("error", "admin", "Calcul des notifications impossible", e); return []; });
        return json({ stock, orders: recent ?? [], items: top ?? [], visits: visits ?? null, payouts: openPay ?? [], reviews_pending: reviewsPending ?? 0, notifications });
      }
      case "notifications": {
        return json({ notifications: await buildNotifications() });
      }
      case "sales_origin": { // ventes payées par origine : semaine / mois / année
        const days = { week: 7, month: 30, year: 365 }[String(body.period)] ?? 30;
        const since = new Date(Date.now() - days * DAY).toISOString();
        const { data, error } = await db.from("orders").select("channel, campaign, amount_fcfa")
          .in("status", ["paid", "processing", "installing", "delivered"]).gte("paid_at", since).limit(20000);
        if (error) return json({ error: error.message }, 500);
        return json({ days, rows: data ?? [] });
      }

      // ================= Messages des clients =================
      case "inbox_list": { // une ligne par client (dernier message), filtre : nouveaux / tous / archivés
        const box = ["new", "all", "archived"].includes(body.box) ? body.box : "all";
        const { data, error } = await db.from("inbox_messages").select("id, created_at, direction, status, customer_email, customer_name, subject, body_text, order_ref, auto_reply")
          .order("created_at", { ascending: false }).limit(2000);
        if (error) return json({ error: error.message }, 500);
        const s = str(body.q, 80).toLowerCase();
        // deno-lint-ignore no-explicit-any
        const conv: Record<string, any> = {};
        for (const m of data ?? []) {
          const c = conv[m.customer_email] ??= { email: m.customer_email, name: null, last: m, unread: 0, count: 0, archived: true, order_ref: null };
          c.count++;
          if (!c.name && m.customer_name) c.name = m.customer_name;
          if (!c.order_ref && m.order_ref) c.order_ref = m.order_ref;
          if (m.direction === "in" && m.status === "new") c.unread++;
          if (m.direction === "in" && m.status !== "archived") c.archived = false;
        }
        let rows = Object.values(conv).map((c) => ({ ...c, last: { ...c.last, body_text: String(c.last.body_text ?? "").slice(0, 160) } }));
        if (box === "new") rows = rows.filter((c) => c.unread > 0);
        else if (box === "archived") rows = rows.filter((c) => c.archived);
        else rows = rows.filter((c) => !c.archived);
        if (s) rows = rows.filter((c) => (c.email + " " + (c.name ?? "") + " " + (c.order_ref ?? "") + " " + (c.last.subject ?? "")).toLowerCase().includes(s));
        const { info, domains } = await classifyContacts(rows.map((c) => c.email));
        rows = rows.map((c) => ({ ...c, contact: info[c.email] }));
        const counts: Record<string, number> = { client: 0, ancien: 0, partenaire: 0, visiteur: 0 };
        for (const c of rows) counts[c.contact?.type ?? "visiteur"]++;
        if (CONTACT_KINDS.includes(body.type)) rows = rows.filter((c) => (c.contact?.type ?? "visiteur") === body.type);
        return json({ rows: rows.slice(0, 300), counts, partner_domains: domains });
      }
      case "inbox_thread": {
        const email = str(body.email, 200).toLowerCase();
        const [{ data: msgs }, { data: orders }, { data: cust }] = await Promise.all([
          db.from("inbox_messages").select("*").eq("customer_email", email).order("created_at").limit(500),
          db.from("orders").select("ref, status, amount_fcfa, created_at, phone, customer_name, order_items(product_name, quantity)").eq("email", email).order("created_at", { ascending: false }).limit(20),
          db.from("customers").select("name, phone, created_at, last_login_at").eq("email", email).maybeSingle(),
        ]);
        await db.from("inbox_messages").update({ status: "read" }).eq("customer_email", email).eq("direction", "in").eq("status", "new");
        const { info } = await classifyContacts([email]);
        return json({ messages: msgs ?? [], orders: orders ?? [], customer: cust ?? null, contact: info[email] ?? null });
      }
      case "inbox_contact_set": { // marquer un contact à la main (Client / Ancien client / Partenaire / Visiteur), ou revenir au type automatique
        const email = str(body.email, 200).toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return json({ error: "email_invalide" }, 400);
        const kind = str(body.kind, 20);
        if (!kind) {
          const { error } = await db.from("inbox_contacts").delete().eq("email", email);
          if (error) return json({ error: error.message }, 500);
        } else {
          if (!CONTACT_KINDS.includes(kind)) return json({ error: "type_inconnu" }, 400);
          const { error } = await db.from("inbox_contacts").upsert({ email, kind, name: str(body.name, 120) || null, updated_at: new Date().toISOString() });
          if (error) return json({ error: /inbox_contacts/.test(error.message) ? "sql_69_manquant" : error.message }, 500);
        }
        await logEvent("info", "messages", "Type du contact " + email + " : " + (kind || "automatique"));
        const { info } = await classifyContacts([email]);
        return json({ ok: true, contact: info[email] });
      }
      case "inbox_partners_set": { // liste des domaines partenaires (Facebook, Google, fournisseurs…)
        const domains = cleanDomains(body.domains);
        const { error } = await db.from("settings").upsert({ key: "inbox_partner_domains", value: domains, updated_at: new Date().toISOString() });
        if (error) return json({ error: error.message }, 500);
        await logEvent("info", "messages", "Domaines partenaires mis à jour (" + domains.length + ")");
        return json({ ok: true, domains });
      }
      case "inbox_status": { // archiver / remettre en non lu une conversation
        const email = str(body.email, 200).toLowerCase();
        const status = ["new", "read", "archived"].includes(body.status) ? body.status : "read";
        let q = db.from("inbox_messages").update({ status }).eq("customer_email", email).eq("direction", "in");
        if (status === "new") q = q.neq("status", "replied");
        const { error } = await q;
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
      case "inbox_send": { // répondre (ou écrire) au client depuis contact@licenceoff.com
        const email = str(body.email, 200).toLowerCase();
        const text = String(body.text ?? "").replace(/\r/g, "").trim().slice(0, 10000);
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return json({ error: "email_invalide" }, 400);
        if (!text) return json({ error: "message_vide" }, 400);
        const { data: lastIn } = await db.from("inbox_messages").select("subject, message_id, order_ref, customer_name").eq("customer_email", email).eq("direction", "in")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        let subject = str(body.subject, 200) || (lastIn?.subject ? (/^re\s*:/i.test(lastIn.subject) ? lastIn.subject : "Re: " + lastIn.subject) : "Message de licenceoff.com");
        subject = subject.slice(0, 250);
        const headers: Record<string, string> = {};
        if (lastIn?.message_id) { headers["In-Reply-To"] = lastIn.message_id; headers["References"] = lastIn.message_id; }
        const paras = text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px;line-height:1.6">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
        const r = await resendSend(email, { subject, html: wrapHtml(paras), text: text + "\n\n" + SLOGAN, headers },
          "contact@licenceoff.com", "licenceoff.com <contact@licenceoff.com>");
        if (!r.ok) return json({ error: r.reason }, 502);
        const { data: cust } = await db.from("customers").select("id").eq("email", email).maybeSingle();
        await db.from("inbox_messages").insert({ direction: "out", status: "read", customer_email: email, customer_name: lastIn?.customer_name ?? null, customer_id: cust?.id ?? null,
          to_email: email, subject, body_text: text, in_reply_to: lastIn?.message_id ?? null, order_ref: str(body.order_ref, 30) || lastIn?.order_ref || null });
        await db.from("inbox_messages").update({ status: "replied" }).eq("customer_email", email).eq("direction", "in").in("status", ["new", "read"]);
        return json({ ok: true });
      }

      // ================= Journal =================
      case "logs_list": {
        let q = db.from("app_logs").select("*").order("id", { ascending: false }).limit(200);
        if (["info", "warn", "error"].includes(body.level)) q = q.eq("level", body.level);
        if (body.source) q = q.eq("source", str(body.source, 30));
        if (Number(body.before) > 0) q = q.lt("id", Number(body.before));
        const s = str(body.q, 80).replace(/[,()*]/g, " ").trim();
        if (s) q = q.or(`message.ilike.*${s}*,order_ref.ilike.*${s}*`);
        const { data, error } = await q;
        if (error) return json({ error: error.message }, 500);
        const { count } = await db.from("app_logs").select("id", { count: "exact", head: true }).eq("level", "error").eq("seen", false);
        return json({ rows: data, unseen_errors: count ?? 0 });
      }
      case "logs_seen": {
        const { error } = await db.from("app_logs").update({ seen: true }).eq("seen", false);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
      case "report_send": {
        const r = await sendReport("manuel, depuis l'admin");
        if (!r.ok) return json({ error: r.reason }, 400);
        return json({ ok: true });
      }

      // ================= Commandes =================
      case "orders_list": {
        let q = db.from("orders")
          .select("*, order_items(id, product_id, product_name, delivery_type, unit_price, quantity, status, created_at, claim_requested_at, manual_link_url, manual_link_sent_at, license_keys(key_value, note, added_at, product_id, products(name)), downloads(token, status, download_count, max_downloads, expires_at, created_at))")
          .order("created_at", { ascending: false }).limit(300);
        if (body.status) q = q.eq("status", str(body.status, 20));
        const s = str(body.q, 80).replace(/[,()*]/g, " ").trim();
        if (s) q = q.or(`ref.ilike.*${s}*,customer_name.ilike.*${s}*,email.ilike.*${s}*,phone.ilike.*${s}*`);
        const [{ data, error }, { data: all }] = await Promise.all([q, db.from("orders").select("status").limit(50000)]);
        if (error) return json({ error: error.message }, 500);
        const counts: Record<string, number> = {};
        for (const r of all ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1;
        return json({ rows: data, counts });
      }

      case "order_create": { // vente faite par WhatsApp / en direct (plusieurs articles possibles)
        const c = await createAdminOrder(body);
        if (c instanceof Response) return c;
        const result = body.deliver === true ? await deliver(c.o.id) : null;
        return json({ order: c.o, result });
      }

      case "manual_send": { // vente WhatsApp : clé(s) du stock + email au modèle du produit, enregistrée comme commande
        const c = await createAdminOrder({ ...body, name: str(body.name, 100) || "Client WhatsApp", items: [{ product_id: body.product_id, qty: body.qty }] });
        if (c instanceof Response) return c;
        if (body.mode === "locked") { // clé verrouillée : commande en attente, email sans la clé
          await db.from("order_items").update({ claim_requested_at: new Date().toISOString() }).eq("order_id", c.o.id); // au déblocage : la clé directement
          await db.from("orders").update({ key_locked: true, payment_ref: str(body.payment_ref, 100) || null }).eq("id", c.o.id);
          const units = await keyUnits([str(body.product_id, 40)]);
          const u = units[str(body.product_id, 40)];
          const stock = u?.unlimited ? 9999 : u?.units ?? 0;
          const email = body.send_email === false ? null : await sendLockedEmail(c.o.id);
          return json({ order: c.o, locked: true, stock, email });
        }
        // « clé directement » : on saute l'étape du lien de téléchargement (produit en 2 temps)
        if (body.mode === "key") await db.from("order_items").update({ claim_requested_at: new Date().toISOString() }).eq("order_id", c.o.id);
        const result = await deliver(c.o.id, true, body.send_email !== false); // emails automatiques (installation ou clé)
        const { data: o2 } = await db.from("orders").select("emailed_at, order_items(id, status, install_emailed_at, license_keys(key_value, products(name)))").eq("id", c.o.id).maybeSingle();
        // deno-lint-ignore no-explicit-any
        const its = (o2?.order_items ?? []) as any[];
        // deno-lint-ignore no-explicit-any
        const keys = its.flatMap((i) => (i.license_keys ?? []).map((k: any) => k.key_value));
        const email = body.send_email === false ? null
          : result?.reason === "awaiting_install" ? { sent: its.some((i) => i.install_emailed_at), kind: "install" }
          : { sent: !!o2?.emailed_at, kind: "key" };
        return json({ order: c.o, result, keys, email, items: its.map((i) => ({ id: i.id, status: i.status })) });
      }

      case "template_send": { // envoyer un modèle seul à une adresse (sans clé ni commande)
        const to = str(body.to, 200).toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(to)) return json({ error: "email_invalide" }, 400);
        const { data: prod } = body.product_id ? await db.from("products").select("name, price_fcfa, email_template_id").eq("id", str(body.product_id, 40)).maybeSingle() : { data: null };
        const { data: t } = prod?.email_template_id ? await db.from("email_templates").select("id, subject, body").eq("id", prod.email_template_id).maybeSingle()
          : await db.from("email_templates").select("id, subject, body").eq("is_default", true).eq("kind", "key").maybeSingle();
        const tpl: Tpl = t ?? BUILTIN_TPL; // le modèle du produit, sinon le modèle par défaut
        const { site, wa } = siteCtx();
        const pname = prod?.name ?? str(body.product_name, 120);
        const mail = renderEmail(tpl, {
          o: { ref: str(body.ref, 40) || "—", customer_name: str(body.name, 100) || "", amount_fcfa: Number(body.amount_fcfa) || prod?.price_fcfa || 0 },
          items: pname ? [{ product_name: pname, delivery_type: "manual", quantity: 1, status: "delivered", license_keys: [] }] : [],
          link: site, wa,
        });
        const r = await resendSend(to, mail);
        if (!r.ok) return json({ error: r.reason }, 400);
        return json({ ok: true });
      }

      case "order_validate": { // "J'ai reçu le paiement" → livraison automatique
        await db.from("orders").update({ key_locked: false }).eq("id", body.id).eq("status", "pending");
        if (body.payment_ref) {
          await db.from("orders").update({ payment_ref: str(body.payment_ref, 100) }).eq("id", body.id).eq("status", "pending");
        }
        // silent : livraison sans email au client (ex. vente à un revendeur, PDF d'instructions envoyé à la main)
        return json({ result: body.silent === true ? await deliver(body.id, true, false) : await deliver(body.id) });
      }

      case "item_send_link": { // 📎 produit « d'exception » : l'admin envoie le lien du logiciel à la main
        const url = str(body.url, 1000).trim();
        if (!/^https:\/\/\S+$/i.test(url)) return json({ error: "lien_invalide" }, 400);
        const { data: it } = await db.from("order_items")
          .select("id, order_id, product_name, delivery_type, status, orders(id, ref, public_token, customer_name, email, status)")
          .eq("id", str(body.id, 40)).maybeSingle();
        if (!it) return json({ error: "commande_introuvable" }, 404);
        // deno-lint-ignore no-explicit-any
        const ord = it.orders as any;
        if (!ord || ord.status === "cancelled") return json({ error: "commande_annulee" }, 400);
        if (ord.status === "pending") return json({ error: "paiement_non_valide" }, 400);
        await db.from("order_items").update({ manual_link_url: url, manual_link_sent_at: new Date().toISOString() }).eq("id", it.id);
        if (it.delivery_type === "file" && it.status === "to_process") await db.rpc("complete_order_item", { p_item_id: it.id });
        let email = { sent: false } as { sent: boolean; reason?: string };
        if ((Deno.env.get("RESEND_API_KEY") ?? "").trim() && ord.email) {
          const { site, wa } = siteCtx();
          const page = site + "/commande.html?o=" + encodeURIComponent(ord.public_token);
          const P = (t: string) => `<p style="margin:0 0 12px;line-height:1.6">${t}</p>`;
          const html = P(esc(hello(ord.customer_name))) +
            P(`Voici le lien pour télécharger <b>${esc(it.product_name)}</b> (commande <b>${esc(ord.ref)}</b>) :`) +
            `<p style="text-align:center;margin:22px 0"><a href="${esc(url)}" style="display:inline-block;background:${EM.O};color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">⬇ Télécharger le logiciel</a></p>` +
            P(`Le lien est aussi sur <a href="${esc(page)}">votre page de commande</a>. Besoin d'aide pour l'installation ? Répondez à cet email ou écrivez-nous sur WhatsApp.`) + waButtonHtml(wa);
          const r = await resendSend(ord.email, { subject: "Votre logiciel " + it.product_name + " — commande " + ord.ref, html: wrapHtml(html, ord.ref),
            text: hello(ord.customer_name) + "\n\nTélécharger " + it.product_name + " : " + url + "\n\nVotre page de commande : " + page + "\n\nAssistance WhatsApp : https://wa.me/" + wa + footerText(ord.ref),
            headers: { "X-Entity-Ref-ID": ord.ref + "-lien" } });
          email = r.ok ? { sent: true } : { sent: false, reason: "envoi_echoue" };
        }
        await logEvent("info", "livraison", "Lien du logiciel envoyé à la main", { produit: it.product_name }, ord.ref);
        return json({ ok: true, email });
      }

      case "ship_start": { // 🚚 produit physique : expédition en cours → email au client
        const { data: o } = await db.from("orders").select("id, status, order_items(delivery_type, status)").eq("id", str(body.id, 40)).maybeSingle();
        if (!o) return json({ error: "commande_introuvable" }, 404);
        if (o.status === "pending") return json({ error: "paiement_non_valide" }, 400);
        if (o.status === "cancelled") return json({ error: "commande_annulee" }, 400);
        // deno-lint-ignore no-explicit-any
        if (!((o.order_items ?? []) as any[]).some((i) => i.delivery_type === "physical" && i.status === "to_process")) return json({ error: "rien_a_expedier" }, 400);
        await db.from("orders").update({ ship_started_at: new Date().toISOString(), ship_note: str(body.note, 300) || null }).eq("id", o.id);
        const email = await sendShipEmail(o.id, "shipping");
        return json({ ok: true, email });
      }

      case "ship_done": { // 📦 produit physique livré → email de confirmation avec demande d'avis
        const { data: o } = await db.from("orders").select("id, status, order_items(id, delivery_type, status)").eq("id", str(body.id, 40)).maybeSingle();
        if (!o) return json({ error: "commande_introuvable" }, 404);
        if (o.status === "pending") return json({ error: "paiement_non_valide" }, 400);
        if (o.status === "cancelled") return json({ error: "commande_annulee" }, 400);
        // deno-lint-ignore no-explicit-any
        const todo = ((o.order_items ?? []) as any[]).filter((i) => i.delivery_type === "physical" && i.status === "to_process");
        if (!todo.length) return json({ error: "rien_a_expedier" }, 400);
        for (const i of todo) {
          const { data, error } = await db.rpc("complete_order_item", { p_item_id: i.id });
          if (error) return json({ error: error.message }, 500);
          if (!data.ok) return json({ error: data.reason }, 400);
        }
        await db.from("orders").update({ ship_done_at: new Date().toISOString() }).eq("id", o.id);
        const email = await sendShipEmail(o.id, "done");
        return json({ ok: true, email });
      }

      case "ship_email": { // renvoyer l'email de l'étape actuelle
        const stage = ["paid", "shipping", "done"].includes(body.stage) ? body.stage : "paid";
        if (stage === "paid") await db.from("orders").update({ ship_paid_mail_at: null }).eq("id", str(body.id, 40));
        const r = await sendShipEmail(str(body.id, 40), stage);
        if (!r.sent) return json({ error: r.reason }, 400);
        return json({ ok: true });
      }

      case "order_deliver_now": { // livraison automatique désactivée : l'admin livre lui-même (clés du stock + liens)
        return json({ result: await deliver(body.id, true) });
      }

      case "client_lookup": { // envoi manuel : nom et téléphone d'un client déjà connu, à partir de son email
        const email = str(body.email, 200).toLowerCase().trim();
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return json({ found: false });
        const [{ data: c }, { data: o }] = await Promise.all([
          db.from("customers").select("name, phone").eq("email", email).maybeSingle(),
          db.from("orders").select("customer_name, phone, billing_company, billing_address").eq("email", email).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        ]);
        const real = (n?: string | null) => n && !/^client (whatsapp|facebook)$/i.test(n.trim()) ? n : ""; // pas le nom par défaut
        const name = real(c?.name) || real(o?.customer_name), phone = c?.phone || o?.phone || "";
        return json({ found: !!(name || phone), name, phone, company: o?.billing_company ?? "", address: o?.billing_address ?? "" });
      }

      case "order_invoice_send": { // envoyer la facture au client par email
        const { data: o } = await db.from("orders").select("ref, public_token, invoice_no, customer_name, email, amount_fcfa, status").eq("id", str(body.id, 40)).maybeSingle();
        if (!o) return json({ error: "not_found" }, 404);
        if (!o.invoice_no) return json({ error: "pas_de_facture" }, 400);
        const url = siteCtx().site + "/facture.html?o=" + encodeURIComponent(o.public_token);
        const html = `<p style="margin:0 0 12px">${esc(hello(o.customer_name))}</p>
<p style="margin:0 0 12px">Voici la facture <b>${esc(o.invoice_no)}</b> de votre commande ${esc(o.ref)} (${esc(fcfaTxt(o.amount_fcfa))}).</p>
<p style="margin:0 0 16px">Vous pouvez l'afficher, l'imprimer ou l'enregistrer en PDF avec le bouton « Télécharger en PDF / Imprimer ».</p>
<p style="text-align:center;margin:22px 0"><a href="${esc(url)}" style="display:inline-block;background:${EM.O};color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">Voir la facture</a></p>
<p style="margin:0">Merci pour votre confiance.</p>`;
        const text = hello(o.customer_name) + "\n\nVoici la facture " + o.invoice_no + " de votre commande " + o.ref + " (" + fcfaTxt(o.amount_fcfa) + ").\nVoir et télécharger la facture : " + url + "\n\nMerci pour votre confiance." + footerText(o.ref);
        const r = await resendSend(o.email, { subject: "Votre facture " + o.invoice_no + " — commande " + o.ref, html: wrapHtml(html, o.ref), text, headers: { "X-Entity-Ref-ID": o.ref } });
        if (!r.ok) return json({ error: r.reason }, 400);
        return json({ ok: true, to: o.email });
      }

      case "order_update_client": { // corriger le nom / la société / l'adresse du client (facture)
        const patch: Record<string, string | null> = {};
        if (body.name != null) { const n = str(body.name, 100); if (n.length < 2) return json({ error: "nom_invalide" }, 400); patch.customer_name = n; }
        if (body.company != null) patch.billing_company = str(body.company, 120) || null;
        if (body.address != null) patch.billing_address = str(body.address, 300) || null;
        if (body.phone != null) patch.phone = str(body.phone, 30).replace(/[^\d+]/g, "") || null;
        const { error } = await db.from("orders").update(patch).eq("id", str(body.id, 40));
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "order_cancel": { // n'importe quel état ; restock = remettre les clés envoyées dans le stock
        const { data, error } = await db.rpc("cancel_order", { p_order_id: str(body.id, 40), p_restock: body.restock === true });
        if (error) return json({ error: error.message }, 500);
        if (!data?.ok) return json({ error: data?.reason ?? "erreur" }, 400);
        return json(data);
      }

      case "item_complete": { // service traité à la main → livré
        const { data, error } = await db.rpc("complete_order_item", { p_item_id: body.id });
        if (error) return json({ error: error.message }, 500);
        if (!data.ok) return json({ error: data.reason }, 400);
        const { data: it } = await db.from("order_items").select("order_id").eq("id", body.id).maybeSingle();
        const email = it ? await sendDeliveryEmail(it.order_id).catch(() => null) : null;
        return json({ ok: true, email });
      }

      case "item_send_key_now": { // livraison en 2 temps : envoyer la clé sans attendre le clic du client
        const { data: it, error } = await db.from("order_items").update({ claim_requested_at: new Date().toISOString() })
          .eq("id", body.id).eq("status", "awaiting_install").select("order_id");
        if (error) return json({ error: error.message }, 500);
        if (!it?.length) return json({ error: "pas_en_installation" }, 400);
        return json({ result: await deliver(it[0].order_id, true) });
      }

      case "item_release_component": { // pack : libérer la clé d'UN produit du pack (décision de l'admin), email avec cette clé seulement
        const { data: it } = await db.from("order_items")
          .select("id, order_id, product_id, product_name, delivery_type, quantity, status, created_at, orders(id, ref, public_token, invoice_no, customer_name, email, amount_fcfa, status)")
          .eq("id", str(body.id, 40)).maybeSingle();
        if (!it) return json({ error: "commande_introuvable" }, 400);
        // deno-lint-ignore no-explicit-any
        const ord = it.orders as any;
        if (!ord || ord.status === "cancelled") return json({ error: "commande_annulee" }, 400);
        if (ord.status === "pending") return json({ error: "paiement_non_valide" }, 400); // aucune clé tant que le paiement n'est pas validé
        if (!["awaiting_install", "waiting_stock", "to_process", "pending"].includes(it.status)) return json({ error: "deja_livre" }, 400);
        const { data: comp } = await db.from("product_bundle_items").select("component_id, qty")
          .eq("bundle_id", it.product_id).eq("component_id", str(body.component_id, 40)).maybeSingle();
        if (!comp) return json({ error: "pas_dans_le_pack" }, 400);
        const { data: cprod } = await db.from("products").select("name, email_template_id").eq("id", comp.component_id).maybeSingle();
        const need = it.quantity * comp.qty;
        const { data: got, error: ek } = await db.rpc("take_keys", { p_item: it.id, p_product: comp.component_id, p_qty: need });
        if (ek) return json({ error: ek.message }, 500);
        if ((got ?? 0) < need) return json({ error: "out_of_stock" }, 400);
        // toutes les clés du pack sont libérées → livraison normale de l'article (statut, email récapitulatif)
        const { data: all } = await db.from("product_bundle_items").select("component_id, qty").eq("bundle_id", it.product_id);
        const { data: ks } = await db.from("license_keys").select("key_value, product_id, products(name)").eq("order_item_id", it.id);
        const done = (all ?? []).every((c) => (ks ?? []).filter((k) => k.product_id === c.component_id).length >= it.quantity * c.qty);
        if (done) {
          await db.from("order_items").update({ claim_requested_at: new Date().toISOString() }).eq("id", it.id).is("claim_requested_at", null);
          return json({ ok: true, all: true, result: await deliver(it.order_id, true) });
        }
        // email avec la clé de ce produit seulement (modèle du produit, sinon le modèle par défaut)
        const cp = cprod ?? { name: "", email_template_id: null };
        const { data: tpls } = await db.from("email_templates").select("id, subject, body, is_default, kind");
        const tpl: Tpl = (tpls ?? []).find((t) => t.id === cp.email_template_id) ?? (tpls ?? []).find((t) => t.is_default && t.kind !== "install") ?? BUILTIN_TPL;
        const { site, wa } = siteCtx();
        const keys = (ks ?? []).filter((k) => k.product_id === comp.component_id);
        const mail = renderEmail(tpl, { o: ord, link: site + "/commande.html?o=" + encodeURIComponent(ord.public_token), wa,
          items: [{ product_name: cp.name || it.product_name, delivery_type: "key", quantity: it.quantity, status: "delivered", license_keys: keys }] });
        const r = body.send_email === false ? { ok: false, reason: "non_demande" } : await resendSend(ord.email, mail);
        await logEvent("info", "admin", "Clé d'un pack libérée", { commande: ord.ref, produit: cp.name });
        return json({ ok: true, all: false, email: r.ok ? { sent: true } : { sent: false, reason: (r as { reason?: string }).reason } });
      }

      case "item_new_link": {
        const { data, error } = await db.rpc("new_item_link", { p_item_id: body.id, p_token: newToken(), p_days: LINK_DAYS });
        if (error) return json({ error: error.message }, 500);
        if (!data.ok) return json({ error: data.reason }, 400);
        return json({ ok: true });
      }

      case "order_email": { // (re)envoyer l'email de livraison au client (ou l'email d'installation si le client installe)
        const { data: oo } = await db.from("orders").select("status").eq("id", body.id).maybeSingle();
        const r = oo?.status === "installing" ? await sendInstallEmail(body.id, true) : await sendDeliveryEmail(body.id, true);
        if (!r.sent) return json({ error: r.reason }, 400);
        return json({ ok: true });
      }

      // ===== PDF d'instructions « neutre » pour un revendeur (sans prix, sans n° de commande, sans adresse du site) =====
      case "order_instructions": {
        const { data: o } = await db.from("orders")
          .select("id, email, customer_name, order_items(id, product_name, delivery_type, status, created_at, license_keys(key_value, products(name)), products(email_template_id, slug))")
          .eq("id", body.id).maybeSingle();
        if (!o) return json({ error: "commande_introuvable" }, 404);
        const { data: tpls } = await db.from("email_templates").select("id, body, is_default, kind");
        const byId = Object.fromEntries((tpls ?? []).map((t) => [t.id, t]));
        const def = (tpls ?? []).find((t) => t.is_default && t.kind !== "install");
        const items = ((o.order_items ?? []) as Item[]).filter((i) => i.status !== "cancelled" && (i.license_keys ?? []).length)
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
          .map((i) => ({
            product_name: i.product_name,
            url: i.products?.slug ? siteCtx().site + "/produit/" + encodeURIComponent(i.products.slug) : siteCtx().site,
            keys: (i.license_keys ?? []).map((k: { key_value: string }) => { const a = acctParts(k.key_value), label = keyLabel(i, k) || undefined; return a ? { login: a[0], password: a[1], label } : { key: k.key_value, label }; }),
            text: neutralInstructions(String((byId[i.products?.email_template_id] ?? def)?.body ?? ""), i.product_name),
          }));
        if (!items.length) return json({ error: "rien_a_livrer" }, 400);
        return json({ email: o.email, items });
      }

      case "order_instructions_send": { // envoie le PDF au revendeur (email de la commande) en pièce jointe
        const { data: o } = await db.from("orders").select("email").eq("id", body.id).maybeSingle();
        if (!o?.email) return json({ error: "commande_introuvable" }, 404);
        const pdf = String(body.pdf ?? "");
        if (!/^[A-Za-z0-9+/=]+$/.test(pdf) || pdf.length > 4_000_000) return json({ error: "pdf_invalide" }, 400);
        const fname = (str(body.filename, 80) || "instructions.pdf").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-") || "instructions.pdf";
        const prod = str(body.product, 120);
        const text = "Bonjour,\n\nVoici en pièce jointe le document d'instructions" + (prod ? " pour " + prod : "") + ", à transmettre tel quel à votre client.\nIl contient les identifiants et la procédure d'installation, sans prix ni numéro de commande.\n\nBonne vente !";
        const r = await resendSend(o.email, {
          subject: "Instructions à transmettre à votre client" + (prod ? " — " + prod : ""),
          html: wrapHtml(text.split("\n\n").map((p) => `<p style="margin:0 0 12px;line-height:1.6">${esc(p).replace(/\n/g, "<br>")}</p>`).join("")),
          text, attachments: [{ filename: fname.endsWith(".pdf") ? fname : fname + ".pdf", content: pdf }],
        });
        if (!r.ok) return json({ error: r.reason }, 400);
        return json({ ok: true, to: o.email });
      }

      case "review_request": { // ⭐ demande d'avis pour une commande livrée (manuel, renvoi possible)
        const { data: o } = await db.from("orders").select("id, ref, email, customer_name, public_token, status, order_items(id, product_id, product_name, status)").eq("id", body.id).maybeSingle();
        if (!o) return json({ error: "commande_introuvable" }, 404);
        const [x] = await reviewables([o]);
        if (!x) return json({ error: "rien_a_noter" }, 400);
        const r = await sendReviewRequest(x.o, x.items);
        if (!r.ok) return json({ error: r.reason }, 400);
        return json({ ok: true, to: o.email });
      }

      case "review_request_bulk": { // ⭐ envoi groupé : commandes livrées depuis 24 h, jamais relancées, sans avis
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { data, error } = await db.from("orders").select("id, ref, email, customer_name, public_token, status, order_items(id, product_id, product_name, status)")
          .eq("status", "delivered").is("review_asked_at", null).lte("delivered_at", since).order("delivered_at", { ascending: true }).limit(1000);
        if (error) return json({ error: error.message }, 500);
        const list = await reviewables(data ?? []);
        if (body.dry === true) return json({ count: list.length, batch: Math.min(list.length, REVIEW_BATCH) });
        let sent = 0, failed = 0;
        for (const x of list.slice(0, REVIEW_BATCH)) {
          const r = await sendReviewRequest(x.o, x.items);
          if (r.ok) sent++; else { failed++; if (r.reason === "resend_non_configure") break; }
          await new Promise((res) => setTimeout(res, 600)); // limite Resend : 2 emails / seconde
        }
        return json({ ok: true, sent, failed, remaining: Math.max(0, list.length - sent - failed) });
      }

      case "order_note": {
        const { error } = await db.from("orders").update({ note: str(body.note, 300) || null }).eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      // ================= Stock (clés, identifiants) =================
      case "keys_list": {
        let q = db.from("license_keys").select("*, order_items(product_name, orders(ref, customer_name))")
          .order("added_at", { ascending: false }).limit(500);
        if (body.product_id) q = q.eq("product_id", body.product_id);
        if (body.status) q = q.eq("status", str(body.status, 20));
        const { data, error } = await q;
        if (error) return json({ error: error.message }, 500);
        // clés réutilisables / multi-postes : nombre d'envois déjà faits
        const src = (data ?? []).filter((k) => k.reusable && !k.source_key_id).map((k) => k.id);
        const used: Record<string, number> = {};
        if (src.length) {
          const { data: cp } = await db.from("license_keys").select("source_key_id").in("source_key_id", src).limit(100000);
          for (const c of cp ?? []) used[c.source_key_id] = (used[c.source_key_id] ?? 0) + 1;
        }
        return json({ rows: (data ?? []).map((k) => src.includes(k.id) ? { ...k, uses: used[k.id] ?? 0 } : k) });
      }

      case "keys_import": {
        let { data: p } = await db.from("products").select("id, delivery_type, key_source_id").eq("id", body.product_id).maybeSingle();
        if (!p) return json({ error: "produit_introuvable" }, 400);
        // stock commun : les clés vont dans le stock du produit source (ex. clés Windows 10 Pro → stock Windows 11 Pro)
        if (p.key_source_id) ({ data: p } = await db.from("products").select("id, delivery_type, key_source_id").eq("id", p.key_source_id).maybeSingle());
        if (!p) return json({ error: "produit_introuvable" }, 400);
        if (!STOCK_TYPES.includes(p.delivery_type)) return json({ error: "produit_sans_stock" }, 400);
        const { count: isPack } = await db.from("product_bundle_items").select("bundle_id", { count: "exact", head: true }).eq("bundle_id", p.id);
        if (isPack) return json({ error: "pack_sans_stock" }, 400); // un pack prend les clés de ses produits
        const note = str(body.note, 200) || null; // origine de la clé (fournisseur, lot…) ; la date et l'heure de saisie sont automatiques
        // clé multi-postes : nombre d'activations (ex. 5 ou 10 appareils) ; vide = usage unique ou illimitée
        const maxUses = Number(body.max_uses) >= 1 ? clamp(Math.floor(Number(body.max_uses)), 1, 100000) : null;
        // produit « Identifiants » : « adresse ; mot de passe » (ou séparés par une tabulation) devient « Identifiant : … | Mot de passe : … »
        const acct = (l: string) => { const m = l.match(/^([^\s;|]+@[^\s;|]+)\s*[;\t]\s*(.+)$/); return m ? "Identifiant : " + m[1] + " | Mot de passe : " + m[2] : l; };
        const lines = String(body.text ?? "").split(/[\r\n]+/).map((l) => l.trim()).map((l) => p.delivery_type === "stock" ? acct(l) : l).filter((l) => l.length >= 3 && l.length <= 500);
        const unique = [...new Set(lines)];
        if (!unique.length) return json({ error: "aucune_cle" }, 400);
        if (unique.length > 2000) return json({ error: "max_2000_par_import" }, 400);
        // doublons : déjà dans le stock de ce produit (les copies envoyées des clés réutilisables ne comptent pas)
        const { data: have } = await db.from("license_keys").select("key_value").eq("product_id", p.id).is("source_key_id", null).limit(50000);
        const known = new Set((have ?? []).map((k) => k.key_value));
        const fresh = unique.filter((k) => !known.has(k));
        const { data, error } = fresh.length
          ? await db.from("license_keys").insert(fresh.map((k) => ({ product_id: p.id, key_value: k, reusable: body.reusable === true || maxUses != null, max_uses: maxUses, note }))).select("id")
          : { data: [], error: null };
        if (error) return json({ error: error.message }, 500);
        const added = data?.length ?? 0;
        const delivered = await deliverWaiting(p.id);
        return json({ added, duplicates: unique.length - added, delivered });
      }

      case "key_set_status": {
        const status = body.status === "disabled" ? "disabled" : "available";
        const { data, error } = await db.from("license_keys").update({ status })
          .eq("id", body.id).neq("status", "sent").select("product_id");
        if (error) return json({ error: error.message }, 500);
        if (!data?.length) return json({ error: "cle_deja_envoyee" }, 400);
        const delivered = status === "available" ? await deliverWaiting(data[0].product_id) : 0;
        return json({ ok: true, delivered });
      }

      case "key_set_reusable": { // usage unique <-> réutilisable (clé encore en stock)
        const mu = Number(body.max_uses) >= 1 ? clamp(Math.floor(Number(body.max_uses)), 1, 100000) : null;
        const { data, error } = await db.from("license_keys").update({ reusable: body.reusable === true || mu != null, max_uses: mu })
          .eq("id", body.id).neq("status", "sent").is("source_key_id", null).select("product_id");
        if (error) return json({ error: error.message }, 500);
        if (!data?.length) return json({ error: "cle_deja_envoyee" }, 400);
        const delivered = body.reusable === true || mu != null ? await deliverWaiting(data[0].product_id) : 0;
        return json({ ok: true, delivered });
      }

      case "key_delete": {
        const { data, error } = await db.from("license_keys").delete().eq("id", body.id).neq("status", "sent").select("id");
        if (error) return json({ error: error.message }, 500);
        if (!data?.length) return json({ error: "cle_deja_envoyee" }, 400);
        return json({ ok: true });
      }

      // ================= Catégories =================
      case "categories_list": {
        const { data, error } = await db.from("categories").select("*").order("sort").order("name");
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data });
      }
      case "category_save": {
        const row = {
          name: str(body.name, 80), slug: slugify(str(body.slug, 80) || str(body.name, 80)),
          sort: clamp(Number(body.sort) || 0, 0, 1000), active: body.active !== false,
          parent_id: str(body.parent_id, 40) || null, description: str(body.description, 300) || null,
        };
        if (!row.name || !row.slug) return json({ error: "nom_obligatoire" }, 400);
        if (row.parent_id && row.parent_id === body.id) return json({ error: "parent_invalide" }, 400);
        if (row.parent_id) { // un seul niveau : la catégorie parente doit être principale
          const { data: par } = await db.from("categories").select("parent_id").eq("id", row.parent_id).maybeSingle();
          if (!par || par.parent_id) return json({ error: "parent_invalide" }, 400);
          if (body.id) { const { count } = await db.from("categories").select("id", { count: "exact", head: true }).eq("parent_id", body.id); if (count) return json({ error: "parent_invalide" }, 400); }
        }
        const r = body.id ? await db.from("categories").update(row).eq("id", body.id).select().single()
          : await db.from("categories").insert(row).select().single();
        if (r.error) return json({ error: r.error.message.includes("duplicate") ? "code_deja_utilise" : r.error.message }, 400);
        return json({ row: r.data });
      }
      case "product_delete": { // 🗑 brouillon jamais vendu : suppression définitive (avec ses clés encore en stock)
        const id = str(body.id, 40);
        const { data: p } = await db.from("products").select("id, name, active").eq("id", id).maybeSingle();
        if (!p) return json({ error: "produit_introuvable" }, 404);
        if (p.active) return json({ error: "produit_publie" }, 400);
        const cnt = async (t: string, col = "product_id") => (await db.from(t).select("id", { count: "exact", head: true }).eq(col, id)).count ?? 0;
        if (await cnt("order_items") || await cnt("orders") || await cnt("downloads")) return json({ error: "produit_vendu" }, 400);
        if (await cnt("products", "key_source_id")) return json({ error: "produit_source" }, 400);
        const { count: used } = await db.from("license_keys").select("id", { count: "exact", head: true }).eq("product_id", id).neq("status", "available");
        if (used) return json({ error: "produit_vendu" }, 400);
        const { data: gone } = await db.from("license_keys").delete().eq("product_id", id).select("id");
        const { error } = await db.from("products").delete().eq("id", id);
        if (error) return json({ error: error.message }, 500);
        await logEvent("warn", "produits", "Produit supprimé (brouillon)", { produit: p.name, cles_supprimees: gone?.length ?? 0 });
        return json({ ok: true, keys: gone?.length ?? 0 });
      }

      case "category_delete": { // les produits restent, sans catégorie
        const { error } = await db.from("categories").delete().eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      // ================= Produits =================
      case "products_list": {
        const [{ data, error }, { data: b }] = await Promise.all([
          db.from("products").select("*").order("sort").order("name"),
          db.from("product_bundle_items").select("bundle_id, component_id, qty"),
        ]);
        if (error) return json({ error: error.message }, 500);
        const bundles: Record<string, { component_id: string; qty: number }[]> = {};
        for (const r of b ?? []) (bundles[r.bundle_id] ??= []).push({ component_id: r.component_id, qty: r.qty });
        return json({ rows: (data ?? []).map((p) => ({ ...p, bundle: bundles[p.id] ?? [] })) });
      }
      case "product_status": { // publier / remettre en brouillon depuis la liste
        const id = str(body.id, 40);
        const { data: cur, error: e0 } = await db.from("products").select("id, price_fcfa").eq("id", id).maybeSingle();
        if (e0) return json({ error: e0.message }, 500);
        if (!cur) return json({ error: "introuvable" }, 404);
        const active = body.active === true;
        if (active && !(Number(cur.price_fcfa) > 0)) return json({ error: "prix_manquant" }, 400);
        const { error } = await db.from("products").update({ active }).eq("id", id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, active });
      }
      case "product_save": {
        // pack : liste des produits inclus (chacun avec sa quantité) ; le pack se livre en clés prises dans leurs stocks
        const bundle = Array.isArray(body.bundle) ? (body.bundle as { component_id?: string; qty?: number }[]).slice(0, 10)
          .map((r) => ({ component_id: str(r?.component_id, 40), qty: clamp(Math.floor(Number(r?.qty) || 1), 1, 10) }))
          .filter((r, k, a) => r.component_id && r.component_id !== body.id && a.findIndex((x) => x.component_id === r.component_id) === k) : null;
        if (bundle?.length) {
          const { data: comps } = await db.from("products").select("id, delivery_type").in("id", bundle.map((r) => r.component_id));
          const { data: nested } = await db.from("product_bundle_items").select("bundle_id").in("bundle_id", bundle.map((r) => r.component_id));
          if ((comps ?? []).length !== bundle.length || (comps ?? []).some((c) => !STOCK_TYPES.includes(c.delivery_type)) || (nested ?? []).length) return json({ error: "pack_invalide" }, 400);
          body.delivery_type = "key"; body.installer_path = null;
        }
        const dtype = DELIVERY_TYPES.includes(body.delivery_type) ? body.delivery_type : "key";
        // galerie : jusqu'à 3 photos en plus de la photo principale, seulement nos photos envoyées par l'admin ; chaque photo garde sa description
        const altsIn: unknown[] = Array.isArray(body.image_alts) ? body.image_alts : [];
        const galleryIn = (Array.isArray(body.gallery) ? body.gallery : []).map((u: unknown, i: number) => ({ u: str(u, 500), alt: str(altsIn[i + 1], 200) }))
          .filter((g: { u: string }) => g.u.startsWith(SUPABASE_URL + "/storage/v1/object/public/product-images/") && !/\s/.test(g.u)).slice(0, 3);
        const row = {
          slug: slugify(str(body.slug, 80) || str(body.name, 120)),
          name: str(body.name, 120),
          description: str(body.description, 5000) || null,
          image_url: str(body.image_url, 500) || null,
          // galerie : jusqu'à 3 photos en plus de la photo principale (liens https uniquement)
          gallery: galleryIn.map((g) => g.u),
          // description de chaque photo (texte alternatif : malvoyants, Google Images, IA), même ordre que [image_url, ...gallery]
          image_alts: [str(altsIn[0], 200), ...galleryIn.map((g) => g.alt)],
          category_id: str(body.category_id, 40) || null,
          price_fcfa: clamp(Number(body.price_fcfa) || 0, 0, 100_000_000),
          compare_price_fcfa: Number(body.compare_price_fcfa) > 0 ? clamp(Number(body.compare_price_fcfa), 0, 100_000_000) : null,
          delivery_type: dtype,
          // fichier dans l'espace privé, ou lien https:// externe (Google Drive, site de l'éditeur…)
          installer_path: ["key_file", "file"].includes(dtype) ? (str(body.installer_path, 500) || null) : null,
          stock_qty: dtype === "physical" && body.stock_qty !== "" && body.stock_qty != null ? clamp(Math.round(Number(body.stock_qty) || 0), 0, 1_000_000) : null,
          active: body.active !== false,
          featured: body.featured === true,
          auto_deliver: body.auto_deliver !== false,
          sort: clamp(Number(body.sort) || 0, 0, 10000),
          low_stock_threshold: clamp(Number(body.low_stock_threshold) || 0, 0, 10000),
          email_template_id: str(body.email_template_id, 40) || null,
          install_template_id: str(body.install_template_id, 40) || null,
          wholesale_price_fcfa: body.wholesale_price_fcfa === "" || body.wholesale_price_fcfa == null ? null : clamp(Math.round(Number(body.wholesale_price_fcfa) || 0), 0, 100_000_000),
          two_step: body.two_step === true,
          // produits « d'exception » : clé et/ou lien du logiciel envoyés à la main par l'admin
          manual_key: dtype !== "physical" && body.manual_key === true,
          manual_link: dtype !== "physical" && body.manual_link === true,
          // stock commun : prend ses clés dans le stock d'un autre produit (ex. Windows 10 Pro ← Windows 11 Pro)
          key_source_id: STOCK_TYPES.includes(dtype) && !bundle?.length && str(body.key_source_id, 40) && str(body.key_source_id, 40) !== body.id ? str(body.key_source_id, 40) : null,
          sku: str(body.sku, 60) || null,
          weight_g: Number(body.weight_g) > 0 ? clamp(Math.round(Number(body.weight_g)), 0, 10_000_000) : null,
          seo_title: str(body.seo_title, 120) || null,
          seo_description: str(body.seo_description, 320) || null,
        };
        if (!row.slug || !row.name) return json({ error: "nom_obligatoire" }, 400);
        if (row.key_source_id) { // un seul niveau : la source doit avoir son propre stock (pas un pack, pas elle-même liée)
          const { data: src } = await db.from("products").select("id, delivery_type, key_source_id").eq("id", row.key_source_id).maybeSingle();
          const { count: srcPack } = await db.from("product_bundle_items").select("bundle_id", { count: "exact", head: true }).eq("bundle_id", row.key_source_id);
          const { count: users } = body.id ? await db.from("products").select("id", { count: "exact", head: true }).eq("key_source_id", body.id) : { count: 0 };
          if (!src || src.key_source_id || srcPack || users || !STOCK_TYPES.includes(src.delivery_type)) return json({ error: "stock_source_invalide" }, 400);
        }
        if (["key_file", "file"].includes(dtype) && !row.installer_path && !row.manual_link) return json({ error: "fichier_obligatoire" }, 400); // lien envoyé à la main : pas de fichier
        if (row.installer_path && /^[a-z]+:/i.test(row.installer_path) && !/^https:\/\/[^\s]+$/i.test(row.installer_path)) return json({ error: "lien_invalide" }, 400);
        const r = body.id ? await db.from("products").update(row).eq("id", body.id).select().single()
          : await db.from("products").insert(row).select().single();
        if (r.error) return json({ error: r.error.message.includes("sku") ? "sku_deja_utilise" : r.error.message.includes("duplicate") ? "code_deja_utilise" : r.error.message }, 400);
        if (bundle) {
          await db.from("product_bundle_items").delete().eq("bundle_id", r.data.id);
          if (bundle.length) {
            const { error: eb } = await db.from("product_bundle_items").insert(bundle.map((x) => ({ bundle_id: r.data.id, ...x })));
            if (eb) return json({ error: eb.message }, 500);
          }
        }
        return json({ row: { ...r.data, bundle: bundle ?? [] } });
      }

      // ================= Avis clients =================
      case "reviews_list": {
        const { data, error } = await db.from("product_reviews")
          .select("id, name, rating, comment, reply, status, created_at, products(name, slug), order_items(orders(ref, email))")
          .order("created_at", { ascending: false }).limit(500);
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data });
      }
      case "review_set": {
        const patch: Record<string, unknown> = {};
        if (["pending", "approved", "hidden"].includes(body.status)) patch.status = body.status;
        if (body.reply !== undefined) patch.reply = str(body.reply, 1000) || null;
        const { error } = await db.from("product_reviews").update(patch).eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
      case "review_delete": {
        const { error } = await db.from("product_reviews").delete().eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      // ================= Paiements =================
      case "pay_get": return json(await payPublicState());
      case "pay_save": { // enregistre (chiffrées) les clés saisies ; un champ laissé vide garde l'ancienne valeur
        const id = str(body.provider, 20), def = PAY_PROVIDERS[id];
        if (!def) return json({ error: "integrateur_inconnu" }, 400);
        const { data: cur } = await db.from("payment_providers").select("secrets").eq("provider", id).maybeSingle();
        const secrets: Record<string, string> = { ...(cur?.secrets ?? {}) };
        const vals = (body.values && typeof body.values === "object") ? body.values : {};
        const changed: string[] = [];
        for (const [key] of def.fields) {
          const v = typeof vals[key] === "string" ? vals[key].trim() : "";
          if (!v) continue;
          if (v.length > 2000 || /\s/.test(v)) return json({ error: "cle_invalide", field: key }, 400);
          secrets[key] = await sealSecret(v); changed.push(key);
        }
        const { error } = await db.from("payment_providers").upsert({ provider: id, live: body.live === true, secrets, updated_at: new Date().toISOString() });
        if (error) return json({ error: error.message }, 500);
        await logEvent("info", "paiements", "Réglages " + def.name + " enregistrés" + (changed.length ? " (clés remplacées : " + changed.join(", ") + ")" : ""), { mode: body.live === true ? "réel" : "test" });
        return json(await payPublicState());
      }
      case "pay_clear": { // efface une clé (pour la ressaisir ou désactiver l'intégrateur)
        const id = str(body.provider, 20), def = PAY_PROVIDERS[id], key = str(body.field, 40);
        if (!def || !def.fields.some(([k]) => k === key)) return json({ error: "champ_inconnu" }, 400);
        const { data: cur } = await db.from("payment_providers").select("secrets").eq("provider", id).maybeSingle();
        const secrets = { ...(cur?.secrets ?? {}) }; delete secrets[key];
        await db.from("payment_providers").upsert({ provider: id, secrets, updated_at: new Date().toISOString() });
        const { data: m } = await db.from("settings").select("value").eq("key", "payment_mode").maybeSingle();
        if (m?.value === id) await db.from("settings").upsert({ key: "payment_mode", value: "whatsapp", updated_at: new Date().toISOString() });
        await logEvent("warn", "paiements", "Clé " + key + " de " + def.name + " effacée");
        return json(await payPublicState());
      }
      case "pay_mode": { // choisit le mode de paiement actif du site
        const mode = str(body.mode, 20);
        if (mode !== "whatsapp") {
          const st = await payPublicState(); const p = st.providers.find((x) => x.id === mode);
          if (!p) return json({ error: "integrateur_inconnu" }, 400);
          if (!p.ready) return json({ error: "integrateur_pas_branche" }, 400);
          if (!p.complete) return json({ error: "cles_manquantes" }, 400);
        }
        await db.from("settings").upsert({ key: "payment_mode", value: mode, updated_at: new Date().toISOString() });
        await logEvent("info", "paiements", "Mode de paiement du site : " + (mode === "whatsapp" ? "WhatsApp (paiement finalisé avec vous)" : PAY_PROVIDERS[mode].name));
        return json(await payPublicState());
      }

      // ================= Réglages =================
      case "settings_get": {
        const { data } = await db.from("settings").select("key, value").neq("key", "cron_secret");
        return json({ settings: Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) });
      }
      case "settings_set": {
        const allowed = ["auto_delivery", "payout_threshold", "default_discount_pct", "admin_email", "shipping_home_fcfa", "shipping_bus_fcfa", "weekly_report", "meta_pixel_id", "google_ads_id", "google_ads_purchase_label",
          "invoice_legal_name", "invoice_address", "invoice_phone", "invoice_email", "invoice_ninea", "invoice_rc", "invoice_vat_enabled"];
        // informations légales imprimées sur les factures et devis
        const TEXT_MAX: Record<string, number> = { invoice_legal_name: 100, invoice_address: 300, invoice_phone: 40, invoice_email: 200, invoice_ninea: 40, invoice_rc: 60 };
        const key = str(body.key, 40);
        if (!allowed.includes(key)) return json({ error: "reglage_inconnu" }, 400);
        let value: unknown = body.value === true;
        if (key === "payout_threshold") value = clamp(Math.round(Number(body.value) || 0), 0, 10_000_000);
        if (key === "default_discount_pct") value = clamp(Number(body.value) || 0, 0, 90);
        if (key === "shipping_home_fcfa" || key === "shipping_bus_fcfa") value = clamp(Math.round(Number(body.value) || 0), 0, 1_000_000);
        if (TEXT_MAX[key]) value = str(body.value, TEXT_MAX[key]);
        if (key === "meta_pixel_id") { value = str(body.value, 30).replace(/\s/g, ""); if (value && !/^\d{5,20}$/.test(value as string)) return json({ error: "pixel_invalide" }, 400); }
        if (key === "google_ads_id") { value = str(body.value, 30).replace(/\s/g, "").toUpperCase(); if (value && !/^AW-\d{6,15}$/.test(value as string)) return json({ error: "google_ads_invalide" }, 400); }
        if (key === "google_ads_purchase_label") { value = str(body.value, 60).replace(/\s/g, "").replace(/^AW-\d+\//i, ""); if (value && !/^[A-Za-z0-9_-]{4,40}$/.test(value as string)) return json({ error: "libelle_invalide" }, 400); }
        if (key === "admin_email") { value = str(body.value, 200).toLowerCase(); if (value && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(value as string)) return json({ error: "email_invalide" }, 400); }
        const { error } = await db.from("settings").upsert({ key, value, updated_at: new Date().toISOString() });
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      // ================= Parrains / revendeurs =================
      case "parrains_list": {
        const [{ data: prs }, { data: codes }, { data: orders }, { data: payouts }] = await Promise.all([
          db.from("parrains").select("*").order("created_at", { ascending: false }),
          db.from("referral_codes").select("*").order("created_at"),
          db.from("orders").select("parrain_id, paid_at, status, amount_fcfa, commission_fcfa").not("parrain_id", "is", null).limit(20000),
          db.from("payouts").select("*, parrains(name, payout_info, phone)").order("created_at", { ascending: false }).limit(500),
        ]);
        const rows = (prs ?? []).map((p) => {
          const os = (orders ?? []).filter((o) => o.parrain_id === p.id && o.paid_at && o.status !== "cancelled");
          const ps = (payouts ?? []).filter((x) => x.parrain_id === p.id);
          const earned = os.reduce((s, o) => s + o.commission_fcfa, 0);
          const out = ps.filter((x) => x.status !== "cancelled").reduce((s, x) => s + x.amount_fcfa, 0);
          return { ...p, codes: (codes ?? []).filter((c) => c.parrain_id === p.id), sales: os.length, revenue: os.reduce((s, o) => s + o.amount_fcfa, 0),
            earned, paid: ps.filter((x) => x.status === "paid").reduce((s, x) => s + x.amount_fcfa, 0),
            to_pay: ps.filter((x) => x.status === "to_pay").reduce((s, x) => s + x.amount_fcfa, 0), balance: earned - out };
        });
        return json({ rows, payouts });
      }
      case "parrain_save": {
        const row = { name: str(body.name, 100), email: str(body.email, 200).toLowerCase(), phone: str(body.phone, 30) || null,
          payout_info: str(body.payout_info, 120) || null, note: str(body.note, 300) || null, status: body.status === "suspended" ? "suspended" : "active" };
        if (row.name.length < 2) return json({ error: "nom_invalide" }, 400);
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(row.email)) return json({ error: "email_invalide" }, 400);
        if (body.id) {
          const { error } = await db.from("parrains").update(row).eq("id", body.id);
          if (error) return json({ error: String(error.message).includes("duplicate") ? "email_deja_utilise" : error.message }, 400);
          return json({ ok: true });
        }
        const { data: pr, error } = await db.from("parrains").insert(row).select().single();
        if (error) return json({ error: String(error.message).includes("duplicate") ? "email_deja_utilise" : error.message }, 400);
        // premier code : prénom en majuscules (+ chiffres si déjà pris), remise par défaut
        const { data: st } = await db.from("settings").select("value").eq("key", "default_discount_pct").maybeSingle();
        const pct = Number(st?.value ?? 10) || 10;
        const base = (row.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/)[0] || "PARRAIN").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "PARRAIN";
        for (let i = 0; i < 6; i++) {
          const code = i === 0 ? base : base + Math.floor(10 + Math.random() * 990);
          const { error: e2 } = await db.from("referral_codes").insert({ parrain_id: pr.id, code, discount_pct: pct, label: "Lien principal" });
          if (!e2) break;
        }
        return json({ ok: true, row: pr });
      }
      case "referral_code_admin": { // l'admin peut corriger la remise ou désactiver un code
        const pct = Math.min(90, Math.max(0, Number(body.discount_pct) || 0));
        const { error } = await db.from("referral_codes").update({ discount_pct: pct, active: body.active !== false }).eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
      case "payout_set": { // « Marquer payé » ou annuler une demande de versement
        const status = body.status === "paid" ? "paid" : "cancelled";
        const { data, error } = await db.from("payouts").update({ status, paid_at: status === "paid" ? new Date().toISOString() : null, note: str(body.note, 200) || null })
          .eq("id", body.id).eq("status", "to_pay").select("parrain_id");
        if (error) return json({ error: error.message }, 500);
        if (!data?.length) return json({ error: "deja_traite" }, 400);
        return json({ ok: true });
      }

      // ================= CRM : clients =================
      case "clients_list": {
        const { data: orders, error } = await db.from("orders")
          .select("ref, customer_name, email, phone, status, amount_fcfa, created_at, paid_at, ip, referral_code, source, order_items(product_name, quantity)")
          .order("created_at", { ascending: false }).limit(10000);
        if (error) return json({ error: error.message }, 500);
        // deno-lint-ignore no-explicit-any
        const by = new Map<string, any>();
        for (const o of orders ?? []) {
          const k = String(o.email).toLowerCase();
          if (!by.has(k)) by.set(k, { email: k, name: o.customer_name, phone: o.phone, ip: o.ip, orders: [], spent: 0, paid_orders: 0, codes: new Set(), first: o.created_at, last: o.created_at });
          const c = by.get(k);
          c.orders.push({ ref: o.ref, date: o.created_at, status: o.status, amount: o.amount_fcfa, code: o.referral_code, source: o.source, ip: o.ip,
            items: (o.order_items ?? []).map((i: { product_name: string; quantity: number }) => (i.quantity > 1 ? i.quantity + " × " : "") + i.product_name).join(", ") });
          if (o.paid_at && o.status !== "cancelled") { c.spent += o.amount_fcfa; c.paid_orders++; }
          if (o.referral_code) c.codes.add(o.referral_code);
          if (!c.phone && o.phone) c.phone = o.phone;
          if (!c.ip && o.ip) c.ip = o.ip;
          c.first = o.created_at;
        }
        // comptes clients : intérêts, favoris, produits vus, recherches (même sans commande)
        const [{ data: accs }, { data: favs }, { data: evs }, { data: prods }] = await Promise.all([
          db.from("customers").select("id, email, name, phone, interests, created_at, last_login_at").limit(10000),
          db.from("customer_favorites").select("customer_id, product_id").limit(50000),
          db.from("customer_events").select("customer_id, kind, product_id, query, created_at").not("customer_id", "is", null).order("created_at", { ascending: false }).limit(20000),
          db.from("products").select("id, name"),
        ]);
        const pName = Object.fromEntries((prods ?? []).map((p) => [p.id, p.name]));
        for (const a of accs ?? []) {
          const k = String(a.email).toLowerCase();
          if (!by.has(k)) by.set(k, { email: k, name: a.name ?? "", phone: a.phone, ip: null, orders: [], spent: 0, paid_orders: 0, codes: new Set(), first: a.created_at, last: a.created_at });
          const c = by.get(k);
          const ev = (evs ?? []).filter((e) => e.customer_id === a.id);
          c.account = { created_at: a.created_at, last_login_at: a.last_login_at, interests: a.interests ?? [],
            favorites: (favs ?? []).filter((f) => f.customer_id === a.id).map((f) => pName[f.product_id]).filter(Boolean),
            viewed: [...new Set(ev.filter((e) => e.kind === "view").map((e) => pName[e.product_id]).filter(Boolean))].slice(0, 10),
            searches: [...new Set(ev.filter((e) => e.kind === "search").map((e) => e.query))].slice(0, 10) };
        }
        // messages échangés (onglet Messages)
        //   un expéditeur qui n'a ni commande ni compte n'apparaît ici que si vous l'avez ajouté à vos clients (Messages > « Ajouter à mes clients »)
        const [{ data: msgs }, { data: marks }] = await Promise.all([
          db.from("inbox_messages").select("customer_email, customer_name, created_at").limit(20000),
          db.from("inbox_contacts").select("email, kind, name, updated_at").limit(20000),
        ]);
        const markBy = Object.fromEntries((marks ?? []).map((m) => [String(m.email).toLowerCase(), m]));
        const msgOnly: Record<string, number> = {}; // messages d'expéditeurs pas (encore) clients : comptés plus bas s'ils sont « Avant le site »
        for (const m of msgs ?? []) {
          if (!by.has(m.customer_email)) {
            if (markBy[m.customer_email]?.kind !== "client") { msgOnly[m.customer_email] = (msgOnly[m.customer_email] ?? 0) + 1; continue; }
            by.set(m.customer_email, { email: m.customer_email, name: markBy[m.customer_email].name || m.customer_name || "", phone: null, ip: null, orders: [], spent: 0, paid_orders: 0, codes: new Set(), first: m.created_at, last: m.created_at, from_inbox: true });
          }
          const c = by.get(m.customer_email); c.messages = (c.messages ?? 0) + 1;
        }
        // clients d'avant le site (relevés dans Gmail, SQL 65) : étiquette « Avant le site »
        const { data: legacy } = await db.from("legacy_customers").select("*").limit(10000);
        for (const l of legacy ?? []) {
          const k = String(l.email).toLowerCase();
          const first = l.first_contact ? l.first_contact + "T12:00:00Z" : l.imported_at;
          const last = l.last_contact ? l.last_contact + "T12:00:00Z" : first;
          if (!by.has(k)) by.set(k, { email: k, name: l.name ?? "", phone: l.phone, ip: null, orders: [], spent: 0, paid_orders: 0, codes: new Set(), first, last });
          const c = by.get(k);
          if (!c.name && l.name) c.name = l.name;
          if (!c.phone && l.phone) c.phone = l.phone;
          if (first < c.first) c.first = first;
          c.legacy = { category: l.category, label: l.category_label, product: l.product, device: l.device, activation: l.activation,
            first: l.first_contact, last: l.last_contact, exchanges: l.exchanges, replies: l.client_replies, links: l.links_sent, keys: l.keys_sent,
            paid: l.paid, email_valid: l.email_valid, notes: l.notes };
          if (msgOnly[k]) { c.messages = (c.messages ?? 0) + msgOnly[k]; delete msgOnly[k]; }
        }
        // consentement aux offres par email
        const { data: mk } = await db.from("marketing_contacts").select("email, optin, optin_at, unsub_at").limit(50000);
        const mkBy = Object.fromEntries((mk ?? []).map((m) => [m.email, m]));
        // points fidélité : solde de chaque client qui a déjà des points
        const { data: lp } = await db.from("loyalty_points").select("email").limit(50000);
        const pts: Record<string, number> = {};
        await Promise.all([...new Set((lp ?? []).map((r) => r.email))].map(async (e) => { const { data } = await db.rpc("loyalty_balance", { p_email: e }); pts[e] = Number(data) || 0; }));
        return json({ rows: [...by.values()].map((c) => ({ ...c, codes: [...c.codes], points: pts[c.email] ?? 0, marketing: mkBy[c.email]?.optin === true, marketing_at: mkBy[c.email]?.optin_at ?? null })) });
      }
      case "loyalty_history": { // 🎁 points fidélité d'un client : solde et mouvements
        const email = str(body.email, 200).toLowerCase();
        const [{ data: rows }, { data: bal }] = await Promise.all([db.rpc("loyalty_valid_rows", { p_email: email }), db.rpc("loyalty_balance", { p_email: email })]);
        // deno-lint-ignore no-explicit-any
        return json({ balance: Number(bal) || 0, rows: ((rows ?? []) as any[]).reverse().slice(0, 100) });
      }
      case "loyalty_adjust": { // 🎁 geste commercial ou correction : ajouter (+) ou retirer (−) des points à la main
        const email = str(body.email, 200).toLowerCase();
        const points = Math.trunc(Number(body.points));
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return json({ error: "email_invalide" }, 400);
        if (!points || Math.abs(points) > 100000) return json({ error: "points_invalides" }, 400);
        const note = str(body.note, 120) || (points > 0 ? "Geste commercial" : "Correction");
        const { error } = await db.from("loyalty_points").insert({ email, points, kind: "adjust", note });
        if (error) return json({ error: error.message }, 500);
        await logEvent("info", "fidelite", (points > 0 ? "+" : "") + points + " points fidélité pour " + email, { motif: note });
        const { data: bal } = await db.rpc("loyalty_balance", { p_email: email });
        return json({ ok: true, balance: Number(bal) || 0 });
      }
      case "email_stats": { // emails envoyés (7 jours, 30 jours, 12 mois, total) et inscrits aux offres
        const cnt = async (days?: number) => {
          let q = db.from("email_sends").select("id", { count: "exact", head: true });
          if (days) q = q.gte("created_at", new Date(Date.now() - days * DAY).toISOString());
          return (await q).count ?? 0;
        };
        const [w, m, y, all] = await Promise.all([cnt(7), cnt(30), cnt(365), cnt()]);
        const { count: optin } = await db.from("marketing_contacts").select("email", { count: "exact", head: true }).eq("optin", true);
        return json({ week: w, month: m, year: y, total: all, optin: optin ?? 0 });
      }

      // ================= Modèles d'email =================
      case "templates_list": {
        const { data, error } = await db.from("email_templates").select("*").order("is_default", { ascending: false }).order("name");
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data });
      }
      case "template_save": {
        const row = { name: str(body.name, 100), subject: str(body.subject, 200), body: str(body.body, 20000), kind: body.kind === "install" ? "install" : "key", updated_at: new Date().toISOString() };
        if (!row.name || !row.subject || !row.body) return json({ error: "modele_incomplet" }, 400);
        const r = body.id ? await db.from("email_templates").update(row).eq("id", body.id).select().single()
          : await db.from("email_templates").insert(row).select().single();
        if (r.error) return json({ error: r.error.message }, 500);
        if (body.is_default === true) {
          await db.from("email_templates").update({ is_default: false }).neq("id", r.data.id).eq("is_default", true).eq("kind", r.data.kind);
          await db.from("email_templates").update({ is_default: true }).eq("id", r.data.id);
        }
        return json({ row: r.data });
      }
      case "template_delete": { // les produits qui l'utilisaient reprennent le modèle par défaut
        const { data: t } = await db.from("email_templates").select("is_default").eq("id", body.id).maybeSingle();
        if (t?.is_default) return json({ error: "modele_par_defaut" }, 400);
        const { error } = await db.from("email_templates").delete().eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
      case "template_preview":
      case "template_test": { // aperçu avec une commande d'exemple, ou envoi de cet aperçu à une adresse
        const tpl = { id: null, subject: str(body.subject, 200), body: str(body.body, 20000) };
        const { site, wa } = siteCtx();
        const sample = {
          o: { ref: "LO-2211-EXEMPLE", customer_name: "Moussa Diop", amount_fcfa: 25000 },
          items: [
            { product_name: str(body.product_name, 120) || "Windows 11 Professionnel", delivery_type: "key", quantity: 1, status: "delivered", license_keys: [{ key_value: "XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" }] },
            { product_name: "Office 2024 Professionnel Plus", delivery_type: "key_file", quantity: 1, status: "delivered", license_keys: [{ key_value: "YYYYY-YYYYY-YYYYY-YYYYY-YYYYY" }] },
          ],
          link: site + "/commande.html?o=exemple", wa,
          install: body.kind === "install" ? site + "/commande.html?o=exemple&installe=1" : undefined,
        };
        if (body.kind === "install") for (const i of sample.items) { i.license_keys = []; i.status = "awaiting_install"; }
        const mail = renderEmail(tpl, sample);
        if (body.action === "template_preview") return json(mail);
        const to = str(body.to, 200).toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(to)) return json({ error: "email_invalide" }, 400);
        const r = await resendSend(to, { ...mail, subject: "[TEST] " + mail.subject });
        if (!r.ok) return json({ error: r.reason }, 400);
        return json({ ok: true });
      }

      // ================= Devis (revendeurs, entreprises) =================
      case "quotes_list": {
        const { data, error } = await db.from("quotes").select("*, orders(ref, invoice_no, status)").order("created_at", { ascending: false }).limit(300);
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data });
      }
      case "quote_save": {
        const name = str(body.customer_name, 100);
        if (name.length < 2) return json({ error: "nom_invalide" }, 400);
        const email = str(body.email, 200).toLowerCase();
        if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return json({ error: "email_invalide" }, 400);
        // deno-lint-ignore no-explicit-any
        const raw = (Array.isArray(body.items) ? body.items : []).slice(0, 50) as any[];
        const ids = raw.map((i) => str(i.product_id, 40)).filter(Boolean);
        const { data: prods } = ids.length ? await db.from("products").select("id, name, price_fcfa").in("id", ids) : { data: [] };
        const byId = Object.fromEntries((prods ?? []).map((p) => [p.id, p]));
        const items = raw.filter((i) => byId[str(i.product_id, 40)]).map((i) => {
          const p = byId[str(i.product_id, 40)];
          const up = Number(i.unit_price);
          return { product_id: p.id, name: str(i.name, 150) || p.name, qty: clamp(Math.floor(Number(i.qty) || 1), 1, 1000),
            unit_price: Number.isFinite(up) && String(i.unit_price) !== "" ? clamp(Math.round(up), 0, 100_000_000) : p.price_fcfa };
        });
        if (!items.length) return json({ error: "panier_vide" }, 400);
        const { data: vat } = await db.from("settings").select("value").eq("key", "invoice_vat_enabled").maybeSingle();
        const row = {
          customer_name: name, company: str(body.company, 120) || null, email: email || null,
          phone: str(body.phone, 30) || null, address: str(body.address, 300) || null,
          items, total_fcfa: items.reduce((t, i) => t + i.qty * i.unit_price, 0),
          vat_rate: vat?.value === true ? 18 : 0, notes: str(body.notes, 1000) || null,
          valid_until: /^\d{4}-\d{2}-\d{2}$/.test(str(body.valid_until, 10)) ? str(body.valid_until, 10) : null,
          updated_at: new Date().toISOString(),
        };
        const id = str(body.id, 40);
        if (id) {
          const { data: cur } = await db.from("quotes").select("status").eq("id", id).maybeSingle();
          if (!cur) return json({ error: "devis_introuvable" }, 404);
          if (cur.status === "converted") return json({ error: "devis_deja_converti" }, 400);
        }
        const { data, error } = id
          ? await db.from("quotes").update(row).eq("id", id).select().single()
          : await db.from("quotes").insert(row).select().single();
        if (error) return json({ error: error.message }, 500);
        return json({ row: data });
      }
      case "quote_status": {
        const status = str(body.status, 20);
        if (!["draft", "sent", "accepted", "cancelled"].includes(status)) return json({ error: "statut_invalide" }, 400);
        const { error } = await db.from("quotes").update({ status, updated_at: new Date().toISOString() }).eq("id", str(body.id, 40)).neq("status", "converted");
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
      case "quote_send": { // envoie le devis au client (lien vers la page imprimable)
        const { data: q } = await db.from("quotes").select("*").eq("id", str(body.id, 40)).maybeSingle();
        if (!q) return json({ error: "devis_introuvable" }, 404);
        if (!q.email) return json({ error: "email_invalide" }, 400);
        const { site } = siteCtx();
        const url = site + "/facture.html?d=" + q.public_token;
        const html = `<p style="margin:0 0 12px">${esc(hello(q.customer_name))}</p>
<p style="margin:0 0 12px">Veuillez trouver votre devis <b>${esc(q.quote_no)}</b>${q.company ? " pour " + esc(q.company) : ""}, d'un montant de <b>${esc(fcfaTxt(q.total_fcfa))}</b>.</p>
<p style="text-align:center;margin:22px 0"><a href="${esc(url)}" style="display:inline-block;background:${EM.O};color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">Voir et télécharger le devis</a></p>
${q.valid_until ? `<p style="margin:0 0 12px">Ce devis est valable jusqu'au ${esc(new Date(q.valid_until).toLocaleDateString("fr-FR"))}.</p>` : ""}
<p style="margin:0 0 12px">Pour l'accepter ou poser une question, répondez simplement à cet email.</p>`;
        const text = hello(q.customer_name) + "\n\nVotre devis " + q.quote_no + " (" + fcfaTxt(q.total_fcfa) + ") : " + url + "\n\nPour l'accepter ou poser une question, répondez à cet email.\n\n" + SLOGAN;
        const r = await resendSend(q.email, { subject: "Votre devis " + q.quote_no, html: wrapHtml(html), text });
        if (!r.ok) return json({ error: r.reason }, 400);
        if (q.status === "draft") await db.from("quotes").update({ status: "sent", updated_at: new Date().toISOString() }).eq("id", q.id);
        return json({ ok: true });
      }
      case "quote_convert": { // devis accepté et payé → commande (et facture)
        const { data: q } = await db.from("quotes").select("*").eq("id", str(body.id, 40)).maybeSingle();
        if (!q) return json({ error: "devis_introuvable" }, 404);
        if (q.status === "converted") return json({ error: "devis_deja_converti" }, 400);
        if (!q.email) return json({ error: "email_invalide" }, 400);
        const c = await createAdminOrder({
          name: q.company ? q.customer_name + " (" + q.company + ")" : q.customer_name, email: q.email, phone: q.phone,
          company: q.company, address: q.address, amount_fcfa: q.total_fcfa,
          // deno-lint-ignore no-explicit-any
          items: ((q.items ?? []) as any[]).map((i) => ({ product_id: i.product_id, qty: i.qty, unit_price: i.unit_price })),
          payment_method: body.payment_method, payment_ref: body.payment_ref, channel: body.channel, note: "Devis " + q.quote_no,
        });
        if (c instanceof Response) return c;
        await db.from("quotes").update({ status: "converted", order_id: c.o.id, updated_at: new Date().toISOString() }).eq("id", q.id);
        // livrer tout de suite (clés du stock, liens) ou laisser la commande à valider
        const result = body.deliver === true ? await deliver(c.o.id, true, body.send_email !== false) : null;
        const { data: o2 } = await db.from("orders").select("ref, invoice_no, public_token, status").eq("id", c.o.id).maybeSingle();
        return json({ order: o2, result });
      }

      // ================= FAQ =================
      // ================= Promos programmées =================
      case "promos_list": {
        const { data, error } = await db.from("promotions").select("*").order("starts_at", { ascending: false });
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data ?? [], now: new Date().toISOString() });
      }
      case "promo_save": {
        const kind = ["percent", "amount", "fixed"].includes(body.kind) ? body.kind : "percent";
        const value = Math.round(Number(body.value) || 0);
        const scope = ["all", "categories", "products"].includes(body.scope) ? body.scope : "products";
        const ids = (x: unknown) => (Array.isArray(x) ? x : []).map((v) => str(v, 40)).filter((v) => /^[0-9a-f-]{36}$/i.test(v)).slice(0, 500);
        const starts = body.starts_at ? new Date(String(body.starts_at)) : new Date();
        const ends = body.ends_at ? new Date(String(body.ends_at)) : null;
        const row = {
          name: str(body.name, 80), kind, value, scope,
          product_ids: scope === "products" ? ids(body.product_ids) : [], category_ids: scope === "categories" ? ids(body.category_ids) : [],
          starts_at: isNaN(starts.getTime()) ? new Date().toISOString() : starts.toISOString(),
          ends_at: ends && !isNaN(ends.getTime()) ? ends.toISOString() : null,
          active: body.active !== false, updated_at: new Date().toISOString(),
        };
        if (!row.name) return json({ error: "promo_nom" }, 400);
        if (value <= 0 || (kind === "percent" && value > 90)) return json({ error: "promo_valeur" }, 400);
        if (scope === "products" && !row.product_ids.length) return json({ error: "promo_produits" }, 400);
        if (scope === "categories" && !row.category_ids.length) return json({ error: "promo_categories" }, 400);
        if (row.ends_at && row.ends_at <= row.starts_at) return json({ error: "promo_dates" }, 400);
        const r = body.id ? await db.from("promotions").update(row).eq("id", str(body.id, 40)).select().single()
          : await db.from("promotions").insert(row).select().single();
        if (r.error) return json({ error: r.error.message }, 500);
        await logEvent("info", "admin", "Promo enregistrée : " + row.name, { type: kind, valeur: value, debut: row.starts_at, fin: row.ends_at, active: row.active });
        return json({ row: r.data });
      }
      case "promo_delete": {
        const { error } = await db.from("promotions").delete().eq("id", str(body.id, 40));
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      case "faqs_list": {
        const { data, error } = await db.from("faqs").select("*").order("sort").order("created_at");
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data });
      }
      case "faq_save": {
        const row = { question: str(body.question, 300), answer: str(body.answer, 5000), sort: clamp(Number(body.sort) || 0, 0, 1000), active: body.active !== false };
        if (!row.question || !row.answer) return json({ error: "question_et_reponse_obligatoires" }, 400);
        const r = body.id ? await db.from("faqs").update(row).eq("id", body.id).select().single()
          : await db.from("faqs").insert(row).select().single();
        if (r.error) return json({ error: r.error.message }, 500);
        return json({ row: r.data });
      }
      case "faq_delete": {
        const { error } = await db.from("faqs").delete().eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      // ================= Blog =================
      case "posts_list": {
        const { data, error } = await db.from("posts").select("*").order("created_at", { ascending: false }).limit(300);
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data, fb_ready: fbReady() });
      }
      case "post_facebook": { // publier (ou republier) un article déjà en ligne sur la page Facebook
        const { data: p } = await db.from("posts").select("*").eq("id", str(body.id, 40)).maybeSingle();
        if (!p || !p.published) return json({ error: "not_found" }, 404);
        if (p.fb_post_id && body.force !== true) return json({ error: "deja_sur_facebook" }, 400);
        const r = await postToFacebook(p);
        if (!r.ok) return json({ error: r.reason }, 400);
        return json({ ok: true });
      }
      case "post_save": {
        const published = body.published === true;
        const row: Record<string, unknown> = {
          title: str(body.title, 200), slug: slugify(str(body.slug, 120) || str(body.title, 120)),
          excerpt: str(body.excerpt, 400) || null, content: str(body.content, 50000),
          cover_url: str(body.cover_url, 500) || null, cover_video: ytId(str(body.cover_video, 300)) ? str(body.cover_video, 300) : null, published, updated_at: new Date().toISOString(),
          rubrique_id: str(body.rubrique_id, 40) || null, show_whatsapp: body.show_whatsapp === true,
        };
        if (!row.title || !row.slug) return json({ error: "titre_obligatoire" }, 400);
        let firstPublish = false;
        if (published) {
          const { data: old } = body.id ? await db.from("posts").select("published_at").eq("id", body.id).maybeSingle() : { data: null };
          firstPublish = !old?.published_at;
          row.published_at = old?.published_at ?? new Date().toISOString();
        }
        const r = body.id ? await db.from("posts").update(row).eq("id", body.id).select().single()
          : await db.from("posts").insert(row).select().single();
        if (r.error) return json({ error: r.error.message.includes("duplicate") ? "code_deja_utilise" : r.error.message }, 400);
        // comme WordPress : à la première publication, l'article part aussi sur la page Facebook
        const facebook = published && body.facebook === true && fbReady() && !r.data.fb_post_id && firstPublish ? await postToFacebook(r.data) : null;
        return json({ row: r.data, facebook });
      }
      // ================= Pages libres =================
      case "pages_list": {
        const { data, error } = await db.from("pages").select("*").order("sort").order("title");
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data });
      }
      case "page_save": {
        const row = {
          title: str(body.title, 200), slug: slugify(str(body.slug, 120) || str(body.title, 120)),
          content: str(body.content, 50000), image_url: str(body.image_url, 500) || null,
          seo_title: str(body.seo_title, 120) || null, seo_description: str(body.seo_description, 320) || null,
          published: body.published === true, in_menu: body.in_menu === true, in_footer: body.in_footer === true,
          sort: clamp(Number(body.sort) || 0, 0, 10000), updated_at: new Date().toISOString(),
          rubrique_id: str(body.rubrique_id, 40) || null, show_whatsapp: body.show_whatsapp !== false,
        };
        if (!row.title || !row.slug) return json({ error: "titre_obligatoire" }, 400);
        const r = body.id ? await db.from("pages").update(row).eq("id", body.id).select().single()
          : await db.from("pages").insert(row).select().single();
        if (r.error) return json({ error: r.error.message.includes("duplicate") ? "adresse_deja_utilisee" : r.error.message }, 400);
        return json({ row: r.data });
      }
      case "page_delete": {
        const { error } = await db.from("pages").delete().eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
      // ================= Pages & blog : tableau de bord et rubriques =================
      case "content_stats": {
        const days = [7, 30, 90, 365, 3650].includes(Number(body.days)) ? Number(body.days) : 30;
        const { data, error } = await db.rpc("content_stats", { p_days: days });
        if (error) return json({ error: error.message }, 500);
        return json(data);
      }
      case "rubriques_list": {
        const { data, error } = await db.from("rubriques").select("*").order("sort").order("name");
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data });
      }
      case "rubrique_save": {
        const id = str(body.id, 40) || null;
        const parent = str(body.parent_id, 40) || null;
        if (parent && parent === id) return json({ error: "rubrique_parent_elle_meme" }, 400);
        if (parent) { // 2 niveaux maximum : la rubrique parente doit être une rubrique principale
          const { data: par } = await db.from("rubriques").select("parent_id").eq("id", parent).maybeSingle();
          if (!par || par.parent_id) return json({ error: "rubrique_2_niveaux" }, 400);
          if (id) { const { count } = await db.from("rubriques").select("id", { count: "exact", head: true }).eq("parent_id", id);
            if (count) return json({ error: "rubrique_2_niveaux" }, 400); }
        }
        const row = {
          name: str(body.name, 80), slug: slugify(str(body.slug, 80) || str(body.name, 80)), description: str(body.description, 300) || null,
          parent_id: parent, category_slug: str(body.category_slug, 80) || null, sort: clamp(Number(body.sort) || 0, 0, 10000), active: body.active !== false,
        };
        if (!row.name || !row.slug) return json({ error: "titre_obligatoire" }, 400);
        const r = id ? await db.from("rubriques").update(row).eq("id", id).select().single() : await db.from("rubriques").insert(row).select().single();
        if (r.error) return json({ error: r.error.message.includes("duplicate") ? "adresse_deja_utilisee" : r.error.message }, 400);
        return json({ row: r.data });
      }
      case "rubrique_delete": { // les articles et pages de la rubrique restent, simplement « sans rubrique »
        const { error } = await db.from("rubriques").delete().eq("id", str(body.id, 40));
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
      case "post_delete": {
        const { error } = await db.from("posts").delete().eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      // ================= Fichiers =================
      case "files_list": { // logiciels (espace privé)
        const { data, error } = await db.storage.from("installers").list("", { limit: 300, sortBy: { column: "name", order: "asc" } });
        if (error) return json({ error: error.message }, 500);
        return json({ rows: (data ?? []).filter((f) => f.id).map((f) => ({ name: f.name, size: f.metadata?.size ?? null })) });
      }
      case "upload_url": { // logiciel → espace privé "installers"
        const name = safeFileName(body.filename);
        if (!name || !/\.[A-Za-z0-9]{2,5}$/.test(name)) return json({ error: "nom_de_fichier_invalide" }, 400);
        const { data, error } = await db.storage.from("installers").createSignedUploadUrl(name, { upsert: true });
        if (error) return json({ error: error.message }, 500);
        return json({ url: data.signedUrl, path: data.path ?? name });
      }
      case "image_upload_url": { // photo produit / blog → espace public "product-images"
        const base = safeFileName(body.filename);
        if (!/\.(jpe?g|png|webp|gif|avif)$/i.test(base)) return json({ error: "image_invalide" }, 400);
        const name = Date.now().toString(36) + "-" + base;
        const { data, error } = await db.storage.from("product-images").createSignedUploadUrl(name);
        if (error) return json({ error: error.message }, 500);
        return json({ url: data.signedUrl, public_url: `${SUPABASE_URL}/storage/v1/object/public/product-images/${encodeURIComponent(name)}` });
      }

      // ================= Liens de téléchargement =================
      case "list": {
        const { data, error } = await db.from("downloads").select("*, products(name), orders(ref)")
          .order("created_at", { ascending: false }).limit(300);
        if (error) return json({ error: error.message }, 500);
        return json({ rows: data });
      }
      case "set_status": {
        const status = String(body.status);
        if (!["pending", "active", "revoked"].includes(status)) return json({ error: "statut_invalide" }, 400);
        const patch: Record<string, unknown> = { status };
        if (status === "active") patch.activated_at = new Date().toISOString();
        const { error } = await db.from("downloads").update(patch).eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }
      case "extend": {
        const days = clamp(Number(body.days) || 7, 1, 90);
        const { data: row } = await db.from("downloads").select("expires_at").eq("id", body.id).maybeSingle();
        if (!row) return json({ error: "introuvable" }, 404);
        const base = Math.max(Date.now(), new Date(row.expires_at).getTime());
        const { error } = await db.from("downloads").update({ expires_at: new Date(base + days * DAY).toISOString() }).eq("id", body.id);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      default:
        return json({ error: "action_inconnue" }, 400);
    }
  } catch (e) {
    await logEvent("error", "admin", "Erreur dans l'admin (action « " + String(body?.action ?? "?").slice(0, 40) + " »)", e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
