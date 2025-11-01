// app.cart.js — Robust Cart with strict Promotions, FCFS (non-stackable), Mode gating,
// Add-on steppers + auto-prune, Promo totals row, and Delivery Address form.
// Refactor-friendly: clear seams for minOrder & usageLimit coming from Admin/promotions.js.

// --- FCFS first-seen tracking ---
const FIRST_SEEN_KEY = 'gufa:COUPON_FIRST_SEEN';
function _firstSeenMap() {
  try { return JSON.parse(localStorage.getItem(FIRST_SEEN_KEY) || '{}'); } catch { return {}; }
}
function markFirstSeen(couponId) {
  const m = _firstSeenMap();
  if (!(couponId in m)) {
    m[couponId] = Date.now();
    localStorage.setItem(FIRST_SEEN_KEY, JSON.stringify(m));
  }
}
function getFirstSeenIndex(couponId) {
  const m = _firstSeenMap();
  return m[couponId] ?? Number.MAX_SAFE_INTEGER;
}

// normalize coupon meta → always have eligibleItemIds on checkout
function _normalizedCoupons() {
  const src = window.COUPONS instanceof Map ? window.COUPONS : new Map(Object.entries(window.COUPONS || {}));
  return Array.from(src.entries()).map(([id, meta]) => {
    const elig = meta?.eligibleItemIds?.length
      ? meta.eligibleItemIds
      : (window.BANNERS instanceof Map ? (window.BANNERS.get(`coupon:${id}`) || []) : []);
    return { id, ...meta, eligibleItemIds: elig };
  });
}


function enforceNextLock(reason = '') {
  // 1) drop stale lock if its eligible items are gone
  try { Cart.enforceLockIntegrity?.(); } catch {}

  const cart = Cart.get?.() || JSON.parse(localStorage.getItem('gufa_cart') || '{}');
  const coupons = _normalizedCoupons();
  const mode = (localStorage.getItem('gufa_mode') || 'delivery').toLowerCase();

  if (!Array.isArray(cart?.lines) || !coupons.length) return;

  // FCFS priority by first-seen time
  const priority = (a, b) => getFirstSeenIndex(a.id) - getFirstSeenIndex(b.id);

  const next = window.CouponEngine?.nextLock?.(cart, coupons, mode, priority);
  if (next && next.couponId && next.elig?.length) {
    // persist lock as your existing lock shape
    const lock = { code: next.code, couponId: next.couponId, elig: next.elig, mode, source: 'auto' };
    localStorage.setItem('gufa_coupon', JSON.stringify(lock));
    document.dispatchEvent?.(new CustomEvent('coupon:lock', { detail: { lock, reason } }));
  } else {
    // if nothing applies, ensure we’re not stuck with an empty/invalid lock
    const cur = JSON.parse(localStorage.getItem('gufa_coupon') || 'null');
    if (!cur || !cur.elig?.length) {
      localStorage.removeItem('gufa_coupon');
      document.dispatchEvent?.(new Event('coupon:unlock'));
    }
  }
}


let lastSnapshotAt = 0;
function persistCartSnapshotThrottled() {
  const now = Date.now();
  if (now - lastSnapshotAt < 1000) return; // 1s debounce
  lastSnapshotAt = now;
  try {
    const cart = window?.Cart?.get?.() || {};
    localStorage.setItem("gufa_cart", JSON.stringify(cart));
  } catch {}
}
window.addEventListener("cart:update", persistCartSnapshotThrottled);
window.addEventListener("cart:update", () => enforceNextLock('after:cart:update'));


// ---- crash guards (no feature changes) ----
// 1) Ensure we have a deterministic UI selector map that matches checkout.html
(function ensureCartUIMap(){
  const defaults = {
    items:      "#cart-items",
    empty:      "#cart-empty",
    subtotal:   "#subtotal-amt",
    servicetax: "#servicetax-amt",
    total:      "#total-amt",
    proceed:    "#proceed-btn",
    invFood:    "#inv-food",
    invAddons:  "#inv-addons",
    promoLbl:   "#promo-label",
    promoAmt:   "#promo-amt",
    promoInput: "#promo-input",
    promoApply: "#promo-apply"
  };
  const root = (window.CART_UI && window.CART_UI.list) ? window.CART_UI.list : {};
  window.CART_UI = window.CART_UI || {};
  window.CART_UI.list = Object.assign({}, defaults, root); // any page overrides still win
})();

// 2) Resolve layout once and memoize element refs. Safe even if pieces are missing.
function resolveLayout(){
  const Q  = sel => document.querySelector(sel);
  const UI = (window.CART_UI && window.CART_UI.list) || {};
  const R = {
    items:      Q(UI.items),
    empty:      Q(UI.empty),
    subtotal:   Q(UI.subtotal),
    servicetax: Q(UI.servicetax),
    total:      Q(UI.total),
    proceed:    Q(UI.proceed),
    invFood:    Q(UI.invFood),
    invAddons:  Q(UI.invAddons),
    promoLbl:   Q(UI.promoLbl),
    promoAmt:   Q(UI.promoAmt),
    promoInput: Q(UI.promoInput),
    promoApply: Q(UI.promoApply)
  };
  return R;
}

// --- Promo label pulse (visual only) ---
let __LAST_PROMO_TAG__ = "";

function pulsePromoLabel(el){
  if (!el) return;
  // retrigger CSS animation by toggling class
  el.classList.remove("promo-pulse");
  // force reflow so re-adding class plays again
  void el.offsetWidth;
  el.classList.add("promo-pulse");
}


// 3) Lightweight “no-crash” renderer wrapper
function safeRender(fn){
  
  try { fn(); } catch (e) { console.warn("[cart] render suppressed:", e); }
}

// === Coupon helpers (apply-by-code + next-eligible) ===
function findCouponByCodeOrId(input){
  const raw = String(input || "").trim();
  if (!raw) return null;

  // Try direct id hit
  if ((window.COUPONS instanceof Map) && window.COUPONS.has(raw)) {
    const meta = window.COUPONS.get(raw);
    return { id: raw, meta };
  }

  // Try code match (case-insensitive)
  if (window.COUPONS instanceof Map) {
    const hit = Array.from(window.COUPONS.entries()).find(([,m]) =>
      String(m?.code || "").toLowerCase() === raw.toLowerCase()
    );
    if (hit) return { id: hit[0], meta: hit[1] };
  }
  return null;
}

