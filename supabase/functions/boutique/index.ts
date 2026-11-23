// ============================================================
// Fonction "boutique" (PUBLIQUE) : catalogue, fiche produit,
// commande (panier à plusieurs articles), suivi de commande,
// blog, FAQ et statistiques de visites.
// Supabase > Edge Functions > nom : boutique — "Verify JWT" désactivé.
// Les clés / identifiants ne sortent ici QUE pour le client qui
// possède le lien secret de SA commande payée.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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
async function logEvent(level: "info" | "warn" | "error", source: string, message: string, detail?: unknown, orderRef?: string | null) {
  if (level === "error") console.error(source, message);
  try {
    const d = detail instanceof Error ? { erreur: detail.message, pile: String(detail.stack ?? "").slice(0, 800) } : detail;
    await db.from("app_logs").insert({ level, source, message: String(message).slice(0, 300), detail: d === undefined ? null : cleanDetail(d), order_ref: orderRef ?? null });
  } catch (_) { /* le journal ne doit jamais bloquer la boutique */ }
}

function newToken(n = 24): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// Référence lisible : LO-2611-7KQ3P (sans 0/O/1/I)
function newRef(): string {
  const abc = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const b = new Uint8Array(5);
  crypto.getRandomValues(b);
  const d = new Date();
  const dm = String(d.getUTCDate()).padStart(2, "0") + String(d.getUTCMonth() + 1).padStart(2, "0");
  return "LO-" + dm + "-" + Array.from(b, (x) => abc[x % abc.length]).join("");
}
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const STOCK_TYPES = ["key", "key_file", "stock"];
const PRODUCT_FIELDS = "id, slug, name, description, image_url, price_fcfa, compare_price_fcfa, delivery_type, featured, sort, category_id, stock_qty, sku, seo_title, seo_description";

// ================= Origine de la commande (pub Facebook, Google Ads, WhatsApp…) =================
const SITE_CHANNELS = ["google_ads", "facebook_ads", "facebook", "google", "whatsapp", "direct", "autre"];
// deno-lint-ignore no-explicit-any
function originOf(o: any) {
  const clean = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n) || null;
  const ch = SITE_CHANNELS.includes(String(o?.ch)) ? String(o.ch) : "direct";
  return { channel: ch, campaign: clean(o?.camp, 80), utm_source: clean(o?.src, 60), utm_medium: clean(o?.med, 30) };
}

// ================= Email automatique de livraison (Resend) =================
// Secrets : RESEND_API_KEY (obligatoire pour envoyer), RESEND_FROM (facultatif,
// ex. « licenceoff <commandes@licenceoff.com> »), SITE_URL, WHATSAPP_NUMBER (facultatif).
// Sans RESEND_API_KEY, rien n'est envoyé et la boutique marche normalement.
// Modèles : table email_templates (un modèle par produit, sinon le modèle par défaut).
// Variables utilisables dans un modèle :
//   {prenom} {nom} {commande} {total} {produits} {cles} {bouton} {lien_commande} {whatsapp}
//   + pour l'email d'installation (livraison en 2 temps) : {bouton_installation} {lien_installation}
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fcfaTxt = (n: number) => new Intl.NumberFormat("fr-FR").format(n).replace(/ | /g, " ") + " FCFA";
const EM = { B: "#1E4FB8", N: "#0F2A6B", O: "#F5A21B", C: "#FBF7EE" };

type Tpl = { id: string | null; subject: string; body: string };
const BUILTIN_TPL: Tpl = {
  id: null,
  subject: "Votre commande {commande} est prête — licenceoff",
  body: "Bonjour {prenom},\n\nMerci pour votre commande **{commande}** ({total}). Elle est prête !\n\n{produits}\n\n{cles}\n\n{bouton}\n\nGardez cet email : votre page de commande regroupe vos clés et vos téléchargements.\n\nBesoin d'aide pour installer ou activer ? [Écrivez-nous sur WhatsApp]({whatsapp}).",
};

const BUILTIN_INSTALL_TPL: Tpl = {
  id: null,
  subject: "Commande {commande} : installez votre logiciel — licenceoff",
  body: "Bonjour {prenom},\n\nMerci pour votre commande **{commande}** ({total}). Votre paiement est bien reçu.\n\n**Étape 1 : téléchargez et installez le logiciel.** Le lien ne fonctionne qu'une seule fois.\n\n{bouton}\n\n**Étape 2 : recevez votre clé de licence.** Une fois l'installation terminée, cliquez sur ce bouton. Il ne fonctionne qu'une fois.\n\n{bouton_installation}\n\nUn souci ? [Écrivez-nous sur WhatsApp]({whatsapp}).",
};

// deno-lint-ignore no-explicit-any
type Item = any;
// deno-lint-ignore no-explicit-any
type Ctx = { o: any; items: Item[]; link: string; wa: string; install?: string };

function keysHtml(items: Item[]) {
  return items.map((i) => {
    const ks = (i.license_keys ?? []) as { key_value: string }[];
    if (!ks.length) return "";
    const label = i.delivery_type === "stock" ? "Vos identifiants" : ks.length > 1 ? "Vos clés d'activation" : "Votre clé d'activation";
    return `<div style="margin:10px 0"><div style="font-size:13px;color:#5b6b86">${label} — ${esc(i.product_name)} :</div>` +
      ks.map((k) => `<div style="font-family:Consolas,Menlo,monospace;font-weight:700;font-size:15px;background:#eff5ff;border:2px dashed ${EM.B};border-radius:8px;padding:10px 12px;margin:6px 0;word-break:break-all;color:${EM.N}">${esc(k.key_value)}</div>`).join("") + "</div>";
  }).join("");
}
function keysText(items: Item[]) {
  return items.filter((i) => (i.license_keys ?? []).length).map((i) => i.product_name + " :\n" + i.license_keys.map((k: { key_value: string }) => "  " + k.key_value).join("\n")).join("\n");
}
const productsHtml = (items: Item[]) => "<ul style=\"margin:6px 0;padding-left:20px\">" + items.map((i) => `<li><b>${i.quantity > 1 ? i.quantity + " × " : ""}${esc(i.product_name)}</b>${["key_file", "file"].includes(i.delivery_type) ? " — logiciel à télécharger depuis votre page de commande (lien à usage unique)" : ""}${i.status === "to_process" ? " — notre équipe vous contacte sur WhatsApp" : ""}</li>`).join("") + "</ul>";
const productsText = (items: Item[]) => items.map((i) => "- " + (i.quantity > 1 ? i.quantity + " x " : "") + i.product_name).join("\n");
const installButtonHtml = (link: string) => `<p style="text-align:center;margin:22px 0 6px"><a href="${esc(link)}" style="display:inline-block;background:#15803d;color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">✅ J'ai fini l'installation : recevoir ma clé</a></p><p style="text-align:center;margin:0 0 14px;font-size:12px;color:#5b6b86">Bouton à usage unique</p>`;
// bouton « Assistance WhatsApp » (remplace le numéro de téléphone dans les signatures)
const waButtonHtml = (wa: string) => `<p style="margin:18px 0 12px"><a href="https://wa.me/${esc(wa)}" style="display:inline-block;background:#25D366;color:#fff;font-weight:800;text-decoration:none;padding:11px 18px;border-radius:10px">💬 Assistance WhatsApp</a></p>`;
const buttonHtml = (link: string) => `<p style="text-align:center;margin:22px 0"><a href="${esc(link)}" style="display:inline-block;background:${EM.O};color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">Voir ma commande et télécharger</a></p>`;

