// licenceoff.com : petit « aiguilleur » Cloudflare Pages.
// 1) Il reprend les adresses courtes de _redirects (au cas où elles ne s'appliquent pas en présence de ce fichier).
// 2) Quand un robot vient lire une page (Google, Bing, Facebook, WhatsApp, et les IA : ChatGPT, Claude, Perplexity…),
//    il écrit directement dans la page le vrai contenu : titre, prix, description du produit, questions de la FAQ,
//    texte des articles, liste des produits d'une catégorie, plus les données structurées (Product, FAQPage,
//    BlogPosting, BreadcrumbList). Ces robots ne lancent pas toujours le JavaScript du site : sans ça ils ne voient
//    qu'une page vide. Le contenu écrit est exactement celui que le JavaScript affiche ensuite (il le remplace).
// 3) /llms.txt : résumé du site pour les IA (produits, prix, FAQ, articles), toujours à jour.
// Toute erreur => la page normale est servie, le site ne peut pas tomber à cause de ce fichier.
const API = "https://vnzpxfoeiixiqxkhdnik.supabase.co/functions/v1/boutique";
const SITE = "https://www.licenceoff.com";
const WA = "https://wa.me/221777860777";
// robots des réseaux sociaux, des moteurs de recherche et des IA, + tout logiciel qui se présente comme robot.
// Un visiteur pris pour un robot par erreur ne perd rien : il reçoit la même page, déjà remplie.
const BOTS = new RegExp([
  "facebookexternalhit", "facebot", "meta-external", "whatsapp", "twitterbot", "linkedinbot", "telegrambot", "slackbot", "discordbot",
  "skypeuripreview", "pinterest", "snapchat", "viber", "redditbot", "embedly",
  "googlebot", "google-inspectiontool", "googleother", "google-extended", "adsbot-google", "storebot-google", "bingbot", "bingpreview",
  "applebot", "duckduckbot", "duckassistbot", "yandex", "baiduspider", "qwant", "ecosia", "seznambot",
  "gptbot", "oai-searchbot", "chatgpt-user", "claudebot", "claude-user", "claude-searchbot", "claude-web", "anthropic-ai",
  "perplexitybot", "perplexity-user", "amazonbot", "ccbot", "bytespider", "cohere-ai", "mistralai-user", "youbot", "diffbot",
  "petalbot", "timpibot", "kagibot", "phindbot",
  "bot\\b", "crawler", "spider", "slurp", "curl/", "wget/", "python-requests", "python-urllib", "aiohttp", "httpx", "axios/",
  "node-fetch", "undici", "go-http-client", "okhttp", "java/", "headlesschrome", "lighthouse",
].join("|"), "i");