function computeEligibleItemIdsForCoupon(couponIdOrCode){
  try {
    const raw = String(couponIdOrCode || "");
    const id  = (window.COUPONS instanceof Map && window.COUPONS.has(raw)) ? raw : (couponIdByCode(raw) || "");
    const all = (window.ITEMS || []);
    // items list may use promotions | coupons | couponIds
    return all.filter((it) => {
      const ids = Array.isArray(it.promotions) ? it.promotions
                : Array.isArray(it.coupons)    ? it.coupons
                : Array.isArray(it.couponIds)  ? it.couponIds
                : [];
      return ids.map(String).includes(id);
    }).map(it => String(it.id));
  } catch { return []; }
}

function writeCouponLockFromMeta(couponId, meta){
  if (!couponId || !meta) return false;

  // mode gating
  const m = (String(localStorage.getItem("gufa_mode") || "delivery").toLowerCase() === "dining") ? "dining" : "delivery";
  const t = meta.targets || {};
  const allowed = (m === "delivery") ? !!t.delivery : !!t.dining;
  if (!allowed) return false;

  // eligible items (fallback to full scan when scope absent)
  const eligibleItemIds = Array.isArray(meta.eligibleItemIds) && meta.eligibleItemIds.length
    ? meta.eligibleItemIds.map(String)
    : computeEligibleItemIdsForCoupon(couponId);

  const payload = {
    code:  String(meta.code || couponId).toUpperCase(),
    type:  String(meta.type || ""),
    value: Number(meta.value || 0),
    valid: { delivery: !!(t.delivery ?? true), dining: !!(t.dining ?? true) },
    scope: { couponId: String(couponId), eligibleItemIds },
    lockedAt: Date.now(),
    source: "apply:manual"
  };

  try { localStorage.setItem("gufa_coupon", JSON.stringify(payload)); } catch {}
  try { window.dispatchEvent(new CustomEvent("cart:update", { detail: { coupon: payload } })); } catch {}
  return true;
}

function wireApplyCouponUI(){
  const UI = resolveLayout();
  const input = UI.promoInput;
  const btn   = UI.promoApply;
  if (!btn || !input) return;

  const apply = () => {
    const query = input.value;
    const found = findCouponByCodeOrId(query);
    if (!found || !found.meta || found.meta.active === false) {
      // Minimal UX: reflect error in label line; totals will stay unchanged
      if (UI.promoLbl) UI.promoLbl.textContent = "Promotion (): invalid or inactive";
      return;
    }
    const ok = writeCouponLockFromMeta(found.id, found.meta);

    // If nothing in cart qualifies yet, stash a hint for Menu to highlight next eligible item
    try {
      const ids = computeEligibleItemIdsForCoupon(found.id);
      const hasEligibleInCart = (function(){
        const bag = window?.Cart?.get?.() || {};
        return Object.keys(bag).some(k => {
          const baseId = String(k).split(":")[0];
          return ids.includes(baseId) && Number(bag[k]?.qty || 0) > 0;
        });
      })();
      if (!hasEligibleInCart && ids.length) {
        localStorage.setItem("gufa:nextEligibleItem", ids[0]);
      }
    } catch {}

    // Repaint will be triggered via cart:update; keep a tiny UX touch here
    if (ok && UI.promoLbl) {
      const c = found.meta.code || found.id;
      UI.promoLbl.textContent = `Promotion (${String(c).toUpperCase()})`;
    }
  };

  btn.addEventListener("click", apply);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") apply(); });
}

// Boot the wire-up after DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  try { wireApplyCouponUI(); } catch {}
});


