// app.menu.js — coupon-truth aligned (no UI changes)
// - Banners/lists wait for coupon hydration
// - Visibility/inclusion driven ONLY by hydrated coupons
// - Publish coupon-centric mirrors for Cart/Checkout parity

(function ensureCartReady(){
  if (!window.Cart || typeof window.Cart.setQty !== "function") {
    console.warn("[gufa] Cart API not initialized before menu.js");
  }
})();

/* ============================================================
   Small utilities
============================================================ */
const COUPONS_READY = () => (window.COUPONS instanceof Map && window.COUPONS.size > 0); // ★ gate
const MODE = () => (window.GUFA?.serviceMode?.get?.() || "delivery");

function safeJSONGet(key, def){ try { return JSON.parse(localStorage.getItem(key) || "null") ?? def; } catch { return def; } }
function setLS(key, val){ try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

/* ============================================================
   Cart Helpers
============================================================ */
function getCartEntries() { try { return Object.entries(window?.Cart?.get?.() || {}); } catch { return []; } }
function sumQtyByPrefix(prefix) {
  return getCartEntries().reduce((n, [k, it]) => n + (k.startsWith(prefix) ? (Number(it.qty)||0) : 0), 0);
}
function getVariantQty(baseKey) {
  try {
    const bag = window?.Cart?.get?.() || {};
    const base = Number(bag?.[baseKey]?.qty || 0);
    const children = sumQtyByPrefix(baseKey + ":");
    return base + children;
  } catch { return 0; }
}

/* ============================================================
   DOM helpers for base variant & add-ons
============================================================ */
function selectedVariantsForItem(itemId){
  const nodes = document.querySelectorAll(`.stepper[data-item="${itemId}"] .qty`);
  const picked = [];
  nodes.forEach(wrap => {
    const baseKey = wrap.getAttribute('data-key'); // itemId:variant
    const num = wrap.querySelector('.num');
    const q = parseInt(num?.textContent || "0", 10) || 0;
    if (q > 0) {
      const variantKey = (baseKey || "").split(":")[1];
      if (variantKey) picked.push(variantKey);
    }
  });
  return picked;
}
function activeVariantForAddons(itemId){
  const picked = selectedVariantsForItem(itemId);
  if (picked.length >= 1) return picked[0];
  return null;
}
function updateAddonsButtonState(itemId){
  const card = document.querySelector(`.menu-item[data-id="${itemId}"]`);
  if (!card) return;
  const btn = card.querySelector(".addons-btn");
  if (!btn) return;
  const any = selectedVariantsForItem(itemId).length > 0;
  btn.classList.toggle("gold", true);
  btn.classList.toggle("glow", any);
  btn.classList.toggle("shimmer", any);
  btn.setAttribute("aria-disabled", String(!any));
  if (!any) {
    btn.classList.remove("rock", "pulse");
    btn.setAttribute("aria-expanded", "false");
  }
}
function primeAddonQuantities(pop, itemId, variantKey){
  const baseKey = `${itemId}:${variantKey}`;
  pop.querySelectorAll('.addon-row').forEach(row => {
    const name = row.getAttribute('data-addon') || "";
    const key = `${baseKey}:${name}`;
    let q = 0;
    try { q = Number((window.Cart?.get?.() || {})[key]?.qty || 0); } catch {}
    const num = row.querySelector('.num'); if (num) num.textContent = String(q);
  });
}
function nudgeBaseSteppers(itemId){
  document.querySelectorAll(`.stepper[data-item="${itemId}"] .qty`).forEach(el=>{
    el.classList.add('pulse'); setTimeout(()=>el.classList.remove('pulse'), 300);
  });
}

/* ============================================================
   Mini-cart Badge (global)
============================================================ */
function getGlobalCartTotal(){
  try {
    const bag = window?.Cart?.get?.() || safeJSONGet("gufa_cart", {});
    return Object.values(bag).reduce((a, it) => a + (Number(it?.qty || 0) || 0), 0);
  } catch { return 0; }
}
function updateItemMiniCartBadge(itemId, rock=false){
  const card = document.querySelector(`.menu-item[data-id="${itemId}"]`);
  if (!card) return;
  const btn = card.querySelector(".mini-cart-btn");
  if (!btn) return;
  const total = getGlobalCartTotal();
  const nuke = () => { btn.classList.remove("active", "rock"); btn.querySelectorAll(".badge").forEach(n => n.remove()); };
  if (total > 0) {
    let badge = btn.querySelector(".badge");
    if (!badge) { badge = document.createElement("span"); badge.className = "badge"; btn.appendChild(badge); }
    badge.textContent = String(total);
    btn.classList.add("active");
    if (rock) {
      btn.classList.remove("rock"); void btn.offsetWidth; btn.classList.add("rock");
      setTimeout(() => btn.classList.remove("rock"), 300);
    }
  } else { nuke(); }
}
function updateAllMiniCartBadges(){
  const total = getGlobalCartTotal();
  document.querySelectorAll(".menu-item[data-id]").forEach(card => {
    const btn = card.querySelector(".mini-cart-btn"); if (!btn) return;
    btn.classList.toggle("active", total > 0);
    let badge = btn.querySelector(".badge");
    if (total > 0) {
      if (!badge) { badge = document.createElement("span"); badge.className = "badge"; btn.appendChild(badge); }
      badge.textContent = String(total);
    } else {
      if (badge) badge.remove(); btn.classList.remove("rock");
    }
  });
}

/* ============================================================
   Coupon & Banner mirrors (coupon-centric)  ★
============================================================ */
// Keep public shapes:
if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
if (!Array.isArray(window.BANNERS)) window.BANNERS = [];

// New coupon-centric mirrors (for Cart/Checkout parity)
window.BANNERS_COUPONS = new Map(); // bannerId -> Set(couponId)
window.COUPON_ITEMS    = new Map(); // couponId -> Set(itemId) (built from hydrated truth)

// Build COUPON_ITEMS strictly from hydrated coupons + catalog (no DOM hints)  ★
function buildCouponItemsFromCatalog(items){
  if (!COUPONS_READY() || !Array.isArray(items)) return;
  const map = new Map();
  for (const it of items) {
    const iid = String(it?.id || "").trim(); if (!iid) continue;
    const raw = Array.isArray(it.couponIds) ? it.couponIds
              : Array.isArray(it.coupons)   ? it.coupons
              : Array.isArray(it.promotions)? it.promotions
              : [];
    for (const cidRaw of raw) {
      const cid = String(cidRaw).trim(); if (!cid || !window.COUPONS.has(cid)) continue; // only hydrated coupons
      if (!map.has(cid)) map.set(cid, new Set());
      map.get(cid).add(iid);
    }
  }
  window.COUPON_ITEMS = map;
  // Persist a plain object for checkout handoff
  const out = {};
  for (const [cid, set] of map.entries()) out[cid.toLowerCase()] = Array.from(set).map(s=>s.toLowerCase());
  setLS("gufa:COUPON_INDEX", out);
}

// Republish banner→coupon mirror using hydrated coupons only  ★
function publishBannerCouponMirror(){
  const list = Array.isArray(window.BANNERS) ? window.BANNERS : [];
  const m = new Map();
  for (const b of list) {
    const id = String(b?.id || "").trim(); if (!id) continue;
    const linked = Array.isArray(b.linkedCouponIds) ? b.linkedCouponIds : [];
    const hydrated = linked.map(String).map(s=>s.trim()).filter(cid => window.COUPONS.has(cid)); // only hydrated
    m.set(id, new Set(hydrated));
  }
  window.BANNERS_COUPONS = m;
  // Keep the old array as-is for UI; publish a compact storage mirror if needed
  try {
    const dump = Array.from(m.entries()).map(([bid,set])=>[bid, Array.from(set)]);
    setLS("gufa:BANNERS_COUPONS", dump);
  } catch {}
}

/* ============================================================
   Global sync & mode mirrors (unchanged behaviorally)
============================================================ */
let lastCartUpdate = 0;
window.addEventListener("cart:update", () => {
  const now = Date.now(); if (now - lastCartUpdate < 80) return; lastCartUpdate = now;
  updateAllMiniCartBadges(); window.updateCartLink?.();
  document.querySelectorAll(".menu-item[data-id]").forEach(el => updateAddonsButtonState(el.getAttribute("data-id")));
});

window.addEventListener("storage", (e) => {
  try {
    if (e.key === "gufa_cart") {
      updateAllMiniCartBadges(); window.updateCartLink?.();
      const bag = safeJSONGet("gufa_cart", {});
      document.querySelectorAll(".stepper[data-item]").forEach(stepper => {
        const itemId = stepper.getAttribute("data-item");
        const total = Object.entries(bag).filter(([k]) => k.startsWith(itemId + ":"))
          .reduce((a,[,v]) => a + (Number(v?.qty || 0)), 0);
        const num = stepper.querySelector(".qty .num"); if (num) num.textContent = String(total || 0);
        updateAddonsButtonState(itemId);
        if (total <= 0) {
          const card = document.querySelector(`.menu-item[data-id="${itemId}"]`);
          const btn  = card?.querySelector(".mini-cart-btn");
          if (btn) { btn.classList.remove("active", "rock"); btn.querySelectorAll(".badge").forEach(n => n.remove()); }
          const pop = card?.querySelector(".addons-popover[aria-hidden='false']");
          const ab  = card?.querySelector(".addons-btn");
          if (pop) {
            if (document.activeElement && pop.contains(document.activeElement)) document.activeElement.blur();
            pop.setAttribute("aria-hidden","true"); pop.hidden = true; pop._stage = undefined; if (ab) ab.setAttribute("aria-expanded","false");
          }
        }
      });
    }
    if (e.key === "gufa_mode" || e.key === "gufa:serviceMode") {
      const m = window.getActiveMode?.();
      window.dispatchEvent(new CustomEvent("mode:change",         { detail:{ mode:m }}));
      window.dispatchEvent(new CustomEvent("serviceMode:changed", { detail:{ mode:m }}));
      try {
        const toggle = document.querySelector("#serviceModeToggle, .mode-toggle, [data-mode-switch]");
        if (toggle) {
          toggle.classList.toggle("active", m === "dining");
          if ("checked" in toggle) toggle.checked = (m === "dining");
        }
      } catch {}
    }
    if (e.key === "gufa_coupon") {
      updateAllMiniCartBadges();
    }
  } catch {}
});

document.addEventListener("DOMContentLoaded", () => {
  try {
    const m = window.getActiveMode?.() || "delivery";
    localStorage.setItem("gufa_mode", m);
    localStorage.setItem("gufa:serviceMode", m);
    updateAllMiniCartBadges(); window.updateCartLink?.();
    window.dispatchEvent(new CustomEvent("mode:change",         { detail:{ mode:m }}));
    window.dispatchEvent(new CustomEvent("serviceMode:changed", { detail:{ mode:m }}));
  } catch {}
});

/* ============================================================
   Main module scope
============================================================ */
(function () {
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  const cartLink = $("#cartLink");

  /* ---------- State ---------- */
  let ITEMS = [];
  let COURSES = [];
  let CATEGORIES = [];
  let vegOn = false;
  let nonvegOn = false;
  let view = "home";     // 'home' | 'list' | 'search'
  let listKind = "";     // 'course' | 'category' | 'banner'
  let listId = "";
  let listLabel = "";
  let searchQuery = "";

  // --- Mode helpers (persist + broadcast) ---
  window.getActiveMode = function () {
    const ms = (localStorage.getItem("gufa:serviceMode") || "").toLowerCase();
    const m  = (localStorage.getItem("gufa_mode")       || "").toLowerCase();
    if (ms === "dining" || ms === "delivery") return ms;
    if (m  === "dining" || m  === "delivery") return m;
    return "delivery";
  };
  window.setActiveMode = function (mode) {
    const m = (String(mode || "").toLowerCase() === "dining") ? "dining" : "delivery";
    try { localStorage.setItem("gufa_mode", m); } catch {}
    try { localStorage.setItem("gufa:serviceMode", m); } catch {}
    window.dispatchEvent(new CustomEvent("mode:change", { detail: { mode: m } }));
    window.dispatchEvent(new CustomEvent("serviceMode:changed", { detail: { mode: m } }));
  };
  window.addEventListener("serviceMode:changed", () => {
    try {
      renderDeals(); // will gate on coupons
      if (view === "list" && listKind === "banner") decorateBannerDealBadges?.();
    } catch {}
  });

  /* ---------- DOM refs ---------- */
  const vegSwitch = $("#vegSwitch");
  const nonvegSwitch = $("#nonvegSwitch");
  const courseToggle = $("#courseToggle");
  const categoryToggle = $("#categoryToggle");
  const searchInputHome = $("#filter-search");
  const searchBtnHome = $("#searchBtn");
  const primaryBar = $("#menu .primary-bar");
  const coursesSection = $("#coursesSection");
  const categoriesSection = $("#categoriesSection");
  const courseBuckets = $("#courseBuckets");
  const categoryBuckets = $("#categoryBuckets");
  const globalResults = $("#globalResults");
  let globalList = $("#globalResultsList");

  /* ---------- Helpers ---------- */
  const normDiet = (t="") => t.toLowerCase().replace(/\s+/g,"-");
  const canon = (s="") => s.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
  function editDistance(a="", b=""){
    const al=a.length, bl=b.length; if (!al) return bl; if (!bl) return al;
    const dp = Array.from({length: al+1}, (_,i)=>Array(bl+1).fill(0));
    for (let i=0;i<=al;i++) dp[i][0]=i; for (let j=0;j<=bl;j++) dp[0][j]=j;
    for (let i=1;i<=al;i++) for (let j=1;j<=bl;j++){
      const cost = a[i-1]===b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
      if (i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1]) dp[i][j] = Math.min(dp[i][j], dp[i-2][j-2]+cost);
    }
    return dp[al][bl];
  }
  function fuzzyMatch(hay="", q=""){
    const H = canon(hay), Q = canon(q); if (!Q) return true;
    for (const t of Q.split(" ")){
      if (!t) continue;
      if (H.includes(t)) return true;
      const thr = t.length >= 5 ? 2 : 1;
      for (const w of H.split(" ")){
        if (!w) continue;
        if (Math.abs(w.length - t.length) > thr) continue;
        if (editDistance(w, t) <= thr) return true;
      }
    }
    return false;
  }

  /* ---------- Price & Cart ---------- */
  function priceModel(qtyType) {
    if (!qtyType) return null;
    if (qtyType.type === "Not Applicable") {
      return { variants: [{ key: "single", label: "", price: Number(qtyType.itemPrice || 0) }] };
    }
    if (qtyType.type === "Half & Full") {
      return { variants: [
        { key: "half", label: "Half", price: Number(qtyType.halfPrice || 0) },
        { key: "full", label: "Full", price: Number(qtyType.fullPrice || 0) },
      ]};
    }
    return null;
  }
  function getQty(key) {
    const el = document.querySelector(`.qty[data-key="${key}"] .num`);
    if (el) { const v = parseInt(el.textContent || "0", 10); if (!Number.isNaN(v)) return v; }
    try {
      const bag = window?.Cart?.get?.() || {};
      let q = Number(bag?.[key]?.qty || 0);
      const prefix = key + ":";
      for (const [k, entry] of Object.entries(bag)) if (k.startsWith(prefix)) q += Number(entry?.qty || 0);
      return q;
    } catch { return 0; }
  }
  function totalQtyForItem(itemId){
    const nodes = document.querySelectorAll(`.stepper[data-item="${itemId}"] .qty .num`);
    let domSum = Array.from(nodes).reduce((a,el)=> a + (parseInt(el.textContent||"0",10)||0), 0);
    try {
      const bag = window?.Cart?.get?.() || {};
      const cartSum = Object.entries(bag).reduce((acc, [k, entry]) => {
        if (k.startsWith(`${itemId}:`)) acc += Number(entry?.qty||0)||0;
        return acc;
      }, 0);
      return Math.max(domSum, cartSum);
    } catch { return domSum; }
  }
  function updateCartLink(){
    try {
      const bag = window.Cart?.get?.() || {};
      const total = Object.values(bag).reduce((a,entry)=> a + (Number(entry?.qty||0)||0), 0);
      if (cartLink) cartLink.textContent = `Cart (${total})`;
    } catch { if (cartLink) cartLink.textContent = `Cart (0)`; }
  }
  window.updateCartLink = updateCartLink;

  function setQty(found, variantKey, price, nextQty) {
    const key  = `${found.id}:${variantKey}`;
    const next = Math.max(0, Number(nextQty || 0));
    const badge = document.querySelector(`.qty[data-key="${key}"] .num`);
    if (badge) badge.textContent = String(next);

    try {
      if (window.Cart?.setQty) {
        const origin = (view === "list" && listKind === "banner" && listId) ? `banner:${listId}` : "non-banner";
        window.Cart.setQty(key, next, { id: found.id, name: found.name, variant: variantKey, price: Number(price) || 0, origin });
      }
    } catch {}

    try {
      const LS_KEY = "gufa_cart";
      let bag = {};
      const live = window?.Cart?.get?.();
      if (live && typeof live === "object" && Object.keys(live).length) {
        bag = (live.items && typeof live.items === "object") ? live.items : live;
      } else {
        bag = safeJSONGet(LS_KEY, {});
      }
      if (!bag || typeof bag !== "object") bag = {};
      if (next <= 0) {
        delete bag[key];
      } else {
        const prev = bag[key] || {};
        const origin = prev.origin || ((view === "list" && listKind === "banner" && listId) ? `banner:${listId}` : "non-banner");
        bag[key] = { id: found.id, name: found.name, variant: variantKey, price: Number(price) || Number(prev.price) || 0, thumb: prev.thumb || "", qty: next, origin };
      }
      setLS(LS_KEY, bag);
      window.dispatchEvent(new CustomEvent("cart:update", { detail: { cart: { items: bag } } }));
    } catch {}

    if (next > 0) { try { window.lockCouponForActiveBannerIfNeeded?.(found.id); } catch {} }

    updateItemMiniCartBadge(found.id, true);
    window.updateCartLink?.();

    setTimeout(() => {
      try {
        const bag = window?.Cart?.get?.() || safeJSONGet("gufa_cart", {});
        const cartQty = Number(bag?.[key]?.qty || 0);
        if (badge && cartQty !== next) badge.textContent = String(cartQty || next);
        updateItemMiniCartBadge(found.id);
        window.updateCartLink?.();
        const target = localStorage.getItem("gufa:nextEligibleItem");
        if (target && String(target).toLowerCase() === String(found.id).toLowerCase() && cartQty > 0) {
          localStorage.removeItem("gufa:nextEligibleItem");
        }
      } catch {}
    }, 50);
  }

  /* ---------- Card templates ---------- */
  function dietSpan(t){
    const v = normDiet(t);
    if (v.startsWith("veg")) return `<span class="diet diet-veg">Veg</span>`;
    if (v.startsWith("non-veg") || v.startsWith("nonveg")) return `<span class="diet diet-nonveg">Non-Veg</span>`;
    return "";
  }
  function stepperHTML(found, variant) {
    const key = `${found.id}:${variant.key}`;
    const qty = getQty(key);
    return `
      <div class="stepper" data-item="${found.id}" data-variant="${variant.key}">
        <span class="vlabel">${variant.label || ""}</span>
        <div class="qty" data-key="${key}">
          <button class="dec" aria-label="decrease">−</button>
          <span class="num">${qty}</span>
          <button class="inc" aria-label="increase">+</button>
        </div>
        <span class="vprice">₹${variant.price}</span>
      </div>
    `;
  }
  function miniCartButtonHTML(){
    return `
      <button class="mini-cart-btn" data-action="goto-cart" title="Go to cart" aria-label="Go to cart">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M7 7l5-5 5 5"/>
          <path d="M3 7h18l-2 12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L3 7z" fill="currentColor"/>
        </svg>
      </button>
    `;
  }
  function itemCardHTML(m) {
    const pm = priceModel(m.qtyType);
    const variants = (pm?.variants || []).filter(v => v.price > 0);
    const tagsLeft = [m.foodCourse||"", m.category||""].filter(Boolean).join(" • ");
    const diet = dietSpan(m.foodType);
    const addons = Array.isArray(m.addons) && m.addons.length
      ? `
      <button class="addons-btn gold" data-action="addons"
              aria-expanded="false" aria-controls="addons-${m.id}" aria-disabled="true">
        Add-ons
      </button>
      <div id="addons-${m.id}" class="addons-popover" role="dialog" aria-hidden="true">
        <div class="bubble">
          <div class="addon-variants" hidden></div>
          <div class="addon-list">
          ${m.addons.map(a => {
            const n = (typeof a === "string") ? a : (a.name || "");
            const p = (typeof a === "string") ? 0 : Number(a.price || 0);
            return `
            <div class="addon-row" data-addon="${n}" data-price="${p}">
              <div class="label-price"><span class="name">${n}</span><span class="price">₹${p}</span></div>
              <div class="addon-stepper" aria-label="Quantity for ${n}">
                <button class="addon-dec" aria-label="decrease">−</button>
                <span class="num">0</span>
                <button class="addon-inc" aria-label="increase">+</button>
              </div>
            </div>`;
          }).join("")}
          </div>
          <div class="addon-actions">
            <button class="addons-add gold" data-action="addons-add" title="Add to Purchase" aria-label="Add to Purchase" disabled>
              Add to Purchase
            </button>
          </div>
        </div>
      </div>`
      : "";

    const steppers = variants.map(v => stepperHTML(m, v)).join("");

    return `
      <article class="menu-item" data-id="${m.id}">
        ${m.imageUrl ? `<img loading="lazy" src="${m.imageUrl}" alt="${m.name||""}" class="menu-img"/>` : ""}
        <div class="menu-header">
          <h4 class="menu-name">${m.name || ""}</h4>
          ${miniCartButtonHTML()}
        </div>
        <p class="menu-desc">${m.description || ""}</p>
        ${addons}
        <div class="row meta">
          <small class="muted">${tagsLeft}</small>
          ${diet}
        </div>
        <div class="steppers">${steppers}</div>
      </article>
    `;
  }

  /* ---------- Filters & Search ---------- */
  function matchesDiet(it){
    const t = normDiet(it.foodType || "");
    if (vegOn && !nonvegOn) return t.startsWith("veg");
    if (!vegOn && nonvegOn) return t.startsWith("non-veg") || t.startsWith("nonveg");
    return true;
  }
  const baseFilter = items => items.filter(it => it.inStock !== false && matchesDiet(it));

  function searchHaystack(it){
    const addonNames = Array.isArray(it.addons) ? it.addons.map(a => typeof a === "string" ? a : a.name) : [];
    const parts = [ it.name, it.description, it.foodCourse, it.category, ...addonNames ].filter(Boolean);
    return parts.join(" ");
  }
  function applySearch(items, q){ if (!q) return items; return items.filter(it => fuzzyMatch(searchHaystack(it), q)); }

  /* ---------- Tiles ---------- */
  function tsToMs(v){
    if (!v) return 0;
    if (v instanceof Date) return v.getTime();
    if (typeof v === "number") return v;
    if (typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000 + (v.nanoseconds||0)/1e6;
    const d = new Date(v); return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  function latestImageForGroup(items){
    if (!items.length) return "";
    const withTs = items.map(i => ({ ...i, _ts: Math.max(tsToMs(i.updatedAt), tsToMs(i.createdAt)) }));
    withTs.sort((a,b)=> b._ts - a._ts);
    const hit = withTs.find(x => x.imageUrl);
    return hit?.imageUrl || "";
  }
  function tileHTML(kind, id, label, imgUrl){
    return `
      <div class="bucket-tile" role="button" tabindex="0" data-kind="${kind}" data-id="${id}" data-label="${label}">
        <div class="tile-img">${imgUrl ? `<img loading="lazy" src="${imgUrl}" alt="${label}">` : ""}</div>
        <span class="bucket-label">${label}</span>
      </div>
    `;
  }

  /* ---------- Renderers ---------- */
  function renderCourseBuckets() {
    if (!courseBuckets) return;
    const filtered = baseFilter(ITEMS);
    courseBuckets.innerHTML = COURSES.slice().sort((a,b)=>a.label.localeCompare(b.label)).map(course => {
      const itemsIn = filtered.filter(it => it.foodCourse === course.id || it.foodCourse === course.label);
      const imgUrl = latestImageForGroup(itemsIn.length ? itemsIn : ITEMS.filter(it=>it.foodCourse === course.id || it.foodCourse === course.label));
      return tileHTML("course", course.id, course.label, imgUrl);
    }).join("");
  }
  function renderCategoryBuckets() {
    if (!categoryBuckets) return;
    const filtered = baseFilter(ITEMS);
    categoryBuckets.innerHTML = CATEGORIES.slice().sort((a,b)=>a.label.localeCompare(b.label)).map(cat => {
      const itemsIn = filtered.filter(it => it.category === cat.id || it.category === cat.label);
      const imgUrl = latestImageForGroup(itemsIn.length ? itemsIn : ITEMS.filter(it=>it.category === cat.id || it.category === cat.label));
      return tileHTML("category", cat.id, cat.label, imgUrl);
    }).join("");
  }

  function topbarHTML(){
    const showBannerTitle = (view === "list" && listKind === "banner" && (listLabel || "").trim().length > 0);
    const titleText = (listLabel || "").trim();
    return `
      <div class="topbar">
        <button class="back-btn" data-action="back">← Back</button>
        <button class="switch veg ${vegOn ? "on": ""}" role="switch" aria-checked="${vegOn}" data-action="veg">
          <span class="track"></span><span class="knob"></span><span class="label">Veg</span>
        </button>
        <button class="switch nonveg ${nonvegOn ? "on": ""}" role="switch" aria-checked="${nonvegOn}" data-action="nonveg">
          <span class="track"></span><span class="knob"></span><span class="label">Non-Veg</span>
        </button>
        <button class="pill-toggle course nav" data-action="nav-course">Food Course</button>
        <button class="pill-toggle category nav" data-action="nav-category">Food Categories</button>
        <div class="searchbar compact">
          <input type="text" class="tile-search" placeholder="Search dishes…" aria-label="Search dishes"
                 value="${view==="search" ? (searchQuery||"").replace(/"/g,'&quot;') : ""}"/>
          <button class="searchbtn" data-action="search" aria-label="Search"></button>
        </div>
        ${showBannerTitle ? `
          <div class="banner-heading" aria-live="polite">
            <span class="banner-title" title="${titleText}">
              <span class="chef-hat left" aria-hidden="true"></span>
              <span class="tilde" aria-hidden="true">~</span>
              <span class="banner-text blade-shine">${titleText}</span>
              <span class="tilde" aria-hidden="true">~</span>
              <span class="chef-hat right" aria-hidden="true"></span>
            </span>
          </div>` : ``}
      </div>`;
  }
  function autoFitBannerTitle(){
    const wrap = document.querySelector(".banner-heading .banner-title"); if (!wrap) return;
    const text = wrap.querySelector(".banner-text"); if (!text) return;
    wrap.style.setProperty("--banner-scale", "1");
    const wrapRect = wrap.getBoundingClientRect();
    let sideWidth = 0;
    wrap.querySelectorAll(".chef-hat, .tilde").forEach(el => { const r = el.getBoundingClientRect(); sideWidth += r.width; });
    const countGaps = wrap.querySelectorAll(".banner-title > *").length - 1; sideWidth += Math.max(0, countGaps) * 6;
    const available = Math.max(0, wrapRect.width - sideWidth);
    const needed    = text.scrollWidth;
    let scale = 1; if (needed > 0 && available > 0) scale = Math.min(1, Math.max(0.72, available / needed));
    wrap.style.setProperty("--banner-scale", String(scale));
  }

  /* ---------- Coupon-driven inclusion (the heart) ---------- */

  // Was: bannerMatchesMode(b) using b.targets/channel.
  // Now: banner is visible iff ANY linked coupon is hydrated, active, and allowed for MODE()  ★
  function bannerVisibleByCoupons(banner){
    if (!COUPONS_READY()) return false;
    const coupons = window.BANNERS_COUPONS.get(String(banner.id)) || new Set();
    const m = MODE();
    for (const cid of coupons) {
      const meta = window.COUPONS.get(String(cid));
      if (!meta || meta.active === false) continue;
      const t = meta.targets || {};
      if (m === "delivery" ? !!t.delivery : !!t.dining) return true;
    }
    return false;
  }

  // Was: itemMatchesBanner allowed pre-hydration and looked at banner/item fields.
  // Now: require hydration and intersect hydrated coupon truth.  ★
  function itemMatchesBanner(item, banner){
    if (!COUPONS_READY()) return false;
    const mode = MODE();

    // item hydrated coupon set
    const raw = Array.isArray(item.couponIds) ? item.couponIds
              : Array.isArray(item.coupons)   ? item.coupons
              : Array.isArray(item.promotions)? item.promotions
              : [];
    const itemC = new Set(raw.map(String).map(s=>s.trim()).filter(cid => window.COUPONS.has(cid)));

    // banner hydrated coupon set
    const bannerC = window.BANNERS_COUPONS.get(String(banner.id)) || new Set();

    for (const cid of itemC) {
      if (!bannerC.has(cid)) continue;
      const meta = window.COUPONS.get(String(cid));
      if (!meta || meta.active === false) continue;
      const t = meta.targets || {};
      if (mode === "delivery" ? !!t.delivery : !!t.dining) return true;
    }
    return false;
  }

  /* ---------- List data ---------- */
  function itemsForList(){
    let arr = baseFilter(ITEMS);
    if (view === "list" && listKind && listId) {
      if (listKind === "course") {
        const c = COURSES.find(x=>x.id===listId) || {id:listId, label:listId};
        arr = arr.filter(it => (it.foodCourse === c.id || it.foodCourse === c.label));
      } else if (listKind === "category") {
        const c = CATEGORIES.find(x=>x.id===listId) || {id:listId, label:listId};
        arr = arr.filter(it => (it.category === c.id || it.category === c.label));
      } else if (listKind === "banner") {
        if (!COUPONS_READY() || !ACTIVE_BANNER) return [];
        arr = arr.filter(it => itemMatchesBanner(it, ACTIVE_BANNER)); // coupon-only
      }
    }
    return arr;
  }

  function renderContentView(){
    if (!globalResults) return;
    const listIdDom = "globalResultsList";
    globalResults.innerHTML = `${topbarHTML()}<div id="${listIdDom}" class="list-grid"></div>`;
    globalList = document.getElementById(listIdDom);

    const base = (view === "search")
      ? applySearch(baseFilter(ITEMS), searchQuery)
      : itemsForList();

    globalList.innerHTML = base.length
      ? base.map(itemCardHTML).join("")
      : `<div class="menu-item placeholder">No items match your selection.</div>`;

    queueMicrotask(autoFitBannerTitle);
    queueMicrotask(decorateBannerDealBadges);
    updateAllMiniCartBadges(); window.updateCartLink?.();
    document.querySelectorAll(".menu-item[data-id]").forEach(el => updateAddonsButtonState(el.getAttribute("data-id")));
  }

  function showHome(){
    view = "home"; listKind=""; listId=""; listLabel="";
    globalResults.classList.add("hidden");
    coursesSection.classList.remove("hidden");
    categoriesSection.classList.remove("hidden");
    primaryBar?.classList.remove("hidden");
    $("#menuTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
    renderCourseBuckets(); renderCategoryBuckets();
    renderDeals(); // coupon-gated now
  }
  function enterList(kind, id, label){
    view = "list"; listKind=kind; listId=id; listLabel=label||id;
    coursesSection.classList.add("hidden");
    categoriesSection.classList.add("hidden");
    primaryBar?.classList.add("hidden");
    globalResults.classList.remove("hidden");
    renderContentView();
    $("#menuTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function enterSearch(q){
    view = "search"; searchQuery = q || "";
    coursesSection.classList.add("hidden");
    categoriesSection.classList.add("hidden");
    primaryBar?.classList.add("hidden");
    globalResults.classList.remove("hidden");
    renderContentView();
    $("#menuTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- Promotions: D1 rail (coupon-gated) ---------- */
  let COUPONS = window.COUPONS;
  let BANNERS = window.BANNERS;
  let ACTIVE_BANNER = null;

  // Coupon backfill for existing lock (unchanged behavior)
  function backfillLockedCouponMeta(){
    try {
      const lock = safeJSONGet("gufa_coupon", null);
      if (!lock) return;
      const cid  = String(lock?.scope?.couponId || "");
      if (!cid || !(COUPONS instanceof Map) || !COUPONS.has(cid)) return;
      const meta  = COUPONS.get(cid) || {};
      const code  = (meta.code || lock.code || cid).toString().toUpperCase();
      const type  = String(meta.type || lock.type || "");
      const value = Number(meta.value || lock.value || 0);
      if (code !== lock.code || type !== lock.type || value !== lock.value){
        const next = { ...lock, code, type, value };
        setLS("gufa_coupon", next);
        window.dispatchEvent(new CustomEvent("cart:update"));
      }
    } catch {}
  }
  backfillLockedCouponMeta();

  // Coupon hydration helper from multiple sources (unchanged shape, but we only consider hydrated truth)
  async function ensureCouponsReadyOnMenu(){
    try {
      if (COUPONS_READY()) return true;

      const raw = localStorage.getItem("gufa:COUPONS");
      if (raw) {
        const dump = JSON.parse(raw);
        if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
        if (Array.isArray(dump)) dump.forEach(([id, meta]) => window.COUPONS.set(String(id), meta || {}));
        else if (dump && typeof dump === "object") Object.entries(dump).forEach(([id, meta]) => window.COUPONS.set(String(id), meta || {}));
        if (COUPONS_READY()) { window.dispatchEvent(new CustomEvent("promotions:hydrated")); return true; }
      }

      if (typeof hydrateCouponsFromInlineJson === "function") {
        const ok = !!hydrateCouponsFromInlineJson();
        if (COUPONS_READY()) { window.dispatchEvent(new CustomEvent("promotions:hydrated")); return ok; }
      }

      if (typeof hydrateCouponsFromFirestoreOnce === "function") {
        const ok = !!(await hydrateCouponsFromFirestoreOnce());
        if (COUPONS_READY()) { window.dispatchEvent(new CustomEvent("promotions:hydrated")); return ok; }
      }

      if (typeof synthesizeCouponsFromBannersByCode === "function") {
        const ok = !!synthesizeCouponsFromBannersByCode();
        if (COUPONS_READY()) { window.dispatchEvent(new CustomEvent("promotions:hydrated")); return ok; }
      }
      return false;
    } catch { return false; }
  }

  // Render deals rail — now strictly coupon-gated  ★
  function renderDeals(){
    const host = document.querySelector("#todays-deals .deals-body");
    if (!host) return;
    if (!COUPONS_READY()) { host.innerHTML = ""; return; } // gate
    // ensure banner->coupon mirror exists
    publishBannerCouponMirror();

    const list = (BANNERS || []).filter(b => b.active !== false && bannerVisibleByCoupons(b));
    if (!list.length){ host.innerHTML = ""; return; }

    host.innerHTML = list.map(b => {
      const title = (b.title || "Deal").trim();
      const img   = b.imageUrl || "";
      return `
        <button class="deal-banner-card" data-banner-id="${b.id}" aria-label="${title}" title="${title}">
          <img class="deal-thumb" src="${img}" alt="" loading="lazy"/>
        </button>`;
    }).join("");

    if (!host.dataset.bannerClicks){
      host.addEventListener("click", (ev) => {
        const card = ev.target.closest(".deal-banner-card"); if (!card) return;
        const id = card.getAttribute("data-banner-id");
        const b = (BANNERS || []).find(x => x.id === id);
        if (b) openBannerList(b);
      }, false);
      host.dataset.bannerClicks = "1";
    }
  }

  /* ===== D2 — Banner → filtered items list ===== */
  function openBannerList(banner){
    if (!COUPONS_READY()) return; // gate
    ACTIVE_BANNER = banner; window.ACTIVE_BANNER = ACTIVE_BANNER; window.BANNERS = BANNERS;
    view = "list"; listKind = "banner"; listId = banner.id; listLabel = banner.title || "Today’s Deals";

    $("#coursesSection")?.classList.add("hidden");
    $("#categoriesSection")?.classList.add("hidden");
    $("#primaryBar")?.classList.add("hidden");
    $("#globalResults")?.classList.remove("hidden");

    renderContentView();

    queueMicrotask(() => {
      const target =
        document.querySelector(".banner-heading") ||
        document.querySelector(".menu-item[data-id]") ||
        document.querySelector(".menu-list, .items-grid");
      if (!target) return;
      target.classList.add("slide-focus");
      const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      try { target.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" }); }
      catch { target.scrollIntoView(true); }
      setTimeout(() => target.classList.remove("slide-focus"), prefersReduced ? 100 : 1200);
    });
  }

  // Decide badge coupon per item under banner (hydrated only)
  function pickCouponForItem(item, banner){
    if (!COUPONS_READY()) return null;
    const mode = MODE();
    const rawItem = Array.isArray(item.couponIds) ? item.couponIds
                  : Array.isArray(item.coupons)    ? item.coupons
                  : Array.isArray(item.promotions) ? item.promotions
                  : [];
    const itemIds = rawItem.map(String).map(s => s.trim()).filter(cid => window.COUPONS.has(cid));
    const bannerIds = Array.from(window.BANNERS_COUPONS.get(String(banner.id)) || []);
    for (const cid of bannerIds){
      if (!itemIds.includes(cid)) continue;
      const meta = window.COUPONS.get(String(cid));
      if (!meta || meta.active === false) continue;
      const t = meta.targets || {};
      const ok = (mode === "delivery") ? !!t.delivery : !!t.dining;
      if (ok) return { id: cid, ...meta };
    }
    return null;
  }

  function decorateBannerDealBadges(){
    if (!(view === "list" && listKind === "banner" && ACTIVE_BANNER)) return;
    if (!COUPONS_READY()) return; // gate
    const root = globalList || document.querySelector(".list-grid"); if (!root) return;
    root.querySelectorAll(".deal-badge").forEach(el => el.remove());
    root.querySelectorAll(".menu-item[data-id]").forEach(card => {
      const id = card.getAttribute("data-id");
      const item = (ITEMS || []).find(x => String(x.id) === String(id));
      if (!item) return;
      const chosen = pickCouponForItem(item, ACTIVE_BANNER);
      if (!chosen) return;
      const label = (chosen.type === "percent") ? `${chosen.value}% OFF`
                  : (chosen.type === "flat")    ? `₹${chosen.value} OFF` : `DEAL`;
      const badge = document.createElement("span");
      badge.className = "deal-badge";
      badge.setAttribute("aria-label", `Promotion: ${label}`);
      badge.textContent = label;
      card.appendChild(badge);
    });
  }

  /* ---------- Live data (Firestore) ---------- */
  async function listenAll() {
    const { collection, onSnapshot, query, orderBy } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const db = window.db;

    // Courses
    try {
      onSnapshot(collection(db, "menuCourses"), (snap) => {
        const list = []; snap.forEach(d => list.push({ id: d.id, label: d.data()?.name || d.id }));
        COURSES = list; if (view === "home") renderCourseBuckets();
      });
    } catch {}

    // Categories
    try {
      onSnapshot(collection(db, "menuCategories"), (snap) => {
        const list = []; snap.forEach(d => list.push({ id: d.id, label: d.data()?.name || d.id }));
        CATEGORIES = list; if (view === "home") renderCategoryBuckets();
      });
    } catch {}

    // Items
    const baseCol = collection(db, "menuItems");
    const renderFrom = (docs) => {
      ITEMS = docs.map(d => ({ id: d.id, ...d.data() }));
      window.ITEMS = ITEMS;
      if ((!COURSES?.length) || (!CATEGORIES?.length)) {
        const cm = new Map(), gm = new Map();
        for (const it of ITEMS) {
          const c=(it.foodCourse||"").trim(); if (c) cm.set(c, {id:c,label:c});
          const g=(it.category||"").trim(); if (g) gm.set(g,{id:g,label:g});
        }
        if (!COURSES?.length)    COURSES    = Array.from(cm.values());
        if (!CATEGORIES?.length) CATEGORIES = Array.from(gm.values());
      }
      // Build coupon→items when hydrated
      if (COUPONS_READY()) buildCouponItemsFromCatalog(ITEMS); // ★
      if (view === "home") { renderCourseBuckets(); renderCategoryBuckets(); }
      else { renderContentView(); }
      updateAllMiniCartBadges(); window.updateCartLink?.();
    };
    try {
      const qLive = query(baseCol, orderBy("createdAt","desc"));
      onSnapshot(qLive, snap => renderFrom(snap.docs), () => onSnapshot(baseCol, snap => renderFrom(snap.docs)));
    } catch {
      onSnapshot(baseCol, snap => renderFrom(snap.docs));
    }

    // Promotions: coupons
    try {
      onSnapshot(collection(db, "promotions"), (snap) => {
        const m = new Map();
        snap.forEach(d => {
          const x = d.data();
          if (x?.kind === "coupon") {
            const chStr = (x.channel || "").toLowerCase();
            const chObj = x.channels || null;
            const targets = chObj
              ? { delivery: !!chObj.delivery, dining: !!chObj.dining }
              : { delivery: (chStr === "delivery" || chStr === "both"), dining: (chStr === "dining" || chStr === "both") };
            m.set(d.id, {
              id: d.id,
              code: String(x.code || d.id).toUpperCase(),
              type: (x.type || "").toLowerCase(),
              value: Number(x.value || 0),
              active: x.active !== false,
              targets
            });
          }
        });
        COUPONS = m; window.COUPONS = m;
        try { setLS("gufa:COUPONS", Array.from(m.entries())); } catch {}
        // hydrate mirrors now that coupons are ready
        publishBannerCouponMirror();            // ★
        buildCouponItemsFromCatalog(ITEMS);     // ★
        backfillLockedCouponMeta();
        // repaint coupon-driven surfaces
        if (view === "home") renderDeals();
        if (view === "list" && listKind === "banner" && ACTIVE_BANNER) {
          renderContentView(); decorateBannerDealBadges();
        }
        window.dispatchEvent(new CustomEvent("promotions:hydrated"));
      });
    } catch {}

    // Promotions: banners
    try {
      onSnapshot(collection(db, "promotions"), (snap) => {
        const list = [];
        snap.forEach(d => {
          const x = d.data();
          if (x?.kind === "banner") {
            list.push({
              id: d.id,
              title: x.title || d.id,
              imageUrl: x.imageUrl || "",
              linkedCouponIds: Array.isArray(x.linkedCouponIds) ? x.linkedCouponIds.map(String) : [],
              targets: x.targets || {}, // legacy fields left intact but ignored as authority
              channel: x.channel || "",
              active: x.active !== false
            });
          }
        });
        BANNERS = list; window.BANNERS = list;
        publishBannerCouponMirror(); // keep mirror in sync  ★
        if (view === "home") renderDeals();
      });
    } catch {}
  }

  /* ---------- Events ---------- */
  document.addEventListener("click", (e) => {
    const tile = e.target.closest(".bucket-tile"); if (!tile) return;
    enterList(tile.dataset.kind, tile.dataset.id, tile.dataset.label || tile.dataset.id);
  });

  // Add-ons popover (guarded by base)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".addons-btn"); if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    const card = btn.closest(".menu-item"); const pop = card?.querySelector(".addons-popover"); const itemId = card?.getAttribute("data-id");
    if (!pop || !itemId) return;
    const variantKey = activeVariantForAddons(itemId);
    if (!variantKey) { nudgeBaseSteppers(itemId); return; }
    document.querySelectorAll('.addons-popover[aria-hidden="false"]').forEach(p => {
      if (p !== pop) {
        p.setAttribute("aria-hidden", "true"); const b = p.previousElementSibling;
        if (b?.classList.contains("addons-btn")) b.setAttribute("aria-expanded","false");
        p.hidden = true;
      }
    });
    const isOpen = pop.getAttribute("aria-hidden") === "false";
    if (isOpen) {
      if (document.activeElement && pop.contains(document.activeElement)) document.activeElement.blur();
      pop.setAttribute("aria-hidden","true"); pop.hidden = true; btn.setAttribute("aria-expanded","false"); pop._stage = undefined;
    } else {
      pop.dataset.variantKey = variantKey;
      pop._stage = new Map();
      primeAddonQuantities(pop, itemId, variantKey);
      const addBtn = pop.querySelector('.addons-add'); if (addBtn) addBtn.disabled = true;
      const vwrap = pop.querySelector(".addon-variants");
      if (vwrap) { vwrap.hidden = false; vwrap.innerHTML = `<small class="muted">Applying to variant: <strong>${variantKey}</strong></small>`; }
      pop.hidden = false; pop.setAttribute("aria-hidden","false"); btn.setAttribute("aria-expanded","true");
      const first = pop.querySelector('.addon-inc, .addon-dec, .addons-add'); if (first) first.focus({ preventScroll: true });
    }
  });

  document.addEventListener("click", (e) => {
    const inc = e.target.closest(".addon-inc"); const dec = e.target.closest(".addon-dec");
    if (!inc && !dec) return;
    const row = e.target.closest(".addon-row"); const pop = e.target.closest(".addons-popover"); const card = e.target.closest(".menu-item");
    const itemId = card?.getAttribute("data-id"); if (!row || !pop || !card || !itemId) return;
    const variantKey = pop.dataset.variantKey; if (!variantKey) { nudgeBaseSteppers(itemId); return; }
    if (!(pop._stage instanceof Map)) pop._stage = new Map();
    const name  = row.getAttribute("data-addon") || "";
    let committed = 0;
    try { const key = `${itemId}:${variantKey}:${name}`; committed = Number((window.Cart?.get?.() || {})[key]?.qty || 0); } catch {}
    const currDelta = Number(pop._stage.get(name) || 0);
    const nextDelta = Math.max(-committed, currDelta + (inc ? 1 : -1));
    pop._stage.set(name, nextDelta);
    const displayQty = committed + nextDelta;
    const num = row.querySelector(".num"); if (num) num.textContent = String(displayQty);
    const hasChange = Array.from(pop._stage.values()).some(v => v !== 0);
    const addBtn = pop.querySelector('.addons-add'); if (addBtn) addBtn.disabled = !hasChange;
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".addons-popover") && !e.target.closest(".addons-btn")) {
      document.querySelectorAll(".addons-popover[aria-hidden='false']").forEach(p => {
        if (document.activeElement && p.contains(document.activeElement)) document.activeElement.blur();
        p.setAttribute("aria-hidden","true"); p.hidden = true; p._stage = undefined;
        const b = p.previousElementSibling; if (b?.classList.contains("addons-btn")) b.setAttribute('aria-expanded','false');
      });
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".addons-popover[aria-hidden='false']").forEach(p => {
        p.setAttribute("aria-hidden","true"); p.hidden = true; p._stage = undefined;
        const b = p.previousElementSibling; if (b?.classList.contains("addons-btn")) b.setAttribute('aria-expanded','false');
      });
    }
  });
  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest('.addons-add[data-action="addons-add"]'); if (!addBtn) return;
    const pop  = addBtn.closest('.addons-popover'); const card = addBtn.closest('.menu-item'); const itemId = card?.getAttribute('data-id');
    if (!pop || !card || !itemId) return;
    const variantKey = pop.dataset.variantKey; if (!variantKey) { nudgeBaseSteppers(itemId); return; }
    const stage = (pop._stage instanceof Map) ? pop._stage : new Map();
    const hasChange = Array.from(stage.values()).some(v => v !== 0);
    if (hasChange) {
      const bag = window?.Cart?.get?.() || {};
      for (const [name, delta] of stage.entries()) {
        if (delta === 0) continue;
        const key = `${itemId}:${variantKey}:${name}`;
        const now = Number(bag?.[key]?.qty || 0);
        const next = Math.max(0, now + delta);
        let addonPrice = 0;
        try { const row = pop.querySelector(`.addon-row[data-addon="${CSS.escape(name)}"]`); addonPrice = Number(row?.getAttribute("data-price") || 0); } catch {}
        window.Cart?.setQty?.(key, next, next > 0 ? {
          id: itemId, name: (ITEMS.find(x=>x.id===itemId)?.name) || itemId, variant: variantKey, price: addonPrice, addons: [{ name, price: addonPrice }]
        } : undefined);
      }
    }
    pop.classList.add('genie-out');
    setTimeout(() => {
      if (document.activeElement && pop.contains(document.activeElement)) document.activeElement.blur();
      pop.setAttribute('aria-hidden','true'); pop.hidden = true; const b = pop.previousElementSibling;
      if (b?.classList.contains("addons-btn")) b.setAttribute('aria-expanded','false');
      pop.classList.remove('genie-out'); pop._stage = undefined;
    }, 180);
    requestAnimationFrame(() => {
      updateItemMiniCartBadge(itemId, hasChange); window.updateCartLink?.();
      const baseKey = `${itemId}:${variantKey}`; const baseBadge = card.querySelector(`.qty[data-key="${baseKey}"] .num`);
      if (baseBadge) baseBadge.textContent = String(getQty(baseKey));
    });
  });

  // Steppers
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".inc, .dec"); if (!btn) return;
    const wrap = btn.closest(".stepper"); const id = wrap?.dataset.item; const variantKey = wrap?.dataset.variant;
    const found = ITEMS.find(x => x.id === id); if (!found) return;
    const pm = priceModel(found.qtyType); const v = (pm?.variants || []).find(x => x.key === variantKey); if (!v || !v.price) return;
    const key = `${id}:${variantKey}`; const now = getQty(key);
    const next = Math.max(0, now + (btn.classList.contains("inc") ? 1 : -1));
    setQty(found, variantKey, v.price, next);
    if (next === 0) {
      const bag = window?.Cart?.get?.() || {};
      Object.keys(bag).forEach(k => { if (k.startsWith(`${id}:${variantKey}:`)) window.Cart?.setQty?.(k, 0); });
      const card = wrap.closest(".menu-item"); const pop  = card?.querySelector(".addons-popover");
      if (pop && pop.getAttribute("aria-hidden") === "false") {
        pop.setAttribute("aria-hidden","true"); pop.hidden = true; pop._stage = undefined;
        const b = pop.previousElementSibling; if (b?.classList.contains("addons-btn")) b.setAttribute("aria-expanded","false");
      }
    }
    updateAddonsButtonState(id);
  });

  // Mini cart button → checkout only if this item's qty > 0
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".mini-cart-btn"); if (!btn) return;
    e.preventDefault();
    const card = btn.closest(".menu-item"); const itemId = card?.getAttribute("data-id") || "";
    let qty = 0; try { qty = sumQtyByPrefix(itemId + ":"); } catch {}
    if (qty > 0) {
      const target = "/customer/checkout.html";
      const to = new URL(target, location.href);
      const sameOrigin = to.origin === location.origin;
      if (!sameOrigin) {
        const store = (window?.Cart?.get?.() || {});
        const raw = JSON.stringify({ items: store });
        const b64 = btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
        to.searchParams.set('cart', b64);
      }
      window.location.href = to.toString();
    } else {
      btn.classList.remove("rock"); void btn.offsetWidth; btn.classList.add("rock");
      setTimeout(() => btn.classList.remove("rock"), 350);
    }
  });

  /* ---------- Service Mode widgets (unchanged UI) ---------- */
  const SERVICE_MODE_KEY = "gufa:serviceMode";
  function getServiceMode(){ try { const v = localStorage.getItem(SERVICE_MODE_KEY); return (v === "dining" || v === "delivery") ? v : "delivery"; } catch { return "delivery"; } }
  function reflectServiceMode(mode){
    const del = document.getElementById("deliverySwitch"); const din = document.getElementById("diningSwitch");
    if (!del || !din) return;
    const isDelivery = (mode === "delivery");
    del.classList.toggle("on",  isDelivery); din.classList.toggle("on", !isDelivery);
    del.setAttribute("aria-checked", String(isDelivery)); din.setAttribute("aria-checked", String(!isDelivery));
  }
  function setServiceMode(mode){
    const next = (mode === "dining") ? "dining" : "delivery";
    try { localStorage.setItem(SERVICE_MODE_KEY, next); } catch {}
    reflectServiceMode(next);
    window.dispatchEvent(new CustomEvent("serviceMode:changed", { detail:{ mode: next } }));
  }
  function initServiceMode(){
    reflectServiceMode(getServiceMode());
    const del = document.getElementById("deliverySwitch"); const din = document.getElementById("diningSwitch");
    del?.addEventListener("click", () => setServiceMode("delivery"));
    din?.addEventListener("click", () => setServiceMode("dining"));
    window.addEventListener("storage", (e) => {
      if (e.key === SERVICE_MODE_KEY) {
        const mode = getServiceMode();
        reflectServiceMode(mode);
        window.dispatchEvent(new CustomEvent("serviceMode:changed", { detail: { mode } }));
      }
    });
  }
  (function setupServiceModeAPI(){
    const w = window; w.GUFA = w.GUFA || {};
    const api = w.GUFA.serviceMode || {};
    api.get = function get(){ return getServiceMode(); };
    api.set = function set(mode){ setServiceMode(mode); };
    api.onChange = function onChange(handler){
      if (typeof handler !== "function") return () => {};
      const fn = (e) => { const mode = (e && e.detail && e.detail.mode) || getServiceMode(); try { handler({ mode }); } catch {} };
      w.addEventListener("serviceMode:changed", fn);
      return () => w.removeEventListener("serviceMode:changed", fn);
    };
    w.GUFA.serviceMode = api;
  })();

  /* ---------- Locks & Indexes (coupon truth only) ---------- */

  // Build and persist coupon index — run only when hydrated & ITEMS ready  ★
  function buildAndPersistCouponIndex(){
    if (!COUPONS_READY() || !Array.isArray(ITEMS) || !ITEMS.length) return;
    buildCouponItemsFromCatalog(ITEMS); // already persists gufa:COUPON_INDEX
    window.dispatchEvent(new CustomEvent("promotions:hydrated"));
  }

  // Lock from banner add: compute eligible strictly from coupon truth  ★
  function lockCouponForActiveBannerIfNeeded(addedItemId) {
    if (!(view === "list" && listKind === "banner" && ACTIVE_BANNER)) return;
    if (!COUPONS_READY()) return;
    if (localStorage.getItem("gufa_coupon")) return;

    const item = (ITEMS || []).find(x => String(x.id) === String(addedItemId));
    if (!item || !itemMatchesBanner(item, ACTIVE_BANNER)) return;

    // Choose coupon via hydrated priority order in banner
    const chosen = pickCouponForItem(item, ACTIVE_BANNER);
    if (!chosen) return;

    // Eligible = union of items mapped to any of the banner’s hydrated coupons
    const bannerCoupons = Array.from(window.BANNERS_COUPONS.get(String(ACTIVE_BANNER.id)) || []);
    const eligibleSet = new Set();
    for (const cid of bannerCoupons) {
      const meta = window.COUPONS.get(cid);
      if (!meta || meta.active === false) continue;
      const t = meta.targets || {};
      if (MODE() === "delivery" ? !t.delivery : !t.dining) continue;
      const s = window.COUPON_ITEMS.get(cid); if (s) s.forEach(id => eligibleSet.add(String(id)));
    }
    const eligibleItemIds = Array.from(eligibleSet);

    // Persist coupon dump for checkout hydration
    try {
      if (window.COUPONS instanceof Map && window.COUPONS.size > 0) {
        setLS("gufa:COUPONS", Array.from(window.COUPONS.entries()));
      }
    } catch {}

    const payload = {
      code: String(chosen.code || chosen.id).toUpperCase(),
      type: String(chosen.type || ""),
      value: Number(chosen.value || 0),
      valid: (function(){
        const t = chosen.targets || {};
        return { delivery: ("delivery" in t) ? !!t.delivery : true, dining: ("dining" in t) ? !!t.dining : true };
      })(),
      scope: { bannerId: ACTIVE_BANNER.id, couponId: String(chosen.id), eligibleItemIds },
      lockedAt: Date.now(),
      source: "banner:" + ACTIVE_BANNER.id
    };

    try { setLS("gufa_coupon", payload); } catch {}
    window.dispatchEvent(new CustomEvent("cart:update"));
  }
  window.lockCouponForActiveBannerIfNeeded = lockCouponForActiveBannerIfNeeded;

  /* ---------- Boot ---------- */
  async function boot(){
    showHome();
    window.updateCartLink?.();
    initServiceMode();
    await listenAll();
    await ensureCouponsReadyOnMenu(); // attempt hydration
    // after hydration, publish mirrors & indexes
    if (COUPONS_READY()) {
      publishBannerCouponMirror();
      buildAndPersistCouponIndex();
      renderDeals();
      if (view === "list" && listKind === "banner" && ACTIVE_BANNER) {
        renderContentView(); decorateBannerDealBadges();
      }
    }
  }
  document.addEventListener("DOMContentLoaded", boot);

  window.addEventListener("serviceMode:changed", () => {
    try {
      if (typeof BANNERS !== "undefined") { window.BANNERS = BANNERS; }
      if (typeof view !== "undefined" ? view === "home" : true) { renderDeals?.(); }
      if (typeof view !== "undefined" && view === "list" && listKind === "banner") {
        renderContentView?.(); decorateBannerDealBadges?.();
      }
      if (COUPONS_READY()) buildAndPersistCouponIndex(); // safe, gated
    } catch {}
  });

  // Cross-origin checkout handoff: attach cart snapshot to the URL
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]'); if (!a) return;
    const href = a.getAttribute('href') || '';
    if (!/checkout\.html(\?|#|$)/i.test(href)) return;
    const to = new URL(href, location.href);
    const sameOrigin = to.origin === location.origin;
    if (sameOrigin) return;
    const store = (window?.Cart?.get?.() || {});
    const raw = JSON.stringify({ items: store });
    const b64 = btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
    to.searchParams.set('cart', b64);
    a.href = to.toString();
  });

})();
