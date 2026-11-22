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
  return { prenom: parts[0] || "", nom: String(c.o.customer_name ?? ""), commande: String(c.o.ref), total: fcfaTxt(c.o.amount_fcfa), lien_commande: c.link, lien_installation: c.install ?? c.link, whatsapp: "https://wa.me/" + c.wa };
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
  const sub = (s: string) => s.replace(/\{(prenom|nom|commande|total|lien_commande|lien_installation|whatsapp)\}/g, (_, k) => v[k]);
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
function wrapHtml(inner: string) {
  const { B, N, O, C } = EM;
  return `<!doctype html><html lang="fr"><body style="margin:0;background:${C};font-family:Nunito,Segoe UI,Arial,sans-serif;color:${N}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:${B};padding:22px 24px">
  <div style="font-size:28px;font-weight:900;letter-spacing:-1px;color:#fff">licence<span style="color:${O}">off</span></div>
  <div style="color:#dbe6fb;font-size:14px">Licences &amp; solutions numériques</div></td></tr>
<tr><td style="padding:24px;font-size:15px">${inner}</td></tr>
<tr><td style="background:${N};color:#d6e0f5;padding:14px 24px;font-size:13px;text-align:center">
  Au Sénégal 🇸🇳 · Des licences authentiques · Votre satisfaction, notre priorité<br>
  <span style="color:${O};font-weight:800;font-style:italic">Vos logiciels, notre engagement !</span></td></tr>
</table></td></tr></table></body></html>`;
}
function renderEmail(tpl: Tpl, c: Ctx) {
  const { html, text } = renderBody(tpl.body, c);
  const v = vars(c) as Record<string, string>;
  const subject = String(tpl.subject || BUILTIN_TPL.subject).replace(/\{(prenom|nom|commande|total)\}/g, (_, k) => v[k]).slice(0, 200);
  return { subject, html: wrapHtml(html), text: text + "\n\nlicenceoff — Vos logiciels, notre engagement !" };
}
function siteCtx() {
  return {
    site: (Deno.env.get("SITE_URL") ?? "https://www.licenceoff.com").trim().replace(/\/$/, ""),
    wa: (Deno.env.get("WHATSAPP_NUMBER") ?? "221777860777").replace(/\D/g, ""),
  };
}
async function resendSend(to: string, mail: { subject: string; html: string; text: string }) {
  const key = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  if (!key) return { ok: false, reason: "resend_non_configure" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: (Deno.env.get("RESEND_FROM") ?? "licenceoff <commandes@licenceoff.com>").trim(),
      to: [to], reply_to: (Deno.env.get("RESEND_REPLY_TO") ?? "").trim() || undefined,
      subject: mail.subject, html: mail.html, text: mail.text,
    }),
  }).catch(() => null);
  if (!r || !r.ok) { console.error("Resend", r ? (await r.text().catch(() => "")).slice(0, 300) : "reseau"); return { ok: false, reason: "envoi_echoue" }; }
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
async function sendOrderEmails(orderId: string, reason?: string) {
  await sendInstallEmail(orderId).catch((e) => console.error("email installation", e));
  if (reason === "delivered") await sendDeliveryEmail(orderId).catch((e) => console.error("email", e));
  await notifyPayouts().catch((e) => console.error("alerte parrainage", e));
}

// Nombre d'unités disponibles par produit (seulement pour les produits à stock)
async function stockCounts(ids: string[]) {
  const out: Record<string, number> = {};
  if (!ids.length) return out;
  const { data } = await db.from("license_keys").select("product_id").in("product_id", ids).eq("status", "available").limit(10000);
  for (const r of data ?? []) out[r.product_id] = (out[r.product_id] ?? 0) + 1;
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
async function setting(key: string, def: number) {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) ? n : def;
}

// Plan du site pour Google (toujours à jour) : …/functions/v1/boutique?sitemap=1 (cité dans robots.txt)
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET" && new URL(req.url).searchParams.has("sitemap")) return sitemap();
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
      const { data } = await db.from("pages").select("slug, title, in_menu, in_footer").eq("published", true).order("sort").order("title");
      return json({ menu: (data ?? []).filter((p) => p.in_menu).map((p) => ({ slug: p.slug, title: p.title })),
        footer: (data ?? []).filter((p) => p.in_footer).map((p) => ({ slug: p.slug, title: p.title })) });
    }
    case "page": {
      const { data } = await db.from("pages").select("slug, title, content, image_url, seo_title, seo_description, updated_at")
        .eq("slug", str(body.slug, 120)).eq("published", true).maybeSingle();
      if (!data) return json({ error: "not_found" }, 404);
      return json({ page: data });
    }
    case "post": {
      const { data } = await db.from("posts").select("slug, title, excerpt, content, cover_url, published_at")
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
          discount_fcfa: listTotal - total, commission_fcfa: commission,
        };
        const { data: o, error } = await db.from("orders").insert(row).select("id").single();
        if (error) {
          if (String(error.message).includes("duplicate")) continue;
          return json({ error: "error" }, 500);
        }
        const { error: e2 } = await db.from("order_items").insert(priced.map((x) => ({
          order_id: o.id, product_id: x.p.id, product_name: x.p.name, delivery_type: x.p.delivery_type,
          unit_price: x.unit, quantity: x.q, list_price: x.p.price_fcfa, wholesale_price: x.wholesale,
        })));
        if (e2) { await db.from("orders").delete().eq("id", o.id); return json({ error: "error" }, 500); }
        return json({ ref: row.ref, token: row.public_token });
      }
      return json({ error: "error" }, 500);
    }

    // ---------- Le client indique son n° de transaction (paiement manuel) ----------
    case "add_payment_ref": {
      const token = str(body.o, 64);
      const payRef = str(body.payment_ref, 100);
      if (!token || !payRef) return json({ error: "invalide" }, 400);
      const { error } = await db.from("orders").update({ payment_ref: payRef, payment_method: "manuel" })
        .eq("public_token", token).eq("status", "pending");
      if (error) return json({ error: "error" }, 500);
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
      if (error) return json({ error: "error" }, 500);
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
    case "status": {
      const token = str(body.o, 64);
      if (!token) return json({ error: "not_found" }, 404);
      const { data: o } = await db.from("orders")
        .select("id, ref, status, amount_fcfa, payment_method, payment_ref, paydunya_token, created_at, delivered_at, shipping_method, shipping_fee_fcfa, shipping_address, shipping_zone, order_items(id, product_name, delivery_type, unit_price, quantity, status, created_at, claim_requested_at, products(slug, image_url, installer_path))")
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
        ref: o.ref, status: o.status, amount_fcfa: o.amount_fcfa, created_at: o.created_at,
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
});
