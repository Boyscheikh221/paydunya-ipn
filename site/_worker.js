// licenceoff.com : petit « aiguilleur » Cloudflare Pages.
// 1) Il reprend les adresses courtes de _redirects (au cas où elles ne s'appliquent pas en présence de ce fichier).
// 2) Quand Facebook, WhatsApp, etc. viennent lire une fiche produit ou un article pour fabriquer l'aperçu d'un partage,
//    il écrit dans la page le vrai titre, la description et l'image du produit / de l'article.
//    (ces robots ne lancent pas le JavaScript du site, ils ne voient que le HTML de départ)
// Toute erreur => la page normale est servie, le site ne peut pas tomber à cause de ce fichier.
const API = "https://vnzpxfoeiixiqxkhdnik.supabase.co/functions/v1/boutique";
const SITE = "https://www.licenceoff.com";
const BOTS = /facebookexternalhit|facebot|meta-externalagent|whatsapp|twitterbot|linkedinbot|telegrambot|slackbot|discordbot|skypeuripreview|pinterest|snapchat|viber|redditbot|embedly|googlebot|bingbot|applebot/i;

const MOVED = { "/categorie/licences-windows": "/categorie/windows", "/categorie/services-informatiques": "/categorie/solutions-pc" };
function rewriteTarget(path) {
  if (/^\/boutique\/?$/.test(path)) return "/categorie";
  if (/^\/categorie\/.+/.test(path)) return "/categorie";
  if (/^\/produit\/[^/]+\/?$/.test(path)) return "/produit";
  if (/^\/blog\/rubrique\/[^/]+\/?$/.test(path)) return "/blog";
  if (/^\/blog\/[^/]+\/?$/.test(path)) return "/article";
  if (/^\/page\/[^/]+\/?$/.test(path)) return "/page";
  if (/^\/services\/[^/]+\/?$/.test(path)) return "/service";
  return null;
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const plain = (t) => String(t || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/https?:\/\/\S+/g, "").replace(/^-{3,}$/gm, "").replace(/[#*>_`]/g, "").replace(/\s+/g, " ").trim();
const cut = (t, n) => (t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, "") + "…");
const abs = (u) => (!u ? null : /^https?:\/\//.test(u) ? u : u.startsWith("/") ? SITE + u : null);
const ytThumb = (u) => { const m = String(u || "").match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/); return m ? "https://i.ytimg.com/vi/" + m[1] + "/hqdefault.jpg" : null; };

async function api(payload) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal });
    return r.ok ? await r.json() : null;
  } finally { clearTimeout(t); }
}

// infos d'aperçu (titre, description, image, adresse) pour un produit ou un article
async function previewFor(path) {
  let m = path.match(/^\/produit\/([^/]+)\/?$/);
  if (m) {
    const slug = decodeURIComponent(m[1]);
    const d = await api({ action: "product", slug }); const p = d && d.product;
    if (!p) return null;
    const price = p.price_fcfa ? " — " + Number(p.price_fcfa).toLocaleString("fr-FR").replace(/ | /g, " ") + " FCFA" : "";
    return { type: "product", title: (p.seo_title || p.name) + price, description: cut(plain(p.seo_description || p.description || p.name), 155),
      image: abs(p.image_url), url: SITE + "/produit/" + encodeURIComponent(p.slug) };
  }
  m = path.match(/^\/blog\/([^/]+)\/?$/);
  if (m) {
    const slug = decodeURIComponent(m[1]);
    const d = await api({ action: "post", slug }); const p = d && d.post;
    if (!p) return null;
    return { type: "article", title: p.title, description: cut(plain(p.excerpt) || plain(p.content) || p.title, 155),
      image: abs(p.cover_url) || ytThumb(p.cover_video), url: SITE + "/blog/" + encodeURIComponent(p.slug) };
  }
  m = path.match(/^\/services\/([^/]+)\/?$/);
  if (m) {
    const slug = decodeURIComponent(m[1]);
    const d = await api({ action: "service", slug }); const p = d && d.service;
    if (!p) return null;
    return { type: "service", title: p.seo_title || p.title, description: cut(plain(p.seo_description || p.short || p.content || p.title), 155),
      image: abs(p.image_url), url: SITE + "/services/" + encodeURIComponent(p.slug) };
  }
  return null;
}

export function injectMeta(html, i) {
  const img = i.image || SITE + "/img/partage.jpg";
  const tags = [
    `<meta property="og:type" content="${i.type === "article" ? "article" : i.type === "service" ? "website" : "product"}">`,
    `<meta property="og:site_name" content="licenceoff.com">`,
    `<meta property="og:title" content="${esc(i.title)}">`,
    `<meta property="og:description" content="${esc(i.description)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:url" content="${esc(i.url)}">`,
    `<meta name="description" content="${esc(i.description)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<link rel="canonical" href="${esc(i.url)}">`,
  ].join("\n");
  return html
    .replace(/<meta\s+property="og:[^"]*"[^>]*>\s*/gi, "")
    .replace(/<meta\s+name="(?:description|twitter:[^"]*)"[^>]*>\s*/gi, "")
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, "")
    .replace(/<title>[^<]*<\/title>/i, `<title>${esc(/licenceoff\.com$/.test(i.title) ? i.title : i.title + " — licenceoff.com")}</title>`)
    .replace(/<\/head>/i, tags + "\n</head>");
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      if (MOVED[path.replace(/\/$/, "")]) return Response.redirect(url.origin + MOVED[path.replace(/\/$/, "")] + url.search, 301);
      // favicon.ico : Cloudflare l'envoie sans type ; Google a besoin d'un vrai type d'image pour afficher le logo
      if (path === "/favicon.ico") {
        const r = await env.ASSETS.fetch(request);
        if (!r.ok) return r;
        const h = new Headers(r.headers); h.set("content-type", "image/x-icon");
        return new Response(r.body, { status: r.status, headers: h });
      }
      const target = rewriteTarget(path);
      if (!target) return env.ASSETS.fetch(request);
      const res = await env.ASSETS.fetch(new Request(url.origin + target, request));
      const ua = request.headers.get("user-agent") || "";
      // ?apercu=1 : permet de vérifier l'aperçu depuis un navigateur normal
      const forced = url.searchParams.get("apercu") === "1";
      if ((!BOTS.test(ua) && !forced) || request.method !== "GET" || !res.ok) return res;
      const info = await previewFor(path).catch(() => null);
      if (!info) return res;
      const html = injectMeta(await res.text(), info);
      const h = new Headers(res.headers); h.delete("content-length"); h.set("content-type", "text/html; charset=utf-8");
      return new Response(html, { status: 200, headers: h });
    } catch (_) {
      return env.ASSETS.fetch(request);
    }
  },
};