const MOVED = { "/categorie/licences-windows": "/categorie/windows", "/categorie/services-informatiques": "/categorie/solutions-pc" };
function rewriteTarget(path) {
  if (/^\/boutique\/?$/.test(path)) return "/categorie";
  if (/^\/categorie\/.+/.test(path)) return "/categorie";
  if (/^\/produit\/[^/]+\/?$/.test(path)) return "/produit";
  if (/^\/blog\/rubrique\/[^/]+\/?$/.test(path)) return "/blog";
  if (/^\/blog\/[^/]+\/?$/.test(path)) return "/article";
  if (/^\/page\/[^/]+\/?$/.test(path)) return "/page";
  return null;
}
// pages servies telles quelles mais qu'on remplit aussi pour les robots
const FILLED = /^\/(?:index\.html|faq\/?|blog\/?|categorie\/?)?$/;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const plain = (t) => String(t || "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/https?:\/\/\S+/g, "").replace(/^-{3,}$/gm, "").replace(/[#*>_`]/g, "").replace(/\s+/g, " ").trim();
const cut = (t, n) => (t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, "") + "…");
const abs = (u) => (!u ? null : /^https?:\/\//.test(u) ? u : u.startsWith("/") ? SITE + u : null);
const ytId = (u) => { const m = String(u || "").match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/); return m ? m[1] : null; };
const ytThumb = (u) => { const id = ytId(u); return id ? "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg" : null; };
const fcfa = (n) => Number(n || 0).toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " ") + " FCFA";
const enc = encodeURIComponent;
const U = {
  product: (s) => "/produit/" + enc(s), post: (s) => "/blog/" + enc(s), page: (s) => "/page/" + enc(s),
  category: (s, parent) => "/categorie/" + (parent ? enc(parent) + "/" : "") + enc(s), rubrique: (s) => "/blog/rubrique/" + enc(s),
};
const CHOOSER = "office-pour-mac"; // page de vérification Office pour Mac : pas un produit à part (comme shop.js)
const dateFr = (d) => { try { return new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Dakar" }); } catch (_) { return ""; } };

// texte des articles et des pages (même mise en forme simple que shop.js > richText)
function richHtml(src) {
  const okUrl = (u) => /^(https?:\/\/|\/)/.test(u);
  const inline = (txt) => {
    const re = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*|[a-z0-9-]+\.html[^\s)]*)\)/g;
    let out = "", last = 0, m;
    while ((m = re.exec(txt))) {
      out += esc(txt.slice(last, m.index));
      if (m[1]) out += "<strong>" + esc(m[1]) + "</strong>";
      else if (m[2]) out += "<em>" + esc(m[2]) + "</em>";
      else out += `<a href="${esc(m[4])}">${esc(m[3])}</a>`;
      last = re.lastIndex;
    }
    return out + esc(txt.slice(last));
  };
  let html = "", listTag = "";
  const close = () => { if (listTag) { html += `</${listTag}>`; listTag = ""; } };
  for (const raw of String(src || "").split(/\r?\n/)) {
    const line = raw.trim();
    const ul = /^[-*] /.test(line), ol = /^\d+[.)] /.test(line);
    if (ul || ol) {
      const t = ul ? "ul" : "ol";
      if (listTag !== t) { close(); html += `<${t}>`; listTag = t; }
      html += "<li>" + inline(line.replace(/^([-*]|\d+[.)]) /, "")) + "</li>";
      continue;
    }
    close();
    if (!line) continue;
    const img = line.match(/^!\[([^\]]*)\]\(([^\s)"]+)(?:\s+"([^"]*)")?\)$/);
    if (img && okUrl(img[2])) {
      const dim = img[2].match(/#(\d+)x(\d+)$/);
      const cap = img[3] != null ? img[3] : dim ? "" : img[1];
      html += `<figure class="img"><img src="${esc(img[2].replace(/#.*$/, ""))}" alt="${esc(img[1] || "")}" loading="lazy"${dim ? ` width="${dim[1]}" height="${dim[2]}"` : ""}>`
        + (cap ? `<figcaption>${esc(cap)}</figcaption>` : "") + "</figure>";
      continue;
    }
    const v = ytId(line);
    if (v) { html += `<p><a href="https://www.youtube.com/watch?v=${v}">Vidéo YouTube</a></p>`; continue; }
    if (line === "---") html += "<hr>";
    else if (line.startsWith("> ")) html += "<blockquote>" + inline(line.slice(2)) + "</blockquote>";
    else if (line.startsWith("### ")) html += "<h3>" + inline(line.slice(4)) + "</h3>";
    else if (line.startsWith("## ")) html += "<h2>" + inline(line.slice(3)) + "</h2>";
    else html += "<p>" + inline(line) + "</p>";
  }
  close();
  return html;
}
// texte brut (descriptions produits, réponses FAQ) : paragraphes et retours à la ligne gardés
const textHtml = (t) => String(t || "").trim().split(/\n\s*\n/).map((p) => "<p>" + esc(p.trim()).replace(/\n/g, "<br>") + "</p>").join("");