function vars(c: Ctx) {
  const parts = String(c.o.customer_name ?? "").trim().split(/\s+/);
  return { prenom: parts[0] || "", nom: String(c.o.customer_name ?? ""), commande: String(c.o.ref), total: fcfaTxt(c.o.amount_fcfa), lien_commande: c.link, lien_installation: c.install ?? c.link, whatsapp: "https://wa.me/" + c.wa,
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
  const sub = (s: string) => s.replace(/\{(prenom|nom|commande|total|lien_commande|lien_installation|whatsapp|version|produit)\}/g, (_, k) => v[k]).replace(/ {2,}/g, " ");
  // HTML
  const blocks = b.replace(/\r/g, "").split(/\n{2,}/).map((para) => {
    const t = para.trim();
    if (t === "{produits}") return productsHtml(c.items);
    if (t === "{cles}") return keysHtml(c.items);
    if (t === "{bouton}") return buttonHtml(c.link);
    if (t === "{bouton_installation}") return installButtonHtml(c.install ?? c.link);
    if (t === "{bouton_whatsapp}") return waButtonHtml(c.wa);
    const inline = (s: string) => esc(sub(s))
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, `<a href="$2" style="color:${EM.B};font-weight:700">$1</a>`);
    const lines = t.split("\n");
    if (lines.every((l) => /^\s*-\s+/.test(l))) return "<ul style=\"margin:6px 0;padding-left:20px\">" + lines.map((l) => "<li>" + inline(l.replace(/^\s*-\s+/, "")) + "</li>").join("") + "</ul>";
    return `<p style="margin:0 0 12px;line-height:1.6">${lines.map(inline).join("<br>")}</p>`;
  }).join("");
  const html = blocks.replace(/\{produits\}/g, productsHtml(c.items)).replace(/\{cles\}/g, keysHtml(c.items)).replace(/\{bouton\}/g, buttonHtml(c.link)).replace(/\{bouton_installation\}/g, installButtonHtml(c.install ?? c.link)).replace(/\{bouton_whatsapp\}/g, waButtonHtml(c.wa));
  // Texte
  const text = sub(b).replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 : $2")
    .replace(/\{produits\}/g, productsText(c.items)).replace(/\{cles\}/g, keysText(c.items)).replace(/\{bouton\}/g, "Votre commande : " + c.link)
    .replace(/\{bouton_installation\}/g, "Installation terminée ? Recevez votre clé (lien à usage unique) : " + (c.install ?? c.link))
    .replace(/\{bouton_whatsapp\}/g, "Assistance WhatsApp : https://wa.me/" + c.wa);
  return { html, text };
}
// Email « transactionnel » sobre (fond blanc, peu d'images, pas de slogan) : Gmail le classe
// plus souvent dans « Principal » que dans « Promotions ».
function wrapHtml(inner: string, ref?: string, invoiceUrl?: string) {
  const { B, N, O } = EM;
  const why = ref ? `Cet email concerne votre commande <b>${esc(ref)}</b> sur licenceoff.com.<br>` : "";
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#ffffff;font-family:Segoe UI,Arial,sans-serif;color:${N}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="padding:0 0 12px;border-bottom:2px solid ${O}"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
  <td style="padding-right:10px;vertical-align:middle"><img src="https://www.licenceoff.com/img/profil-64.png" width="40" height="40" alt="" style="display:block;border:0;width:40px;height:40px"></td>
  <td style="vertical-align:middle;font-size:20px;font-weight:800;color:${B}">licence<span style="color:${O}">off</span></td></tr></table></td></tr>
<tr><td style="padding:20px 0;font-size:15px;line-height:1.5">${inner}</td></tr>
<tr><td style="border-top:1px solid #e3e8f0;padding:12px 0;color:#6b7690;font-size:12px">
  ${why}${invoiceUrl ? `Votre facture : <a href="${esc(invoiceUrl)}" style="color:${B}">voir et télécharger la facture</a><br>` : ""}Une question ? Répondez simplement à cet email.<br>
  Pour recevoir nos prochains emails sans problème, ajoutez commandes@licenceoff.com à vos contacts. Si cet email est arrivé dans « Promotions » ou « Spam », déplacez-le dans « Principal ».<br>
  licenceoff — Dakar, Sénégal · www.licenceoff.com</td></tr>
</table></td></tr></table></body></html>`;
}
function renderEmail(tpl: Tpl, c: Ctx) {
  const { html, text } = renderBody(tpl.body, c);
  const v = vars(c) as Record<string, string>;
  const subject = String(tpl.subject || BUILTIN_TPL.subject).replace(/\{(prenom|nom|commande|total|version|produit)\}/g, (_, k) => v[k]).replace(/ {2,}/g, " ").trim().slice(0, 200);
  const ref = String(c.o.ref || "");
  // lien vers la facture (commande payée avec un numéro de facture)
  const inv = c.o.invoice_no && c.o.public_token ? siteCtx().site + "/facture.html?o=" + encodeURIComponent(c.o.public_token) : undefined;
  const subj = ref && ref !== "—" && !subject.includes(ref) ? (subject + " — commande " + ref).slice(0, 200) : subject;
  return {
    subject: subj, html: wrapHtml(html, ref && ref !== "—" ? ref : undefined, inv),
    text: text + (ref && ref !== "—" ? "\n\nCet email concerne votre commande " + ref + " sur licenceoff.com." : "") + (inv ? "\nVotre facture : " + inv : "") + "\nUne question ? Répondez simplement à cet email.\nPour recevoir nos prochains emails sans problème, ajoutez commandes@licenceoff.com à vos contacts. Si cet email est arrivé dans « Promotions » ou « Spam », déplacez-le dans « Principal ».\nlicenceoff — www.licenceoff.com",
    headers: ref && ref !== "—" ? { "X-Entity-Ref-ID": ref } : undefined,
  };
}
function siteCtx() {
  return {
    site: (Deno.env.get("SITE_URL") ?? "https://www.licenceoff.com").trim().replace(/\/$/, ""),
    wa: (Deno.env.get("WHATSAPP_NUMBER") ?? "221777860777").replace(/\D/g, ""),
  };
}
async function resendSend(to: string, mail: { subject: string; html: string; text: string; headers?: Record<string, string> }, replyTo?: string, from?: string) {
  const key = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  if (!key) { await logEvent("warn", "email", "Email non envoyé : clé Resend absente dans Supabase (secret RESEND_API_KEY)", { destinataire: to }); return { ok: false, reason: "resend_non_configure" }; }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: from ?? (Deno.env.get("RESEND_FROM") ?? "licenceoff <commandes@licenceoff.com>").trim(),
      // les réponses des clients arrivent dans l'admin (onglet Messages) via contact@licenceoff.com
      to: [to], reply_to: replyTo ?? ((Deno.env.get("RESEND_REPLY_TO") ?? "").trim() || "contact@licenceoff.com"),
      subject: mail.subject, html: mail.html, text: mail.text, headers: mail.headers,
    }),
  }).catch(() => null);
  if (!r || !r.ok) {
    const rep = r ? (await r.text().catch(() => "")).slice(0, 500) : "pas de réponse (réseau)";
    await logEvent("error", "email", "Email non envoyé à " + to + " : « " + mail.subject + " »", { statut_http: r?.status ?? null, reponse_resend: rep });
    return { ok: false, reason: "envoi_echoue" };
  }
  await logEvent("info", "email", "Email envoyé à " + to + " : « " + mail.subject + " »");
  return { ok: true };
}

// Envoie l'email de livraison UNE fois (force = renvoi manuel depuis l'admin).
// Si la commande contient des produits avec des modèles différents : un email par modèle.
async function sendDeliveryEmail(orderId: string, force = false, templateId?: string): Promise<{ sent: boolean; count?: number; reason?: string }> {
  if (!(Deno.env.get("RESEND_API_KEY") ?? "").trim()) return { sent: false, reason: "resend_non_configure" };
  const { data: o } = await db.from("orders")
    .select("id, ref, public_token, invoice_no, customer_name, email, amount_fcfa, status, emailed_at, order_items(id, product_name, delivery_type, quantity, status, created_at, license_keys(key_value), products(email_template_id))")
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
    .select("id, ref, public_token, invoice_no, customer_name, email, amount_fcfa, status, order_items(id, product_name, delivery_type, quantity, status, created_at, install_emailed_at, products(install_template_id))")
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
  await notifyPayouts().catch((e) => logEvent("error", "parrainage", "Erreur pendant l'alerte de versement parrain", e));
}

// Nombre d'unités disponibles par produit (seulement pour les produits à stock)
// Unités de stock par produit : clés à usage unique + activations restantes des clés multi-postes.
// Une clé réutilisable sans limite rend le produit « illimité » (unlimited).
async function keyUnits(ids: string[]) {
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
async function stockCounts(ids: string[]) {
  const out: Record<string, number> = {};
  for (const [id, u] of Object.entries(await keyUnits(ids))) out[id] = u.unlimited ? 9999 : u.units;
  return out;
}
// deno-lint-ignore no-explicit-any
function publicProduct(p: any, counts: Record<string, number>, cats: Record<string, any>) {
  // produit physique : quantité saisie par l'admin (vide = illimitée)
  const physical = p.delivery_type === "physical" && p.stock_qty != null;
  const needsStock = STOCK_TYPES.includes(p.delivery_type) || physical;
  const left = physical ? p.stock_qty : counts[p.id] ?? 0;
  return {
    slug: p.slug, name: p.name, description: p.description ?? "", image_url: p.image_url ?? "",
    price_fcfa: p.price_fcfa, compare_price_fcfa: p.compare_price_fcfa ?? null,
    sku: p.sku ?? null, seo_title: p.seo_title ?? null, seo_description: p.seo_description ?? null,
    delivery_type: p.delivery_type, featured: p.featured,
    category: cats[p.category_id]?.slug ?? null,
    in_stock: needsStock ? left > 0 : true,
    max_qty: needsStock ? Math.min(left, 20) : 20,
  };
}

// ================= Parrainage =================
// Prix client avec le code d'un parrain : remise en %, jamais sous le prix de gros.
// Sans prix de gros, le produit n'a ni remise ni gain parrain.
// deno-lint-ignore no-explicit-any
function referralPrice(p: any, pct: number) {
  const list = p.price_fcfa;
  const w = p.wholesale_price_fcfa;
  if (w == null || w >= list || pct <= 0) return { unit: list, wholesale: w ?? null, gain: 0 };
  const unit = Math.max(w, Math.round(list * (1 - pct / 100)));
  return { unit, wholesale: w, gain: unit - w };
}
const normCode = (c: unknown) => str(c, 30).toUpperCase().replace(/[^A-Z0-9-]/g, "");
async function findCode(code: string) {
  if (!code) return null;
  const { data } = await db.from("referral_codes").select("id, code, discount_pct, active, parrain_id, parrains(name, status)").eq("code", code).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const d = data as any;
  if (!d || !d.active || d.parrains?.status !== "active") return null;
  return d;
}
async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function parrainFromSession(token: unknown) {
  const t = str(token, 100);
  if (!t) return null;
  const { data } = await db.from("parrain_sessions").select("parrain_id, expires_at, parrains(*)").eq("token_hash", await sha256(t)).eq("kind", "session").maybeSingle();
  // deno-lint-ignore no-explicit-any
  const d = data as any;
  if (!d || new Date(d.expires_at) < new Date() || d.parrains?.status !== "active") return null;
  return d.parrains;
}
// ---------- comptes clients ----------
async function customerFromSession(token: unknown) {
  const t = str(token, 100);
  if (!t) return null;
  const { data } = await db.from("customer_sessions").select("customer_id, expires_at, customers(*)").eq("token_hash", await sha256(t)).eq("kind", "session").maybeSingle();
  // deno-lint-ignore no-explicit-any
  const d = data as any;
  if (!d || new Date(d.expires_at) < new Date()) return null;
  return d.customers;
}
async function setting(key: string, def: number) {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) ? n : def;
}

// Plan du site pour Google (toujours à jour) : …/functions/v1/boutique?sitemap=1 (cité dans robots.txt)
// ================= Flux produits (Meta / Google) =================
// boutique?feed=meta (ou google) : RSS 2.0 avec l'espace g: ; boutique?feed=csv : même contenu en CSV.
// Seulement les produits publiés qui ont une photo. id = code produit (le même que dans le pixel Meta).
async function productFeed(kind: string) {
  const site = (Deno.env.get("SITE_URL") ?? "https://www.licenceoff.com").trim().replace(/\/$/, "");
  const [{ data: prods }, { data: cats }] = await Promise.all([
    db.from("products").select("id, slug, name, description, image_url, price_fcfa, compare_price_fcfa, delivery_type, stock_qty, category_id, sku, seo_description").eq("active", true).order("sort").order("name"),
    db.from("categories").select("id, name, parent_id"),
  ]);
  const catById = Object.fromEntries((cats ?? []).map((c) => [c.id, c]));
  const list = (prods ?? []).filter((p) => String(p.image_url ?? "").trim());
  const counts = await stockCounts(list.filter((p) => STOCK_TYPES.includes(p.delivery_type)).map((p) => p.id));
  const plain = (s: string) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>`]+/g, "").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, 5000);
  const rows = list.map((p) => {
    const c = catById[p.category_id];
    const parent = c?.parent_id ? catById[c.parent_id] : null;
    const type = [parent?.name, c?.name].filter(Boolean).join(" > ");
    const pub = publicProduct(p, counts, {});
    const img = String(p.image_url).startsWith("http") ? String(p.image_url) : site + "/" + String(p.image_url).replace(/^\//, "");
    const promo = p.compare_price_fcfa && p.compare_price_fcfa > p.price_fcfa;
    const brand = /cam[ée]ra|surveillance/i.test(p.name + " " + type) ? (String(p.name).match(/\b(Hikvision|Dahua|Ezviz|Imou|TP-?Link|Tapo|Xiaomi|Reolink|Uniview|Ring|Arlo)\b/i)?.[1] ?? "Licenceoff")
      : /windows|office|microsoft|365|visio|project|outlook|word|excel/i.test(p.name + " " + type) ? "Microsoft" : "Licenceoff";
    return {
      id: p.slug, title: String(p.name).slice(0, 150), description: plain(p.description || p.seo_description || p.name) || p.name,
      availability: pub.in_stock ? "in stock" : "out of stock", condition: "new",
      price: (promo ? p.compare_price_fcfa : p.price_fcfa) + " XOF", sale_price: promo ? p.price_fcfa + " XOF" : "",
      link: site + "/produit/" + encodeURIComponent(p.slug), image_link: img, brand, product_type: type,
      // logiciels : 313 ; caméras : chemin texte de la taxonomie Google (accepté par Google et Meta)
      google_product_category: /cam[ée]ra|surveillance/i.test(p.name + " " + type) ? "Cameras & Optics > Cameras > Surveillance Cameras" : p.delivery_type === "physical" ? "" : "313",
      mpn: p.sku ?? "", identifier_exists: "no",
    };
  });
  const headers = { ...cors, "Cache-Control": "public, max-age=3600" };
  if (kind === "csv") {
    const cols = ["id", "title", "description", "availability", "condition", "price", "sale_price", "link", "image_link", "brand", "product_type", "google_product_category", "mpn", "identifier_exists"];
    const q = (v: string) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    // deno-lint-ignore no-explicit-any
    const body = [cols.join(","), ...rows.map((r: any) => cols.map((k) => q(r[k])).join(","))].join("\n") + "\n";
    return new Response(body, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
  }
  const x = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const items = rows.map((r) => "<item>" + Object.entries(r).filter(([, v]) => v !== "").map(([k, v]) => `<g:${k}>${x(String(v))}</g:${k}>`).join("") + "</item>").join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>\n<title>licenceoff</title>\n<link>${site}</link>\n<description>Catalogue licenceoff</description>\n${items}\n</channel>\n</rss>\n`,
    { headers: { ...headers, "Content-Type": "application/xml; charset=utf-8" } });
}

async function sitemap() {
  const site = (Deno.env.get("SITE_URL") ?? "https://www.licenceoff.com").trim().replace(/\/$/, "");
  const [{ data: cats }, { data: prods }, { data: posts }, { data: pages }] = await Promise.all([
    db.from("categories").select("id, slug, parent_id").eq("active", true),
    db.from("products").select("slug, category_id").eq("active", true),
    db.from("posts").select("slug, published_at").eq("published", true),
    db.from("pages").select("slug, updated_at").eq("published", true),
  ]);
  const catById = Object.fromEntries((cats ?? []).map((c) => [c.id, c]));
  const used = new Set((prods ?? []).map((p) => p.category_id));
  for (const id of [...used]) { const par = catById[id as string]?.parent_id; if (par) used.add(par); }
  const catPath = (c: { slug: string; parent_id: string | null }) => (c.parent_id && catById[c.parent_id] ? encodeURIComponent(catById[c.parent_id].slug) + "/" : "") + encodeURIComponent(c.slug);
  const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const day = (d?: string | null) => d ? `<lastmod>${String(d).slice(0, 10)}</lastmod>` : "";
  const urls = [
    `<url><loc>${site}/</loc></url>`, `<url><loc>${site}/boutique</loc></url>`, `<url><loc>${site}/blog</loc></url>`, `<url><loc>${site}/faq</loc></url>`,
    ...(cats ?? []).filter((c) => used.has(c.id)).map((c) => `<url><loc>${site}/categorie/${x(catPath(c))}</loc></url>`),
    // deno-lint-ignore no-explicit-any
    ...(prods ?? []).map((p: any) => `<url><loc>${site}/produit/${x(encodeURIComponent(p.slug))}</loc></url>`),
    ...(posts ?? []).map((p) => `<url><loc>${site}/blog/${x(encodeURIComponent(p.slug))}</loc>${day(p.published_at)}</url>`),
    ...(pages ?? []).map((p) => `<url><loc>${site}/page/${x(encodeURIComponent(p.slug))}</loc>${day(p.updated_at)}</url>`),
  ];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
    { headers: { ...cors, "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

Deno.serve(async (req) => {
  try { return await handle(req); } catch (e) {
    await logEvent("error", "boutique", "Erreur inattendue dans la fonction boutique", e);
    return json({ error: "erreur_serveur" }, 500);
  }
});
// ================= Messages reçus (Cloudflare Email Routing → Worker → ici) =================
// Le Worker envoie l'email brut. Un email n'est jamais une preuve d'identité : on le traite comme
// un simple message (taille limitée, nombre limité par heure, texte seulement, aucun lien exécuté).
async function inbound(req: Request): Promise<Response> {
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length || buf.length > 5 * 1048576) return json({ error: "taille" }, 413);
  const { count } = await db.from("inbox_messages").select("id", { count: "exact", head: true }).eq("direction", "in")
    .gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  if ((count ?? 0) >= 200) { await logEvent("warn", "messages", "Plus de 200 emails reçus en une heure : les suivants sont refusés pour l'instant"); return json({ error: "trop" }, 429); }
  const { default: PostalMime } = await import("npm:postal-mime@2.4.4");
  // deno-lint-ignore no-explicit-any
  let m: any;
  try { m = await PostalMime.parse(buf); } catch (e) { await logEvent("error", "messages", "Email reçu illisible", e); return json({ error: "illisible" }, 400); }
  const email = String(m.from?.address ?? req.headers.get("x-envelope-from") ?? "").trim().toLowerCase().slice(0, 200);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: true, ignored: "expediteur" });
  if (email.endsWith("@licenceoff.com")) return json({ ok: true, ignored: "boucle" });
  const subject = String(m.subject ?? "").slice(0, 300);
  let text = String(m.text ?? "").trim();
  if (!text && m.html) text = String(m.html).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();
  text = text.slice(0, 20000);
  // deno-lint-ignore no-explicit-any
  const headers = (m.headers ?? []) as any[];
  const auto = headers.some((h) => (h.key === "auto-submitted" && !/^no$/i.test(String(h.value))) || h.key === "x-autoreply" || (h.key === "precedence" && /bulk|junk|auto_reply/i.test(String(h.value))));
  // commande : n° cité dans l'objet ou le texte, sinon la dernière commande de cet email
  let orderRef = (subject + "\n" + text).match(/LO-\d{4}-[A-Z0-9]{5}/)?.[0] ?? null;
  if (!orderRef) {
    const { data: last } = await db.from("orders").select("ref").eq("email", email).order("created_at", { ascending: false }).limit(1).maybeSingle();
    orderRef = last?.ref ?? null;
  }
  const { data: cust } = await db.from("customers").select("id, name").eq("email", email).maybeSingle();
  let name = String(m.from?.name ?? "").trim().slice(0, 120) || cust?.name || null;
  if (!name) { const { data: o } = await db.from("orders").select("customer_name").eq("email", email).limit(1).maybeSingle(); name = o?.customer_name ?? null; }
  const row = {
    direction: "in", status: auto ? "read" : "new", customer_email: email, customer_name: name, customer_id: cust?.id ?? null,
    to_email: String(req.headers.get("x-envelope-to") ?? m.to?.[0]?.address ?? "").slice(0, 200) || null,
    subject: subject || null, body_text: text || "(message vide)",
    // deno-lint-ignore no-explicit-any
    attachments: (m.attachments ?? []).length ? (m.attachments as any[]).slice(0, 20).map((a) => ({ nom: String(a.filename ?? "fichier").slice(0, 120), taille: a.content?.byteLength ?? 0 })) : null,
    message_id: String(m.messageId ?? "").slice(0, 300) || null, in_reply_to: String(m.inReplyTo ?? "").slice(0, 300) || null,
    order_ref: orderRef, auto_reply: auto,
  };
  const { error } = await db.from("inbox_messages").insert(row);
  if (error) {
    if (String(error.message).includes("duplicate")) return json({ ok: true, ignored: "doublon" });
    await logEvent("error", "messages", "Message de " + email + " non enregistré", { erreur: error.message }, orderRef);
    return json({ error: "error" }, 500);
  }
  await logEvent("info", "messages", (auto ? "Réponse automatique reçue de " : "Nouveau message de ") + (name ? name + " " : "") + "<" + email + "> : « " + (subject || "sans objet") + " »", { pieces_jointes: row.attachments?.length ?? 0 }, orderRef);
  // alerte par email à l'admin (si l'email d'alerte est réglé). « Répondre » dans Gmail écrit directement au client.
  if (!auto) {
    const { data: st } = await db.from("settings").select("value").eq("key", "admin_email").maybeSingle();
    const to = String(st?.value ?? "").trim();
    if (to) {
      const { site } = siteCtx();
      await resendSend(to, {
        subject: "✉️ Message de " + (name || email) + (subject ? " : " + subject : ""),
        html: wrapHtml(`<p style="margin:0 0 6px"><b>${esc(name || "")}</b> &lt;${esc(email)}&gt;${orderRef ? " · commande " + esc(orderRef) : ""}</p><p style="margin:0 0 12px;color:#5b6b86">${esc(subject || "Sans objet")}</p><div style="white-space:pre-wrap;background:#f6f8fc;border-radius:10px;padding:12px;font-size:14px">${esc(text.slice(0, 3000))}</div><p style="text-align:center;margin:20px 0 0"><a href="${esc(site)}/admin" style="display:inline-block;background:${EM.O};color:#fff;font-weight:800;text-decoration:none;padding:12px 20px;border-radius:10px">Répondre depuis l'admin</a></p>`),
        text: "Message de " + (name || "") + " <" + email + ">" + (orderRef ? " (commande " + orderRef + ")" : "") + "\n" + subject + "\n\n" + text.slice(0, 3000) + "\n\nRépondre depuis l'admin : " + site + "/admin",
      }, email).catch(() => null);
    }
  }
  return json({ ok: true });
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET" && new URL(req.url).searchParams.has("sitemap")) return sitemap();
  if (req.method === "GET" && new URL(req.url).searchParams.has("feed")) return productFeed(String(new URL(req.url).searchParams.get("feed")));
  if (req.method === "POST" && new URL(req.url).searchParams.has("inbound")) return inbound(req);
  if (req.method !== "POST") return json({ error: "method" }, 405);

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch (_) { return json({ error: "bad_json" }, 400); }

  switch (body.action) {
    // ---------- Statistiques de visites ----------
    case "hit": {
      const ua = req.headers.get("user-agent") ?? "";
      if (/bot|crawl|spider|preview|facebookexternalhit|whatsapp/i.test(ua)) return json({ ok: true });
      const page = str(body.page, 100).split("?")[0] || "/";
      let ref = "";
      try { ref = body.ref ? new URL(String(body.ref)).hostname.replace(/^www\./, "") : ""; } catch (_) { /* ignore */ }
      if (ref.endsWith("licenceoff.com") || ref.endsWith("pages.dev")) ref = "";
      await db.from("page_views").insert({
        page, visitor: str(body.v, 40) || null, referrer: ref.slice(0, 100) || null,
        device: /Mobi|Android|iPhone/i.test(ua) ? "mobile" : "ordinateur",
      });
      return json({ ok: true });
    }

    // ---------- Catalogue complet ----------
    case "catalog": {
      const [{ data: cats }, { data: prods, error }] = await Promise.all([
        db.from("categories").select("id, slug, name, sort, parent_id, description").eq("active", true).order("sort").order("name"),
        db.from("products").select(PRODUCT_FIELDS).eq("active", true).order("sort").order("name"),
      ]);
      if (error) return json({ error: "error" }, 500);
      const byId = Object.fromEntries((cats ?? []).map((c) => [c.id, c]));
      const counts = await stockCounts((prods ?? []).filter((p) => STOCK_TYPES.includes(p.delivery_type)).map((p) => p.id));
      return json({
        // parent = slug de la catégorie principale (null pour une catégorie principale)
        categories: (cats ?? []).map((c) => ({ slug: c.slug, name: c.name, description: c.description ?? "", parent: byId[c.parent_id]?.slug ?? null })),
        products: (prods ?? []).map((p) => publicProduct(p, counts, byId)),
      });
    }

    // ---------- Une fiche produit ----------
    case "product": {
      const { data: p } = await db.from("products").select(PRODUCT_FIELDS).eq("slug", str(body.slug, 80)).eq("active", true).maybeSingle();
      if (!p) return json({ error: "not_found" }, 404);
      const { data: cats } = await db.from("categories").select("id, slug, name, parent_id");
      const byId = Object.fromEntries((cats ?? []).map((c) => [c.id, c]));
      const counts = await stockCounts(STOCK_TYPES.includes(p.delivery_type) ? [p.id] : []);
      const cat = byId[p.category_id], parent = cat?.parent_id ? byId[cat.parent_id] : null;
      // avis validés par l'admin
      const { data: revs } = await db.from("product_reviews").select("name, rating, comment, reply, created_at")
        .eq("product_id", p.id).eq("status", "approved").order("created_at", { ascending: false }).limit(200);
      const all = revs ?? [];
      const rating = all.length ? { avg: Math.round(all.reduce((s, r) => s + r.rating, 0) / all.length * 10) / 10, count: all.length } : null;
      return json({ product: { ...publicProduct(p, counts, byId), category_name: cat?.name ?? null,
        category_parent: parent ? { slug: parent.slug, name: parent.name } : null, rating,
        reviews: all.slice(0, 30).map((r) => ({ name: r.name, rating: r.rating, comment: r.comment ?? "", reply: r.reply ?? "", date: r.created_at })) } });
    }

    // ---------- FAQ ----------
    case "faq": {
      const { data, error } = await db.from("faqs").select("question, answer").eq("active", true).order("sort").order("created_at");
      if (error) return json({ error: "error" }, 500);
      return json({ faqs: data });
    }

    // ---------- Blog ----------
    case "posts": {
      const { data, error } = await db.from("posts").select("slug, title, excerpt, cover_url, published_at")
        .eq("published", true).order("published_at", { ascending: false }).limit(Math.min(Number(body.limit) || 50, 100));
      if (error) return json({ error: "error" }, 500);
      return json({ posts: data });
    }
    // ---------- Pages libres (créées dans l'admin) ----------
    case "nav": { // liens du menu et du pied de page
      const [{ data }, { data: px }] = await Promise.all([
        db.from("pages").select("slug, title, in_menu, in_footer").eq("published", true).order("sort").order("title"),
        db.from("settings").select("value").eq("key", "meta_pixel_id").maybeSingle(),
      ]);
      return json({ pixel: /^\d{5,20}$/.test(String(px?.value ?? "")) ? String(px?.value) : "", menu: (data ?? []).filter((p) => p.in_menu).map((p) => ({ slug: p.slug, title: p.title })),
        footer: (data ?? []).filter((p) => p.in_footer).map((p) => ({ slug: p.slug, title: p.title })) });
    }
    case "page": {
      const { data } = await db.from("pages").select("slug, title, content, image_url, seo_title, seo_description, updated_at")
        .eq("slug", str(body.slug, 120)).eq("published", true).maybeSingle();
      if (!data) return json({ error: "not_found" }, 404);
      return json({ page: data });
    }
    case "post": {
      const { data } = await db.from("posts").select("slug, title, excerpt, content, cover_url, published_at, updated_at")
        .eq("slug", str(body.slug, 120)).eq("published", true).maybeSingle();
      if (!data) return json({ error: "not_found" }, 404);
      return json({ post: data });
    }

    // ---------- Parrainage : code d'un lien (?ref=) et prix du panier ----------
    case "ref_info": {
      const rc = await findCode(normCode(body.code));
      if (!rc) return json({ error: "code_invalide" }, 404);
      if (body.click === true) await db.rpc("referral_click", { p_id: rc.id }).then(() => {}, () => {});
      return json({ code: rc.code, discount_pct: Number(rc.discount_pct), parrain: String(rc.parrains?.name ?? "").split(/\s+/)[0] });
    }
    // ---------- Panier : produits physiques et tarifs de livraison ----------
    case "cart_info": {
      const slugs = (Array.isArray(body.slugs) ? body.slugs : []).slice(0, 50).map((x: unknown) => str(x, 80));
      const { data: prods } = slugs.length ? await db.from("products").select("slug, delivery_type").in("slug", slugs).eq("active", true) : { data: [] };
      return json({
        physical: (prods ?? []).filter((p) => p.delivery_type === "physical").map((p) => p.slug),
        shipping: { home: await setting("shipping_home_fcfa", 1500), bus: await setting("shipping_bus_fcfa", 1000) },
      });
    }

    case "quote": { // prix du panier avec le code parrain (le serveur recalcule tout à la commande)
      const rc = await findCode(normCode(body.code));
      const slugs = (Array.isArray(body.slugs) ? body.slugs : []).slice(0, 30).map((x: unknown) => str(x, 80));
      const { data: prods } = await db.from("products").select("slug, price_fcfa, wholesale_price_fcfa").in("slug", slugs).eq("active", true);
      return json({ code: rc?.code ?? null, discount_pct: rc ? Number(rc.discount_pct) : 0,
        prices: Object.fromEntries((prods ?? []).map((p) => [p.slug, referralPrice(p, rc ? Number(rc.discount_pct) : 0).unit])) });
    }

    // ---------- Espace parrain (connexion par lien envoyé par email) ----------
    // ================= Comptes clients (lien magique, sans mot de passe) =================
    case "account_login": {
      const email = str(body.email, 200).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "email_invalide" }, 400);
      // anti-abus : 5 liens par email et par heure
      const { data: c0 } = await db.from("customers").select("id").eq("email", email).maybeSingle();
      let cid = c0?.id as string | undefined;
      if (cid) {
        const { count } = await db.from("customer_sessions").select("token_hash", { count: "exact", head: true })
          .eq("customer_id", cid).eq("kind", "login").gte("created_at", new Date(Date.now() - 3600_000).toISOString());
        if ((count ?? 0) >= 5) { await logEvent("warn", "connexion", "Trop de demandes de lien de connexion pour " + email + " (5 par heure) : bloqué"); return json({ ok: true }); }
      } else {
        // nom repris de la dernière commande passée avec cet email, s'il y en a une
        const { data: last } = await db.from("orders").select("customer_name, phone").eq("email", email).order("created_at", { ascending: false }).limit(1).maybeSingle();
        const { data: c1, error } = await db.from("customers").insert({ email, name: last?.customer_name ?? null, phone: last?.phone ?? null }).select("id").single();
        if (error) return json({ error: "error" }, 500);
        cid = c1.id;
      }
      const t = newToken(32);
      await db.from("customer_sessions").insert({ token_hash: await sha256(t), customer_id: cid, kind: "login", expires_at: new Date(Date.now() + 30 * 60_000).toISOString() });
      const { site } = siteCtx();
      const link = site + "/compte?t=" + t;
      await resendSend(email, {
        subject: "Votre lien de connexion — licenceoff",
        html: wrapHtml(`<p style="margin:0 0 12px">Bonjour,</p><p style="margin:0 0 12px">Cliquez sur ce bouton pour ouvrir votre compte licenceoff : vos commandes, vos clés, vos favoris. Le lien marche une seule fois, pendant 30 minutes.</p><p style="text-align:center;margin:22px 0"><a href="${esc(link)}" style="display:inline-block;background:${EM.O};color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">Ouvrir mon compte</a></p><p style="font-size:13px;color:#5b6b86">Vous n'avez rien demandé ? Ignorez cet email.</p>`),
        text: "Votre lien de connexion (30 minutes, une seule fois) : " + link,
      });
      return json({ ok: true });
    }
    case "account_session": {
      const h = await sha256(str(body.t, 100));
      const { data: used } = await db.from("customer_sessions").update({ used_at: new Date().toISOString() })
        .eq("token_hash", h).eq("kind", "login").is("used_at", null).gt("expires_at", new Date().toISOString()).select("customer_id");
      if (!used?.length) return json({ error: "lien_expire" }, 401);
      const cid = used[0].customer_id;
      const s = newToken(32);
      await db.from("customer_sessions").insert({ token_hash: await sha256(s), customer_id: cid, kind: "session", expires_at: new Date(Date.now() + 60 * 86400_000).toISOString() });
      const { data: who } = await db.from("customers").update({ last_login_at: new Date().toISOString() }).eq("id", cid).select("email").maybeSingle();
      await logEvent("info", "connexion", "Client connecté à son compte : " + (who?.email ?? "?"));
      // l'historique de ce navigateur (déjà accepté par les cookies) rejoint le compte
      const v = str(body.v, 40);
      if (v) await db.from("customer_events").update({ customer_id: cid }).eq("visitor", v).is("customer_id", null);
      return json({ s });
    }
    case "account_logout": {
      await db.from("customer_sessions").delete().eq("token_hash", await sha256(str(body.s, 100))).eq("kind", "session");
      return json({ ok: true });
    }
    case "account_me": {
      const c = await customerFromSession(body.s);
      if (!c) return json({ error: "non_connecte" }, 401);
      const [{ data: orders }, { data: favs }, { data: evs }, { data: prods }, { data: cats }] = await Promise.all([
        db.from("orders").select("ref, public_token, invoice_no, created_at, status, amount_fcfa, order_items(product_id, product_name, quantity)")
          .eq("email", c.email).order("created_at", { ascending: false }).limit(100),
        db.from("customer_favorites").select("product_id, created_at").eq("customer_id", c.id).order("created_at", { ascending: false }),
        db.from("customer_events").select("kind, product_id, query, created_at").eq("customer_id", c.id).order("created_at", { ascending: false }).limit(200),
        db.from("products").select(PRODUCT_FIELDS).eq("active", true).order("sort").order("name"),
        db.from("categories").select("id, slug, name, parent_id, sort").eq("active", true).order("sort"),
      ]);
      const byId = Object.fromEntries((cats ?? []).map((k) => [k.id, k]));
      const plist = prods ?? [];
      const counts = await stockCounts(plist.filter((p) => STOCK_TYPES.includes(p.delivery_type)).map((p) => p.id));
      const pById = Object.fromEntries(plist.map((p) => [p.id, p]));
      const pub = (id: string) => pById[id] ? publicProduct(pById[id], counts, byId) : null;
      // deno-lint-ignore no-explicit-any
      const bought = new Set((orders ?? []).filter((o: any) => ["paid", "processing", "installing", "delivered"].includes(o.status)).flatMap((o: any) => (o.order_items ?? []).map((i: any) => i.product_id)));
      const favIds = (favs ?? []).map((f) => f.product_id).filter((id) => pById[id]);
      const views = (evs ?? []).filter((e) => e.kind === "view" && e.product_id && pById[e.product_id]).map((e) => e.product_id as string);
      // suggestions : catégories (et catégorie parente) des produits vus, favoris, achetés, et centres d'intérêt
      const score: Record<string, number> = {};
      const addCat = (catId: string | null, w: number) => {
        if (!catId) return;
        score[catId] = (score[catId] ?? 0) + w;
        const par = byId[catId]?.parent_id; if (par) score[par] = (score[par] ?? 0) + w / 2;
      };
      for (const id of views.slice(0, 50)) addCat(pById[id].category_id, 1);
      for (const id of favIds) addCat(pById[id].category_id, 3);
      for (const id of bought) if (pById[id as string]) addCat(pById[id as string].category_id, 2);
      const interests: string[] = c.interests ?? [];
      for (const k of cats ?? []) if (interests.includes(k.slug)) addCat(k.id, 3);
      const pScore = (p: { category_id: string | null; featured: boolean }) => (p.category_id ? (score[p.category_id] ?? 0) + (score[byId[p.category_id]?.parent_id] ?? 0) / 2 : 0) + (p.featured ? 0.5 : 0);
      const suggestions = plist.filter((p) => !bought.has(p.id) && !favIds.includes(p.id))
        .map((p) => ({ p, sc: pScore(p) })).sort((a, b) => b.sc - a.sc).slice(0, 8).map((x) => publicProduct(x.p, counts, byId));
      return json({
        me: { email: c.email, name: c.name ?? "", phone: c.phone ?? "", interests, created_at: c.created_at },
        // deno-lint-ignore no-explicit-any
        orders: (orders ?? []).map((o: any) => ({ ref: o.ref, token: o.public_token, invoice: !!o.invoice_no, date: o.created_at, status: o.status, amount: o.amount_fcfa,
          // deno-lint-ignore no-explicit-any
          items: (o.order_items ?? []).map((i: any) => (i.quantity > 1 ? i.quantity + " × " : "") + i.product_name).join(", ") })),
        favorites: favIds.map(pub).filter(Boolean),
        recent: [...new Set(views)].slice(0, 8).map(pub).filter(Boolean),
        searches: [...new Set((evs ?? []).filter((e) => e.kind === "search" && e.query).map((e) => e.query as string))].slice(0, 10),
        suggestions,
        categories: (cats ?? []).map((k) => ({ slug: k.slug, name: k.name, parent: k.parent_id ? byId[k.parent_id]?.slug ?? null : null })),
      });
    }
    case "account_save": {
      const c = await customerFromSession(body.s);
      if (!c) return json({ error: "non_connecte" }, 401);
      const interests = (Array.isArray(body.interests) ? body.interests : []).slice(0, 30).map((x: unknown) => str(x, 80)).filter(Boolean);
      await db.from("customers").update({ name: str(body.name, 120) || null, phone: str(body.phone, 40) || null, interests }).eq("id", c.id);
      return json({ ok: true });
    }
    case "account_history_clear": {
      const c = await customerFromSession(body.s);
      if (!c) return json({ error: "non_connecte" }, 401);
      await db.from("customer_events").delete().eq("customer_id", c.id);
      return json({ ok: true });
    }
    case "account_delete": { // les commandes restent (comptabilité), le compte, les favoris et l'historique sont effacés
      const c = await customerFromSession(body.s);
      if (!c) return json({ error: "non_connecte" }, 401);
      await db.from("customers").delete().eq("id", c.id);
      return json({ ok: true });
    }
    case "fav": { // état du favori ; avec "set" : ajouter / retirer
      const c = await customerFromSession(body.s);
      if (!c) return json({ error: "non_connecte" }, 401);
      const { data: p } = await db.from("products").select("id").eq("slug", str(body.slug, 80)).maybeSingle();
      if (!p) return json({ error: "not_found" }, 404);
      if (body.set === true) await db.from("customer_favorites").upsert({ customer_id: c.id, product_id: p.id });
      if (body.set === false) await db.from("customer_favorites").delete().eq("customer_id", c.id).eq("product_id", p.id);
      const { count } = await db.from("customer_favorites").select("product_id", { count: "exact", head: true }).eq("customer_id", c.id).eq("product_id", p.id);
      return json({ fav: (count ?? 0) > 0 });
    }
    case "track": { // appelé par le site seulement si le visiteur a accepté les cookies
      const kind = body.kind === "search" ? "search" : body.kind === "view" ? "view" : null;
      if (!kind) return json({ ok: true });
      const c = await customerFromSession(body.s);
      const visitor = str(body.v, 40) || null;
      if (!c && !visitor) return json({ ok: true });
      let product_id: string | null = null;
      if (kind === "view") {
        const { data: p } = await db.from("products").select("id").eq("slug", str(body.slug, 80)).maybeSingle();
        if (!p) return json({ ok: true });
        product_id = p.id;
      }
      const query = kind === "search" ? str(body.q, 100) : null;
      if (kind === "search" && !query) return json({ ok: true });
      await db.from("customer_events").insert({ customer_id: c?.id ?? null, visitor, kind, product_id, query });
      return json({ ok: true });
    }

    case "parrain_login": {
      const email = str(body.email, 200).toLowerCase();
      const { data: pr } = await db.from("parrains").select("id, name, email, status").eq("email", email).maybeSingle();
      if (pr && pr.status === "active") {
        const t = newToken(32);
        await db.from("parrain_sessions").insert({ token_hash: await sha256(t), parrain_id: pr.id, kind: "login", expires_at: new Date(Date.now() + 30 * 60_000).toISOString() });
        const { site } = siteCtx();
        const link = site + "/parrain?t=" + t;
        await resendSend(pr.email, {
          subject: "Votre lien de connexion — espace parrain licenceoff",
          html: wrapHtml(`<p style="margin:0 0 12px">Bonjour ${esc(String(pr.name).split(/\s+/)[0])},</p><p style="margin:0 0 12px">Cliquez sur ce bouton pour ouvrir votre espace parrain. Le lien marche une seule fois, pendant 30 minutes.</p><p style="text-align:center;margin:22px 0"><a href="${esc(link)}" style="display:inline-block;background:${EM.O};color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">Ouvrir mon espace parrain</a></p><p style="font-size:13px;color:#5b6b86">Vous n'avez rien demandé ? Ignorez cet email.</p>`),
          text: "Votre lien de connexion (30 minutes, une seule fois) : " + link,
        });
      }
      return json({ ok: true }); // même réponse dans tous les cas
    }
    case "parrain_session": {
      const h = await sha256(str(body.t, 100));
      const { data: used } = await db.from("parrain_sessions").update({ used_at: new Date().toISOString() })
        .eq("token_hash", h).eq("kind", "login").is("used_at", null).gt("expires_at", new Date().toISOString()).select("parrain_id");
      if (!used?.length) return json({ error: "lien_expire" }, 401);
      const s = newToken(32);
      const { data: pw } = await db.from("parrains").select("name").eq("id", used[0].parrain_id).maybeSingle();
      await logEvent("info", "connexion", "Parrain connecté à son espace : " + (pw?.name ?? "?"));
      await db.from("parrain_sessions").insert({ token_hash: await sha256(s), parrain_id: used[0].parrain_id, kind: "session", expires_at: new Date(Date.now() + 30 * 86400_000).toISOString() });
      return json({ s });
    }
    case "parrain_logout": {
      await db.from("parrain_sessions").delete().eq("token_hash", await sha256(str(body.s, 100))).eq("kind", "session");
      return json({ ok: true });
    }
    case "parrain_me": {
      const pr = await parrainFromSession(body.s);
      if (!pr) return json({ error: "non_connecte" }, 401);
      const [{ data: codes }, { data: prods }, { data: orders }, { data: payouts }, threshold, bal] = await Promise.all([
        db.from("referral_codes").select("id, code, label, discount_pct, active, clicks, created_at").eq("parrain_id", pr.id).order("created_at"),
        db.from("products").select("slug, name, price_fcfa, wholesale_price_fcfa").eq("active", true).order("sort").order("name"),
        db.from("orders").select("ref, created_at, paid_at, status, amount_fcfa, commission_fcfa, referral_code, customer_name, email, order_items(product_name, quantity)")
          .eq("parrain_id", pr.id).order("created_at", { ascending: false }).limit(300),
        db.from("payouts").select("amount_fcfa, status, created_at, paid_at").eq("parrain_id", pr.id).order("created_at", { ascending: false }),
        setting("payout_threshold", 10000),
        db.rpc("parrain_balance", { p_parrain: pr.id }),
      ]);
      const paid = (orders ?? []).filter((o) => o.paid_at && o.status !== "cancelled");
      const maskMail = (e: string) => { const [u, d] = String(e).split("@"); return (u ?? "").slice(0, 2) + "***@" + (d ?? ""); };
      return json({
        me: { name: pr.name, email: pr.email, phone: pr.phone, payout_info: pr.payout_info },
        codes, threshold,
        balance: Number(bal.data ?? 0),
        earned: paid.reduce((s, o) => s + o.commission_fcfa, 0),
        to_pay: (payouts ?? []).filter((p) => p.status === "to_pay").reduce((s, p) => s + p.amount_fcfa, 0),
        paid_out: (payouts ?? []).filter((p) => p.status === "paid").reduce((s, p) => s + p.amount_fcfa, 0),
        payouts,
        products: (prods ?? []).filter((p) => p.wholesale_price_fcfa != null && p.wholesale_price_fcfa < p.price_fcfa)
          .map((p) => ({ slug: p.slug, name: p.name, price: p.price_fcfa, wholesale: p.wholesale_price_fcfa })),
        sales: (orders ?? []).map((o) => ({ ref: o.ref, date: o.created_at, paid: !!o.paid_at && o.status !== "cancelled", status: o.status,
          amount: o.amount_fcfa, gain: o.commission_fcfa, code: o.referral_code, client: String(o.customer_name).split(/\s+/)[0] + " · " + maskMail(o.email),
          items: (o.order_items ?? []).map((i: { product_name: string; quantity: number }) => (i.quantity > 1 ? i.quantity + " × " : "") + i.product_name).join(", ") })),
      });
    }
    case "parrain_code_save": {
      const pr = await parrainFromSession(body.s);
      if (!pr) return json({ error: "non_connecte" }, 401);
      const pct = Math.round(Math.min(90, Math.max(0, Number(body.discount_pct) || 0)) * 100) / 100;
      const row = { label: str(body.label, 60) || null, discount_pct: pct, active: body.active !== false };
      if (body.id) {
        const { error } = await db.from("referral_codes").update(row).eq("id", str(body.id, 40)).eq("parrain_id", pr.id);
        if (error) return json({ error: "error" }, 500);
        return json({ ok: true });
      }
      const code = normCode(body.code);
      if (code.length < 3 || code.length > 20) return json({ error: "code_invalide" }, 400);
      const { count } = await db.from("referral_codes").select("id", { count: "exact", head: true }).eq("parrain_id", pr.id);
      if ((count ?? 0) >= 50) return json({ error: "trop_de_codes" }, 400);
      const { error } = await db.from("referral_codes").insert({ ...row, code, parrain_id: pr.id });
      if (error) return json({ error: String(error.message).includes("duplicate") ? "code_pris" : "error" }, 400);
      return json({ ok: true });
    }
    case "parrain_profile_save": {
      const pr = await parrainFromSession(body.s);
      if (!pr) return json({ error: "non_connecte" }, 401);
      await db.from("parrains").update({ payout_info: str(body.payout_info, 120) || null, phone: str(body.phone, 30) || null }).eq("id", pr.id);
      return json({ ok: true });
    }

    // ---------- Nouvelle commande (panier) ----------
    case "create_order": {
      if (str(body.website, 50)) return json({ error: "spam" }, 400); // champ piège invisible
      const name = str(body.name, 100);
      const email = str(body.email, 200).toLowerCase();
      const phone = str(body.phone, 30).replace(/[^\d+]/g, "");
      if (name.length < 2) return json({ error: "nom_invalide" }, 400);
      if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return json({ error: "email_invalide" }, 400);
      if (phone.length < 8) return json({ error: "telephone_invalide" }, 400);

      // regroupe le panier : { slug: quantité }
      const want = new Map<string, number>();
      for (const it of Array.isArray(body.items) ? body.items.slice(0, 30) : []) {
        const slug = str(it?.slug, 80);
        const q = Math.floor(Number(it?.qty));
        if (slug && q > 0) want.set(slug, Math.min(20, (want.get(slug) ?? 0) + q));
      }
      if (!want.size) return json({ error: "panier_vide" }, 400);

      const { data: prods } = await db.from("products").select("id, slug, name, price_fcfa, wholesale_price_fcfa, delivery_type, stock_qty")
        .in("slug", [...want.keys()]).eq("active", true);
      if (!prods || prods.length !== want.size) return json({ error: "produit_introuvable" }, 400);
      const counts = await stockCounts(prods.filter((p) => STOCK_TYPES.includes(p.delivery_type)).map((p) => p.id));
      for (const p of prods) {
        if (STOCK_TYPES.includes(p.delivery_type) && (counts[p.id] ?? 0) < want.get(p.slug)!) {
          return json({ error: "stock_insuffisant", product: p.name, left: counts[p.id] ?? 0 }, 409);
        }
        if (p.delivery_type === "physical" && p.stock_qty != null && p.stock_qty < want.get(p.slug)!) {
          return json({ error: "stock_insuffisant", product: p.name, left: p.stock_qty }, 409);
        }
      }

      // anti-abus : 3 commandes en attente max par email ou téléphone sur 1 heure
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await db.from("orders").select("id", { count: "exact", head: true })
        .eq("status", "pending").gte("created_at", since).or(`email.eq.${email},phone.eq.${phone}`);
      if ((count ?? 0) >= 3) return json({ error: "trop_de_commandes" }, 429);

      // code parrain (lien ?ref= ou saisi dans le panier)
      const rc = await findCode(normCode(body.ref));
      const priced = prods.map((p) => ({ p, q: want.get(p.slug)!, ...referralPrice(p, rc ? Number(rc.discount_pct) : 0) }));
      const total = priced.reduce((s, x) => s + x.unit * x.q, 0);
      const listTotal = priced.reduce((s, x) => s + x.p.price_fcfa * x.q, 0);
      const commission = rc ? priced.reduce((s, x) => s + x.gain * x.q, 0) : 0;
      if (total <= 0) return json({ error: "montant_invalide" }, 400);

      // livraison des produits physiques (Dakar seulement ; hors Dakar, le client passe par WhatsApp)
      const hasPhysical = prods.some((p) => p.delivery_type === "physical");
      let ship: Record<string, unknown> = { shipping_fee_fcfa: 0 };
      if (hasPhysical) {
        const sh = body.shipping ?? {};
        const method = ["home", "bus"].includes(sh.method) ? sh.method : null;
        const address = str(sh.address, 300), zone = str(sh.zone, 80);
        if (!method) return json({ error: "livraison_manquante" }, 400);
        if (address.length < 4) return json({ error: "adresse_manquante" }, 400);
        const lat = Number(sh.lat), lng = Number(sh.lng);
        const okPos = sh.lat != null && sh.lng != null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
        const fee = Math.max(0, Math.round(await setting(method === "home" ? "shipping_home_fcfa" : "shipping_bus_fcfa", method === "home" ? 1500 : 1000)));
        ship = { shipping_method: method, shipping_fee_fcfa: fee, shipping_address: address, shipping_zone: zone || null,
          shipping_lat: okPos ? Math.round(lat * 1e6) / 1e6 : null, shipping_lng: okPos ? Math.round(lng * 1e6) / 1e6 : null };
      }

      for (let i = 0; i < 4; i++) {
        const row = {
          ref: newRef(), public_token: newToken(), customer_name: name, email, phone,
          amount_fcfa: total + Number(ship.shipping_fee_fcfa), payment_method: "paydunya", source: "site", ...ship,
          // CRM / anti-fraude (voir la page Confidentialité)
          ip: (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim().slice(0, 64) || null,
          user_agent: (req.headers.get("user-agent") ?? "").slice(0, 200) || null,
          parrain_id: rc?.parrain_id ?? null, referral_code_id: rc?.id ?? null, referral_code: rc?.code ?? null,
          ...originOf(body.origin),
          discount_fcfa: listTotal - total, commission_fcfa: commission,
        };
        const { data: o, error } = await db.from("orders").insert(row).select("id").single();
        if (error) {
          if (String(error.message).includes("duplicate")) continue;
          await logEvent("error", "boutique", "Une commande n'a pas pu être enregistrée", { erreur: error.message, email });
          return json({ error: "error" }, 500);
        }
        const { error: e2 } = await db.from("order_items").insert(priced.map((x) => ({
          order_id: o.id, product_id: x.p.id, product_name: x.p.name, delivery_type: x.p.delivery_type,
          unit_price: x.unit, quantity: x.q, list_price: x.p.price_fcfa, wholesale_price: x.wholesale,
        })));
        if (e2) { await db.from("orders").delete().eq("id", o.id); await logEvent("error", "boutique", "Une commande n'a pas pu être enregistrée (articles)", { erreur: e2.message, email }); return json({ error: "error" }, 500); }
        await logEvent("info", "boutique", "Nouvelle commande de " + name + " : " + row.amount_fcfa + " FCFA (en attente de paiement)", { articles: priced.map((x) => x.q + " x " + x.p.name), code_parrain: rc?.code ?? null }, row.ref);
        return json({ ref: row.ref, token: row.public_token });
      }
      return json({ error: "error" }, 500);
    }

    // ---------- Le client indique son n° de transaction (paiement manuel) ----------
    case "add_payment_ref": {
      const token = str(body.o, 64);
      const payRef = str(body.payment_ref, 100);
      if (!token || !payRef) return json({ error: "invalide" }, 400);
      const { data: upd, error } = await db.from("orders").update({ payment_ref: payRef, payment_method: "manuel" })
        .eq("public_token", token).eq("status", "pending").select("ref");
      if (error) return json({ error: "error" }, 500);
      if (upd?.length) await logEvent("warn", "paiement", "Le client dit avoir payé (Wave / Orange Money) : vérifiez et validez la commande", { numero_transaction: payRef }, upd[0].ref);
      return json({ ok: true });
    }

    // ---------- Livraison en 2 temps : « J'ai fini l'installation » (bouton à usage unique) ----------
    case "claim": {
      const token = str(body.o, 64), itemId = str(body.i, 40);
      if (!token || !itemId) return json({ error: "not_found" }, 404);
      const { data: o } = await db.from("orders").select("id").eq("public_token", token).maybeSingle();
      if (!o) return json({ error: "not_found" }, 404);
      const { data: it } = await db.from("order_items").update({ claim_requested_at: new Date().toISOString() })
        .eq("id", itemId).eq("order_id", o.id).eq("status", "awaiting_install").is("claim_requested_at", null).select("id");
      if (!it?.length) return json({ error: "deja_demande" }, 400);
      const tokens = Array.from({ length: 10 }, () => newToken());
      const { data, error } = await db.rpc("deliver_order_v3", { p_order_id: o.id, p_tokens: tokens, p_days: 7, p_force: false });
      if (error) { await logEvent("error", "livraison", "Le client a fini l'installation mais l'envoi de la clé a échoué", { erreur: error.message }, await orderRefOf(o.id)); return json({ error: "error" }, 500); }
      await sendOrderEmails(o.id, data?.reason);
      // delivered : clé envoyée ; to_process : livraison auto désactivée, l'admin l'envoie ; out_of_stock : dès réception du stock
      return json({ ok: true, reason: data?.reason });
    }

    // ---------- Avis client (seulement un acheteur, 1 avis par article, validé par l'admin) ----------
    case "review": {
      const token = str(body.o, 64), itemId = str(body.i, 40);
      const rating = Math.round(Number(body.rating));
      if (!token || !itemId) return json({ error: "not_found" }, 404);
      if (!(rating >= 1 && rating <= 5)) return json({ error: "note_invalide" }, 400);
      const { data: o } = await db.from("orders").select("id, customer_name").eq("public_token", token).maybeSingle();
      if (!o) return json({ error: "not_found" }, 404);
      const { data: it } = await db.from("order_items").select("id, product_id, status").eq("id", itemId).eq("order_id", o.id).maybeSingle();
      if (!it || it.status !== "delivered" || !it.product_id) return json({ error: "pas_encore_livre" }, 400);
      const name = str(body.name, 40) || String(o.customer_name ?? "Client").split(/\s+/)[0];
      const { error } = await db.from("product_reviews").insert({ product_id: it.product_id, order_item_id: it.id, name, rating, comment: str(body.comment, 1000) || null });
      if (error) return json({ error: error.message.includes("duplicate") ? "deja_note" : "error" }, 400);
      return json({ ok: true });
    }

    // ---------- Page de suivi du client ----------
    case "invoice": { // facture d'une commande (o = jeton de la commande) ou devis (d = jeton du devis)
      const { data: st } = await db.from("settings").select("key, value")
        .in("key", ["invoice_legal_name", "invoice_address", "invoice_phone", "invoice_email", "invoice_ninea", "invoice_rc"]);
      const seller: Record<string, string> = {};
      for (const r of st ?? []) seller[r.key.replace("invoice_", "")] = String(r.value ?? "");
      if (!seller.legal_name) seller.legal_name = "licenceoff";
      const { wa } = siteCtx();
      seller.whatsapp = wa;
      const dTok = str(body.d, 80), oTok = str(body.o, 80);
      if (dTok) {
        const { data: q } = await db.from("quotes").select("*").eq("public_token", dTok).maybeSingle();
        if (!q) return json({ error: "not_found" }, 404);
        // deno-lint-ignore no-explicit-any
        const lines = ((q.items ?? []) as any[]).map((i) => ({ name: String(i.name ?? ""), qty: Number(i.qty) || 1, unit_price: Number(i.unit_price) || 0 }));
        return json({ kind: "quote", seller, no: q.quote_no, date: q.created_at, valid_until: q.valid_until, status: q.status,
          customer: { name: q.customer_name, company: q.company, email: q.email, phone: q.phone, address: q.address },
          lines, total: q.total_fcfa, vat_rate: Number(q.vat_rate) || 0, notes: q.notes ?? "" });
      }
      if (!oTok) return json({ error: "not_found" }, 404);
      const { data: o } = await db.from("orders")
        .select("ref, invoice_no, invoice_at, status, amount_fcfa, vat_rate, customer_name, email, phone, billing_company, billing_address, shipping_address, shipping_fee_fcfa, discount_fcfa, payment_method, payment_ref, paid_at, created_at, order_items(product_name, quantity, unit_price, created_at)")
        .eq("public_token", oTok).maybeSingle();
      if (!o || !o.invoice_no) return json({ error: "pas_de_facture" }, 404);
      // deno-lint-ignore no-explicit-any
      const lines: { name: string; qty: number; unit_price: number }[] = ((o.order_items ?? []) as any[])
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((i) => ({ name: i.product_name, qty: i.quantity, unit_price: i.unit_price }));
      if (o.shipping_fee_fcfa > 0) lines.push({ name: "Livraison", qty: 1, unit_price: o.shipping_fee_fcfa });
      if (o.discount_fcfa > 0) lines.push({ name: "Remise (code parrain)", qty: 1, unit_price: -o.discount_fcfa });
      const diff = o.amount_fcfa - lines.reduce((t, l) => t + l.qty * l.unit_price, 0);
      if (diff !== 0) lines.push({ name: diff < 0 ? "Remise" : "Ajustement", qty: 1, unit_price: diff });
      return json({ kind: "invoice", seller, no: o.invoice_no, date: o.invoice_at ?? o.paid_at ?? o.created_at, ref: o.ref,
        status: o.status, cancelled: o.status === "cancelled",
        customer: { name: o.customer_name, company: o.billing_company, email: o.email, phone: o.phone, address: o.billing_address || o.shipping_address },
        payment: { method: o.payment_method, ref: o.payment_ref, date: o.paid_at },
        lines, total: o.amount_fcfa, vat_rate: Number(o.vat_rate) || 0 });
    }

    case "status": {
      const token = str(body.o, 64);
      if (!token) return json({ error: "not_found" }, 404);
      const { data: o } = await db.from("orders")
        .select("id, ref, invoice_no, status, amount_fcfa, payment_method, payment_ref, paydunya_token, created_at, delivered_at, shipping_method, shipping_fee_fcfa, shipping_address, shipping_zone, order_items(id, product_name, delivery_type, unit_price, quantity, status, created_at, claim_requested_at, products(slug, image_url, installer_path))")
        .eq("public_token", token).maybeSingle();
      if (!o) return json({ error: "not_found" }, 404);
      const paid = ["paid", "processing", "installing", "delivered"].includes(o.status);

      // deno-lint-ignore no-explicit-any
      const items = ((o.order_items ?? []) as any[]).sort((a, b) => a.created_at.localeCompare(b.created_at));
      const ids = items.map((i) => i.id);
      // articles déjà notés par le client
      const { data: revd } = ids.length ? await db.from("product_reviews").select("order_item_id").in("order_item_id", ids) : { data: [] };
      const reviewedIds = new Set((revd ?? []).map((r) => r.order_item_id));
      const keysByItem: Record<string, string[]> = {};
      // deno-lint-ignore no-explicit-any
      const linkByItem: Record<string, any> = {};
      if (paid && ids.length) {
        const { data: ks } = await db.from("license_keys").select("order_item_id, key_value").in("order_item_id", ids).order("sent_at");
        for (const k of ks ?? []) (keysByItem[k.order_item_id] ??= []).push(k.key_value);
        const { data: ls } = await db.from("downloads")
          .select("order_item_id, token, status, download_count, max_downloads, expires_at, created_at")
          .in("order_item_id", ids).eq("status", "active").order("created_at", { ascending: false });
        for (const l of ls ?? []) if (!linkByItem[l.order_item_id]) linkByItem[l.order_item_id] = l;
      }

      return json({
        ref: o.ref, status: o.status, amount_fcfa: o.amount_fcfa, created_at: o.created_at, invoice: !!o.invoice_no,
        payment_method: o.payment_method, has_payment_ref: !!o.payment_ref, has_paydunya: !!o.paydunya_token,
        shipping: o.shipping_method ? { method: o.shipping_method, fee: o.shipping_fee_fcfa, address: o.shipping_address, zone: o.shipping_zone } : null,
        items: items.map((i) => {
          const link = linkByItem[i.id];
          let download = null;
          if (["delivered", "awaiting_install"].includes(i.status) && i.products?.installer_path && ["key_file", "file"].includes(i.delivery_type)) {
            let state = "none";
            if (link) state = link.download_count >= link.max_downloads ? "used" : new Date(link.expires_at) < new Date() ? "expired" : "ready";
            download = { state, token: state === "ready" ? link.token : null };
          }
          return {
            name: i.product_name, slug: i.products?.slug ?? null, image_url: i.products?.image_url ?? "",
            delivery_type: i.delivery_type, unit_price: i.unit_price, quantity: i.quantity, status: i.status,
            keys: i.status === "delivered" ? (keysByItem[i.id] ?? []) : [], download,
            id: i.id, can_claim: i.status === "awaiting_install" && !i.claim_requested_at,
            claimed: !!i.claim_requested_at && i.status !== "delivered",
            reviewed: reviewedIds.has(i.id),
            can_review: i.status === "delivered" && !!i.products?.slug && !reviewedIds.has(i.id),
          };
        }),
      });
    }

    default:
      return json({ error: "action_inconnue" }, 400);
  }
}