;(function(){
  // ---- crash guards (no feature changes) ----
  // Ensure global catalogs exist even if menu didn’t hydrate yet
  if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
  if (!window.BANNERS) window.BANNERS = new Map(); // tolerate array elsewhere

  // Safe-define no-op UI selectors bag if page didn’t set it (prevents null deref)
  window.CART_UI = window.CART_UI || {};
  window.CART_UI.list = window.CART_UI.list || {};

  // Soft guard for Firestore usage in hydrate paths
  // (hydrate functions already early-return if db is missing, but keep this stable)
  if (!window.db) {
    try {
      // On checkout.html this is normally set; elsewhere we just leave it undefined
      // so hydrate routines bail out safely.
    } catch {}
  }


  /* ===================== Money & utils ===================== */
  const INR = (v) => "₹" + Math.round(Number(v)||0).toLocaleString("en-IN");
  const SERVICE_TAX_RATE = 0.05;
  const clamp0 = (n) => Math.max(0, Number(n)||0);
  const taxOn = (amt) => clamp0(amt) * SERVICE_TAX_RATE;

  const COUPON_KEY = "gufa_coupon";
  const ADDR_KEY   = "gufa:deliveryAddress";

  const isUUID = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s||"");

// --- Coupon code index (ID <-> CODE) ---
function couponIdByCode(codeUpp){
  try{
    const needle = String(codeUpp||"").trim().toUpperCase();
    if (!needle || !(window.COUPONS instanceof Map)) return null;
    for (const [cid, meta] of window.COUPONS) {
      const mc = String(meta?.code||"").trim().toUpperCase();
      if (mc && mc === needle) return String(cid);
    }
    return null;
  } catch { return null; }
}

  
  /* ===================== Mode ===================== */
function activeMode(){
  const m = String(localStorage.getItem("gufa_mode") || "delivery").toLowerCase();
  return m === "dining" ? "dining" : "delivery";
}


  /* ===================== Cart I/O ===================== */
  function entries(){
    try {
      const store = window?.Cart?.get?.();
      if (store && typeof store === "object") return Object.entries(store);
    } catch {}
    try {
      const raw = localStorage.getItem("gufa_cart");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const bag = (parsed && typeof parsed === "object")
        ? (parsed.items && typeof parsed.items === "object" ? parsed.items : parsed)
        : {};
      return Object.entries(bag || {});
    } catch { return []; }
  }
  const itemCount = () => entries().reduce((n, [,it]) => n + (Number(it?.qty)||0), 0);
  const isAddonKey = (key) => String(key).split(":").length >= 3;
  const baseKeyOf  = (key) => String(key).split(":").slice(0,2).join(":");

 
  /* ===================== Base-line order (Promo Wheel) ===================== */
  const ORDER_KEY = "gufa:baseOrder";

  function readBaseOrder(){
    try { const a = JSON.parse(localStorage.getItem(ORDER_KEY) || "[]"); return Array.isArray(a) ? a : []; }
    catch { return []; }
  }
  function writeBaseOrder(arr){
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(Array.from(new Set(arr)))); } catch {}
  }

  // Maintain a stable “first arrival” order of base lines currently in cart.
  // - add baseKey when its qty goes from 0 → >0
  // - remove baseKey when its qty drops to 0
  function syncBaseOrderWithCart(){
    const bag = window?.Cart?.get?.() || {};
    const liveBase = new Set(
      Object.keys(bag)
        .filter(k => !isAddonKey(k))
        .map(k => baseKeyOf(k))
    );

    let order = readBaseOrder();

    // add newly seen baseKeys at the end (preserve arrival)
    for (const k of liveBase){
      if (!order.includes(k)) order.push(k);
    }
    // drop baseKeys no longer present
    order = order.filter(k => liveBase.has(k));

    writeBaseOrder(order);
    return order;
  }

  // Keep the order in sync on every cart mutation
  window.addEventListener("cart:update", () => {
    try { syncBaseOrderWithCart(); } catch {}
  });

  
  function splitBaseVsAddons(){
    let base=0, add=0;
    for (const [key, it] of entries()){
      const line = clamp0(it.price) * clamp0(it.qty);
      if (isAddonKey(key)) add += line; else base += line;
    }
    return { base, add };
  }

    /* ===================== Global Catalogs ===================== */
  if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
  if (!window.BANNERS) window.BANNERS = new Map(); // Map preferred; Array tolerated


  /* ===== INSERT: read-only Firestore hydrate for promotions ===== */
  async function hydrateCouponsFromFirestoreOnce() {
    try {
      // Already hydrated? skip
      if (window.COUPONS instanceof Map && window.COUPONS.size > 0) return false;

      // db comes from /admin/firease.js (shimmed to window.db in checkout.html)
      const db = window.db;
      if (!db || !db.collection) return false;

      // Fetch only active promotions; you can add 'published' or date windows later
      const snap = await db.collection("promotions").where("active", "==", true).get();
      if (!snap || snap.empty) return false;

      if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
      let added = 0;

      snap.forEach(doc => {
        const d = doc.data() || {};
        // Only coupons (ignore any non-coupon docs)
        const kind = String(d.kind || "coupon").toLowerCase();
        if (kind !== "coupon") return;

        const targetsRaw = d.channels || d.targets || {};
        const meta = {
          code:      d.code ? String(d.code) : undefined,
          type:      String(d.type || "flat").toLowerCase(), // 'percent' | 'flat'
          value:     Number(d.value || 0),
          minOrder:  Number(d.minOrder || 0),
          targets:   { delivery: !!targetsRaw.delivery, dining: !!targetsRaw.dining },
          // optional fields if you later add them
          eligibleItemIds: Array.isArray(d.eligibleItemIds) ? d.eligibleItemIds : undefined,
          usageLimit: d.usageLimit ?? undefined,
          usedCount:  d.usedCount  ?? undefined
        };

        window.COUPONS.set(String(doc.id), meta);
        added++;
      });

        if (added > 0) {
        try {
          localStorage.setItem("gufa:COUPONS", JSON.stringify(Array.from(window.COUPONS.entries())));
        } catch {}
        window.dispatchEvent(new CustomEvent("promotions:hydrated"));
        window.dispatchEvent(new CustomEvent("cart:update"));
        return true;
      }

      return false;
    } catch (err) {
      console.warn("[Firestore promo hydrate] failed:", err);
      return false;
    }
  }
    
  /* ===== Hydrate from inline JSON (#promo-data) before any promo logic ===== */
  function hydrateCouponsFromInlineJson(){
    try {
      // Skip if coupons already exist
      if (window.COUPONS instanceof Map && window.COUPONS.size > 0) return false;

      const tag = document.getElementById("promo-data");
      if (!tag) return false; // nothing embedded on this page

      const data = JSON.parse(tag.textContent || tag.innerText || "null");
      if (!data || typeof data !== "object") return false;

      // Normalize coupons
      if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
      if (Array.isArray(data.coupons)) {
        for (const [cid, meta] of data.coupons) {
          if (!cid) continue;
          window.COUPONS.set(String(cid), meta || {});
        }
      }

      // Normalize banners to Map
      if (!(window.BANNERS instanceof Map)) window.BANNERS = new Map();
      if (Array.isArray(data.banners)) {
        for (const [key, arr] of data.banners) {
          window.BANNERS.set(String(key), Array.isArray(arr) ? arr : []);
        }
      }

       // Persist a lightweight snapshot for future tabs/pages
      try {
        const dump = Array.from(window.COUPONS.entries());
        if (dump.length) localStorage.setItem("gufa:COUPONS", JSON.stringify(dump));
      } catch {}

      // Signal readiness, then repaint
      window.dispatchEvent(new CustomEvent("promotions:hydrated"));
      window.dispatchEvent(new CustomEvent("cart:update"));
      return true;
    } catch (e) {
      console.warn("[inline promo hydrate] failed:", e);
      return false;
    }
  }

/* ========== ensure coupons exist on Checkout (Firestore-only) ========== */
async function ensureCouponsReady() {
  if (window.COUPONS instanceof Map && window.COUPONS.size > 0) return true;
  try {
    const ok = await hydrateCouponsFromFirestoreOnce();
    return !!ok;
  } catch {
    return false;
  }
}

