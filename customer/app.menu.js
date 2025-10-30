// app.menu.js — align menu cards with the real Cart store and folder paths (no UI changes)

// Cart store is now always pre-loaded via index.html (before this script),
// so no dynamic injection needed — just verify readiness.
(function ensureCartReady(){
  if (!window.Cart || typeof window.Cart.setQty !== "function") {
    console.warn("[gufa] Cart API not initialized before menu.js");
  }
})();



// ===== Cart Helpers =====
function getCartEntries() {
  try { return Object.entries(Cart.get() || {}); } catch { return []; }
}

function sumQtyByPrefix(prefix) {
  return getCartEntries().reduce((n, [k, it]) => n + (k.startsWith(prefix) ? (Number(it.qty)||0) : 0), 0);
}

function getVariantQty(baseKey) {
  const base = Number((Cart.get?.() || {})[baseKey]?.qty || 0);
  const children = sumQtyByPrefix(baseKey + ":");
  return base + children;
}

// --- Determine selected base variant(s) for an item from DOM ---
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

// --- Choose active variant for add-ons ---
function activeVariantForAddons(itemId){
  const picked = selectedVariantsForItem(itemId);
  if (picked.length === 1) return picked[0];
  if (picked.length > 1) return picked[0]; // simple choice: first selected
  return null; // none selected
}

// --- Enable/disable the Add-ons button based on base qty ---
function updateAddonsButtonState(itemId){
  const card = document.querySelector(`.menu-item[data-id="${itemId}"]`);
  if (!card) return;
  const btn = card.querySelector(".addons-btn");
  if (!btn) return;
  const any = selectedVariantsForItem(itemId).length > 0;
  btn.setAttribute("aria-disabled", String(!any));
  btn.classList.toggle("glow", any);
  btn.classList.toggle("shimmer", any);
  // Highlight only when usable
  btn.classList.toggle("gold", true);
}

// --- Initialize popover quantities from Cart for the chosen variant ---
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

// --- Optional tiny pulse on steppers if user tries opening without base ---
function nudgeBaseSteppers(itemId){
  document.querySelectorAll(`.stepper[data-item="${itemId}"] .qty`).forEach(el=>{
    el.classList.add('pulse');
    setTimeout(()=>el.classList.remove('pulse'), 300);
  });
}

// ===== Mini-cart Badge =====
function updateItemMiniCartBadge(itemId, rock=false){
  const card = document.querySelector(`.menu-item[data-id="${itemId}"]`);
  if (!card) return;
  const btn = card.querySelector(".mini-cart-btn");
  if (!btn) return;

  const qty = sumQtyByPrefix(`${itemId}:`);
  let badge = btn.querySelector(".badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "badge";
    btn.appendChild(badge);
  }

  if (qty > 0) {
    badge.textContent = String(qty);
    btn.classList.add("active");
    if (rock) {
      btn.classList.add("rock");
      setTimeout(() => btn.classList.remove("rock"), 300);
    }
  } else {
    badge.textContent = "";
    btn.classList.remove("active");
  }
}

function updateAllMiniCartBadges(){
  document.querySelectorAll(".menu-item[data-id]").forEach(el => {
    const id = el.getAttribute("data-id");
    updateItemMiniCartBadge(id);
  });
}

// Keep coupons & banners available to cart and locker
if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
if (!Array.isArray(window.BANNERS)) window.BANNERS = [];

// —— Persist a lightweight coupons snapshot for checkout hydration ——//

(function persistCouponsSnapshot(){
  try {
    // Store only when we actually have some coupons
    if (window.COUPONS instanceof Map && window.COUPONS.size > 0) {
      const dump = Array.from(window.COUPONS.entries());
      localStorage.setItem("gufa:COUPONS", JSON.stringify(dump));
    }
  } catch {}
})();

// Keep coupon snapshot fresh without touching the locker function
window.addEventListener("cart:update", () => {
  try {
    if (window.COUPONS instanceof Map && window.COUPONS.size > 0) {
      const dump = Array.from(window.COUPONS.entries());
      localStorage.setItem("gufa:COUPONS", JSON.stringify(dump));
    }
  } catch {}
});




// ===== Global Sync =====
let lastCartUpdate = 0;
window.addEventListener("cart:update", () => {
  const now = Date.now();
  if (now - lastCartUpdate < 80) return; // ignore quick duplicates
  lastCartUpdate = now;

  updateAllMiniCartBadges();
  updateCartLink();

  // Keep Add-ons button state in sync with cart
  document.querySelectorAll(".menu-item[data-id]").forEach(el => {
    const itemId = el.getAttribute("data-id");
    updateAddonsButtonState(itemId);
  });
});

