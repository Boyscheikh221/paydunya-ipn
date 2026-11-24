// licenceoff — fonctions communes du site client
// ====== À MODIFIER ======
const SUPABASE = "https://vnzpxfoeiixiqxkhdnik.supabase.co/functions/v1";
const WHATSAPP_NUMBER = "221777860777";
const FACEBOOK_PAGE = "https://www.facebook.com/1367697816423693";   // Page Facebook Licenceoff   // sans le +
const MANUAL_PAY = {                      // paiement manuel de secours (si PayDunya indisponible)
  "Wave": "77 786 07 77",
  "Orange Money": "77 786 07 77",
};
// ========================

const LO = (() => {
  const $ = (s, el = document) => el.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(typeof c === "string" || typeof c === "number" ? String(c) : c);
    return e;
  };
  // ---------- adresses des pages (courtes et lisibles) ----------
  const SITE = "https://www.licenceoff.com";
  const enc = encodeURIComponent;
  const url = {
    home: "/", shop: "/boutique", cart: "/panier", blog: "/blog", faq: "/faq", privacy: "/confidentialite",
    category: (slug, parent) => "/categorie/" + (parent ? enc(parent) + "/" : "") + enc(slug),
    product: (slug) => "/produit/" + enc(slug),
    post: (slug) => "/blog/" + enc(slug),
    page: (slug) => "/page/" + enc(slug),
    search: (q) => "/boutique?q=" + enc(q),
  };
  // le mot après /produit/, /categorie/ ou /blog/ (sinon l'ancien paramètre ?p= ?c= ?a=)
  function slugFromPath(prefix, param) {
    const m = location.pathname.match(new RegExp("^/" + prefix + "/(.+?)/?$"));
    if (m) return decodeURIComponent(m[1].split("/").pop());
    return new URLSearchParams(location.search).get(param) || "";
  }
  // titre, description, adresse officielle (canonical) ; remplace l'ancienne adresse dans la barre
  function seo({ title, description, path, image }) {
    if (title) document.title = title;
    const meta = (attr, key, val) => { if (!val) return; let m = document.head.querySelector(`meta[${attr}="${key}"]`); if (!m) { m = document.createElement("meta"); m.setAttribute(attr, key); document.head.append(m); } m.setAttribute("content", val); };
    meta("name", "description", description); meta("property", "og:title", title); meta("property", "og:description", description);
    meta("property", "og:image", image); meta("property", "og:type", "website");
    if (path) {
      let l = document.head.querySelector('link[rel="canonical"]'); if (!l) { l = document.createElement("link"); l.rel = "canonical"; document.head.append(l); }
      l.href = SITE + path; meta("property", "og:url", SITE + path);
      const keep = new URLSearchParams(location.search); for (const k of ["p", "c", "a"]) keep.delete(k);
      const qs = keep.toString();
      if (location.pathname !== path) try { history.replaceState(null, "", path + (qs ? "?" + qs : "") + location.hash); } catch (_) {}
    }
  }
  // catégories principales qui ont des produits (directement ou dans une sous-catégorie)
  function mainCats(d) {
    const used = new Set((d.products || []).map((p) => p.category));
    const parentOf = Object.fromEntries((d.categories || []).map((c) => [c.slug, c.parent]));
    for (const s of [...used]) if (parentOf[s]) used.add(parentOf[s]);
    return (d.categories || []).filter((c) => !c.parent && used.has(c.slug));
  }
  // données structurées Google : un seul bloc par type (remplacé si la page se redessine)
  function jsonLd(obj) {
    const id = "ld-" + obj["@type"];
    let s = document.getElementById(id);
    if (!s) { s = document.createElement("script"); s.type = "application/ld+json"; s.id = id; document.head.append(s); }
    s.textContent = JSON.stringify(obj);
  }
  // fil d'Ariane : [["Accueil", "/"], ["Catégorie", "/categorie/x"], ["Page actuelle"]]
  function crumbs(list) {
    const nav = el("nav", { class: "crumbs", "aria-label": "Fil d'Ariane" });
    list.forEach(([label, href], i) => {
      if (i) nav.append(el("span", { class: "sep", "aria-hidden": "true", text: "›" }));
      nav.append(href && i < list.length - 1 ? el("a", { href, text: label }) : el("span", { "aria-current": "page", text: label }));
    });
    jsonLd({ "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: list.map(([name, href], i) => ({ "@type": "ListItem", position: i + 1, name, item: href ? SITE + href : undefined })) });
    return nav;
  }

  const fcfa = (n) => Number(n || 0).toLocaleString("fr-FR") + " FCFA";

  async function api(fn, payload) {
    const r = await fetch(SUPABASE + "/" + fn, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return r.json();
  }
  const boutique = (payload) => api("boutique", payload);

  // ---------- panier (gardé dans ce navigateur) ----------
  const CART_KEY = "lo_cart";
  function cart() { try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]").filter((i) => i && i.slug && i.qty > 0); } catch (_) { return []; } }
  function saveCart(items) { try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch (_) {} updateBadge(); }
  function addToCart(p, qty = 1) {
    const items = cart();
    const line = items.find((i) => i.slug === p.slug);
    const max = p.max_qty || 20;
    if (line) line.qty = Math.min(max, line.qty + qty);
    else items.push({ slug: p.slug, name: p.name, price: p.price_fcfa, image: p.image_url || "", qty: Math.min(max, qty), max });
    saveCart(items);
    px("AddToCart", { content_ids: [p.slug], content_type: "product", content_name: p.name, value: p.price_fcfa * qty, currency: "XOF" });
  }
  function cartCount() { return cart().reduce((s, i) => s + i.qty, 0); }
  function updateBadge() { const n = document.querySelector(".cart-btn .n"); if (n) n.textContent = cartCount(); }

  // ---------- en-tête et pied de page ----------
  const icon = (d, size = 18) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("width", size); s.setAttribute("height", size); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.innerHTML = d; return s; };
  // logos pleins (Facebook, WhatsApp)
  const brand = (d, size = 18, color = "currentColor") => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("width", size); s.setAttribute("height", size); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", color); s.setAttribute("aria-hidden", "true"); const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); s.append(p); return s; };
  const BRANDS = { fb: "M14 8.5V6.8c0-.8.2-1.3 1.4-1.3H17V2.6c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v1.7H7.6v3.2h2.7V22h3.3v-10.3h2.7l.4-3.2H14z", wa: "M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" };
  // boutons « Partager » (articles, produits)
  function shareBar(link, title) {
    const u = encodeURIComponent(link), t = encodeURIComponent((title ? title + " : " : "") + link);
    return el("div", { class: "share" }, el("span", { text: "Partager :" }),
      el("a", { class: "sh fb", href: "https://www.facebook.com/sharer/sharer.php?u=" + u, target: "_blank", rel: "noopener", title: "Partager sur Facebook" }, brand(BRANDS.fb, 18, "#fff"), el("span", { text: "Facebook" })),
      el("a", { class: "sh wa", href: "https://wa.me/?text=" + t, target: "_blank", rel: "noopener", title: "Partager sur WhatsApp" }, brand(BRANDS.wa, 18, "#fff"), el("span", { text: "WhatsApp" })));
  }
  const ICONS = {
    cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
    wa: '<path d="M21 11.5a8.4 8.4 0 0 1-12.6 7.3L3 20l1.3-5A8.4 8.4 0 1 1 21 11.5z"/>',
  };
  function header(active) {
    const top = el("div", { class: "top", text: "Licences & solutions numériques • Livraison immédiate • Wave, Orange Money, carte" });
    const nav = el("nav", { class: "main" },
      el("a", { href: url.home, class: active === "home" ? "on" : null, text: "Accueil" }),
      el("a", { href: url.shop, class: active === "shop" ? "on" : null, text: "Boutique" }),
      el("a", { href: url.blog, class: active === "blog" ? "on" : null, text: "Blog" }),
      el("a", { href: url.faq, class: active === "faq" ? "on" : null, text: "FAQ" }),
      el("span", { id: "navPages", style: "display:contents" }),
      el("a", { href: "https://wa.me/" + WHATSAPP_NUMBER, target: "_blank", rel: "noopener", text: "Contact" }),
    );
    const burger = el("button", { class: "burger", "aria-label": "Menu", onclick: () => nav.classList.toggle("open") }, icon(ICONS.menu, 24));
    const q = el("input", { type: "search", placeholder: "Rechercher un produit…", "aria-label": "Rechercher" });
    q.value = new URLSearchParams(location.search).get("q") || "";
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") location.href = url.search(q.value.trim()); });
    const h = el("header", { class: "site" }, el("div", { class: "wrap" },
      burger,
      el("a", { href: url.home, class: "logo" }, el("span", { class: "a", text: "licence" }), el("span", { class: "b", text: "off" }), el("span", { class: "c", text: ".com" })),
      nav,
      el("div", { class: "search" }, icon(ICONS.search), q),
      el("a", { href: "/compte", class: "acct-btn", "aria-label": "Mon compte", title: acct() ? "Mon compte" : "Se connecter" }, icon(ICONS.user, 22)),
      el("a", { href: url.cart, class: "cart-btn" }, icon(ICONS.cart), el("span", { class: "t", text: "Panier" }), el("span", { class: "n", text: String(cartCount()) })),
    ));
    document.body.prepend(top, h);
  }
  function footer() {
    const year = new Date().getFullYear();
    document.body.append(
      el("div", { class: "strip" }, el("div", { class: "wrap" },
        el("span", { text: "Au Sénégal 🇸🇳" }), el("span", { text: "Des licences authentiques" }), el("span", { text: "Rapide et fiable" }))),
      el("footer", { class: "site" }, el("div", { class: "wrap" },
        el("div", { class: "cols" },
          el("div", {}, el("div", { class: "logo" }, el("span", { class: "a", text: "licence" }), el("span", { class: "b", text: "off" }), el("span", { class: "c", text: ".com" })),
            el("p", { text: "Licences & solutions numériques. Licences et logiciels authentiques, livrés en quelques minutes. Basé à Dakar." }),
            el("p", { class: "tag-line", text: "Vos logiciels, notre engagement !" }),
            el("div", { class: "socials" },
              el("a", { class: "so fb", href: FACEBOOK_PAGE, target: "_blank", rel: "noopener", "aria-label": "Notre page Facebook", title: "Suivez-nous sur Facebook" }, brand(BRANDS.fb, 20, "#fff")),
              el("a", { class: "so wa", href: "https://wa.me/" + WHATSAPP_NUMBER, target: "_blank", rel: "noopener", "aria-label": "WhatsApp", title: "Écrivez-nous sur WhatsApp" }, brand(BRANDS.wa, 20, "#fff")))),
          el("div", {}, el("b", { text: "Boutique" }), el("a", { href: url.shop, text: "Tous les produits" }), el("a", { href: url.cart, text: "Mon panier" }), el("a", { href: url.blog, text: "Blog" }), el("a", { href: url.faq, text: "Questions fréquentes" }), el("a", { href: url.privacy, text: "Confidentialité et cookies" }),
            el("a", { href: "#", text: "Gérer les cookies", onclick: (e) => { e.preventDefault(); cookieBar(true); } })),
          el("div", { id: "footPages", class: "hidden" }, el("b", { text: "Infos" })),
          el("div", {}, el("b", { text: "Aide" }), el("a", { href: "https://wa.me/" + WHATSAPP_NUMBER, target: "_blank", rel: "noopener", text: "WhatsApp : +" + WHATSAPP_NUMBER }),
            el("a", { href: FACEBOOK_PAGE, target: "_blank", rel: "noopener", text: "Facebook : Licenceoff" }),
            el("span", { text: "Paiement sécurisé via PayDunya" }), el("a", { href: "/compte", text: "Mon compte" }), el("a", { href: "/parrain", text: "Espace parrain" })),
        ),
        el("div", { class: "copy", text: "© " + year + " licenceoff.com — Tous droits réservés" }),
      )),
      el("a", { class: "wa-float", href: "https://wa.me/" + WHATSAPP_NUMBER, target: "_blank", rel: "noopener", "aria-label": "WhatsApp" }, (() => { const s = icon(ICONS.wa, 26); s.setAttribute("stroke", "#fff"); return s; })()),
      el("div", { id: "toast" }),
    );
  }
  // pages créées dans l'admin (menu / pied de page), gardées 5 minutes dans le navigateur
  async function navPages(active) {
    const KEY = "lo_nav";
    let d = null;
    try { const c = JSON.parse(sessionStorage.getItem(KEY) || "null"); if (c && Date.now() - c.at < 300000) d = c.d; } catch (_) {}
    if (!d) { try { d = await boutique({ action: "nav" }); sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), d })); } catch (_) { return; } }
    pixelId = d.pixel || ""; loadPixel();
    const m = document.getElementById("navPages"), f = document.getElementById("footPages");
    if (m) m.replaceChildren(...(d.menu || []).map((p) => el("a", { href: url.page(p.slug), class: active === "page:" + p.slug ? "on" : null, text: p.title })));
    if (f && (d.footer || []).length) { f.append(...d.footer.map((p) => el("a", { href: url.page(p.slug), text: p.title }))); f.classList.remove("hidden"); }
  }
  function toast(t) { const e = document.getElementById("toast"); if (!e) return; e.textContent = t; e.style.display = "block"; clearTimeout(toast.t); toast.t = setTimeout(() => (e.style.display = "none"), 3500); }

  // ---------- carte produit ----------
  function initials(name) { return String(name || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase(); }
  function productCard(p, catName) {
    const off = p.compare_price_fcfa && p.compare_price_fcfa > p.price_fcfa ? Math.round(100 - p.price_fcfa * 100 / p.compare_price_fcfa) : 0;
    const link = url.product(p.slug);
    const btn = el("button", { class: "btn" + (p.in_stock ? "" : " light"), disabled: !p.in_stock, text: p.in_stock ? "Ajouter au panier" : "Rupture de stock" });
    btn.addEventListener("click", (e) => { e.preventDefault(); addToCart(p, 1); toast("Ajouté au panier ✔"); });
    return el("a", { class: "card", href: link },
      el("div", { class: "img" },
        p.image_url ? el("img", { src: p.image_url, alt: p.name, loading: "lazy" }) : el("span", { class: "ph", text: initials(p.name) }),
        !p.in_stock ? el("span", { class: "badge out", text: "Rupture" }) : off ? el("span", { class: "badge", text: "-" + off + " %" }) : null),
      el("div", { class: "body" },
        catName ? el("div", { class: "cat", text: catName }) : null,
        el("div", { class: "name", text: p.name }),
        el("div", { class: "price" }, fcfa(p.price_fcfa), off ? el("s", { text: fcfa(p.compare_price_fcfa) }) : null),
        btn));
  }

  // ---------- texte d'article (petit Markdown sûr) ----------
  const ytId = (u) => { const m = String(u || "").trim().match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/); return m ? m[1] : null; };
  const ytThumb = (u) => { const v = ytId(u); return v ? "https://i.ytimg.com/vi/" + v + "/hqdefault.jpg" : null; };
  const ytEmbed = (u) => { const v = ytId(u); return v ? el("div", { class: "video" }, el("iframe", { src: "https://www.youtube-nocookie.com/embed/" + v, title: "Vidéo", loading: "lazy", allow: "accelerometer; encrypted-media; picture-in-picture", allowfullscreen: "" })) : null; };
  function richText(src) {
    const frag = document.createDocumentFragment();
    const okUrl = (u) => /^(https?:\/\/|\/)/.test(u);
    const inline = (txt) => {
      const span = document.createDocumentFragment();
      const re = /\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*|[a-z0-9-]+\.html[^\s)]*)\)/g;
      let last = 0, m;
      while ((m = re.exec(txt))) {
        if (m.index > last) span.append(txt.slice(last, m.index));
        if (m[1]) span.append(el("strong", { text: m[1] }));
        else if (m[2]) span.append(el("em", { text: m[2] }));
        else { const ext = /^https?:/.test(m[4]) && !/licenceoff\.com/.test(m[4]); span.append(el("a", ext ? { href: m[4], text: m[3], rel: "noopener", target: "_blank" } : { href: m[4], text: m[3] })); }
        last = re.lastIndex;
      }
      if (last < txt.length) span.append(txt.slice(last));
      return span;
    };
    const yt = ytId;
    let list = null, listTag = "";
    for (const raw of String(src || "").split(/\r?\n/)) {
      const line = raw.trim();
      const ul = /^[-*] /.test(line), ol = /^\d+[.)] /.test(line);
      if (ul || ol) {
        const t = ul ? "ul" : "ol";
        if (!list || listTag !== t) { list = el(t); listTag = t; frag.append(list); }
        list.append(el("li", {}, inline(line.replace(/^([-*]|\d+[.)]) /, ""))));
        continue;
      }
      list = null;
      if (!line) continue;
      const img = line.match(/^!\[([^\]]*)\]\(([^\s)]+)\)$/);
      if (img && okUrl(img[2])) {
        const fig = el("figure", { class: "img" }, el("img", { src: img[2], alt: img[1] || "", loading: "lazy" }));
        if (img[1]) fig.append(el("figcaption", { text: img[1] }));
        frag.append(fig); continue;
      }
      const v = yt(line);
      if (v) { frag.append(el("div", { class: "video" }, el("iframe", { src: "https://www.youtube-nocookie.com/embed/" + v, title: "Vidéo", loading: "lazy", allow: "accelerometer; encrypted-media; picture-in-picture", allowfullscreen: "" }))); continue; }
      if (line === "---") frag.append(el("hr"));
      else if (line.startsWith("> ")) frag.append(el("blockquote", {}, inline(line.slice(2))));
      else if (line.startsWith("### ")) frag.append(el("h3", {}, inline(line.slice(4))));
      else if (line.startsWith("## ")) frag.append(el("h2", {}, inline(line.slice(3))));
      else frag.append(el("p", {}, inline(line)));
    }
    return frag;
  }

  // ---------- cookies : choix du visiteur (accepter / refuser) ----------
  // Essentiel (toujours) : panier, ce choix, le code parrain. Facultatif (si accepté) : identifiant de visite pour les statistiques.
  const CONSENT_KEY = "lo_consent";
  function consent() { try { return localStorage.getItem(CONSENT_KEY) || ""; } catch (_) { return ""; } }
  function setConsent(v) {
    try { localStorage.setItem(CONSENT_KEY, v); if (v !== "yes") localStorage.removeItem("lo_v"); } catch (_) {}
    document.querySelector(".cookie-bar")?.remove();
  }
  function cookieBar(force) {
    if (!force && consent()) return;
    document.querySelector(".cookie-bar")?.remove();
    document.body.append(el("div", { class: "cookie-bar", role: "dialog", "aria-label": "Cookies" },
      el("p", {}, "Nous utilisons le stockage de votre navigateur pour votre panier (indispensable) et, si vous l'acceptez, pour mesurer les visites et nos publicités (Meta). ",
        el("a", { href: url.privacy, text: "En savoir plus" })),
      el("div", { class: "cb-btns" },
        el("button", { class: "btn light", text: "Refuser", onclick: () => setConsent("no") }),
        el("button", { class: "btn", text: "Accepter", onclick: () => { setConsent("yes"); hit(); loadPixel(); } }))));
  }

  // ---------- pixel Meta (publicités) : chargé SEULEMENT si le visiteur accepte les cookies ----------
  // ID réglé dans l'admin (Réglages). Les identifiants produits = code produit, comme dans le flux produits.
  let pixelId = "", pxQueue = [];
  function loadPixel() {
    if (!pixelId || consent() !== "yes") { if (consent() === "no") pxQueue = []; return; }
    if (!window.fbq) {
      /* code officiel Meta */
      !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v;
        s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
      window.fbq("init", pixelId);
      window.fbq("track", "PageView");
    }
    for (const a of pxQueue.splice(0)) window.fbq("track", ...a);
  }
  // événement : envoyé tout de suite si le pixel est chargé, sinon gardé en attente du chargement (jamais sans accord)
  function px(event, params, opts) {
    if (consent() !== "yes") return;
    const a = opts ? [event, params, opts] : [event, params];
    if (window.fbq && pixelId) window.fbq("track", ...a); else pxQueue.push(a);
  }

  // ---------- statistiques de visites ----------
  // Sans accord : une visite est comptée sans aucun identifiant (rien n'est enregistré dans le navigateur).
  function hit() {
    let v = "";
    if (consent() === "yes") try { v = localStorage.getItem("lo_v") || ""; if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("lo_v", v); } } catch (_) {}
    try { fetch(SUPABASE + "/boutique", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ action: "hit", page: location.pathname.replace(/\.html$/, "").replace(/\/index$/, "/") || "/", v, ref: document.referrer }) }); } catch (_) {}
  }

  // ---------- compte client (connexion par lien email ; jeton gardé dans ce navigateur) ----------
  const ACCT_KEY = "lo_compte";
  function acct() { try { return localStorage.getItem(ACCT_KEY) || ""; } catch (_) { return ""; } }
  function setAcct(t) { try { t ? localStorage.setItem(ACCT_KEY, t) : localStorage.removeItem(ACCT_KEY); } catch (_) {} }
  function visitorId() { try { return consent() === "yes" ? localStorage.getItem("lo_v") || "" : ""; } catch (_) { return ""; } }
  // historique (produits vus, recherches) : seulement si le visiteur a accepté les cookies
  function track(kind, data) {
    if (consent() !== "yes") return;
    try { fetch(SUPABASE + "/boutique", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ action: "track", kind, ...data, v: visitorId(), s: acct() }) }); } catch (_) {}
  }

  // ---------- parrainage : lien ?ref=CODE (gardé 30 jours dans ce navigateur) ----------
  const REF_KEY = "lo_ref";
  function refCode() { try { const r = JSON.parse(localStorage.getItem(REF_KEY) || "null"); return r && Date.now() - r.at < 30 * 86400000 ? r.code : ""; } catch (_) { return ""; } }
  function setRef(code) { try { code ? localStorage.setItem(REF_KEY, JSON.stringify({ code, at: Date.now() })) : localStorage.removeItem(REF_KEY); } catch (_) {} }
  function captureRef() {
    const u = new URL(location.href);
    const code = (u.searchParams.get("ref") || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (!code) return;
    u.searchParams.delete("ref");
    try { history.replaceState(null, "", u.pathname + (u.search || "") + u.hash); } catch (_) {}
    boutique({ action: "ref_info", code, click: true }).then((d) => {
      if (!d.code) return;
      setRef(d.code);
      toast((d.parrain ? "Invité par " + d.parrain + " : " : "") + "-" + d.discount_pct + " % sur votre panier ✔");
    }).catch(() => {});
  }

  // ---------- d'où vient le visiteur (pub Facebook, Google Ads, WhatsApp…) ----------
  // On garde seulement la catégorie et le nom de campagne (aucun identifiant personnel), 30 jours.
  const SRC_KEY = "lo_src";
  function classifySource(u, referrer) {
    const p = u.searchParams, low = (k) => (p.get(k) || "").toLowerCase();
    const s = low("utm_source"), m = low("utm_medium"), camp = p.get("utm_campaign") || "";
    const paid = /cpc|ppc|paid|ads?$|^ad|cpm|display|retarget|social_paid|paidsocial/.test(m);
    let host = "";
    try { if (referrer) { const h = new URL(referrer).hostname.replace(/^www\./, ""); if (!/(^|\.)licenceoff\.com$/.test(h)) host = h; } } catch (_) {}
    let ch = "";
    if (p.get("gclid") || p.get("gbraid") || p.get("wbraid") || (/google|youtube/.test(s) && paid)) ch = "google_ads";
    else if (/facebook|^fb|instagram|^ig|meta/.test(s) && paid) ch = "facebook_ads";
    else if (p.get("fbclid") && paid) ch = "facebook_ads";
    else if (/whatsapp|^wa$/.test(s) || /whatsapp|wa\.me/.test(host)) ch = "whatsapp";
    else if (p.get("fbclid") || /facebook|^fb|instagram|^ig/.test(s) || /facebook\.com|instagram\.com|^fb\.|messenger/.test(host)) ch = "facebook";
    else if (/google|bing|yahoo|duckduckgo|ecosia|qwant/.test(host) || /google/.test(s)) ch = "google";
    else if (s || host) ch = "autre";
    return ch ? { ch, camp: camp.slice(0, 80), src: (s || host).slice(0, 60), med: m.slice(0, 30), at: Date.now() } : null;
  }
  function captureSource() {
    try {
      const t = classifySource(new URL(location.href), document.referrer);
      if (t) localStorage.setItem(SRC_KEY, JSON.stringify(t)); // la dernière origine connue gagne
    } catch (_) {}
  }
  function source() {
    try { const r = JSON.parse(localStorage.getItem(SRC_KEY) || "null"); if (r && Date.now() - r.at < 30 * 86400000) return { ch: r.ch, camp: r.camp, src: r.src, med: r.med }; } catch (_) {}
    return { ch: "direct" };
  }

  function page(active) { captureSource(); header(active); footer(); navPages(active); hit(); cookieBar(); captureRef(); }
  const DELIVERY_TEXT = {
    key: "Clé de licence livrée immédiatement après paiement",
    key_file: "Clé de licence + lien de téléchargement livrés immédiatement",
    file: "Lien de téléchargement livré immédiatement",
    stock: "Identifiants livrés immédiatement après paiement",
    manual: "Service traité par notre équipe après paiement",
    physical: "Produit physique : nous vous contactons sur WhatsApp pour la livraison",
  };

  return { source, classifySource, px, acct, setAcct, visitorId, track, icon, ICONS, refCode, setRef, cookieBar, url, slugFromPath, seo, jsonLd, crumbs, mainCats, SITE, $, el, fcfa, api, boutique, cart, saveCart, addToCart, cartCount, page, toast, productCard, initials, shareBar, FACEBOOK_PAGE, richText, ytId, ytThumb, ytEmbed, DELIVERY_TEXT };
})();
