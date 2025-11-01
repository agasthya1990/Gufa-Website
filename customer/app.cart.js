// GUFA Cart — Full rewrite with Funnel FCFS across banners + robust Apply
// Features: non-stackable coupons, banner-aware "funnel" next-eligible handoff,
// strict mode gating (Delivery/Dining), add-on steppers + auto-prune,
// promo totals row, delivery address form, hydration from inline/Firestore/local dump,
// single idempotent [Apply Coupon], debug surface.
//
// Keys used:
//   gufa_cart, gufa_coupon, gufa:COUPONS, gufa:baseOrder, gufa:promoPivot,
//   gufa:nextEligibleItem, gufa:deliveryAddress, gufa_mode

/* ===================== Persistence snapshot (unchanged) ===================== */
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

/* ===================== Deterministic UI selector map ===================== */
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
    promoApply: "#promo-apply",
    count:      "#cart-count-wrap"
  };
  const root = (window.CART_UI && window.CART_UI.list) ? window.CART_UI.list : {};
  window.CART_UI = window.CART_UI || {};
  window.CART_UI.list = Object.assign({}, defaults, root);
})();

/* ============ Tiny helpers for the promo controls (decoupled from layout) ============ */
function getUI(){
  const Q = (sel) => (sel ? document.querySelector(sel) : null);
  const UI = (window.CART_UI && window.CART_UI.list) || {};
  return {
    promoLbl:   Q(UI.promoLbl),
    promoAmt:   Q(UI.promoAmt),
    promoInput: Q(UI.promoInput),
    promoApply: Q(UI.promoApply),
  };
}
let __LAST_PROMO_TAG__ = "";
function pulsePromoLabel(el){
  if (!el) return;
  el.classList.remove("promo-pulse");
  void el.offsetWidth; // reflow to retrigger
  el.classList.add("promo-pulse");
}
function safe(fn){ try { fn(); } catch(e){ console.warn("[cart] render suppressed:", e); } }

/* ===================== Apply-by-code helpers (code or id) ===================== */
function findCouponByCodeOrId(input){
  const raw = String(input || "").trim();
  if (!raw) return null;

  if ((window.COUPONS instanceof Map) && window.COUPONS.has(raw)) {
    const meta = window.COUPONS.get(raw);
    return { id: raw, meta };
  }
  if (window.COUPONS instanceof Map) {
    const hit = Array.from(window.COUPONS.entries()).find(([,m]) =>
      String(m?.code || "").toLowerCase() === raw.toLowerCase()
    );
    if (hit) return { id: hit[0], meta: hit[1] };
  }
  return null;
}