(function () {
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  /* ---------- Header cart link (already on your page) ---------- */
  const cartLink = $("#cartLink"); // e.g., "Cart (0)"


  /* ---------- State ---------- */
  let ITEMS = [];
  let COURSES = [];
  let CATEGORIES = [];

  let vegOn = false;
  let nonvegOn = false;

  let view = "home";     // 'home' | 'list' | 'search'
  let listKind = "";     // 'course' | 'category'
  let listId = "";       // selected id
  let listLabel = "";
  let searchQuery = "";
  let ACTIVE_BANNER = null;
  
  // --- Mode helpers (persist + broadcast) ---
  window.getActiveMode = function () {
    const m = String(localStorage.getItem("gufa_mode") || "delivery").toLowerCase();
    return (m === "dining" ? "dining" : "delivery");
  };
  
  window.setActiveMode = function (mode) {
  const m = (String(mode || "").toLowerCase() === "dining") ? "dining" : "delivery";
  // Write BOTH keys so old & new listeners stay in sync
  try { localStorage.setItem("gufa_mode", m); } catch {}
  try { localStorage.setItem("gufa:serviceMode", m); } catch {}

  // Broadcast BOTH events so all subscribers update immediately
  window.dispatchEvent(new CustomEvent("mode:change", { detail: { mode: m } }));
  window.dispatchEvent(new CustomEvent("serviceMode:changed", { detail: { mode: m } }));
};




   window.lockCouponForActiveBannerIfNeeded = function (addedItemId) {
  try {
    if (!(view === "list" && listKind === "banner")) return;

    // Skip if another coupon is already locked
    const existing = JSON.parse(localStorage.getItem("gufa_coupon") || "null");
    if (existing && existing.code) return;

    const ACTIVE_BANNER_ID = String(listId || "");
    const ACTIVE_BANNER = (window.BANNERS || []).find(b => String(b.id) === ACTIVE_BANNER_ID);
    if (!ACTIVE_BANNER) return;

    const [couponId] = Array.isArray(ACTIVE_BANNER.linkedCouponIds) ? ACTIVE_BANNER.linkedCouponIds : [];
    if (!couponId) return;

    const eligibleItemIds = (ITEMS || [])
      .filter(it => Array.isArray(it.promotions) && it.promotions.map(String).includes(String(couponId)))
      .map(it => String(it.id));

    // Guard: auto-lock allowed only if item was placed from banner context
const provenance = localStorage.getItem("gufa:prov:" + addedItemId);
if (!provenance || !provenance.startsWith("banner:")) return;


    const meta = (window.COUPONS instanceof Map) ? window.COUPONS.get(String(couponId)) : null;
    const targets = (meta && meta.targets) ? meta.targets : { delivery: true, dining: true };

    const payload = {
      code:  (meta?.code || String(couponId)).toUpperCase(),
      type:  String(meta?.type || ""),
      value: Number(meta?.value || 0),
      valid: {
        delivery: !!targets.delivery,
        dining:   !!targets.dining
      },
      scope: { couponId: String(couponId), eligibleItemIds },
      lockedAt: Date.now()
    };

    localStorage.setItem("gufa_coupon", JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent("cart:update", { detail: { coupon: payload } }));
  } catch {}
};



  /* ---------- DOM ---------- */
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

  /* ---------- Price & Cart (real cart API) ---------- */
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
  if (el) {
    const v = parseInt(el.textContent || "0", 10);
    if (!Number.isNaN(v)) return v;
  }
  try {
    const bag = window?.Cart?.get?.() || {};
    // exact key qty
    let q = Number(bag?.[key]?.qty || 0);
    // include composite children like "item:variant:addonKey"
    const prefix = key + ":";
    for (const [k, entry] of Object.entries(bag)) {
      if (k.startsWith(prefix)) q += Number(entry?.qty || 0);
    }
    return q;
  } catch { return 0; }
}


  function totalQtyForItem(itemId){
  // DOM steppers total
  const nodes = document.querySelectorAll(`.stepper[data-item="${itemId}"] .qty .num`);
  let domSum = Array.from(nodes).reduce((a,el)=> a + (parseInt(el.textContent||"0",10)||0), 0);

  // Include Cart store entries (covers add-on composite keys)
  try {
    const bag = window?.Cart?.get?.() || {};
    const cartSum = Object.entries(bag).reduce((acc, [k, entry]) => {
      if (k.startsWith(`${itemId}:`)) acc += Number(entry?.qty||0)||0;
      return acc;
    }, 0);
    // If cartSum is larger (e.g., due to add-on combos), prefer it
    return Math.max(domSum, cartSum);
  } catch { return domSum; }
}


function updateCartLink(){
  try {
    const bag = window.Cart?.get?.() || {};
    const total = Object.values(bag).reduce((a,entry)=> a + (Number(entry?.qty||0)||0), 0);
    if (cartLink) cartLink.textContent = `Cart (${total})`;
  } catch {
    if (cartLink) cartLink.textContent = `Cart (0)`;
  }
}


 

  function updateItemMiniCartBadge(itemId, rock=false){
    const btn = document.querySelector(`.menu-item[data-id="${itemId}"] .mini-cart-btn`);
    if (!btn) return;
  // include all cart entries starting with this itemId (covers add-ons)
const bag = window?.Cart?.get?.() || {};
let q = 0;
for (const [k, entry] of Object.entries(bag)) {
  if (k.startsWith(itemId + ":")) q += Number(entry?.qty || 0);
}

// fallback: if cart not updated yet, use DOM steppers to show immediate feedback
if (q === 0) {
  const nodes = document.querySelectorAll(`.stepper[data-item="${itemId}"] .qty .num`);
  q = Array.from(nodes).reduce((a,el)=> a + (parseInt(el.textContent||"0",10)||0), 0);
}

btn.classList.toggle("active", q>0);
let b = btn.querySelector(".badge");
if (q>0){
  if (!b){ b = document.createElement("span"); b.className = "badge"; btn.appendChild(b); }
  const prev = Number(b.textContent||"0");
  b.textContent = String(q);
  if (rock){
    btn.classList.remove("rock");
    void btn.offsetWidth; // reflow
    btn.classList.add("rock");
    setTimeout(()=>btn.classList.remove("rock"), 350);
  }
} else {
  if (b) b.remove();
 }
}  
  function updateAllMiniCartBadges(){
    document.querySelectorAll(".menu-item").forEach(card=>{
      const id = card.getAttribute("data-id");
      updateItemMiniCartBadge(id);
    });
  }

function setQty(found, variantKey, price, nextQty) {
  const key  = `${found.id}:${variantKey}`;
  const next = Math.max(0, Number(nextQty || 0));

  const badge = document.querySelector(`.qty[data-key="${key}"] .num`);
  if (badge) badge.textContent = String(next);

  // 1️⃣ Live Cart update
  try {
    if (window.Cart && typeof window.Cart.setQty === "function") {
      window.Cart.setQty(key, next, {
        id: found.id, name: found.name, variant: variantKey, price: Number(price) || 0
      });
    }
  } catch {}

    // 2️⃣ Persistent mirror for checkout hydration (single-key, flat)
try {
  const LS_KEY = "gufa_cart";
  let bag = {};

  // Prefer the live store’s flat items object
  const live = window?.Cart?.get?.();
  if (live && typeof live === "object" && Object.keys(live).length) {
    bag = (live.items && typeof live.items === "object") ? live.items : live;
  } else {
    try { bag = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
    catch { bag = {}; }
  }
  if (!bag || typeof bag !== "object") bag = {};

if (next <= 0) {
  delete bag[key];
  try { localStorage.removeItem("gufa:prov:" + key); } catch {}
} else {
  const prev = bag[key] || {};
  bag[key] = {
    id: found.id,
    name: found.name,
    variant: variantKey,
    price: Number(price) || Number(prev.price) || 0,
    thumb: prev.thumb || "",
    qty: next
  };
}


localStorage.setItem(LS_KEY, JSON.stringify(bag));
window.dispatchEvent(new CustomEvent("cart:update", { detail: { cart: { items: bag } } }));

// Tag provenance if user is currently in a banner list (no helpers needed)
try {
const inBanner = (view === "list") && (listKind === "banner") && (ACTIVE_BANNER && ACTIVE_BANNER.id);

  if (next > 0 && inBanner) {
    localStorage.setItem("gufa:prov:" + key, "banner:" + ACTIVE_BANNER.id);
  }
} catch {}



  if (next > 0) {
    try { window.lockCouponForActiveBannerIfNeeded?.(found.id); } catch {}
  }

  updateItemMiniCartBadge(found.id, true);
  updateCartLink();

setTimeout(() => {
  try {
    const bag = window?.Cart?.get?.() || JSON.parse(localStorage.getItem("gufa_cart") || "{}");
    const cartQty = Number(bag?.[key]?.qty || 0);
    if (badge && cartQty !== next) badge.textContent = String(cartQty || next);
    updateItemMiniCartBadge(found.id);
    updateCartLink();
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
  <div class="label-price">
    <span class="name">${n}</span>
    <span class="price">₹${p}</span>
  </div>
  <div class="addon-stepper" aria-label="Quantity for ${n}">
    <button class="addon-dec" aria-label="decrease">−</button>
    <span class="num">0</span>
    <button class="addon-inc" aria-label="increase">+</button>
  </div>
</div>
          `;
        }).join("")}
        </div>
        <div class="addon-actions">
  <button class="addons-add gold" data-action="addons-add" title="Add to Purchase" aria-label="Add to Purchase" disabled>
    Add to Purchase
  </button>
</div>
      </div>
    </div>
  `
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
  const courseMatch   = (it, c) => it.foodCourse === c.id || it.foodCourse === c.label;
  const categoryMatch = (it, c) => it.category   === c.id || it.category   === c.label;

function searchHaystack(it){
  const addonNames = Array.isArray(it.addons) ? it.addons.map(a => typeof a === "string" ? a : a.name) : [];
  const parts = [ it.name, it.description, it.foodCourse, it.category, ...addonNames ].filter(Boolean);
  return parts.join(" ");
}

  function applySearch(items, q){ if (!q) return items; return items.filter(it => fuzzyMatch(searchHaystack(it), q)); }

  /* ---------- Tiles (centered grid) ---------- */
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
      const itemsIn = filtered.filter(it => courseMatch(it, course));
      const imgUrl = latestImageForGroup(itemsIn.length ? itemsIn : ITEMS.filter(it=>courseMatch(it, course)));
      return tileHTML("course", course.id, course.label, imgUrl);
    }).join("");
  }
  function renderCategoryBuckets() {
    if (!categoryBuckets) return;
    const filtered = baseFilter(ITEMS);
    categoryBuckets.innerHTML = CATEGORIES.slice().sort((a,b)=>a.label.localeCompare(b.label)).map(cat => {
      const itemsIn = filtered.filter(it => categoryMatch(it, cat));
      const imgUrl = latestImageForGroup(itemsIn.length ? itemsIn : ITEMS.filter(it=>categoryMatch(it, cat)));
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
  </div>
` : ``}

</div>`;
}

 function autoFitBannerTitle(){
  const wrap = document.querySelector(".banner-heading .banner-title");
  if (!wrap) return;

  const text = wrap.querySelector(".banner-text");
  if (!text) return;

  // reset to natural size
  wrap.style.setProperty("--banner-scale", "1");

  // measure available width for the text (subtract hats + tildes + gaps)
  const wrapRect = wrap.getBoundingClientRect();
  let sideWidth = 0;
  wrap.querySelectorAll(".chef-hat, .tilde").forEach(el => {
    const r = el.getBoundingClientRect();
    sideWidth += r.width;
  });
  const countGaps = wrap.querySelectorAll(".banner-title > *").length - 1;
  sideWidth += Math.max(0, countGaps) * 6; // matches CSS gap

  const available = Math.max(0, wrapRect.width - sideWidth);
  const needed    = text.scrollWidth;

  // compute scale, clamped
  let scale = 1;
  if (needed > 0 && available > 0) {
    scale = Math.min(1, Math.max(0.72, available / needed)); // never smaller than ~72%
  }
  wrap.style.setProperty("--banner-scale", String(scale));
}
     
  
  
function itemsForList(){
  let arr = baseFilter(ITEMS);
  if (view === "list" && listKind && listId) {
    if (listKind === "course") {
      const c = COURSES.find(x=>x.id===listId) || {id:listId, label:listId};
      arr = arr.filter(it=>courseMatch(it, c));
    } else if (listKind === "category") {
      const c = CATEGORIES.find(x=>x.id===listId) || {id:listId, label:listId};
      arr = arr.filter(it=>categoryMatch(it, c));
} else if (listKind === "banner") {
  const hasActiveBanner = !!ACTIVE_BANNER;
  if (typeof itemMatchesBanner === "function" && hasActiveBanner) {
    arr = arr.filter(it => itemMatchesBanner(it, ACTIVE_BANNER));
  } else {
    arr = []; // fallback if helpers not ready
  }
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

  // — post-render UI decorators —
  queueMicrotask(autoFitBannerTitle);       // no-op unless banner list
  queueMicrotask(decorateBannerDealBadges); // attaches badges in banner lists

  updateAllMiniCartBadges();
  updateCartLink();

  // Initialize Add-ons button enabled/disabled state per card
  document.querySelectorAll(".menu-item[data-id]").forEach(el => {
    const itemId = el.getAttribute("data-id");
    updateAddonsButtonState(itemId);
  });
}
                         
  function showHome(){
  view = "home"; listKind=""; listId=""; listLabel="";
  globalResults.classList.add("hidden");
  coursesSection.classList.remove("hidden");
  categoriesSection.classList.remove("hidden");
  primaryBar?.classList.remove("hidden");
  document.getElementById("menuTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
  renderCourseBuckets(); renderCategoryBuckets();
  renderDeals(); // NEW: D1 banners
}

  function enterList(kind, id, label){
    view = "list"; listKind=kind; listId=id; listLabel=label||id;
    coursesSection.classList.add("hidden");
    categoriesSection.classList.add("hidden");
    primaryBar?.classList.add("hidden");
    globalResults.classList.remove("hidden");
    renderContentView();
    document.getElementById("menuTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function enterSearch(q){
    view = "search";
    searchQuery = q || "";
    coursesSection.classList.add("hidden");
    categoriesSection.classList.add("hidden");
    primaryBar?.classList.add("hidden");
    globalResults.classList.remove("hidden");
    renderContentView();
    document.getElementById("menuTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- Promotions (D1) ---------- */
let COUPONS = new Map();        // id -> { type: 'percent'|'flat', value, active }
let BANNERS = [];               // [{ id, title, imageUrl, linkedCouponIds:[], targets:{delivery,dining}, active }]
window.COUPONS = COUPONS;       // ← make it readable by app.cart.js
backfillLockedCouponMeta(); 

  // --- Backfill the saved lock with human-readable coupon code/type/value once coupons are ready ---
function backfillLockedCouponMeta(){
  try {
    const raw = localStorage.getItem("gufa_coupon");
    if (!raw) return;

    const lock = JSON.parse(raw);
    const cid  = String(lock?.scope?.couponId || "");
    if (!cid || !(COUPONS instanceof Map) || !COUPONS.has(cid)) return;

    const meta  = COUPONS.get(cid) || {};
    const code  = (meta.code || lock.code || cid).toString().toUpperCase();
    const type  = String(meta.type || lock.type || "");
    const value = Number(meta.value || lock.value || 0);

    // If any field improves, rewrite and notify listeners (cart, badges, etc.)
    if (code !== lock.code || type !== lock.type || value !== lock.value){
      const next = { ...lock, code, type, value };
      localStorage.setItem("gufa_coupon", JSON.stringify(next));
      window.dispatchEvent(new CustomEvent("cart:update"));
    }
  } catch {}
}

// --- Auto-run backfill once coupons hydrate (no need to touch your fetch/hydrate code) ---
(function ensureBackfillOnceReady(){
  const start = Date.now();
  (function tick(){
    try {
      if ((COUPONS instanceof Map) && COUPONS.size > 0) { backfillLockedCouponMeta(); return; }
      if (Date.now() - start > 10000) return; // stop after 10s to avoid infinite loop
    } catch {}
    setTimeout(tick, 300);
  })();
})();
  
function bannerMatchesMode(b){
  const m = (window.GUFA?.serviceMode?.get?.() || "delivery");
  const t = b?.targets || {};
  const legacy = (b?.channel || "").toLowerCase();
  return m === "delivery"
    ? (t.delivery === true || legacy === "delivery" || legacy === "both")
    : (t.dining === true   || legacy === "dining"   || legacy === "both");
}

function renderDeals(){
  const host = document.querySelector("#todays-deals .deals-body");
  if (!host) return;

  const list = (BANNERS || []).filter(b => b.active !== false && bannerMatchesMode(b));
  if (!list.length){ host.innerHTML = ""; return; }

  host.innerHTML = list.map(b => {
  const title = (b.title || "Deal").trim();
  const img   = b.imageUrl || "";
  return `
    <button class="deal-banner-card" data-banner-id="${b.id}" aria-label="${title}" title="${title}">
      <img class="deal-thumb" src="${img}" alt="" loading="lazy"/>
    </button>
  `;
}).join("");

// ONE-TIME: delegate clicks to open filtered list
if (!host.dataset.bannerClicks){
  host.addEventListener("click", (ev) => {
    const card = ev.target.closest(".deal-banner-card");
    if (!card) return;
    const id = card.getAttribute("data-banner-id");
    const b = (BANNERS || []).find(x => x.id === id);
    if (b) openBannerList(b);      // will be defined at file scope (see patch #2)
  }, false);
  host.dataset.bannerClicks = "1";
}
}
  
  /* ===== D2 — Banner → filtered items list (file-scope) ===== */

/** true if an item has at least one coupon linked to this banner */
function itemMatchesBanner(item, banner){
  if (!banner || !Array.isArray(banner.linkedCouponIds) || !banner.linkedCouponIds.length) return false;

  // Current service mode: "delivery" | "dining"
  const mode = (window.GUFA?.serviceMode?.get?.() || "delivery");

  // Normalize item coupon ids
  const rawIds = Array.isArray(item.couponIds) ? item.couponIds
               : Array.isArray(item.coupons)    ? item.coupons
               : Array.isArray(item.promotions) ? item.promotions
               : [];
  const itemIds = rawIds.map(String).map(s => s.trim()).filter(Boolean);

  // Normalize banner-linked ids
  const bannerIds = banner.linkedCouponIds.map(String).map(s => s.trim()).filter(Boolean);

  if (!itemIds.length || !bannerIds.length) return false;

  // Accept iff there exists at least one coupon id that:
  //  - is in BOTH (itemIds ∩ bannerIds)
  //  - is active (if meta present)
  //  - has targets allowing the current mode (delivery/dining)
  
  return itemIds.some(cid => {
    if (!bannerIds.includes(cid)) return false;
    const meta = (window.COUPONS instanceof Map) ? window.COUPONS.get(String(cid)) : null;

    // Before coupons map hydrates, allow temporarily to avoid flashing empty lists.
    if (!meta) return !(COUPONS instanceof Map) || COUPONS.size === 0;

    if (meta.active === false) return false;
    const t = meta.targets || {};
    return mode === "delivery" ? !!t.delivery : !!t.dining;
  });
}


/** Switch to list view showing only items matching the clicked banner */
function openBannerList(banner){
  ACTIVE_BANNER = banner;
  view = "list";
  listKind = "banner";
  listId = banner.id;
  listLabel = banner.title || "Today’s Deals";

  // hide tiles, show list
  document.getElementById("coursesSection")?.classList.add("hidden");
  document.getElementById("categoriesSection")?.classList.add("hidden");
  document.getElementById("primaryBar")?.classList.add("hidden");
  document.getElementById("globalResults")?.classList.remove("hidden");

  // use the standard renderer so cards look exactly the same
  renderContentView();

  // Smooth-scroll to the banner heading (or first menu card) after render,
  // and briefly highlight the destination for better visual navigation.
  queueMicrotask(() => {
    const target =
      document.querySelector(".banner-heading") ||
      document.querySelector(".menu-item[data-id]") ||
      document.querySelector(".menu-list, .items-grid");

    if (!target) return;

    // Add a temporary focus-beacon class for visual orientation
    target.classList.add("slide-focus");

    // Respect reduced-motion users by avoiding animation if requested
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    // Rely on CSS scroll-margin-top to stop cleanly below the fixed header
    try {
      target.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });
    } catch {
      target.scrollIntoView(true);
    }

    // Remove the beacon after it has served its purpose
    setTimeout(() => target.classList.remove("slide-focus"), prefersReduced ? 100 : 1200);
  });
}

// --- PROMO LOCK: persist coupon to localStorage on first eligible add ---
function lockCouponForActiveBannerIfNeeded(addedItemId) {
  if (!(view === "list" && listKind === "banner" && ACTIVE_BANNER)) return;
  if (localStorage.getItem("gufa_coupon")) return;

  const item = (window.ITEMS || []).find(x => String(x.id) === String(addedItemId));
  if (!item) return;

  // Item must currently match the open banner
  if (!itemMatchesBanner(item, ACTIVE_BANNER)) return;

  // Prefer a fully hydrated coupon meta; else fall back gracefully
  let chosen = null;
  try { chosen = pickCouponForItem(item, ACTIVE_BANNER); } catch {}

  // Compute a first-intersecting coupon id as fallback (if meta hasn’t hydrated yet)
  const rawItemIds = Array.isArray(item.couponIds) ? item.couponIds
                  : Array.isArray(item.coupons)    ? item.coupons
                  : Array.isArray(item.promotions) ? item.promotions
                  : [];
  const itemIds   = rawItemIds.map(String).map(s => s.trim()).filter(Boolean);
  const bannerIds = (ACTIVE_BANNER.linkedCouponIds || []).map(String).map(s => s.trim()).filter(Boolean);
  const firstIntersectId = bannerIds.find(cid => itemIds.includes(cid)) || "";

  // Eligible items = exactly what the user sees in the banner list right now
  const eligibleItemIds = (function() {
    try {
      if (typeof itemsForList === "function") return itemsForList().map(it => String(it.id));
      return (window.ITEMS || [])
        .filter(it => itemMatchesBanner(it, ACTIVE_BANNER))
        .map(it => String(it.id));
    } catch { return []; }
  })();

  // Resolve coupon details from COUPONS map if available
  const chosenId   = (chosen?.id || firstIntersectId || "").toString();
  const chosenMeta = (window.COUPONS instanceof Map) ? window.COUPONS.get(chosenId) : null;

  const payload = {
    code: String((chosen?.code || chosenMeta?.code || chosenId || ACTIVE_BANNER.id)).toUpperCase(),
    type: String(chosen?.type ?? chosenMeta?.type ?? ""),
    value: Number(chosen?.value ?? chosenMeta?.value ?? 0),

    // explicit per-mode validity; default permissive if meta missing
    valid: (function(){
      const t = chosenMeta?.targets || {};
      return {
        delivery: ("delivery" in t) ? !!t.delivery : true,
        dining:   ("dining"   in t) ? !!t.dining   : true
      };
    })(),

    scope: { bannerId: ACTIVE_BANNER.id, couponId: chosenId, eligibleItemIds },
    lockedAt: Date.now(),
    source: "banner:" + ACTIVE_BANNER.id
  };

  try { localStorage.setItem("gufa_coupon", JSON.stringify(payload)); } catch {}
  window.dispatchEvent(new CustomEvent("cart:update"));
}
// expose (some older code calls it via window.*)
window.lockCouponForActiveBannerIfNeeded = lockCouponForActiveBannerIfNeeded;



/* ===== D3 — Deal badges on item cards (banner list only) ===== */

/** Decide which coupon to badge for an item under a banner.
 * Policy: first intersecting, active coupon in the banner's linkedCouponIds order
 * that is valid for the current service mode (delivery/dining).
 */
function pickCouponForItem(item, banner){
  if (!item || !banner) return null;

  const mode = (window.GUFA?.serviceMode?.get?.() || "delivery");

  // normalize ids
  const rawItemIds = Array.isArray(item.couponIds) ? item.couponIds
                    : Array.isArray(item.coupons)    ? item.coupons
                    : Array.isArray(item.promotions) ? item.promotions
                    : [];
  const itemIds   = rawItemIds.map(String).map(s => s.trim()).filter(Boolean);
  const bannerIds = (banner.linkedCouponIds || []).map(String).map(s => s.trim()).filter(Boolean);
  if (!itemIds.length || !bannerIds.length) return null;

  // preserve banner order (admin controls priority)
  for (const cid of bannerIds){
    if (!itemIds.includes(cid)) continue;
    const meta = (window.COUPONS instanceof Map) ? window.COUPONS.get(String(cid)) : null;
    if (!meta) continue;                   // wait until coupons map hydrates
    if (meta.active === false) continue;

    const t = meta.targets || {};
    const ok = (mode === "delivery") ? !!t.delivery : !!t.dining;
    if (!ok) continue;

    return { id: cid, ...meta };
  }
  return null;
}

/** Attach a small red badge to each eligible card in banner list view.
 * Idempotent: removes old badges before decorating again.
 */
  
function decorateBannerDealBadges(){
  if (!(view === "list" && listKind === "banner" && ACTIVE_BANNER)) return;

  const root = (typeof globalList !== "undefined" && globalList) ? globalList
             : document.querySelector(".list-grid");
  if (!root) return;

  // Clean previous badges (re-render safe)
  root.querySelectorAll(".deal-badge").forEach(el => el.remove());

  // Each card is an .menu-item with data-id set in your current template
  root.querySelectorAll(".menu-item[data-id]").forEach(card => {
    const id = card.getAttribute("data-id");
    const item = (ITEMS || []).find(x => String(x.id) === String(id));
    if (!item) return;

    const chosen = pickCouponForItem(item, ACTIVE_BANNER);
    if (!chosen) return;

    // Label text
    const label = (chosen.type === "percent")
      ? `${chosen.value}% OFF`
      : (chosen.type === "flat")
        ? `₹${chosen.value} OFF`
        : `DEAL`;

    // Create badge
    const badge = document.createElement("span");
    badge.className = "deal-badge";
    badge.setAttribute("aria-label", `Promotion: ${label}`);
    badge.textContent = label;

    // Attach to the card; your cards already have position context in CSS
    card.appendChild(badge);
  });
}



  

  /* ---------- Live data (use window.db) ---------- */
  async function listenAll() {
    const { collection, onSnapshot, query, orderBy } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

    const db = window.db; // set by firebase.client.js

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

    // Items (with fallback if orderBy not available)
    const baseCol = collection(db, "menuItems");
    const renderFrom = (docs) => {
      ITEMS = docs.map(d => ({ id: d.id, ...d.data() }));
      window.ITEMS = ITEMS; 
      if ((!COURSES?.length) || (!CATEGORIES?.length)) {
        const cm = new Map(), gm = new Map();
        for (const it of ITEMS) { const c=(it.foodCourse||"").trim(); if (c) cm.set(c, {id:c,label:c}); const g=(it.category||"").trim(); if (g) gm.set(g,{id:g,label:g}); }
        if (!COURSES?.length)    COURSES    = Array.from(cm.values());
        if (!CATEGORIES?.length) CATEGORIES = Array.from(gm.values());
      }
      if (view === "home") { renderCourseBuckets(); renderCategoryBuckets(); }
      else { renderContentView(); }
      updateAllMiniCartBadges(); updateCartLink();
    };
    try {
      const qLive = query(baseCol, orderBy("createdAt","desc"));
      onSnapshot(qLive, snap => renderFrom(snap.docs), () => onSnapshot(baseCol, snap => renderFrom(snap.docs)));
    } catch {
      onSnapshot(baseCol, snap => renderFrom(snap.docs));
    }
 // Coupons (for later D2 label text; stored now)
    
try {
  onSnapshot(collection(db, "promotions"), (snap) => {
    const m = new Map();
    snap.forEach(d => {
      const x = d.data();
      if (x?.kind === "coupon") {
        const chStr = (x.channel || "").toLowerCase();           // legacy: "delivery" | "dining" | "both" | ""
        const chObj = x.channels || null;                         // new: { delivery:bool, dining:bool } if present
        const targets = chObj
          ? { delivery: !!chObj.delivery, dining: !!chObj.dining }
          : {
              delivery: (chStr === "delivery" || chStr === "both"),
              dining:   (chStr === "dining"   || chStr === "both")
            };
        m.set(d.id, {
          id: d.id,
          code: String(x.code || d.id).toUpperCase(),
          type: (x.type || "").toLowerCase(),
          value: Number(x.value || 0),
          active: x.active !== false,
          channel: chStr || null,
          channels: chObj,
          targets
        });
      }
    });
    COUPONS = m;
    window.COUPONS = m; // ← mirror globally

    // Backfill lock with meta/code if needed and refresh cart
    
    try {
      const locked = JSON.parse(localStorage.getItem("gufa_coupon") || "null");
      if (locked && locked.scope?.couponId) {
        const meta = m.get(String(locked.scope.couponId));
        if (meta && meta.active !== false) {
          const next = { ...locked };
          if (!next.code)  next.code  = meta.code || String(locked.scope.couponId).toUpperCase();
          if (!next.type)  next.type  = String(meta.type || "");
          if (!next.value) next.value = Number(meta.value || 0);
          if (next.code !== locked.code || next.type !== locked.type || next.value !== locked.value) {
            localStorage.setItem("gufa_coupon", JSON.stringify(next));
            window.dispatchEvent(new Event("cart:update"));
          }
        }
      }
    } catch {}

    // If currently viewing a banner list, (re)decorate badges now that coupons are hydrated
    if (typeof decorateBannerDealBadges === "function" && view === "list" && listKind === "banner" && ACTIVE_BANNER) {
      try { decorateBannerDealBadges(); } catch {}
    }
  });
} catch {}

// Banners (D1)
    
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
          targets: x.targets || {},
          channel: x.channel || "",   // legacy
          active: x.active !== false
        });
      }
    });
    BANNERS = list;
    window.BANNERS = list; // ← mirror globally
    if (view === "home") renderDeals();
  });
} catch {}
    
 }

  /* ---------- Events ---------- */
  // Tile clicks => list view
  document.addEventListener("click", (e) => {
    const tile = e.target.closest(".bucket-tile");
    if (!tile) return;
    enterList(tile.dataset.kind, tile.dataset.id, tile.dataset.label || tile.dataset.id);
  });
    
// Toggle Add-ons popover
// Toggle Add-ons popover (guarded by base selection)
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".addons-btn");
if (!btn) return;

e.preventDefault();
e.stopPropagation();

const card   = btn.closest(".menu-item");
const pop    = card?.querySelector(".addons-popover");
const itemId = card?.getAttribute("data-id");
if (!pop || !itemId) return;

// Require a base variant selection first
const variantKey = activeVariantForAddons(itemId);
if (!variantKey) { nudgeBaseSteppers(itemId); return; }

// Close other open popovers
document.querySelectorAll('.addons-popover[aria-hidden="false"]').forEach(p => {
  if (p !== pop) {
    p.setAttribute("aria-hidden", "true");
    const b = p.previousElementSibling;
    if (b?.classList.contains("addons-btn")) b.setAttribute("aria-expanded", "false");
    p.hidden = true;
  }
});

const isOpen = pop.getAttribute("aria-hidden") === "false";
if (isOpen) {
  if (document.activeElement && pop.contains(document.activeElement)) document.activeElement.blur();
  pop.setAttribute("aria-hidden","true");
  pop.hidden = true;
  btn.setAttribute("aria-expanded","false");
  // discard any staged deltas
  pop._stage = undefined;
} else {
  // lock variant in this session
  pop.dataset.variantKey = variantKey;

  // Stage map: addonName -> delta (start 0)
  pop._stage = new Map();

  // Prime UI numbers from Cart (committed state)
  primeAddonQuantities(pop, itemId, variantKey);

  // Reset staged button state
  const addBtn = pop.querySelector('.addons-add');
  if (addBtn) addBtn.disabled = true;

  // Optional: show variant info
  
  const vwrap = pop.querySelector(".addon-variants");
  if (vwrap) {
    vwrap.hidden = false;
    vwrap.innerHTML = `<small class="muted">Applying to variant: <strong>${variantKey}</strong></small>`;
  }

  pop.hidden = false;
  pop.setAttribute("aria-hidden","false");
  btn.setAttribute("aria-expanded","true");

  const first = pop.querySelector('.addon-inc, .addon-dec, .addons-add');
  if (first) first.focus({ preventScroll: true });
}
});