// === synthesize coupons from banners keyed by couponCode:CODE (no hard-wired IDs) ===
function synthesizeCouponsFromBannersByCode() {
  try {
    const B = (window.BANNERS instanceof Map) ? window.BANNERS : null;
    if (!B) return false;
    if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
    let added = 0;

    for (const [key, ids] of B.entries()) {
      const m = String(key||"").match(/^couponCode:(.+)$/i);
      if (!m) continue;
      const code = m[1].toUpperCase();
      const meta = window.COUPONS.get(code) || {
        code, type: 'flat', value: 100, targets: { delivery: true, dining: true }
      };
      const set = new Set((meta.eligibleItemIds || []).map(s => String(s).toLowerCase()));
      (Array.isArray(ids) ? ids : []).forEach(x => set.add(String(x).toLowerCase()));
      meta.eligibleItemIds = [...set];
      window.COUPONS.set(code, meta);
      added++;
    }
    if (added > 0) {
      try { localStorage.setItem("gufa:COUPONS", JSON.stringify(Array.from(window.COUPONS.entries()))); } catch {}
      document.dispatchEvent?.(new CustomEvent("promotions:hydrated"));
    }
    return added > 0;
  } catch { return false; }
}

  /* ===================== Coupon Lock ===================== */
  const getLock = () => { try { return JSON.parse(localStorage.getItem(COUPON_KEY) || "null"); } catch { return null; } };
  const setLock = (obj) => { try { obj ? localStorage.setItem(COUPON_KEY, JSON.stringify(obj)) : localStorage.removeItem(COUPON_KEY); } catch {} };


  function displayCode(locked){
  try {
    if (!locked) return "";
    const raw = String(locked.code || "").trim();
    if (raw && !isUUID(raw)) return raw.toUpperCase();
    const cid = String(locked?.scope?.couponId || "").trim();
    if (cid && (window.COUPONS instanceof Map)) {
      const meta = window.COUPONS.get(cid);
      if (meta?.code) return String(meta.code).toUpperCase();
    }
    return "";
  } catch { return ""; }
}


  
// --- Helpers: resolve code -> coupon, build lock, and error host ---
function findCouponByCode(codeUpp) {
  if (!(window.COUPONS instanceof Map)) return null;
  for (const [cid, meta] of window.COUPONS) {
    const mcode = (meta?.code || "").toString().trim().toUpperCase();
    if (mcode && mcode === codeUpp) return { cid: String(cid), meta };
  }
  return null;
}

// Accept either Coupon ID or CODE (admin may read out the ID on a call)
function findCouponByIdOrCode(input) {
  const needle = String(input || "").trim().toUpperCase();
  if (!needle || !(window.COUPONS instanceof Map)) return null;

  // 1) direct ID match (key)
  if (window.COUPONS.has(needle) || window.COUPONS.has(needle.toLowerCase())) {
    const meta = window.COUPONS.get(needle) || window.COUPONS.get(needle.toLowerCase());
    return { cid: needle, meta };
  }

  // 2) meta.code match
  for (const [cid, meta] of window.COUPONS) {
    const mcode = (meta?.code || "").toString().trim().toUpperCase();
    if (mcode && mcode === needle) return { cid: String(cid), meta };
  }
  return null;
}

function buildLockFromMeta(cid, meta) {
  // 1) Prefer explicit meta eligibility if present
  const explicit = Array.isArray(meta?.eligibleItemIds) ? meta.eligibleItemIds
                 : Array.isArray(meta?.eligibleIds)     ? meta.eligibleIds
                 : Array.isArray(meta?.itemIds)         ? meta.itemIds
                 : [];
  let eligSet = new Set(explicit.map(s => String(s).toLowerCase()));

  // 2) Else derive from banners
  if (!eligSet.size) {
    eligSet = eligibleIdsFromBanners({ couponId: cid });
  }


  return {
    scope: {
      couponId: cid,
      couponCode: (meta?.code ? String(meta.code).toUpperCase() : undefined),
      eligibleItemIds: Array.from(eligSet)
    },
    type:  String(meta?.type || "flat").toLowerCase(),
    value: Number(meta?.value || 0),
    minOrder: Number(meta?.minOrder || 0),
    valid: meta?.targets ? { delivery: !!meta.targets.delivery, dining: !!meta.targets.dining } : undefined,
    code: (meta?.code ? String(meta.code).toUpperCase() : undefined),
  };
}


// Create/find a small error line under the input (single-line, red, compact)
function ensurePromoErrorHost() {
  const UI = resolveLayout();
  const input = UI.promoInput;
  if (!input) return null;

  const parent =
    input.parentElement ||
    input.closest(".inv-list") ||
    input.closest("form") ||
    input;

  let node = parent.querySelector("#promo-error");
  if (!node) {
    node = document.createElement("div");
    node.id = "promo-error";
    node.style.color = "#B00020";
    node.style.fontSize = "12px";
    node.style.marginTop = "6px";
    node.style.lineHeight = "1.2";
    node.style.minHeight = "14px";
    parent.appendChild(node);
  }
  return node;
}


function showPromoError(msg) {
  const host = ensurePromoErrorHost();
  if (host) host.textContent = msg || "";
}

  /* ===================== Promotions Discipline ===================== */
  // Hooks for future admin fields:
  // - minOrder: number  (already supported)
  // - usageLimit: number, usedCount: number (supported via checkUsageAvailable)
  function checkUsageAvailable(meta){
    // Future ready: if admin tracks usedCount per customer/user, plug it here.
    // For now, if usageLimit exists on meta and is 0 or less, treat as exhausted.
    if (!meta) return true;
    if (typeof meta.usageLimit === "number" && meta.usageLimit <= 0) return false;
    // If meta.usedCount >= usageLimit → not available
    if (typeof meta.usageLimit === "number" && typeof meta.usedCount === "number") {
      return meta.usedCount < meta.usageLimit;
    }
    return true;
  }

  function modeAllowed(locked){
    const m = activeMode();
    const v = locked?.valid;
    if (v && typeof v === "object" && (m in v)) return !!v[m];
    const cid = String(locked?.scope?.couponId||"");
    const meta = (window.COUPONS instanceof Map) ? window.COUPONS.get(cid) : null;
    if (meta && meta.targets && (m in meta.targets)) return !!meta.targets[m];
    return true;
  }