function crumbs(list) {
  const nav = list.map(([label, href], i) => (i ? '<span class="sep" aria-hidden="true">›</span>' : "")
    + (href && i < list.length - 1 ? `<a href="${esc(href)}">${esc(label)}</a>` : `<span aria-current="page">${esc(label)}</span>`)).join("");
  return {
    html: `<nav class="crumbs" aria-label="Fil d'Ariane">${nav}</nav>`,
    ld: { "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: list.map(([name, href], i) => ({ "@type": "ListItem", position: i + 1, name, item: href ? SITE + href : undefined })) },
  };
}
const card = (p, catName) => `<div class="card"><a href="${U.product(p.slug)}"><h3>${esc(p.name)}</h3></a>`
  + (catName ? `<p class="note">${esc(catName)}</p>` : "")
  + `<p><strong>${p.price_fcfa > 0 ? fcfa(p.price_fcfa) : "Prix sur demande"}</strong>${p.in_stock ? "" : " · Bientôt disponible"}</p>`
  + (p.description ? `<p>${esc(cut(plain(p.description), 220))}</p>` : "") + "</div>";
const listed = (products) => (products || []).filter((p) => p.slug !== CHOOSER);
const catsOf = (d) => {
  const cats = d.categories || [];
  return { cats, bySlug: Object.fromEntries(cats.map((c) => [c.slug, c])), names: Object.fromEntries(cats.map((c) => [c.slug, c.name])) };
};

// lecture de la boutique (gardée 5 min en mémoire Cloudflare pour ne pas surcharger Supabase)
async function api(payload) {
  const key = new Request("https://cache.licenceoff.internal/" + enc(JSON.stringify(payload)));
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) { const hit = await cache.match(key).catch(() => null); if (hit) return hit.json(); }
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal });
    if (!r.ok) return null;
    const txt = await r.text();
    if (cache) await cache.put(key, new Response(txt, { headers: { "content-type": "application/json", "cache-control": "max-age=300" } })).catch(() => {});
    return JSON.parse(txt);
  } finally { clearTimeout(t); }
}