// Add-on stepper (+/−): STAGE only (no Cart writes yet)
  
document.addEventListener("click", (e) => {
  const inc = e.target.closest(".addon-inc");
  const dec = e.target.closest(".addon-dec");
  if (!inc && !dec) return;

  const row  = e.target.closest(".addon-row");
  const pop  = e.target.closest(".addons-popover");
  const card = e.target.closest(".menu-item");
  const itemId = card?.getAttribute("data-id");
  if (!row || !pop || !card || !itemId) return;

  const variantKey = pop.dataset.variantKey;
  if (!variantKey) { nudgeBaseSteppers(itemId); return; }

  if (!(pop._stage instanceof Map)) pop._stage = new Map();

  const name  = row.getAttribute("data-addon") || "";
  const price = Number(row.getAttribute("data-price") || 0);

  let committed = 0;
  try {
    const key = `${itemId}:${variantKey}:${name}`;
    committed = Number((window.Cart?.get?.() || {})[key]?.qty || 0);
  } catch {}

  const currDelta = Number(pop._stage.get(name) || 0);
  const nextDelta = Math.max(-committed, currDelta + (inc ? 1 : -1));
  pop._stage.set(name, nextDelta);

  const displayQty = committed + nextDelta;

  const num = row.querySelector(".num");
  if (num) num.textContent = String(displayQty);

  // Enable if ANY delta ≠ 0 (add or remove)
  const hasChange = Array.from(pop._stage.values()).some(v => v !== 0);
  const addBtn = pop.querySelector('.addons-add');
  if (addBtn) addBtn.disabled = !hasChange;
});

  
// Close add-ons popover when clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest(".addons-popover") && !e.target.closest(".addons-btn")) {
    document.querySelectorAll(".addons-popover[aria-hidden='false']").forEach(p => {
      if (document.activeElement && p.contains(document.activeElement)) document.activeElement.blur();
      p.setAttribute("aria-hidden","true");
      p.hidden = true;
      p._stage = undefined; // clear staged changes
      const b = p.previousElementSibling;
      if (b?.classList.contains("addons-btn")) b.setAttribute('aria-expanded','false');
    });
  }
});