function eligibleIdsFromBanners(scope){
  const out = new Set();
  if (!scope) return out;

  const bid = String(scope.bannerId||"").trim();
  const cid = String(scope.couponId||"").trim();
  const ccode = String(scope.couponCode||"").trim().toUpperCase();


  // Helper to add ids safely
  const addAll = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const x of arr) {
      const s = String(x||"").trim();
      if (s) out.add(s.toLowerCase());
    }
  };

  // Map form: key -> array of itemIds (or a keyed alias "coupon:<cid>")
  if (window.BANNERS instanceof Map){
    addAll(window.BANNERS.get(bid));
        if (!out.size && cid)   addAll(window.BANNERS.get(`coupon:${cid}`));
    if (!out.size && ccode) addAll(window.BANNERS.get(`couponCode:${ccode}`));
    return out;
  }

  // Array form: [{ id, linkedCouponIds, items/eligibleItemIds/itemIds }]
  if (Array.isArray(window.BANNERS)){
    const banner = bid ? window.BANNERS.find(b => String(b?.id||"").trim() === bid) : null;
    if (banner) {
      // explicit items first
      addAll(banner.items || banner.eligibleItemIds || banner.itemIds);
      if (out.size) return out;
      // no explicit items? then we accept banner linkage as eligibility scope;
      // in strict mode, fallback is empty if no items listed—so keep it empty here.
    }

    // if only the couponId/code is known, look for a banner that links it
    if (!out.size && (cid || ccode)) {
      const byCoupon = window.BANNERS.find(b => {
        const ids = Array.isArray(b?.linkedCouponIds) ? b.linkedCouponIds.map(String) : [];
        const codes = Array.isArray(b?.linkedCouponCodes) ? b.linkedCouponCodes.map(s=>String(s).toUpperCase()) : [];
        return (cid && ids.some(x => x.trim() === cid)) || (ccode && codes.some(x => x.trim().toUpperCase() === ccode));
      });
      addAll(byCoupon?.items || byCoupon?.eligibleItemIds || byCoupon?.itemIds);
    }
  }
  return out;
}


   // explicit eligibleItemIds > banner-derived (by id/code) > ITEMS scan by code > empty (strict)
  function resolveEligibilitySet(locked){
    const scope = locked?.scope || {};
    const explicit = (
      Array.isArray(scope.eligibleItemIds) ? scope.eligibleItemIds :
      Array.isArray(scope.eligibleIds)     ? scope.eligibleIds     :
      Array.isArray(scope.itemIds)         ? scope.itemIds         :
      []
    ).map(s=>String(s).toLowerCase());
    if (explicit.length) return new Set(explicit);

    const byBanner = eligibleIdsFromBanners(scope);
    if (byBanner.size) return byBanner;

    // Fallback: infer by COUPON CODE directly from ITEMS.promotions/coupons arrays
    try {
      const code = String(scope.couponCode || locked?.code || "").trim().toUpperCase();
      if (!code) return new Set();
      const items = Array.isArray(window.ITEMS) ? window.ITEMS : [];
      const ids = [];
      for (const it of items) {
        const pools = []
          .concat(Array.isArray(it.promotions) ? it.promotions : [])
          .concat(Array.isArray(it.coupons)    ? it.coupons    : [])
          .concat(Array.isArray(it.couponIds)  ? it.couponIds  : []);
        const hit = pools.map(x=>String(x).toUpperCase()).includes(code);
        if (hit && it.id) ids.push(String(it.id).toLowerCase());
      }
      return new Set(ids);
    } catch { return new Set(); }
  }

// Provenance: did this base line come from the currently locked banner/coupon?
function hasBannerProvenance(baseKey) {
  try {
    // Current persisted lock (if any)
    const lock = getLock && getLock();
    if (!lock) return false;

    // Build the eligibility set the banner/coupon declared
    const eligible = resolveEligibilitySet(lock); // Set of item ids (lowercased)
    if (!(eligible instanceof Set) || eligible.size === 0) return false;

    // baseKey looks like "<itemId>:<variant>"
    const itemId = String(baseKey || "").split(":")[0].toLowerCase();
    return eligible.has(itemId);
  } catch {
    return false;
  }
}

  
  // FCFS: pick the first base item in the cart that matches any coupon eligibility,
  // and use that coupon exclusively (non-stackable).
function findFirstApplicableCouponForCart(){
  const es = entries();
  if (!es.length) return null;
  if (!(window.COUPONS instanceof Map)) return null;

  const { base } = splitBaseVsAddons();

  // 1) Build the FCFS scan order from our persistent wheel (arrival order),
  //    then append any leftover bases we somehow missed.
  const order = syncBaseOrderWithCart(); // returns array of baseKeys
  const seen = new Set(order);
  for (const [key] of es){
    if (isAddonKey(key)) continue;
    const b = baseKeyOf(key);
    if (!seen.has(b)) order.push(b), seen.add(b);
  }

  // 2) For each baseKey in arrival order, try coupons in map order.
  //    We allow cross-banner handoff: any coupon that discounts wins.
  for (const bKey of order){
    for (const [cid, meta] of window.COUPONS){
      if (!checkUsageAvailable(meta)) continue;
      const lock = buildLockFromMeta(String(cid), meta);
      lock.source = "auto";
      const { discount } = computeDiscount(lock, base);
      if (discount > 0) return lock; // first stop that actually discounts wins
    }
  }

  return null;
}





  function clearLockIfNoLongerApplicable(){
    const lock = getLock();
    if (!lock) return;
// If no eligible items for this lock remain, clear it and trigger same-frame recompute.
const elig = resolveEligibilitySet(lock);
if (!elig.size){
  setLock(null);
  window.dispatchEvent(new CustomEvent("cart:update")); // ← ensures FCFS picks next promo immediately
  return;
}

    // If the cart no longer contains any of the eligible IDs as base lines, clear it.
    let any = false;
    for (const [key, it] of entries()){
      if (isAddonKey(key)) continue;
      const parts = String(key).toLowerCase().split(":");
      const itemId  = String(it?.id ?? parts[0]);
      const baseKey = parts.slice(0,2).join(":");
      if (elig.has(itemId) || elig.has(baseKey) || Array.from(elig).some(x => !x.includes(":") && baseKey.startsWith(x + ":"))){
        any = true; break;
      }
    }
    if (!any) {
  setLock(null);
  // trigger instant recompute so FCFS can pick the next coupon in the same frame
  window.dispatchEvent(new CustomEvent("cart:update"));
  }
}

function enforceFirstComeLock(){
  // If there’s a current lock but it’s no longer applicable, clear it first.
  clearLockIfNoLongerApplicable();

  // If we still have a lock, keep it only if it actually produces a discount now.
  const kept = getLock();
  const { base } = splitBaseVsAddons();
  if (kept) {
    const { discount } = computeDiscount(kept, base);
    if (discount > 0) return;         // keep current non-stackable lock
    // Otherwise fall through to try the next applicable coupon (FCFS among remaining items)
    setLock(null);
  }

  // Pick the first coupon that actually yields a non-zero discount for current cart & mode.
  const fcfs = findFirstApplicableCouponForCart();
  if (!fcfs) return;
  const test = computeDiscount(fcfs, base);
  if (test.discount > 0) setLock(fcfs);
}