// ce qu'on écrit dans la page : meta (titre, description, image), blocs HTML (#id => contenu), données structurées
async function renderFor(path) {
  let m = path.match(/^\/produit\/([^/]+)\/?$/);
  if (m) {
    const d = await api({ action: "product", slug: decodeURIComponent(m[1]) }); const p = d && d.product;
    if (!p) return null;
    const par = p.category_parent;
    const catPath = p.category ? U.category(p.category, par ? par.slug : null) : null;
    const cr = crumbs([["Accueil", "/"], ["Boutique", "/boutique"], ...(par ? [[par.name, U.category(par.slug)]] : []),
      ...(p.category_name && catPath ? [[p.category_name, catPath]] : []), [p.name]]);
    const all = [p.image_url, ...(p.gallery || [])], alts = p.image_alts || [];
    const altOf = all.map((u, i) => String(alts[i] || "").trim() || (i ? p.name + " — photo " + (i + 1) : p.name)).filter((_, i) => all[i]);
    const pics = all.filter(Boolean);
    const url = SITE + U.product(p.slug);
    const off = p.compare_price_fcfa && p.compare_price_fcfa > p.price_fcfa;
    const rt = p.rating;
    const html = cr.html + '<div class="product">'
      + (pics.length ? '<div class="img">' + pics.map((u, i) => `<img src="${esc(u)}" alt="${esc(altOf[i])}"${i ? ' loading="lazy"' : ""}>`).join("") + "</div>" : "")
      + `<div><h1>${esc(p.name)}</h1>`
      + `<p class="price"><strong>${p.price_fcfa > 0 ? fcfa(p.price_fcfa) : "Prix sur demande"}</strong>${off ? ` <s>${fcfa(p.compare_price_fcfa)}</s>` : ""}</p>`
      + `<p>${p.in_stock ? "En stock" : "Bientôt disponible"}${p.category_name ? " · " + esc(p.category_name) : ""}${rt ? ` · ${rt.avg}/5 (${rt.count} avis)` : ""}</p>`
      + (p.description ? `<h2>Description</h2><div class="desc">${textHtml(p.description)}</div>` : "")
      + `<p>Paiement Wave ou Orange Money. Commande en ligne ou sur <a href="${WA}">WhatsApp</a>. Livraison rapide au Sénégal.</p>`
      + ((p.reviews || []).length ? "<h2>Avis clients</h2>" + p.reviews.slice(0, 10).map((v) => `<blockquote>${"★".repeat(v.rating)} ${esc(v.comment || "")} — ${esc(v.name)}</blockquote>`).join("") : "")
      + "</div></div>";
    const ld = { "@context": "https://schema.org", "@type": "Product", name: p.name, description: p.seo_description || p.description || p.name,
      image: pics.length ? pics : undefined, sku: p.sku || undefined, url, category: p.category_name || undefined,
      brand: /office|windows|microsoft/i.test(p.name) ? { "@type": "Brand", name: "Microsoft" } : undefined,
      aggregateRating: rt ? { "@type": "AggregateRating", ratingValue: rt.avg, reviewCount: rt.count, bestRating: 5, worstRating: 1 } : undefined,
      review: rt ? (p.reviews || []).slice(0, 5).map((v) => ({ "@type": "Review", author: { "@type": "Person", name: v.name }, datePublished: String(v.date).slice(0, 10), reviewBody: v.comment || undefined, reviewRating: { "@type": "Rating", ratingValue: v.rating, bestRating: 5 } })) : undefined,
      offers: p.price_fcfa > 0 ? { "@type": "Offer", price: p.price_fcfa, priceCurrency: "XOF", availability: "https://schema.org/" + (p.in_stock ? "InStock" : "OutOfStock"),
        itemCondition: "https://schema.org/NewCondition", url, seller: { "@type": "Organization", name: "licenceoff.com", url: SITE } } : undefined };
    const price = p.price_fcfa > 0 ? " — " + fcfa(p.price_fcfa) : "";
    return { meta: { type: "product", title: (p.seo_title || p.name) + price, description: cut(plain(p.seo_description || p.description || p.name), 155), image: abs(p.image_url), url },
      blocks: { view: html }, ld: [ld, cr.ld] };
  }

  m = path.match(/^\/blog\/([^/]+)\/?$/);
  if (m && m[1] !== "rubrique") {
    const d = await api({ action: "post", slug: decodeURIComponent(m[1]) }); const p = d && d.post;
    if (!p) return null;
    const r = d.rubrique;
    const url = SITE + U.post(p.slug);
    const image = abs(p.cover_url) || ytThumb(p.cover_video);
    const cr = crumbs([["Accueil", "/"], ["Blog", "/blog"], ...(r ? [[r.name, U.rubrique(r.slug)]] : []), [p.title]]);
    const html = cr.html + `<h1>${esc(p.title)}</h1>`
      + `<div class="note">${esc(dateFr(p.published_at))} · ${p.minutes || 1} min de lecture${r ? ` · <a href="${U.rubrique(r.slug)}">${esc(r.name)}</a>` : ""}</div>`
      + (p.cover_url ? `<div class="cv"><img src="${esc(p.cover_url)}" alt="${esc(p.title)}"></div>` : "")
      + `<div class="content">${richHtml(p.content)}</div>`
      + ((d.related || []).length ? "<h2>À lire aussi</h2><ul>" + d.related.map((x) => `<li><a href="${U.post(x.slug)}">${esc(x.title)}</a></li>`).join("") + "</ul>" : "");
    const ld = { "@context": "https://schema.org", "@type": "BlogPosting", headline: p.title, description: p.excerpt || undefined,
      datePublished: p.published_at, dateModified: p.updated_at || p.published_at, image: [image || SITE + "/img/banniere.jpg"], inLanguage: "fr",
      articleSection: r ? r.name : undefined, mainEntityOfPage: { "@type": "WebPage", "@id": url },
      author: { "@type": "Organization", name: "licenceoff.com", url: SITE },
      publisher: { "@type": "Organization", name: "licenceoff.com", url: SITE, logo: { "@type": "ImageObject", url: SITE + "/img/logo.png" } } };
    return { meta: { type: "article", title: p.title, description: cut(plain(p.excerpt) || plain(p.content) || p.title, 155), image, url },
      blocks: { view: html }, ld: [ld, cr.ld] };
  }

  m = path.match(/^\/page\/([^/]+)\/?$/);
  if (m) {
    const d = await api({ action: "page", slug: decodeURIComponent(m[1]) }); const p = d && d.page;
    if (!p) return null;
    const cr = crumbs([["Accueil", "/"], [p.title]]);
    return { meta: { type: "website", title: p.seo_title || p.title, description: cut(plain(p.seo_description) || plain(p.content) || p.title, 155), image: abs(p.image_url), url: SITE + U.page(p.slug) },
      blocks: { view: cr.html + `<h1>${esc(p.title)}</h1><div class="content">${richHtml(p.content)}</div>` }, ld: [cr.ld] };
  }

  if (/^\/faq\/?$/.test(path)) {
    const d = await api({ action: "faq" }); const list = (d && d.faqs) || [];
    if (!list.length) return null;
    const cr = crumbs([["Accueil", "/"], ["Questions fréquentes"]]);
    return { blocks: { crumbs: cr.html, faq: list.map((f, i) => `<details${i ? "" : " open"}><summary>${esc(f.question)}</summary><div class="a">${textHtml(f.answer)}</div></details>`).join("") },
      ld: [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: list.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) }, cr.ld] };
  }

  if (/^\/(?:boutique|categorie)(?:\/|$)/.test(path)) {
    const d = await api({ action: "catalog" });
    if (!d || !d.products) return null;
    const { cats, bySlug, names } = catsOf(d);
    const sm = path.match(/^\/categorie\/(.+?)\/?$/);
    const current = sm ? decodeURIComponent(sm[1].split("/").pop()) : "";
    const cat = current ? bySlug[current] : null;
    if (current && !cat) return null;
    const parent = cat && cat.parent ? bySlug[cat.parent] : null;
    const inCat = new Set(cat ? [cat.slug, ...cats.filter((c) => c.parent === cat.slug).map((c) => c.slug)] : []);
    const list = listed(d.products).filter((p) => !cat || inCat.has(p.category)).sort((a, b) => (b.in_stock ? 1 : 0) - (a.in_stock ? 1 : 0));
    const cr = crumbs([["Accueil", "/"], ["Boutique", "/boutique"], ...(parent ? [[parent.name, U.category(parent.slug)]] : []), ...(cat ? [[cat.name]] : [])].map((x, i, arr) => (i === arr.length - 1 ? [x[0]] : x)));
    const url = SITE + (cat ? U.category(cat.slug, cat.parent) : "/boutique");
    const mains = cats.filter((c) => !c.parent);
    return {
      meta: { type: "website", title: cat ? cat.name : "Boutique", description: cut(cat ? cat.description || cat.name + " : achat en ligne, livraison rapide au Sénégal." : "Tous nos produits : licences Windows, Microsoft Office, logiciels et solutions PC. Livraison rapide au Sénégal.", 155), url },
      blocks: { crumbs: cr.html, catTitle: esc(cat ? cat.name : "Tous les produits"), catIntro: esc(cat ? cat.description || "" : ""), count: list.length + " produit" + (list.length > 1 ? "s" : ""),
        chips: '<div class="chips"><a class="chip" href="/boutique">Tout</a>' + mains.map((c) => `<a class="chip" href="${U.category(c.slug)}">${esc(c.name)}</a>`).join("") + "</div>",
        grid: list.map((p) => card(p, names[p.category])).join("") || "<p>Pas encore de produit en ligne dans cette catégorie.</p>" },
      ld: [cr.ld, { "@context": "https://schema.org", "@type": "ItemList", itemListElement: list.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: SITE + U.product(p.slug), name: p.name })) }],
    };
  }

  if (/^\/blog(?:\/rubrique\/[^/]+)?\/?$/.test(path)) {
    const rm = path.match(/^\/blog\/rubrique\/([^/]+)/);
    const d = await api({ action: "posts", rubrique: rm ? decodeURIComponent(rm[1]) : undefined, sort: "recent" });
    if (!d || !d.posts || d.not_found) return null;
    const r = d.rubrique;
    const cr = crumbs([["Accueil", "/"], ["Blog", "/blog"], ...(r && r.parent ? [[r.parent.name, U.rubrique(r.parent.slug)]] : []), ...(r ? [[r.name]] : [])].map((x, i, arr) => (i === arr.length - 1 ? [x[0]] : x)));
    const blocks = { crumbs: cr.html,
      posts: d.posts.map((p) => `<div class="card"><a href="${U.post(p.slug)}"><h2>${esc(p.title)}</h2></a><p class="note">${esc(dateFr(p.published_at))} · ${p.minutes || 1} min</p>${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ""}</div>`).join("") || "<p>Les premiers articles arrivent bientôt.</p>",
      rubs: (d.rubriques || []).filter((x) => x.count).map((x) => `<a class="chip" href="${U.rubrique(x.slug)}">${esc(x.name)}</a>`).join("") };
    if (r) { blocks.h1 = esc(r.name); if (r.description) blocks.intro = esc(r.description); }
    return { meta: r ? { type: "website", title: r.name + " — Blog", description: cut(r.description || "Articles " + r.name + " : guides et astuces.", 155), url: SITE + U.rubrique(r.slug) } : null,
      blocks, ld: [cr.ld] };
  }

  if (path === "/" || path === "/index.html") {
    const [d, b] = await Promise.all([api({ action: "catalog" }), api({ action: "posts", sort: "recent", limit: 6 }).catch(() => null)]);
    if (!d || !d.products) return null;
    const { names } = catsOf(d);
    const blocks = { grid: listed(d.products).sort((a, c) => (c.in_stock ? 1 : 0) - (a.in_stock ? 1 : 0)).slice(0, 12).map((p) => card(p, names[p.category])).join("") };
    if (b && b.posts && b.posts.length) blocks.posts = b.posts.map((p) => `<div class="card"><a href="${U.post(p.slug)}"><h3>${esc(p.title)}</h3></a>${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ""}</div>`).join("");
    return { blocks, show: b && b.posts && b.posts.length ? ["blogBlock"] : [], ld: [] };
  }
  return null;
}