// Close add-ons popover on Esc
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".addons-popover[aria-hidden='false']").forEach(p => {
      p.setAttribute("aria-hidden","true");
      p.hidden = true;
      p._stage = undefined; // clear staged changes
      const b = p.previousElementSibling;
      if (b?.classList.contains("addons-btn")) b.setAttribute('aria-expanded','false');
    });
  }
});

  
// [Add to Purchase]: commit staged add-ons to Cart (adds & removals), then close
document.addEventListener("click", (e) => {
  const addBtn = e.target.closest('.addons-add[data-action="addons-add"]');
  if (!addBtn) return;

  const pop  = addBtn.closest('.addons-popover');
  const card = addBtn.closest('.menu-item');
  const itemId = card?.getAttribute('data-id');
  if (!pop || !card || !itemId) return;

  const variantKey = pop.dataset.variantKey;
  if (!variantKey) { nudgeBaseSteppers(itemId); return; }

  const stage = (pop._stage instanceof Map) ? pop._stage : new Map();

  // Any change (positive or negative)?
  const hasChange = Array.from(stage.values()).some(v => v !== 0);

  if (hasChange) {
    const bag = window?.Cart?.get?.() || {};
    for (const [name, delta] of stage.entries()) {
      if (delta === 0) continue;

      const key = `${itemId}:${variantKey}:${name}`;
      const now = Number(bag?.[key]?.qty || 0);
      const next = Math.max(0, now + delta);

      let basePrice = 0, addonPrice = 0;
      try {
        const found = ITEMS.find(x => x.id === itemId);
        const pm = priceModel(found?.qtyType);
        basePrice = Number((pm?.variants || []).find(x => x.key === variantKey)?.price || 0);
        const row = pop.querySelector(`.addon-row[data-addon="${CSS.escape(name)}"]`);
        addonPrice = Number(row?.getAttribute("data-price") || 0);
      } catch {}

      window.Cart?.setQty?.(key, next, next > 0 ? {
       id: itemId,
       name: (ITEMS.find(x=>x.id===itemId)?.name) || itemId,
       variant: variantKey,
        price: addonPrice,
        addons: [{ name, price: addonPrice }]
      } : undefined);
    }
  }

  // close popover + clear stage
  pop.classList.add('genie-out');
  setTimeout(() => {
    if (document.activeElement && pop.contains(document.activeElement)) document.activeElement.blur();
    pop.setAttribute('aria-hidden','true');
    pop.hidden = true;
    const b = pop.previousElementSibling;
    if (b?.classList.contains("addons-btn")) b.setAttribute('aria-expanded','false');
    pop.classList.remove('genie-out');
    pop._stage = undefined;
  }, 180);

  // Rock if any change; refresh header + variant stepper
  requestAnimationFrame(() => {
    updateItemMiniCartBadge(itemId, /*rock*/ hasChange);
    updateCartLink();
    const baseKey = `${itemId}:${variantKey}`;
    const baseBadge = card.querySelector(`.qty[data-key="${baseKey}"] .num`);
    if (baseBadge) baseBadge.textContent = String(getQty(baseKey));
  });
});