/* ===================== Discount computation ===================== */
function computeDiscount(locked, baseSubtotal){


    if (!locked) return { discount:0 };

    // Mode gate
    if (!modeAllowed(locked)) return { discount:0 };

    // Admin minOrder (present/future)
    const minOrder = Number(locked?.minOrder || 0);
    if (minOrder > 0 && baseSubtotal < minOrder) return { discount:0 };

    // Eligibility set (strict)
let elig = resolveEligibilitySet(locked);

// Manual-apply fallback: if no eligibility could be derived, allow any base line in cart
if (!elig.size && String(locked?.source||"") === "manual") {
  try {
    const bases = [];
    for (const [key, it] of entries()) {
      if (isAddonKey(key)) continue;
      const parts  = String(key).split(":");
      const itemId = String(it?.id ?? parts[0]).toLowerCase();
      bases.push(itemId);
    }
    if (bases.length) elig = new Set(bases);
  } catch {}
}

if (!elig.size) return { discount:0 };


// Eligible base subtotal only
let eligibleBase = 0;
let eligibleQty  = 0; // NEW: count units across eligible base lines
for (const [key, it] of entries()){
  if (isAddonKey(key)) continue;
  const parts = String(key).split(":");
  const itemId  = String(it?.id ?? parts[0]).toLowerCase();
  const baseKey = parts.slice(0,2).join(":").toLowerCase();
  if (elig.has(itemId) || elig.has(baseKey) || Array.from(elig).some(x => !x.includes(":") && baseKey.startsWith(x + ":"))){
    const q = clamp0(it.qty);
    eligibleBase += clamp0(it.price) * q;
    eligibleQty  += q; // count quantity
  }
}
    if (eligibleBase <= 0) return { discount:0 };

const t = String(locked?.type||"").toLowerCase();
const v = Number(locked?.value||0);
let d = 0;
if (t === "percent") d = Math.round(eligibleBase * (v/100));
else if (t === "flat") d = Math.min(v * eligibleQty, eligibleBase); // stack flat per unit, cap at line value;
return { discount: Math.max(0, Math.round(d)) };
    
  }



  /* ===================== Grouping & rows ===================== */
  function buildGroups(){
    const gs = new Map(); // baseKey -> { base, addons[] }
    for (const [key, it] of entries()){
      const parts = String(key).split(":");
      const bKey = parts.slice(0,2).join(":");
      const addonName = parts[2];
      if (!gs.has(bKey)) gs.set(bKey, { base:null, addons:[] });
      if (addonName) {
        const name = (it?.addons?.[0]?.name) || addonName;
        gs.get(bKey).addons.push({ key, it, name });
      } else {
        gs.get(bKey).base = { key, it };
      }
    }
    return gs;
  }

  function removeAllAddonsOf(baseKey){
    const bag = window?.Cart?.get?.() || {};
    for (const k of Object.keys(bag)) {
      if (isAddonKey(k) && baseKeyOf(k) === baseKey) {
        window.Cart.setQty(k, 0);
      }
    }
  }

  function addonRow(baseKey, add){
    const { key, it, name } = add;
    const row = document.createElement("div");
    row.className = "addon-row";

    const label = document.createElement("div");
    label.className = "addon-label muted";
    label.textContent = `+ ${name}`;

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "10px";

    const stepper = document.createElement("div");
    stepper.className = "stepper sm";
    const minus = document.createElement("button"); minus.textContent = "–";
    const out   = document.createElement("output");  out.textContent = String(it.qty || 0);
    const plus  = document.createElement("button");  plus.textContent = "+";
    stepper.append(minus, out, plus);

    const lineSub = document.createElement("div");
    lineSub.className = "line-subtotal";
    const computeLine = () => INR(clamp0(it.price) * clamp0((window.Cart?.get?.()[key]?.qty || 0)));
    lineSub.textContent = computeLine();

    plus.addEventListener("click", () => {
      const cur = Number(window.Cart?.get?.()[key]?.qty || 0);
      const next = cur + 1;
      window.Cart.setQty(key, next, it);
      out.textContent = String(next);
      lineSub.textContent = computeLine();
      window.dispatchEvent(new CustomEvent("cart:update"));
    });

    minus.addEventListener("click", () => {
      const cur = Number(window.Cart?.get?.()[key]?.qty || 0);
      const next = Math.max(0, cur - 1);
      window.Cart.setQty(key, next, it);
      out.textContent = String(next);
      lineSub.textContent = computeLine();
      window.dispatchEvent(new CustomEvent("cart:update"));
    });

    right.append(stepper, lineSub);
    row.append(label, right);
    return row;
  }

  function baseRow(baseKey, it){
    const li = document.createElement("li");
    li.className = "cart-row grouped";
    li.dataset.key = baseKey;

    const mid = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "cart-title";
    title.textContent = it?.name || "";
    const sub = document.createElement("p");
    sub.className = "cart-sub";
    sub.textContent = `${it?.variant || ""} • ${INR(clamp0(it?.price))}`;

    const right = document.createElement("div");
    right.className = "row-right";

    const lineSub = document.createElement("div");
    lineSub.className = "line-subtotal";
    lineSub.textContent = INR(clamp0(it?.price) * clamp0(it?.qty));

    const stepper = document.createElement("div");
    stepper.className = "stepper";
    const minus = document.createElement("button"); minus.textContent = "–";
    const out   = document.createElement("output");  out.textContent = String(it?.qty || 0);
    const plus  = document.createElement("button");  plus.textContent = "+";
    stepper.append(minus, out, plus);

    plus.addEventListener("click", () => {
      const next = (Number(window.Cart.get()?.[baseKey]?.qty)||0) + 1;
      window.Cart.setQty(baseKey, next, it);
      window.dispatchEvent(new CustomEvent("cart:update"));
    });
    minus.addEventListener("click", () => {
      const prev = (Number(window.Cart.get()?.[baseKey]?.qty)||0);
      const next = Math.max(0, prev - 1);
      window.Cart.setQty(baseKey, next, it);
      if (next === 0) removeAllAddonsOf(baseKey);
      window.dispatchEvent(new CustomEvent("cart:update"));
    });

    const remove = document.createElement("button");
    remove.className = "remove-link";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      window.Cart.setQty(baseKey, 0);
      removeAllAddonsOf(baseKey);
      window.dispatchEvent(new CustomEvent("cart:update"));
    });

    mid.append(title, sub);
    right.append(stepper, lineSub, remove);
    li.append(mid, right);
    return li;
  }

  /* ===================== Layout & Invoice ===================== */
  let R = {};
  function resolveLayout(){
    const CFG = window.CART_UI?.list || {};
    R = {
      items:      document.querySelector(CFG.items),
      empty:      document.querySelector(CFG.empty || null),
      count:      document.querySelector(CFG.count || null),
      subtotal:   document.querySelector(CFG.subtotal || null),
      servicetax: document.querySelector(CFG.servicetax || null),
      total:      document.querySelector(CFG.total || null),
      proceed:    document.querySelector(CFG.proceed || null),
      invFood:    document.querySelector(CFG.invFood || null),
      invAddons:  document.querySelector(CFG.invAddons || null),
      promoLbl:   document.querySelector(CFG.promoLbl || null),
      promoAmt:   document.querySelector(CFG.promoAmt || null),
      promoInput: document.querySelector(CFG.promoInput || null),
      promoApply: document.querySelector(CFG.promoApply || null),
      badge:      document.querySelector('#cart-count'),
      // Delivery form container (created dynamically if missing)
      deliveryHost: document.querySelector('#delivery-form') || null,
    };
    return !!R.items;
  }

  function renderInvoiceLists(groups){
    const food = [], adds = [];
    for (const [, g] of groups){
      if (g.base){
        const it = g.base.it || {};
        const qty = clamp0(it.qty);
        if (qty > 0) food.push(`<div class="inv-row"><div>${it.name || ""} × ${qty}</div><strong>${INR(clamp0(it.price) * qty)}</strong></div>`);
      }
      for (const a of g.addons){
        const it = a.it || {};
        const qty = clamp0(it.qty);
        if (qty > 0) adds.push(`<div class="inv-row"><div>${a.name || ""} × ${qty}</div><strong>${INR(clamp0(it.price) * qty)}</strong></div>`);
      }
    }
    if (R.invFood)   R.invFood.innerHTML   = food.length ? food.join("") : `<div class="muted">None</div>`;
    if (R.invAddons) R.invAddons.innerHTML = adds.length ? adds.join("") : `<div class="muted">None</div>`;
  }

  /* ===================== Delivery Address form (mode = delivery) ===================== */
  function getAddress(){ try { return JSON.parse(localStorage.getItem(ADDR_KEY) || "null"); } catch { return null; } }
  function setAddress(obj){ try { obj ? localStorage.setItem(ADDR_KEY, JSON.stringify(obj)) : localStorage.removeItem(ADDR_KEY); } catch {} }

  function ensureDeliveryForm(){
    if (activeMode() !== "delivery") { if (R.deliveryHost) R.deliveryHost.remove(); return; }
    if (!R.deliveryHost) {
      const aside = document.querySelector("aside.cart-right") || document.body;
      const wrap = document.createElement("div");
      wrap.id = "delivery-form";
      wrap.style.marginTop = "12px";
      wrap.innerHTML = `
        <div class="pilltitle">Delivery Address</div>
        <div class="inv-list" id="delivery-fields">
          <input id="addr-name" placeholder="Full name"/>
          <input id="addr-phone" placeholder="Phone"/>
          <input id="addr-line1" placeholder="Address line 1"/>
          <input id="addr-line2" placeholder="Address line 2 (optional)"/>
          <input id="addr-area"  placeholder="Area / Locality"/>
          <input id="addr-pin"   placeholder="Pincode"/>
          <textarea id="addr-notes" placeholder="Delivery instructions (optional)"></textarea>
          <button id="addr-save" style="padding:10px;border:1px solid #111;background:#111;color:#fff;border-radius:8px;">Save Address</button>
        </div>
      `;
      aside.appendChild(wrap);
      R.deliveryHost = wrap;
      wireAddressForm();
    } else {
      wireAddressForm();
    }
  }

  function wireAddressForm(){
    const saved = getAddress() || {};
    const $ = (id) => R.deliveryHost.querySelector(id);
    const name=$('#addr-name'), phone=$('#addr-phone'), l1=$('#addr-line1'), l2=$('#addr-line2'),
          area=$('#addr-area'), pin=$('#addr-pin'), notes=$('#addr-notes'), save=$('#addr-save');
    if (name && !name.value)  name.value  = saved.name  || "";
    if (phone && !phone.value) phone.value= saved.phone || "";
    if (l1 && !l1.value)      l1.value    = saved.line1 || "";
    if (l2 && !l2.value)      l2.value    = saved.line2 || "";
    if (area && !area.value)  area.value  = saved.area  || "";
    if (pin && !pin.value)    pin.value   = saved.pin   || "";
    if (notes && !notes.value)notes.value = saved.notes || "";

    if (save && !save._wired){
      save._wired = true;
      save.addEventListener("click", ()=>{
        const obj = {
          name: name?.value?.trim() || "",
          phone: phone?.value?.trim() || "",
          line1: l1?.value?.trim() || "",
          line2: l2?.value?.trim() || "",
          area:  area?.value?.trim() || "",
          pin:   pin?.value?.trim() || "",
          notes: notes?.value?.trim() || ""
        };
        setAddress(obj);
        window.dispatchEvent(new CustomEvent("cart:update"));
      }, false);
    }
  }


  
  /* ===================== Render ===================== */