// remplace titre / description / og:* / canonical
export function injectMeta(html, i) {
  const img = i.image || SITE + "/img/partage.jpg";
  const tags = [
    `<meta property="og:type" content="${i.type === "article" ? "article" : i.type === "product" ? "product" : "website"}">`,
    `<meta property="og:site_name" content="licenceoff.com">`,
    `<meta property="og:title" content="${esc(i.title)}">`,
    `<meta property="og:description" content="${esc(i.description)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:url" content="${esc(i.url)}">`,
    `<meta property="og:locale" content="fr_FR">`,
    `<meta name="description" content="${esc(i.description)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<link rel="canonical" href="${esc(i.url)}">`,
  ].join("\n");
  return html
    .replace(/<meta\s+property="og:[^"]*"[^>]*>\s*/gi, "")
    .replace(/<meta\s+name="(?:description|twitter:[^"]*)"[^>]*>\s*/gi, "")
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, "")
    .replace(/<title>[^<]*<\/title>/i, `<title>${esc(i.title)} — licenceoff.com</title>`)
    .replace(/<\/head>/i, tags + "\n</head>");
}

// écrit les blocs HTML dans les zones que le JavaScript remplit d'habitude (#view, #faq, #grid…)
// et les données structurées dans <head> avec le même id que shop.js (ld-Product…), pour qu'il les remplace sans doublon
async function fill(html, r) {
  if (r.meta) html = injectMeta(html, r.meta);
  const ld = (r.ld || []).filter(Boolean).map((o) => `<script type="application/ld+json" id="ld-${esc(o["@type"])}">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`).join("\n");
  if (ld) html = html.replace(/<\/head>/i, ld + "\n</head>");
  let rw = new HTMLRewriter();
  for (const [id, content] of Object.entries(r.blocks || {})) rw = rw.on(`#${id}`, { element(e) { e.setInnerContent(content, { html: true }); } });
  for (const id of r.show || []) rw = rw.on(`#${id}`, { element(e) { e.removeAttribute("hidden"); } });
  return rw.transform(new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })).text();
}