// Dismiss on outside click
document.addEventListener("click", (e) => {
  document.querySelectorAll('.addons-popover[aria-hidden="false"]').forEach(p => {
    if (!p.contains(e.target) && !e.target.closest(".addons-btn")) {
      if (document.activeElement && p.contains(document.activeElement)) {
        document.activeElement.blur();
      }
      p.setAttribute("aria-hidden", "true");
      p.hidden = true;
      const b = p.previousElementSibling;
      if (b?.classList.contains("addons-btn")) b.setAttribute("aria-expanded", "false");
    }
  });
});

// Dismiss on Esc
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  document.querySelectorAll('.addons-popover[aria-hidden="false"]').forEach(p => {
    if (document.activeElement && p.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    p.setAttribute("aria-hidden", "true");
    p.hidden = true;
    const b = p.previousElementSibling;
    if (b?.classList.contains("addons-btn")) b.setAttribute("aria-expanded", "false");
  });
});

  
  // Topbar actions
  document.addEventListener("click", (e) => {
    const actBtn = e.target.closest("[data-action]"); if (!actBtn) return;
    const action = actBtn.getAttribute("data-action");

    if (action === "back") { showHome(); if (listKind === "course") coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); if (listKind === "category") categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (action === "veg")    { vegOn = !vegOn; renderAfterToggle(); return; }
    if (action === "nonveg") { nonvegOn = !nonvegOn; renderAfterToggle(); return; }
    if (action === "nav-course")   { showHome(); coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (action === "nav-category") { showHome(); categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (action === "search") {
      const wrap = actBtn.closest(".topbar"); const field = wrap?.querySelector(".tile-search");
      enterSearch((field?.value || "").trim()); if (searchInputHome) searchInputHome.value = (field?.value || "").trim(); return;
    }
  });
  function renderAfterToggle(){
    vegSwitch?.classList.toggle("on", vegOn); vegSwitch?.setAttribute("aria-checked", String(vegOn));
    nonvegSwitch?.classList.toggle("on", nonvegOn); nonvegSwitch?.setAttribute("aria-checked", String(nonvegOn));
    if (view==="home"){ renderCourseBuckets(); renderCategoryBuckets(); } else { renderContentView(); }
  }

  // Home switches + search
  vegSwitch?.addEventListener("click", () => { vegOn = !vegOn; renderAfterToggle(); });
  nonvegSwitch?.addEventListener("click", () => { nonvegOn = !nonvegOn; renderAfterToggle(); });
  courseToggle?.addEventListener("click", () => { coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  categoryToggle?.addEventListener("click", () => { categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  searchBtnHome?.addEventListener("click", () => enterSearch((searchInputHome?.value || "").trim()));
  searchInputHome?.addEventListener("keydown", (e) => { if (e.key === "Enter") enterSearch((searchInputHome?.value || "").trim()); });

  /* Steppers — DOM-first qty, then store */
// Steppers — DOM-first qty, then store
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".inc, .dec"); if (!btn) return;
  const wrap = btn.closest(".stepper"); const id = wrap?.dataset.item; const variantKey = wrap?.dataset.variant;
  const found = ITEMS.find(x => x.id === id); if (!found) return;
  const pm = priceModel(found.qtyType); const v = (pm?.variants || []).find(x => x.key === variantKey); if (!v || !v.price) return;

  const key = `${id}:${variantKey}`;
  const now = getQty(key);
  const next = Math.max(0, now + (btn.classList.contains("inc") ? 1 : -1));
  setQty(found, variantKey, v.price, next);

  // Cascade: if base qty goes to 0, purge all add-ons for this base
  if (next === 0) {
    const bag = window?.Cart?.get?.() || {};
    Object.keys(bag).forEach(k => {
      if (k.startsWith(`${id}:${variantKey}:`)) {
        window.Cart?.setQty?.(k, 0);
      }
    });

    // Close popover if open
    const card = wrap.closest(".menu-item");
    const pop  = card?.querySelector(".addons-popover");
    if (pop && pop.getAttribute("aria-hidden") === "false") {
      pop.setAttribute("aria-hidden","true");
      pop.hidden = true;
      pop._stage = undefined;
      const b = pop.previousElementSibling;
      if (b?.classList.contains("addons-btn")) b.setAttribute("aria-expanded","false");
    }
  }

  updateAddonsButtonState(id);
});

// Mini cart button click: only go to checkout if this item has qty > 0
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".mini-cart-btn");
  if (!btn) return;

  e.preventDefault();

  const card = btn.closest(".menu-item");
  const itemId = card?.getAttribute("data-id") || "";

  // Compute latest qty for this item (base + any add-ons)
  let qty = 0;
  try {
    qty = sumQtyByPrefix(itemId + ":");  // uses Cart.get() under the hood
  } catch {}

if (qty > 0) {
  // proceed to checkout with cross-origin handoff support
  const target = "/customer/checkout.html";
  const to = new URL(target, location.href);
  const sameOrigin = to.origin === location.origin;

  if (!sameOrigin) {
    // Snapshot current cart (same as your anchor patch)
    const store = (window?.Cart?.get?.() || {});
    const snap = { items: store };
    const raw = JSON.stringify(snap);
    const b64 = btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');

    to.searchParams.set('cart', b64);
  }

  window.location.href = to.toString();
} else {
    // empty -> do a quick rock/wobble and do nothing
    btn.classList.remove("rock");
    // reflow to retrigger the animation even on repeated clicks
    void btn.offsetWidth;
    btn.classList.add("rock");
    setTimeout(() => btn.classList.remove("rock"), 350);
  }
});