function render(){
  if (!R.items && !resolveLayout()) return;
  enforceFirstComeLock();
 

    
    const n = itemCount();
    if (R.badge)   R.badge.textContent = String(n);
    if (R.count)   R.count.textContent = `(${n} ${n===1?"item":"items"})`;
    if (R.proceed) R.proceed.disabled  = n === 0;
    if (R.empty)   R.empty.hidden      = n > 0;
    if (R.items)   R.items.hidden      = n === 0;

    // Left list
    if (R.items){
      R.items.innerHTML = "";
      const gs = buildGroups();
      for (const [, g] of gs){
        if (!g.base && g.addons.length){
          // synthesize shell if only add-ons exist for a baseKey
          const first = g.addons[0];
          g.base = { key: first.key.split(":").slice(0,2).join(":"), it: { ...(first.it||{}), qty: 0 } };
        }
        if (g.base){
          const row = baseRow(g.base.key, g.base.it);
          if (g.addons.length){
            const list = document.createElement("div");
            list.className = "addon-list";
            g.addons.sort((a,b)=>a.name.localeCompare(b.name)).forEach(a => list.appendChild(addonRow(g.base.key, a)));
            row.appendChild(list);
          }
          R.items.appendChild(row);
        }
      }
    }

    // Totals
    const { base, add } = splitBaseVsAddons();
    const locked = getLock();
    const { discount } = computeDiscount(locked, base);
    const preTax = clamp0(base + add - discount);
    const tax    = taxOn(preTax);
    const grand  = preTax + tax;

    renderInvoiceLists(buildGroups());

    if (R.subtotal)   R.subtotal.textContent   = INR(base + add);
    if (R.servicetax) R.servicetax.textContent = INR(tax);
    if (R.total)      R.total.textContent      = INR(grand);

// Promo totals row (left label + right amount)
const codeText = locked ? displayCode(locked) : "";
if (R.promoLbl) {
  if (locked && codeText) {
    // Always show the code if a lock exists, even if the discount is 0 for now
    R.promoLbl.textContent = `Promotion (${codeText}):`;
    if (codeText !== __LAST_PROMO_TAG__) { // pulse only when the tag changes
      pulsePromoLabel(R.promoLbl);
      __LAST_PROMO_TAG__ = codeText;
    }
  } else {
    R.promoLbl.textContent = `Promotion (): none`;
    __LAST_PROMO_TAG__ = "";
  }
}
if (R.promoAmt) {
  R.promoAmt.textContent = `− ${INR(discount)}`;
}
// Clear any lingering error whenever a valid non-zero discount is active
if (discount > 0) showPromoError("");



// --- Next-eligible hint (for manual apply with no qualifying lines yet) ---
(function showNextEligibleHint(){
  try {
    const targetId = localStorage.getItem("gufa:nextEligibleItem");
    // If no breadcrumb, remove any old hint and bail
    if (!targetId) { const n = document.getElementById("next-eligible"); if (n) n.remove(); return; }

    const hasAnyEligibleBaseNow = (function(){
      const bag = window?.Cart?.get?.() || {};
      for (const [k, it] of Object.entries(bag)) {
        // base keys look like "<itemId>:<variant>"
        const parts  = String(k).split(":");
        if (parts.length < 2) continue; // skip add-ons or malformed
        const baseId = String(it?.id || parts[0]).toLowerCase();
        if (baseId === String(targetId).toLowerCase() && Number(it?.qty||0) > 0) return true;
      }
      return false;
    })();

    // If discount is active or the qualifying item is now present, clear the hint
    if (discount > 0 || hasAnyEligibleBaseNow) {
      localStorage.removeItem("gufa:nextEligibleItem");
      const n = document.getElementById("next-eligible"); if (n) n.remove();
      return;
    }

    // Create/refresh the hint node under the promo input
    const parent = (R.promoInput?.parentElement) || document.querySelector(".promo-wrap") || document.querySelector("aside.cart-right");
    if (!parent) return;
    let node = document.getElementById("next-eligible");
    if (!node) {
      node = document.createElement("div");
      node.id = "next-eligible";
      node.style.fontSize = "12px";
      node.style.marginTop = "6px";
      node.style.color = "#444";
      parent.appendChild(node);
    }
    node.textContent = "Tip: add one eligible item to activate your coupon.";
  } catch {}
})();

  
  // Delivery address section (mode = delivery only)
    ensureDeliveryForm();

// Manual Apply Coupon (no auto-fill from lock)
if (R.promoApply && !R.promoApply._wired){
  R.promoApply._wired = true;
  R.promoApply.addEventListener("click", async ()=>{
    // normalize user input once
    const raw = (R.promoInput?.value || "").trim();
    if (!raw) { showPromoError(""); return; }
    const needle = raw.toUpperCase();

    // hydrate once (was called twice)
    const hydrated = await ensureCouponsReady();
    if (!hydrated && !(window.COUPONS instanceof Map && window.COUPONS.size > 0)) {
      showPromoError("Coupon data not available");
      return;
    }

    // resolve by ID or CODE
    const found = findCouponByIdOrCode(needle) || findCouponByCode(needle);
    if (!found) { showPromoError("Invalid or Ineligible Coupon Code"); return; }

    // construct lock & validate against current cart
    const fullLock = buildLockFromMeta(found.cid, found.meta);
    const { base } = splitBaseVsAddons();
    const { discount } = computeDiscount(fullLock, base);
    if (!discount || discount <= 0) { showPromoError("Invalid or Ineligible Coupon Code"); return; }

    // apply (non-stackable FCFS is enforced by render/enforceFirstComeLock)
    fullLock.source = "manual";
    setLock(fullLock);
    showPromoError("");
    enforceFirstComeLock();
    window.dispatchEvent(new CustomEvent("cart:update"));
  }, false);
}
}

  /* ===================== Boot & subscriptions ===================== */
