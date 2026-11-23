// ============================================================
// Fonction "paydunya" : paiement en ligne (Wave, Orange Money,
// carte…) via PayDunya, puis livraison AUTOMATIQUE de la commande
// (tous les articles du panier).
// Supabase > Edge Functions > nom : paydunya
// IMPORTANT : désactiver "Verify JWT" pour cette fonction.
//
// Secrets à créer (Supabase > Edge Functions > Secrets) :
//   PAYDUNYA_MASTER_KEY, PAYDUNYA_PRIVATE_KEY, PAYDUNYA_TOKEN
//   PAYDUNYA_MODE = test   (puis "live" quand tout marche)
//   SITE_URL      = https://www.licenceoff.com
//
// Sécurité : on ne croit JAMAIS ce que dit la notification (IPN).
// On redemande toujours à PayDunya l'état réel de la facture
// (confirm) et on vérifie le montant avant de livrer.
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

const MODE = (Deno.env.get("PAYDUNYA_MODE") ?? "test").trim().toLowerCase();
const API = MODE === "live" ? "https://app.paydunya.com/api/v1" : "https://app.paydunya.com/sandbox-api/v1";
const SITE = (Deno.env.get("SITE_URL") ?? "https://www.licenceoff.com").trim().replace(/\/$/, "");
const FN_URL = Deno.env.get("SUPABASE_URL")! + "/functions/v1/paydunya";

function keys() {
  const k = {
    "PAYDUNYA-MASTER-KEY": (Deno.env.get("PAYDUNYA_MASTER_KEY") ?? "").trim(),
    "PAYDUNYA-PRIVATE-KEY": (Deno.env.get("PAYDUNYA_PRIVATE_KEY") ?? "").trim(),
    "PAYDUNYA-TOKEN": (Deno.env.get("PAYDUNYA_TOKEN") ?? "").trim(),
  };
  return Object.values(k).every(Boolean) ? k : null;
}

function newToken(n = 18): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
const buttonHtml = (link: string) => `<p style="text-align:center;margin:22px 0"><a href="${esc(link)}" style="display:inline-block;background:${EM.O};color:#fff;font-weight:800;text-decoration:none;padding:14px 22px;border-radius:10px">Voir ma commande et télécharger</a></p>`;