/* ---------- Service Mode (Slice 2) ---------- */
const SERVICE_MODE_KEY = "gufa:serviceMode";

/** Read current mode (default 'delivery'). */
function getServiceMode(){
  try {
    const v = localStorage.getItem(SERVICE_MODE_KEY);
    return (v === "dining" || v === "delivery") ? v : "delivery";
  } catch { return "delivery"; }
}

/** Reflect mode to UI switches (class + aria). Safe if elements are missing. */
function reflectServiceMode(mode){
  const del = document.getElementById("deliverySwitch");
  const din = document.getElementById("diningSwitch");
  if (!del || !din) return;

  const isDelivery = (mode === "delivery");
  del.classList.toggle("on",  isDelivery);
  din.classList.toggle("on", !isDelivery);
  del.setAttribute("aria-checked", String(isDelivery));
  din.setAttribute("aria-checked", String(!isDelivery));
}

/** Persist + reflect + broadcast (decoupled for downstream listeners). */
function setServiceMode(mode){
  const next = (mode === "dining") ? "dining" : "delivery";
  try { localStorage.setItem(SERVICE_MODE_KEY, next); } catch {}
  reflectServiceMode(next);
  // Notify any feature that cares (promos, checkout, badges… later slices)
  window.dispatchEvent(new CustomEvent("serviceMode:changed", { detail:{ mode: next } }));
}