// /llms.txt : présentation du site pour les assistants IA (format llmstxt.org)
async function llmsTxt() {
  const [cat, faq, posts] = await Promise.all([api({ action: "catalog" }), api({ action: "faq" }).catch(() => null), api({ action: "posts", sort: "recent", limit: 100 }).catch(() => null)]);
  if (!cat || !cat.products) return null;
  const { cats, names } = catsOf(cat);
  const prods = listed(cat.products);
  const out = [
    "# licenceoff.com",
    "",
    "> Boutique en ligne au Sénégal (Dakar) : licences Microsoft Windows et Office, antivirus, logiciels et solutions PC. Paiement Wave ou Orange Money, commande en ligne ou sur WhatsApp, livraison rapide par email (clé de licence + lien de téléchargement). Prix en francs CFA (FCFA / XOF).",
    "",
    "- Site : " + SITE,
    "- Contact : WhatsApp +221 77 786 07 77 (" + WA + "), contact@licenceoff.com",
    "- Langue : français",
    "",
    "## Catégories",
    "",
    ...cats.filter((c) => !c.parent).map((c) => `- [${c.name}](${SITE + U.category(c.slug)})${c.description ? ": " + cut(plain(c.description), 160) : ""}`),
    "",
    "## Produits",
    "",
    ...prods.map((p) => `- [${p.name}](${SITE + U.product(p.slug)}): ${p.price_fcfa > 0 ? fcfa(p.price_fcfa) : "prix sur demande"}${p.in_stock ? "" : " (bientôt disponible)"}${names[p.category] ? " · " + names[p.category] : ""}${p.description ? ". " + cut(plain(p.description), 200) : ""}`),
    "",
  ];
  if (faq && faq.faqs && faq.faqs.length) out.push("## Questions fréquentes", "", ...faq.faqs.flatMap((f) => ["### " + plain(f.question), "", String(f.answer || "").trim(), ""]), "Toutes les questions : " + SITE + "/faq", "");
  if (posts && posts.posts && posts.posts.length) out.push("## Blog (guides et astuces)", "", ...posts.posts.map((p) => `- [${p.title}](${SITE + U.post(p.slug)})${p.excerpt ? ": " + cut(plain(p.excerpt), 200) : ""}`), "");
  out.push("## Pages utiles", "", `- [Boutique](${SITE}/boutique)`, `- [Questions fréquentes](${SITE}/faq)`, `- [Blog](${SITE}/blog)`, `- [Confidentialité](${SITE}/confidentialite)`, "");
  return out.join("\n");
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
      if (path === "/llms.txt" && request.method === "GET") {
        const txt = await llmsTxt().catch(() => null);
        if (!txt) return env.ASSETS.fetch(request); // secours : le fichier llms.txt fixe
        return new Response(txt, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
      }
      const target = rewriteTarget(path);
      if (!target && !FILLED.test(path)) return env.ASSETS.fetch(request);
      const res = await env.ASSETS.fetch(target ? new Request(url.origin + target, request) : request);
      const ua = request.headers.get("user-agent") || "";
      // ?apercu=1 : permet de vérifier depuis un navigateur normal ce que voit un robot
      const forced = url.searchParams.get("apercu") === "1";
      if ((!BOTS.test(ua) && !forced) || request.method !== "GET" || !res.ok || !/text\/html/.test(res.headers.get("content-type") || "")) return res;
      if (url.searchParams.get("q")) return res; // recherche : pas de contenu fixe
      const page = await res.text();
      const info = await renderFor(path).catch(() => null);
      const h = new Headers(res.headers); h.delete("content-length"); h.set("content-type", "text/html; charset=utf-8"); h.append("vary", "user-agent");
      if (!info) return new Response(page, { status: 200, headers: h });
      const html = await fill(page, info).catch(() => page);
      return new Response(html, { status: 200, headers: h });
    } catch (_) {
      return env.ASSETS.fetch(request);
    }
  },
};