function vars(c: Ctx) {
  const parts = String(c.o.customer_name ?? "").trim().split(/\s+/);
  return { prenom: parts[0] || "", nom: String(c.o.customer_name ?? ""), commande: String(c.o.ref), total: fcfaTxt(c.o.amount_fcfa), lien_commande: c.link, lien_installation: c.install ?? c.link, whatsapp: "https://wa.me/" + c.wa,
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
  const sub = (s: string) => s.replace(/\{(prenom|nom|commande|total|lien_commande|lien_installation|whatsapp|version|produit)\}/g, (_, k) => v[k]).replace(/ {2,}/g, " ");
  // HTML
  const blocks = b.replace(/\r/g, "").split(/\n{2,}/).map((para) => {
    const t = para.trim();
    if (t === "{produits}") return productsHtml(c.items);
    if (t === "{cles}") return keysHtml(c.items);
    if (t === "{bouton}") return buttonHtml(c.link);
    if (t === "{bouton_installation}") return installButtonHtml(c.install ?? c.link);
    const inline = (s: string) => esc(sub(s))
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, `<a href="$2" style="color:${EM.B};font-weight:700">$1</a>`);
    const lines = t.split("\n");
    if (lines.every((l) => /^\s*-\s+/.test(l))) return "<ul style=\"margin:6px 0;padding-left:20px\">" + lines.map((l) => "<li>" + inline(l.replace(/^\s*-\s+/, "")) + "</li>").join("") + "</ul>";
    return `<p style="margin:0 0 12px;line-height:1.6">${lines.map(inline).join("<br>")}</p>`;
  }).join("");
  const html = blocks.replace(/\{produits\}/g, productsHtml(c.items)).replace(/\{cles\}/g, keysHtml(c.items)).replace(/\{bouton\}/g, buttonHtml(c.link)).replace(/\{bouton_installation\}/g, installButtonHtml(c.install ?? c.link));
  // Texte
  const text = sub(b).replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 : $2")
    .replace(/\{produits\}/g, productsText(c.items)).replace(/\{cles\}/g, keysText(c.items)).replace(/\{bouton\}/g, "Votre commande : " + c.link)
    .replace(/\{bouton_installation\}/g, "Installation terminée ? Recevez votre clé (lien à usage unique) : " + (c.install ?? c.link));
  return { html, text };
}
// Email « transactionnel » sobre (fond blanc, peu d'images, pas de slogan) : Gmail le classe
// plus souvent dans « Principal » que dans « Promotions ».
function wrapHtml(inner: string, ref?: string) {
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
  ${why}Une question ? Répondez simplement à cet email.<br>
  Pour recevoir nos prochains emails sans problème, ajoutez commandes@licenceoff.com à vos contacts. Si cet email est arrivé dans « Promotions » ou « Spam », déplacez-le dans « Principal ».<br>
  licenceoff — Dakar, Sénégal · www.licenceoff.com</td></tr>
</table></td></tr></table></body></html>`;
}
function renderEmail(tpl: Tpl, c: Ctx) {
  const { html, text } = renderBody(tpl.body, c);
  const v = vars(c) as Record<string, string>;
  const subject = String(tpl.subject || BUILTIN_TPL.subject).replace(/\{(prenom|nom|commande|total|version|produit)\}/g, (_, k) => v[k]).replace(/ {2,}/g, " ").trim().slice(0, 200);
  const ref = String(c.o.ref || "");
  const subj = ref && ref !== "—" && !subject.includes(ref) ? (subject + " — commande " + ref).slice(0, 200) : subject;
  return {
    subject: subj, html: wrapHtml(html, ref && ref !== "—" ? ref : undefined),
    text: text + (ref && ref !== "—" ? "\n\nCet email concerne votre commande " + ref + " sur licenceoff.com." : "") + "\nUne question ? Répondez simplement à cet email.\nPour recevoir nos prochains emails sans problème, ajoutez commandes@licenceoff.com à vos contacts. Si cet email est arrivé dans « Promotions » ou « Spam », déplacez-le dans « Principal ».\nlicenceoff — www.licenceoff.com",
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
    .select("id, ref, public_token, customer_name, email, amount_fcfa, status, emailed_at, order_items(id, product_name, delivery_type, quantity, status, created_at, license_keys(key_value), products(email_template_id))")
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
    .select("id, ref, public_token, customer_name, email, amount_fcfa, status, order_items(id, product_name, delivery_type, quantity, status, created_at, install_emailed_at, products(install_template_id))")
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

// Demande à PayDunya l'état réel de la facture et livre si elle est payée
async function confirmAndDeliver(invoiceToken: string, from = "retour") {
  const k = keys();
  if (!k) { await logEvent("warn", "paiement", "Vérification de paiement impossible : clés PayDunya absentes dans Supabase"); return { ok: false, reason: "invalide" }; }
  if (!invoiceToken || invoiceToken.length > 100) {
    if (from === "ipn") await logEvent("warn", "paiement", "Notification PayDunya reçue sans numéro de facture");
    return { ok: false, reason: "invalide" };
  }

  const { data: o } = await db.from("orders")
    .select("id, ref, status, amount_fcfa").eq("paydunya_token", invoiceToken).maybeSingle();
  if (!o) { await logEvent("warn", "paiement", "Notification PayDunya pour une facture inconnue", { origine: from }); return { ok: false, reason: "commande_introuvable" }; }
  if (["delivered", "processing", "installing"].includes(o.status)) return { ok: true, reason: "already_delivered" };
  if (o.status === "cancelled") return { ok: false, reason: "cancelled" };

  const r = await fetch(API + "/checkout-invoice/confirm/" + encodeURIComponent(invoiceToken), {
    headers: { ...k, "Content-Type": "application/json" },
  });
  // deno-lint-ignore no-explicit-any
  const b: any = await r.json().catch(() => ({}));
  if (b.response_code !== "00") {
    await logEvent("error", "paiement", "PayDunya n'a pas pu confirmer la facture", { origine: from, statut_http: r.status, code: b.response_code, reponse: b.response_text }, o.ref);
    return { ok: false, reason: "confirm_echec" };
  }
  if (b.status !== "completed") {
    if (from === "ipn" || b.status === "cancelled") await logEvent("info", "paiement", "Paiement pas encore terminé (statut PayDunya : " + b.status + ")", { origine: from }, o.ref);
    return { ok: false, reason: "pas_encore_paye", status: b.status };
  }
  if (Number(b.invoice?.total_amount) !== Number(o.amount_fcfa)) {
    await db.from("orders").update({ note: "ALERTE : montant PayDunya différent (" + b.invoice?.total_amount + ")" }).eq("id", o.id);
    await logEvent("error", "paiement", "Montant payé différent du montant de la commande : commande NON livrée", { paye: b.invoice?.total_amount, attendu: o.amount_fcfa }, o.ref);
    return { ok: false, reason: "montant_different" };
  }

  await db.from("orders").update({
    payment_method: "paydunya",
    payment_ref: String(b.receipt_identifier ?? b.provider_reference ?? invoiceToken).slice(0, 100),
  }).eq("id", o.id);

  const tokens = Array.from({ length: 30 }, () => newToken());
  const { data, error } = await db.rpc("deliver_order_v3", { p_order_id: o.id, p_tokens: tokens, p_days: 7, p_force: false });
  await logEvent("info", "paiement", "Paiement reçu : " + o.amount_fcfa + " FCFA", { origine: from, moyen: b.customer?.payment_method ?? b.invoice?.payment_method ?? null }, o.ref);
  if (error) { await logEvent("error", "livraison", "Paiement reçu mais la livraison a échoué", { erreur: error.message }, o.ref); return { ok: false, reason: "error" }; }
  await sendOrderEmails(o.id, data?.reason);
  return data;
}

Deno.serve(async (req) => {
  try { return await handle(req); } catch (e) {
    await logEvent("error", "paiement", "Erreur inattendue dans la fonction paydunya", e);
    return json({ error: "erreur_serveur" }, 500);
  }
});
async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const ctype = req.headers.get("content-type") ?? "";

  // ---------- Notification de PayDunya (IPN) ----------
  if (!ctype.includes("application/json")) {
    let token = "";
    try {
      const f = await req.formData();
      token = String(f.get("data[invoice][token]") ?? f.get("data[token]") ?? f.get("token") ?? "");
    } catch (_) { /* ignore */ }
    const result = await confirmAndDeliver(token, "ipn");
    return json(result);
  }

  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch (_) { return json({ error: "bad_json" }, 400); }
  const pub = String(body.o ?? "").trim().slice(0, 64);
  if (!pub) return json({ error: "not_found" }, 404);

  const { data: o } = await db.from("orders")
    .select("id, ref, status, amount_fcfa, paydunya_token, customer_name, email, phone, order_items(product_name, quantity)")
    .eq("public_token", pub).maybeSingle();
  if (!o) return json({ error: "not_found" }, 404);

  switch (body.action) {
    // ---------- Le client clique "Payer" ----------
    case "create": {
      if (o.status !== "pending") return json({ error: "deja_payee" }, 400);
      const k = keys();
      if (!k) { await logEvent("warn", "paiement", "Un client a voulu payer mais les clés PayDunya ne sont pas encore dans Supabase", null, o.ref); return json({ error: "paydunya_non_configure" }, 503); }
      // deno-lint-ignore no-explicit-any
      const items = (o.order_items ?? []) as any[];
      const prodName = items.map((i) => (i.quantity > 1 ? i.quantity + " x " : "") + i.product_name).join(", ").slice(0, 180) || "Commande";
      const back = SITE + "/commande.html?o=" + encodeURIComponent(pub);
      const r = await fetch(API + "/checkout-invoice/create", {
        method: "POST",
        headers: { ...k, "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice: { total_amount: o.amount_fcfa, description: prodName + " — commande " + o.ref },
          store: { name: "licenceoff", website_url: SITE },
          actions: { return_url: back, cancel_url: back, callback_url: FN_URL },
          custom_data: { order_ref: o.ref },
        }),
      });
      // deno-lint-ignore no-explicit-any
      const b: any = await r.json().catch(() => ({}));
      if (b.response_code !== "00" || !b.token || !b.response_text) {
        await logEvent("error", "paiement", "PayDunya a refusé de créer le paiement", { statut_http: r.status, code: b.response_code, reponse: b.response_text, mode: MODE }, o.ref);
        return json({ error: "paydunya_erreur" }, 502);
      }
      await db.from("orders").update({ paydunya_token: b.token, payment_method: "paydunya" }).eq("id", o.id);
      return json({ url: b.response_text });
    }

    // ---------- Retour du client sur le site : on vérifie tout de suite ----------
    case "check": {
      if (!o.paydunya_token) return json({ ok: false, reason: "pas_de_paiement" });
      return json(await confirmAndDeliver(o.paydunya_token));
    }

    default:
      return json({ error: "action_inconnue" }, 400);
  }
}