/** Wire up click handlers + storage sync across tabs. */
function initServiceMode(){
  // Initial reflect from storage (or default).
  reflectServiceMode(getServiceMode());

  const del = document.getElementById("deliverySwitch");
  const din = document.getElementById("diningSwitch");

  del?.addEventListener("click", () => setServiceMode("delivery"));
  din?.addEventListener("click", () => setServiceMode("dining"));

    // Keep multiple tabs in sync
  
  window.addEventListener("storage", (e) => {
    if (e.key === SERVICE_MODE_KEY) {
      const mode = getServiceMode();
      reflectServiceMode(mode);
      // NEW: also broadcast so onChange() subscribers in other tabs get notified
      window.dispatchEvent(new CustomEvent("serviceMode:changed", { detail: { mode } }));
    }
  });
}

  /* ---------- Service Mode API (Slice 3) ---------- */
/**
 * Public, decoupled API:
 *   - GUFA.serviceMode.get()        -> "delivery" | "dining"
 *   - GUFA.serviceMode.set(mode)    -> sets + persists + broadcasts
 *   - GUFA.serviceMode.onChange(fn) -> subscribe to changes, returns unsubscribe()
 */
(function setupServiceModeAPI(){
  const w = window;
  w.GUFA = w.GUFA || {};

  // Reuse existing object if present; otherwise create.
  const api = w.GUFA.serviceMode || {};

  /** Return current mode immediately. */
  api.get = function get(){ return getServiceMode(); };

  /** Set mode using Slice-2 setter (handles storage, reflect, event). */
  api.set = function set(mode){ setServiceMode(mode); };

  /**
   * Subscribe to mode changes. Handler receives {mode}.
   * Returns an unsubscribe function.
   */
  api.onChange = function onChange(handler){
    if (typeof handler !== "function") return () => {};
    const fn = (e) => {
      const mode = (e && e.detail && e.detail.mode) || getServiceMode();
      try { handler({ mode }); } catch {}
    };
    w.addEventListener("serviceMode:changed", fn);
    return () => w.removeEventListener("serviceMode:changed", fn);
  };

  w.GUFA.serviceMode = api;
})();

 /* ---------- Boot ---------- */
