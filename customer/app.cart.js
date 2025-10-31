# Writing a consolidated, fully self-contained app.cart.js to the workspace.
# The file aims to preserve and enhance all previously established behaviors:
# - Strict per-coupon eligibility (never globalize discounts)
# - Manual Apply (ID or CODE) with validation + next-eligible breadcrumb
# - FCFS promo funnel + guard (non-stackable, swaps only when current stops discounting)
# - Mode gating (delivery/dining) + minOrder (admin-driven)
# - Stable base arrival rail for fair-scanning
# - Add-on steppers, auto-prune when base qty hits 0
# - Invoice lists, promo totals row, address form (delivery mode only)
# - LocalStorage snapshot + debug helpers
# NOTE: This code is meant to be drop-in for checkout/cart view.
#
# The file will be saved as /mnt/data/app.cart.super.js

content = r"""/* app.cart.js — Consolidated Super File (STRICT promotions, FCFS guard, mode/minOrder, add-ons, invoice, address)
   - Strict scoping: coupons discount ONLY their eligible items
   - Manual Apply: validate before persisting; no global fallback
   - Promo Funnel + Guard: FCFS, non-stackable, swaps only when current stops discounting
   - Mode gating (Delivery/Dining) + minOrder
   - Add-on steppers + auto-prune
   - Promo totals row & invoice lists
   - Delivery Address form (delivery mode only)
   - LocalStorage snapshot + debug helper
*/

/* ===================== Snapshot (throttled) ===================== */
let __lastSnapshotAt = 0;
function persistCartSnapshotThrottled() {
  const now = Date.now();
  if (now - __lastSnapshotAt < 1000) return; // 1s debounce
  __lastSnapshotAt = now;
  try {
    const cart = window?.Cart?.get?.() || {};
    localStorage.setItem("gufa_cart", JSON.stringify(cart));
  } catch {}
}
window.addEventListener("cart:update", persistCartSnapshotThrottled);

/* ===================== UI selector defaults ===================== */
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
    count:      "#cart-count-label"
  };
  const root = (window.CART_UI && window.CART_UI.list) ? window.CART_UI.list : {};
  window.CART_UI = window.CART_UI || {};
  window.CART_UI.list = Object.assign({}, defaults, root);
})();

/* ===================== Money & utils ===================== */
const INR = (v) => "₹" + Math.round(Number(v)||0).toLocaleString("en-IN");
const SERVICE_TAX_RATE = 0.05;
const clamp0 = (n) => Math.max(0, Number(n)||0);
const taxOn  = (amt) => clamp0(amt) * SERVICE_TAX_RATE;

const COUPON_KEY = "gufa_coupon";
const ADDR_KEY   = "gufa:deliveryAddress";
const ORDER_KEY  = "gufa:baseOrder";

const isUUID = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s||"");

/* ===================== Mode ===================== */
function activeMode(){
  const m = String(localStorage.getItem("gufa_mode") || "delivery").toLowerCase();
  return m === "dining" ? "dining" : "delivery";
}

/* ===================== Global catalogs (tolerant) ===================== */
if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
if (!window.BANNERS) window.BANNERS = new Map(); // Map or Array tolerated

/* ===================== Cart I/O helpers ===================== */
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
const itemCount   = () => entries().reduce((n, [,it]) => n + (Number(it?.qty)||0), 0);
const isAddonKey  = (key) => String(key).split(":").length >= 3;
const baseKeyOf   = (key) => String(key).split(":").slice(0,2).join(":");
function splitBaseVsAddons(){
  let base=0, add=0;
  for (const [key, it] of entries()){
    const line = clamp0(it.price) * clamp0(it.qty);
    if (isAddonKey(key)) add += line; else base += line;
  }
  return { base, add };
}

/* ===================== Stable arrival (for FCFS) ===================== */
function readBaseOrder(){
  try { const a = JSON.parse(localStorage.getItem(ORDER_KEY) || "[]"); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function writeBaseOrder(arr){
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(Array.from(new Set(arr)))); } catch {}
}
function syncBaseOrderWithCart(){
  const bag = window?.Cart?.get?.() || {};
  const liveBase = new Set(Object.keys(bag).filter(k => !isAddonKey(k)).map(k => baseKeyOf(k)));
  let order = readBaseOrder();
  for (const k of liveBase){ if (!order.includes(k)) order.push(k); }
  order = order.filter(k => liveBase.has(k));
  writeBaseOrder(order);
  return order;
}
window.addEventListener("cart:update", () => { try { syncBaseOrderWithCart(); } catch {} });

/* ===================== Promo hydrate (inline first, then Firestore) ===================== */
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
        targets:   { delivery: !!targetsRaw.delivery, dining: !!targetsRaw.dining },
        eligibleItemIds: Array.isArray(d.eligibleItemIds) ? d.eligibleItemIds : undefined,
        usageLimit: d.usageLimit ?? undefined,
        usedCount:  d.usedCount  ?? undefined
      };
      window.COUPONS.set(String(doc.id), meta);
      added++;
    });
    if (added > 0) {
      try { localStorage.setItem("gufa:COUPONS", JSON.stringify(Array.from(window.COUPONS.entries()))); } catch {}
      window.dispatchEvent(new CustomEvent("promotions:hydrated"));
      return true;
    }
    return false;
  } catch (err) {
    console.warn("[Firestore promo hydrate] failed:", err);
    return false;
  }
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
      for (const [cid, meta] of data.coupons) if (cid) window.COUPONS.set(String(cid), meta || {});
    }
    if (!(window.BANNERS instanceof Map)) window.BANNERS = new Map();
    if (Array.isArray(data.banners)) {
      for (const [key, arr] of data.banners) window.BANNERS.set(String(key), Array.isArray(arr) ? arr : []);
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
async function ensureCouponsReady() {
  if (window.COUPONS instanceof Map && window.COUPONS.size > 0) return true;
  try { return !!(await hydrateCouponsFromFirestoreOnce()); } catch { return false; }
}

/* ===================== Coupon Lock helpers ===================== */
const getLock = () => { try { return JSON.parse(localStorage.getItem(COUPON_KEY) || "null"); } catch { return null; } };
const setLock = (obj) => { try { obj ? localStorage.setItem(COUPON_KEY, JSON.stringify(obj)) : localStorage.removeItem(COUPON_KEY); } catch {} };
function applyLock(lock){
  setLock(lock);
  try { window.dispatchEvent(new CustomEvent("cart:update")); } catch {}
}
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

/* ===================== Coupon find/build ===================== */
function findCouponByCode(codeUpp) {
  if (!(window.COUPONS instanceof Map)) return null;
  for (const [cid, meta] of window.COUPONS) {
    const mcode = (meta?.code || "").toString().trim().toUpperCase();
    if (mcode && mcode === codeUpp) return { cid: String(cid), meta };
  }
  return null;
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
    valid: meta?.targets ? { delivery: !!meta.targets.delivery, dining: !!meta.targets.dining } : undefined,
    code: (meta?.code ? String(meta.code).toUpperCase() : undefined),
    source: "auto"
  };
}

/* ===================== Eligibility & rules ===================== */
function checkUsageAvailable(meta){
  if (!meta) return true;
  if (typeof meta.usageLimit === "number" && meta.usageLimit <= 0) return false;
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
function computeDiscount(locked, baseSubtotal){
  if (!locked) return { discount:0 };
  if (!modeAllowed(locked)) return { discount:0 };
  const minOrder = Number(locked?.minOrder || 0);
  if (minOrder > 0 && baseSubtotal < minOrder) return { discount:0 };

  const elig = resolveEligibilitySet(locked);
  if (!elig.size) return { discount:0 };

  let eligibleBase = 0;
  let eligibleQty  = 0;
  for (const [key, it] of entries()){
    if (isAddonKey(key)) continue;
    const parts = String(key).split(":");
    const itemId  = String(it?.id ?? parts[0]).toLowerCase();
    const baseKey = parts.slice(0,2).join(":").toLowerCase();
    const hit = elig.has(itemId) || elig.has(baseKey)
             || Array.from(elig).some(x => !x.includes(":") && baseKey.startsWith(x + ":"));
    if (hit){
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
  else if (t === "flat") d = Math.min(v * eligibleQty, eligibleBase); // per unit, capped
  return { discount: Math.max(0, Math.round(d)) };
}

/* ===================== Promo Funnel (queue) + Guard ===================== */
function buildPromoQueue() {
  const bag = (window?.Cart?.get?.() || {});
  const { base } = splitBaseVsAddons();
  const baseKeysLive = [];
  for (const [k, it] of Object.entries(bag)) {
    if (isAddonKey(k)) continue;
    if ((it?.qty|0) > 0) baseKeysLive.push(baseKeyOf(k));
  }
  if (!baseKeysLive.length) return [];

  const order = readBaseOrder().filter(k => baseKeysLive.includes(k));
  for (const k of baseKeysLive) if (!order.includes(k)) order.push(k);

  const BANNERS = (window.BANNERS && Array.isArray(window.BANNERS)) ? window.BANNERS : [];
  const COUPONS = (window.COUPONS instanceof Map) ? window.COUPONS : new Map();

  function bannerPriorityFor(){
    try {
      const activeId = (window.ACTIVE_BANNER && window.ACTIVE_BANNER.id) ? String(window.ACTIVE_BANNER.id) : null;
      const picks = [];
      for (const b of BANNERS) {
        const linked = Array.isArray(b?.linkedCouponIds) ? b.linkedCouponIds.map(String) : [];
        if (!linked.length) continue;
        linked.forEach((cid, idx) => picks.push([ (activeId && String(b.id) === activeId) ? 0 : 1, idx, cid ]));
      }
      picks.sort((a,b) => (a[0]-b[0]) || (a[1]-b[1]));
      const out = [];
      for (const [, , cid] of picks) if (!out.includes(cid)) out.push(cid);
      return out;
    } catch { return []; }
  }

  const queue = [];
  for (const bKey of order) {
    const primaryIds = bannerPriorityFor(bKey);
    const allIds = [...new Set([...primaryIds, ...Array.from(COUPONS.keys()).map(String)])];
    for (const cid of allIds) {
      const meta = COUPONS.get(cid);
      if (!meta) continue;
      if (!checkUsageAvailable(meta)) continue;
      const lock = buildLockFromMeta(String(cid), meta); // auto lock (scoped)
      const res  = computeDiscount(lock, base);
      if (res && res.discount > 0) queue.push({ lock, baseKey: bKey, discount: res.discount });
    }
  }
  return queue;
}

let __promoGuardBusy = false;
let __promoGuardTimer = null;
let __lastChosenSignature = "";
function schedulePromoGuard() {
  if (__promoGuardTimer) return;
  __promoGuardTimer = setTimeout(runPromoGuard, 25);
}
function runPromoGuard() {
  __promoGuardTimer = null;
  if (__promoGuardBusy) return;
  __promoGuardBusy = true;
  try {
    const haveCoupons = (window.COUPONS instanceof Map) && window.COUPONS.size > 0;
    const bag = (window?.Cart?.get?.() || {});
    const hasBase = Object.keys(bag).some(k => !isAddonKey(k) && (bag[k]?.qty|0) > 0);
    if (!hasBase || !haveCoupons) { __promoGuardBusy = false; return; }

    let locked = getLock();
    const { base } = splitBaseVsAddons();
    if (locked) {
      const res = computeDiscount(locked, base);
      if (res.discount > 0) { __promoGuardBusy = false; return; } // keep current while effective
    }

    const q = buildPromoQueue();
    if (!q.length) { setLock(null); window.dispatchEvent(new CustomEvent("cart:update")); __promoGuardBusy = false; return; }

    const head = q[0];
    const signature = `${head.lock.code || head.lock.scope?.couponId}:${head.discount}`;
    if (signature === __lastChosenSignature) { __promoGuardBusy = false; return; }
    __lastChosenSignature = signature;

    head.lock.source = "auto";
    applyLock(head.lock);
  } catch {} finally { __promoGuardBusy = false; }
}
window.addEventListener("cart:update",           schedulePromoGuard);
window.addEventListener("serviceMode:changed",   schedulePromoGuard);
window.addEventListener("promotions:hydrated",   schedulePromoGuard);
document.addEventListener("DOMContentLoaded",    schedulePromoGuard);

/* ===================== UI: promo label pulse & error host ===================== */
let __LAST_PROMO_TAG__ = "";
function pulsePromoLabel(el){
  if (!el) return;
  el.classList.remove("promo-pulse"); void el.offsetWidth; el.classList.add("promo-pulse");
}
function ensurePromoErrorHost(R) {
  const input = R.promoInput;
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
function showPromoError(R, msg) {
  const host = ensurePromoErrorHost(R);
  if (host) host.textContent = msg || "";
}

/* ===================== Layout resolve (one shared) ===================== */
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
    deliveryHost: document.querySelector('#delivery-form') || null,
  };
  return !!R.items;
}

/* ===================== Apply-by-code (+ next-eligible breadcrumb) ===================== */
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
function wireApplyCouponUI(){
  const input = R.promoInput;
  const btn   = R.promoApply;
  if (!btn || !input) return;

  const apply = async () => {
    const raw = (input.value || "").trim();
    if (!raw) { showPromoError(R, ""); return; }
    const hydrated = await ensureCouponsReady();
    if (!hydrated && !(window.COUPONS instanceof Map && window.COUPONS.size > 0)) {
      showPromoError(R, "Coupon data not available"); return;
    }
    const needle = raw.toUpperCase();
    const found = findCouponByIdOrCode(needle) || findCouponByCode(needle);
    if (!found) { showPromoError(R, "Invalid or Ineligible Coupon Code"); return; }

    const fullLock = buildLockFromMeta(found.cid, found.meta);
    fullLock.source = "manual";

    // STRICT: validate BEFORE persisting
    const { base } = splitBaseVsAddons();
    const { discount } = computeDiscount(fullLock, base);
    if (!discount || discount <= 0) {
      const ids = computeEligibleItemIdsForCoupon(found.cid);
      if (ids.length) localStorage.setItem("gufa:nextEligibleItem", ids[0]);
      showPromoError(R, "Invalid or Ineligible Coupon Code");
      return;
    }

    showPromoError(R, "");
    applyLock(fullLock);
  };

  if (!btn._wired)   { btn._wired   = true; btn.addEventListener("click", apply); }
  if (!input._wired) { input._wired = true; input.addEventListener("keydown", (e)=>{ if (e.key==="Enter") apply(); }); }
}

/* ===================== Groups + rows ===================== */
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

/* ===================== Invoice & address ===================== */
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

  // Promo totals row (left label + right amount)
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
  if (R.promoAmt) {
    R.promoAmt.textContent = `− ${INR(discount)}`;
  }
  if (discount > 0) showPromoError(R, "");

  // Next-eligible UX
  (function showNextEligibleHint(){
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

  // Delivery address section (mode = delivery only)
  ensureDeliveryForm();
}

/* ===================== Boot & subscriptions ===================== */
async function boot(){
  resolveLayout();

  // Inline JSON first (if present), else Firestore
  const inlined = hydrateCouponsFromInlineJson();
  if (!inlined) { try { await ensureCouponsReady(); } catch {} }

  // First paint
  render();

  // Wire Apply UI once R is resolved
  wireApplyCouponUI();

  window.addEventListener("cart:update", render, false);
  window.addEventListener("serviceMode:changed", render, false);
  window.addEventListener("storage", (e) => {
    if (!e) return;
    if (e.key === "gufa_cart" || e.key === COUPON_KEY || e.key === ADDR_KEY || e.key === "gufa_mode") {
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