function computeEligibleItemIdsForCoupon(couponId){
  try {
    const id = String(couponId || "");
    const all = (window.ITEMS || []);
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

  const m = (String(localStorage.getItem("gufa_mode") || "delivery").toLowerCase() === "dining") ? "dining" : "delivery";
  const t = meta.targets || {};
  const allowed = (m === "delivery") ? (t.delivery ?? true) : (t.dining ?? true);
  if (!allowed) return false;

  const eligibleItemIds = Array.isArray(meta.eligibleItemIds) && meta.eligibleItemIds.length
    ? meta.eligibleItemIds.map(String)
    : computeEligibleItemIdsForCoupon(couponId);

  const payload = {
    code:  String(meta.code || couponId).toUpperCase(),
    type:  String(meta.type || ""),
    value: Number(meta.value || 0),
    valid: { delivery: (t.delivery ?? true), dining: (t.dining ?? true) },
    scope: { couponId: String(couponId), eligibleItemIds },
    lockedAt: Date.now(),
    source: "apply:manual"
  };

  try { localStorage.setItem("gufa_coupon", JSON.stringify(payload)); } catch {}
  try { window.dispatchEvent(new CustomEvent("cart:update", { detail: { coupon: payload } })); } catch {}
  return true;
}

/* ===================== Single [Apply Coupon] UI binder (idempotent) ===================== */
(function wireApplyCouponUI(){
  const UI = getUI();
  const input = UI.promoInput;
  const btn   = UI.promoApply;
  if (!btn || !input || btn._wiredOnce) return;

  const ensureErrHost = () => {
    const parent = input.parentElement || input.closest(".inv-list") || input.closest("form") || input;
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
  };
  const showPromoError = (msg) => { const n = ensureErrHost(); if (n) n.textContent = msg || ""; };

  async function apply(){
    const query = (input.value || "").trim();
    if (!query) { showPromoError(""); return; }

    const ready = await window.ensureCouponsReady?.();
    if (!ready && !(window.COUPONS instanceof Map && window.COUPONS.size > 0)) {
      showPromoError("Coupon data not available");
      return;
    }

    const found = findCouponByCodeOrId(query);
    if (!found || !found.meta || found.meta.active === false) {
      const L = getUI().promoLbl; if (L) L.textContent = "Promotion (): invalid or inactive";
      showPromoError("Invalid or Ineligible Coupon Code");
      return;
    }

    const ok = writeCouponLockFromMeta(found.id, found.meta);

    // Hint: next eligible, if none in cart yet
    try {
      const ids = Array.isArray(found.meta.eligibleItemIds) && found.meta.eligibleItemIds.length
        ? found.meta.eligibleItemIds.map(String) : computeEligibleItemIdsForCoupon(found.id);
      if (ids?.length) {
        const bag = window?.Cart?.get?.() || {};
        const hasEligible = Object.keys(bag).some(k => {
          const baseId = String(k).split(":")[0];
          return ids.includes(baseId) && Number(bag[k]?.qty || 0) > 0;
        });
        if (!hasEligible) localStorage.setItem("gufa:nextEligibleItem", ids[0]);
      }
    } catch {}

    if (ok) {
      const L = getUI().promoLbl; const c = found.meta.code || found.id;
      if (L) { L.textContent = `Promotion (${String(c).toUpperCase()}):`; pulsePromoLabel(L); }
      showPromoError("");
      window.dispatchEvent(new CustomEvent("cart:update"));
    } else {
      showPromoError("Invalid or Ineligible Coupon Code");
    }
  }

  btn._wiredOnce = true;
  btn.addEventListener("click", (e)=>{ e.preventDefault(); apply(); }, false);
  input.addEventListener("keydown", (e)=>{ if (e.key === "Enter"){ e.preventDefault(); apply(); }}, false);
})();

/* ===================== Main cart module ===================== */
;(function(){
  // Global catalogs
  if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
  if (!window.BANNERS) window.BANNERS = new Map(); // Map preferred; array tolerated
  window.CART_UI = window.CART_UI || {};
  window.CART_UI.list = window.CART_UI.list || {};

  /* ===================== Money & utils ===================== */
  const INR = (v) => "₹" + Math.round(Number(v)||0).toLocaleString("en-IN");
  const SERVICE_TAX_RATE = 0.05;
  const clamp0 = (n) => Math.max(0, Number(n)||0);
  const taxOn = (amt) => clamp0(amt) * SERVICE_TAX_RATE;

  const COUPON_KEY = "gufa_coupon";
  const ADDR_KEY   = "gufa:deliveryAddress";
  const ORDER_KEY  = "gufa:baseOrder";
  const PIVOT_KEY  = "gufa:promoPivot";

  const isUUID = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s||"");

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

  /* ===================== Arrival rail (for FCFS) ===================== */
  function readBaseOrder(){
    try { const a = JSON.parse(localStorage.getItem(ORDER_KEY) || "[]"); return Array.isArray(a) ? a : []; }
    catch { return []; }
  }
  function writeBaseOrder(arr){
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(Array.from(new Set(arr)))); } catch {}
  }
  function syncBaseOrderWithCart(){
    const bag = window?.Cart?.get?.() || {};
    const liveBase = new Set(
      Object.keys(bag)
        .filter(k => !isAddonKey(k) && (bag[k]?.qty|0) > 0)
        .map(k => baseKeyOf(k))
    );

    let order = readBaseOrder();
    for (const k of liveBase){ if (!order.includes(k)) order.push(k); }
    order = order.filter(k => liveBase.has(k));
    writeBaseOrder(order);
    return order;
  }
  window.addEventListener("cart:update", () => { try { syncBaseOrderWithCart(); } catch {} });

  /* ===================== Split base vs addons ===================== */
  function splitBaseVsAddons(){
    let base=0, add=0;
    for (const [key, it] of entries()){
      const line = clamp0(it.price) * clamp0(it.qty);
      if (isAddonKey(key)) add += line; else base += line;
    }
    return { base, add };
  }

  /* ===================== Hydration (inline / local dump / Firestore) ===================== */
  function defaultTrueTargets(meta){
    if (!meta) return meta;
    const t = meta.targets || {};
    meta.targets = { delivery: (t.delivery ?? true), dining: (t.dining ?? true) };
    return meta;
  }

  function hydrateCouponsFromInlineJson(){
    try {
      if (window.COUPONS instanceof Map && window.COUPONS.size > 0) return false;
      const tag = document.getElementById("promo-data");
      if (!tag) return false;

      const data = JSON.parse(tag.textContent || tag.innerText || "null");
      if (!data || typeof data !== "object") return false;

      if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
      if (Array.isArray(data.coupons)) {
        for (const [cid, meta] of data.coupons) {
          if (!cid) continue;
          window.COUPONS.set(String(cid), defaultTrueTargets(meta || {}));
        }
      }

      if (!(window.BANNERS instanceof Map)) window.BANNERS = new Map();
      if (Array.isArray(data.banners)) {
        for (const [key, arr] of data.banners) {
          window.BANNERS.set(String(key), Array.isArray(arr) ? arr : []);
        }
      }

      try {
        const dump = Array.from(window.COUPONS.entries());
        if (dump.length) localStorage.setItem("gufa:COUPONS", JSON.stringify(dump));
      } catch {}

      window.dispatchEvent(new CustomEvent("promotions:hydrated"));
      return true;
    } catch (e) {
      console.warn("[inline promo hydrate] failed:", e);
      return false;
    }
  }

  function hydrateCouponsFromLocalDump(){
    try {
      if (window.COUPONS instanceof Map && window.COUPONS.size > 0) return false;
      const dump = JSON.parse(localStorage.getItem("gufa:COUPONS") || "[]");
      if (!Array.isArray(dump) || dump.length === 0) return false;
      window.COUPONS = new Map(dump.map(([cid, meta]) => [String(cid), defaultTrueTargets(meta||{})]));
      window.dispatchEvent(new CustomEvent("promotions:hydrated"));
      return true;
    } catch { return false; }
  }

  async function hydrateCouponsFromFirestoreOnce() {
    try {
      if (window.COUPONS instanceof Map && window.COUPONS.size > 0) return false;
      const db = window.db;
      if (!db || !db.collection) return false;

      const snap = await db.collection("promotions").where("active", "==", true).get();
      if (!snap || snap.empty) return false;

      if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
      let added = 0;

      snap.forEach(doc => {
        const d = doc.data() || {};
        const kind = String(d.kind || "coupon").toLowerCase();
        if (kind !== "coupon") return;

        const targetsRaw = d.channels || d.targets || {};
        const meta = {
          code:      d.code ? String(d.code) : undefined,
          type:      String(d.type || "flat").toLowerCase(), // 'percent' | 'flat'
          value:     Number(d.value || 0),
          minOrder:  Number(d.minOrder || 0),
          targets:   { delivery: (targetsRaw.delivery ?? true), dining: (targetsRaw.dining ?? true) },
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
        return true;
      }
      return false;
    } catch (err) {
      console.warn("[Firestore promo hydrate] failed:", err);
      return false;
    }
  }

  window.ensureCouponsReady = async function ensureCouponsReady(){
    if (window.COUPONS instanceof Map && window.COUPONS.size > 0) return true;
    try { if (hydrateCouponsFromInlineJson()) return true; } catch {}
    try { if (hydrateCouponsFromLocalDump()) return true; } catch {}
    try { return !!(await hydrateCouponsFromFirestoreOnce()); } catch { return false; }
  };

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

  function findCouponByIdOrCode(input) {
    const needle = String(input || "").trim().toUpperCase();
    if (!needle || !(window.COUPONS instanceof Map)) return null;

    if (window.COUPONS.has(needle) || window.COUPONS.has(needle.toLowerCase())) {
      const meta = window.COUPONS.get(needle) || window.COUPONS.get(needle.toLowerCase());
      return { cid: needle, meta };
    }
    for (const [cid, meta] of window.COUPONS) {
      const mcode = (meta?.code || "").toString().trim().toUpperCase();
      if (mcode && mcode === needle) return { cid: String(cid), meta };
    }
    return null;
  }

  function eligibleIdsFromBanners(scope){
    const out = new Set();
    if (!scope) return out;

    const bid = String(scope.bannerId||"").trim();
    const cid = String(scope.couponId||"").trim();

    const addAll = (arr) => {
      if (!Array.isArray(arr)) return;
      for (const x of arr) {
        const s = String(x||"").trim();
        if (s) out.add(s.toLowerCase());
      }
    };

    if (window.BANNERS instanceof Map){
      addAll(window.BANNERS.get(bid));
      if (!out.size && cid) addAll(window.BANNERS.get(`coupon:${cid}`));
      return out;
    }

    if (Array.isArray(window.BANNERS)){
      const banner = bid ? window.BANNERS.find(b => String(b?.id||"").trim() === bid) : null;
      if (banner) {
        addAll(banner.items || banner.eligibleItemIds || banner.itemIds);
        if (out.size) return out;
      }
      if (!out.size && cid) {
        const byCoupon = window.BANNERS.find(b =>
          Array.isArray(b?.linkedCouponIds) &&
          b.linkedCouponIds.map(String).some(x => x.trim() === cid)
        );
        addAll(byCoupon?.items || byCoupon?.eligibleItemIds || byCoupon?.itemIds);
      }
    }
    return out;
  }

  function buildLockFromMeta(cid, meta) {
    const explicit = Array.isArray(meta?.eligibleItemIds) ? meta.eligibleItemIds
                   : Array.isArray(meta?.eligibleIds)     ? meta.eligibleIds
                   : Array.isArray(meta?.itemIds)         ? meta.itemIds
                   : [];
    let eligSet = new Set(explicit.map(s => String(s).toLowerCase()));
    if (!eligSet.size) eligSet = eligibleIdsFromBanners({ couponId: cid });

    return {
      scope: { couponId: cid, eligibleItemIds: Array.from(eligSet) },
      type:  String(meta?.type || "flat").toLowerCase(),
      value: Number(meta?.value || 0),
      minOrder: Number(meta?.minOrder || 0),
      valid: meta?.targets ? { delivery: (meta.targets.delivery ?? true), dining: (meta.targets.dining ?? true) } : undefined,
      code: (meta?.code ? String(meta.code).toUpperCase() : undefined),
      source: "auto"
    };
  }

  function checkUsageAvailable(meta){
    if (!meta) return true;
    if (typeof meta.usageLimit === "number" && typeof meta.usedCount === "number") {
      return meta.usedCount < meta.usageLimit;
    }
    if (typeof meta.usageLimit === "number" && meta.usageLimit <= 0) return false;
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

    return new Set();
  }

  /* ===================== Discount computation ===================== */
  function computeDiscount(locked, baseSubtotal){
    if (!locked) return { discount:0 };
    if (!modeAllowed(locked)) return { discount:0 };

    const minOrder = Number(locked?.minOrder || 0);
    if (minOrder > 0 && baseSubtotal < minOrder) return { discount:0 };

    let elig = resolveEligibilitySet(locked);

    // Manual-apply fallback: if no eligibility could be derived, allow any base line in cart
    if (!elig.size && String(locked?.source||"") === "apply:manual") {
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

    let eligibleBase = 0;
    let eligibleQty  = 0;
    for (const [key, it] of entries()){
      if (isAddonKey(key)) continue;
      const parts = String(key).split(":");
      const itemId  = String(it?.id ?? parts[0]).toLowerCase();
      const baseKey = parts.slice(0,2).join(":").toLowerCase();
      if (elig.has(itemId) || elig.has(baseKey) || Array.from(elig).some(x => !x.includes(":") && baseKey.startsWith(x + ":"))){
        const q = clamp0(it.qty);
        eligibleBase += clamp0(it.price) * q;
        eligibleQty  += q;
      }
    }
    if (eligibleBase <= 0) return { discount:0 };

    const t = String(locked?.type||"").toLowerCase();
    const v = Number(locked?.value||0);
    let d = 0;
    if (t === "percent") d = Math.round(eligibleBase * (v/100));
    else if (t === "flat") d = Math.min(v * eligibleQty, eligibleBase);
    return { discount: Math.max(0, Math.round(d)) };
  }

  /* ===================== FUNNEL: next-eligible across banners (FCFS) ===================== */
  function readPivot(){ try { return String(localStorage.getItem(PIVOT_KEY)||""); } catch { return ""; } }
  function storePivot(bKey){ try { localStorage.setItem(PIVOT_KEY, String(bKey||"")); } catch {} }

  function pivotStillValid(pivot, eligSet){
    if (!pivot) return false;
    if (!(eligSet instanceof Set) || eligSet.size===0) return false;
    const parts = String(pivot).toLowerCase().split(":");
    const itemId = parts[0];

    const bag = window?.Cart?.get?.() || {};
    const live = bag[pivot]?.qty > 0;
    const eligible = eligSet.has(itemId) || eligSet.has(pivot.toLowerCase());
    return live && eligible;
  }

  function computeFunnelCandidates(baseSubtotal){
    if (!(window.COUPONS instanceof Map)) return [];

    const order = syncBaseOrderWithCart(); // baseKeys in arrival order
    const bag   = window?.Cart?.get?.() || {};
    const presentBaseKeys = order.filter(bk => (bag[bk]?.qty|0) > 0);

    const candidates = [];
    for (const [cid, meta] of window.COUPONS){
      if (!checkUsageAvailable(meta)) continue;

      const lock = buildLockFromMeta(String(cid), meta);
      const elig = resolveEligibilitySet(lock);
      if (!elig.size) continue;

      // find earliest baseKey in arrival order that intersects elig
      let earliestIdx = Infinity;
      let pivotKey = "";
      for (let i = 0; i < presentBaseKeys.length; i++){
        const bKey = presentBaseKeys[i];
        const parts = bKey.toLowerCase().split(":");
        const itemId = parts[0];
        if (elig.has(itemId) || elig.has(bKey.toLowerCase())){
          earliestIdx = i; pivotKey = bKey; break;
        }
      }
      if (earliestIdx === Infinity) continue;

      // verify discount > 0 for this cart
      const { discount } = computeDiscount(lock, baseSubtotal);
      if (discount <= 0) continue;

      candidates.push({ cid, meta, lock, elig, earliestIdx, pivotKey, discount });
    }

    // FCFS: smallest earliestIdx wins
    candidates.sort((a,b)=> a.earliestIdx - b.earliestIdx);
    return candidates;
  }

  function enforceFunnelFCFS(){
    const { base } = splitBaseVsAddons();
    const candidates = computeFunnelCandidates(base);

    // Keep current lock if still valid (FCFS sticks to its owner)
    const kept = getLock();
    if (kept){
      const elig = resolveEligibilitySet(kept);
      const { discount } = computeDiscount(kept, base);
      if (discount > 0 && pivotStillValid(readPivot(), elig)) return; // keep
      // otherwise release and try funnel
      setLock(null);
    }

    // Choose first candidate in the funnel
    if (candidates.length){
      const first = candidates[0];
      storePivot(first.pivotKey || "");
      const locked = { ...first.lock, source: "auto" };
      setLock(locked);
      return;
    }

    // No candidates → ensure cleared
    setLock(null);
  }
  
    /* ===================== Grouping & rows (steppers intact) ===================== */
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
      badge:      document.querySelector("#cart-count"),
      deliveryHost: document.querySelector("#delivery-form") || null,
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

  /* ===================== Delivery Address (mode = delivery) ===================== */
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
    if (!R.deliveryHost) return;
    const $ = (sel) => R.deliveryHost.querySelector(sel);
    const name=$('#addr-name'), phone=$('#addr-phone'), l1=$('#addr-line1'), l2=$('#addr-line2'),
          area=$('#addr-area'), pin=$('#addr-pin'), notes=$('#addr-notes'), save=$('#addr-save');
    const saved = getAddress() || {};
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
    if (!resolveLayout()) return;
    enforceFunnelFCFS();

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

    // Promo totals row
    const codeText = locked ? displayCode(locked) : "";
    if (R.promoLbl) {
      if (locked && codeText) {
        R.promoLbl.textContent = `Promotion (${codeText}):`;
        if (codeText !== __LAST_PROMO_TAG__) {
          pulsePromoLabel(R.promoLbl);
          __LAST_PROMO_TAG__ = codeText;
        }
      } else {
        R.promoLbl.textContent = `Promotion (): none`;
        __LAST_PROMO_TAG__ = "";
      }
    }
    if (R.promoAmt) R.promoAmt.textContent = `− ${INR(discount)}`;
    if (discount > 0) {
      const e = document.getElementById("promo-error");
      if (e) e.textContent = "";
    }

    // Next-eligible hint (when a valid manual code is set but no eligible base in cart yet)
    (function nextEligibleHint(){
      try {
        const targetId = localStorage.getItem("gufa:nextEligibleItem");
        if (!targetId) { const n = document.getElementById("next-eligible"); if (n) n.remove(); return; }

        const hasAnyEligibleBaseNow = (function(){
          const bag = window?.Cart?.get?.() || {};
          for (const [k, it] of Object.entries(bag)) {
            const parts  = String(k).split(":");
            if (parts.length < 2) continue;
            const baseId = String(it?.id || parts[0]).toLowerCase();
            if (baseId === String(targetId).toLowerCase() && Number(it?.qty||0) > 0) return true;
          }
          return false;
        })();

        if (discount > 0 || hasAnyEligibleBaseNow) {
          localStorage.removeItem("gufa:nextEligibleItem");
          const n = document.getElementById("next-eligible"); if (n) n.remove();
          return;
        }

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

    ensureDeliveryForm();
  }

  /* ===================== Boot & subscriptions ===================== */
  async function boot(){
    resolveLayout();
    const inlined = (function(){ try { return hydrateCouponsFromInlineJson(); } catch { return false; }})();
    if (!inlined) { try { await window.ensureCouponsReady(); } catch {} }
    render();

    window.addEventListener("cart:update", render, false);
    window.addEventListener("serviceMode:changed", render, false);
    window.addEventListener("promotions:hydrated", render, false);
    window.addEventListener("storage", (e) => {
      if (!e) return;
      if (e.key === "gufa_cart" || e.key === "gufa_coupon" || e.key === "gufa:deliveryAddress" || e.key === "gufa_mode") {
        render();
      }
    }, false);

    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") render(); }, false);
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
    const pivot = (function(){ try { return localStorage.getItem("gufa:promoPivot")||""; } catch { return ""; } })();
    const { discount } = computeDiscount(lock, base);
    return { lock, mode:activeMode(), base, add, elig, pivot, discount };
  };
})();