async function boot(){
  showHome(); // renders tiles on load if sections present
  updateCartLink();
  initServiceMode();
  await listenAll();
}
document.addEventListener("DOMContentLoaded", boot);


// D1: re-filter banners when service mode changes
window.addEventListener("serviceMode:changed", () => {
  if (view === "home") renderDeals();
});


// Refresh UI when service mode switches (Delivery <-> Dining)
// Customer UI only; avoid reloading /admin.
  
window.addEventListener("serviceMode:changed", () => {
  // refresh deals strip (filters banners by mode)
  try { renderDeals?.(); } catch {}

  // if user is viewing a banner-filtered list, re-filter the items
  try {
    if (view === "list" && listKind === "banner") {
      renderContentView?.();
      try { decorateBannerDealBadges?.(); } catch {}
    }
  } catch {}

  // Don’t reload the Admin Panel.
  if (location.pathname.startsWith("/admin")) return;

  // Prevent duplicate reloads if multiple handlers fire.
  if (window.__modeReloadPending) return;
  window.__modeReloadPending = true;

  // Small delay to allow any in-flight UI actions to settle.
  setTimeout(() => { try { location.reload(); } catch {} }, 120);
});



// Also refresh banner badges when service mode changes
window.addEventListener("serviceMode:changed", () => {
  if (view === "list" && listKind === "banner" && typeof decorateBannerDealBadges === "function") {
    try { decorateBannerDealBadges(); } catch {}
  }
});

  
 // Keep header & badges in sync whenever the cart store updates
window.addEventListener("cart:update", () => {
  updateAllMiniCartBadges();
  updateCartLink();

  // NEW: keep Add-ons button state in sync with cart
  document.querySelectorAll(".menu-item[data-id]").forEach(el => {
    const itemId = el.getAttribute("data-id");
    updateAddonsButtonState(itemId);
  });
});

})();
 // Cross-origin checkout handoff: attach cart snapshot to the URL
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;

  // Only act on links that go to checkout
  const href = a.getAttribute('href') || '';
  if (!/checkout\.html(\?|#|$)/i.test(href)) return;

  // Resolve absolute target to compare origins
  const to = new URL(href, location.href);
  const sameOrigin = to.origin === location.origin;
  if (sameOrigin) return; // no need to hand off within same origin

  // Snapshot current cart
  const store = (window?.Cart?.get?.() || {});
  const snap = { items: store };

  // Base64URL encode
  const raw = JSON.stringify(snap);
  const b64 = btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');

  // Append ?cart= payload
  to.searchParams.set('cart', b64);
  a.href = to.toString();
});