async function boot(){
  resolveLayout();

  // 1) Inline JSON first (if present in HTML)
  const inlined = hydrateCouponsFromInlineJson();

  // 2) If still empty, hydrate from Firestore (once)
  if (!inlined) {
    try { await ensureCouponsReady(); } catch {}
  }

  // 2.5) Synthesize coupons from banners keyed by couponCode:*
  try { synthesizeCouponsFromBannersByCode(); } catch {}

  // 3) First paint — Apply & FCFS are deterministic now
  render();



    // Normal reactive paints
    window.addEventListener("cart:update", render, false);
    window.addEventListener("serviceMode:changed", render, false);
    window.addEventListener("promotions:hydrated", () => { 
  try { enforceNextLock('after:hydrate'); } catch {} 
  render(); 
}, false);

window.addEventListener("storage", (e) => {
  if (!e) return;
  if (e.key === "gufa_cart" || e.key === COUPON_KEY || e.key === ADDR_KEY || e.key === "gufa_mode") {
    try { enforceNextLock('on:storage'); } catch {}
    render();
  }
}, false);


    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") render();
    }, false);
    window.addEventListener("pageshow", (ev) => { if (ev && ev.persisted) render(); }, false);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { boot(); }, { once:true });
  } else {
    boot();
  }


  /* ===================== Debug helper ===================== */
  window.CartDebug = window.CartDebug || {};
  window.CartDebug.eval = function(){
    const lock = getLock();
    const { base, add } = splitBaseVsAddons();
    const elig = Array.from(lock ? resolveEligibilitySet(lock) : new Set());
    const { discount } = computeDiscount(lock, base);
    return { lock, mode:activeMode(), base, add, elig, discount };
  };
})();
