// GUFA Cart — Full stack with Next-Eligible Funnel (FCFS across banners)
// Preserves and fixes:
//  • Non-stackable promos, Delivery/Dining gating
//  • Add-on steppers + auto-prune (incl. orphan sweep on external changes)
//  • Promo totals row + label pulse
//  • Delivery Address form + Proceed gating by address completeness (delivery mode)
//  • Manual [Apply Coupon] (strict scope; no fallback), strict erroring
//  • Hydration: inline JSON → localStorage dump → Firestore
//  • Next-eligible hint lifecycle (robust clears)
//  • Debug exports parity (CartDebug.eval + computeDiscount)
//  • Usage write-back to Firestore (reservation; increment/decrement on lock changes)
//  • FCFS strategy switch: arrival (default) | dominant (by discount)
//  • UI selector compatibility for #promo-apply/#promo-input and #applyCouponBtn/#couponCodeInput
//
// Keys used:
//  gufa_cart, gufa_coupon, gufa:COUPONS, gufa:baseOrder, gufa:promoPivot, gufa:deliveryAddress,
//  gufa_mode, gufa:nextEligibleItem, gufa:usageReservation, gufa:fcfsStrategy

/* ===================== Persistence snapshot ===================== */
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
    // Compatibility: try both new and legacy IDs
    promoInput: "#promo-input, #couponCodeInput",
    promoApply: "#promo-apply, #applyCouponBtn",
    count:      "#cart-count-wrap"
  };
  const root = (window.CART_UI && window.CART_UI.list) ? window.CART_UI.list : {};
  window.CART_UI = window.CART_UI || {};
  window.CART_UI.list = Object.assign({}, defaults, root);
})();

/* ===================== Promo UI helpers ===================== */
function UIQ(sel){ return sel ? document.querySelector(sel) : null; }
function getUI(){
  const UI = (window.CART_UI && window.CART_UI.list) || {};
  return {
    promoLbl:   UIQ(UI.promoLbl),
    promoAmt:   UIQ(UI.promoAmt),
    promoInput: UIQ(UI.promoInput),
    promoApply: UIQ(UI.promoApply),
  };
}
let __LAST_PROMO_TAG__ = "";
let __LAST_LOCKED_CID__ = "";
function pulsePromoLabel(el){
  if (!el) return;
  el.classList.remove("promo-pulse");
  void el.offsetWidth; // reflow
  el.classList.add("promo-pulse");
}
function safe(fn){ try { fn(); } catch(e){ console.warn("[cart] suppressed:", e); } }

/* ===================== Money & utils ===================== */
const INR = (v) => "₹" + Math.round(Number(v)||0).toLocaleString("en-IN");
const SERVICE_TAX_RATE = 0.05;
const clamp0 = (n) => Math.max(0, Number(n)||0);
const taxOn = (amt) => clamp0(amt) * SERVICE_TAX_RATE;
const isUUID = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s||"");
const STRICT_MANUAL_SCOPE = true;

/* ===================== Keys ===================== */
const COUPON_KEY = "gufa_coupon";
const ADDR_KEY   = "gufa:deliveryAddress";
const ORDER_KEY  = "gufa:baseOrder";
const PIVOT_KEY  = "gufa:promoPivot";
const RESV_KEY   = "gufa:usageReservation";

/* ===================== Mode ===================== */
function activeMode(){
  const m = String(localStorage.getItem("gufa_mode") || "delivery").toLowerCase();
  return m === "dining" ? "dining" : "delivery";
}

/* ===================== Catalog guards ===================== */
if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
if (!window.BANNERS) window.BANNERS = new Map(); // Map preferred; array tolerated

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

/* ===================== Coupon Lock & Firestore reservations ===================== */
const getLock = () => { try { return JSON.parse(localStorage.getItem(COUPON_KEY) || "null"); } catch { return null; } };
const setLockRaw = (obj) => { try { obj ? localStorage.setItem(COUPON_KEY, JSON.stringify(obj)) : localStorage.removeItem(COUPON_KEY); } catch {} };

function getReservation(){ try { return JSON.parse(localStorage.getItem(RESV_KEY) || "null"); } catch { return null; } }
function setReservation(v){ try { v ? localStorage.setItem(RESV_KEY, JSON.stringify(v)) : localStorage.removeItem(RESV_KEY); } catch {} }

async function updateUsage(cid, delta){
  try {
    if (!cid || !delta) return;
    const db = window.db;
    const FV = (window.firebase?.firestore?.FieldValue || window.firebase?.firestore?.fieldValue || null);
    const inc = FV && (FV.increment ? FV.increment(delta) : null);
    if (!db || !db.collection) return;
    const ref = db.collection("promotions").doc(String(cid));
    if (inc) await ref.update({ usedCount: inc });
    else {
      // best-effort read-modify-write
      const snap = await ref.get();
      const cur = (snap.exists && typeof snap.data().usedCount === "number") ? snap.data().usedCount : 0;
      await ref.update({ usedCount: Math.max(0, cur + delta) });
    }
  } catch {}
}

async function adjustReservation(prevCid, nextCid){
  // decrement previous, increment next; store reservation
  if (prevCid && prevCid !== nextCid) await updateUsage(prevCid, -1);
  if (nextCid && prevCid !== nextCid)  await updateUsage(nextCid, +1);
  setReservation(nextCid ? { cid: nextCid, at: Date.now() } : null);
}

async function setLockWithReservation(newLock){
  const prev = getLock();
  const prevCid = String(prev?.scope?.couponId || "");
  const nextCid = String(newLock?.scope?.couponId || "");

  setLockRaw(newLock || null);

  // Reservation applies to both auto and manual to keep counts consistent
  await adjustReservation(prevCid || null, nextCid || null);

  // Pivot hygiene
  if (!newLock) { try { localStorage.removeItem(PIVOT_KEY); } catch {} }
}

/* ===================== Display helpers ===================== */
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

/* ===================== Eligibility helpers ===================== */
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

/* ===================== Discount computation (strict manual scope) ===================== */
function computeDiscount(locked, baseSubtotal){
  if (!locked) return { discount:0 };
  if (!modeAllowed(locked)) return { discount:0 };

  const minOrder = Number(locked?.minOrder || 0);
  if (minOrder > 0 && baseSubtotal < minOrder) return { discount:0 };

  let elig = resolveEligibilitySet(locked);

  // STRICT: Do NOT widen manual scope if none derived
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

/* ===================== FCFS strategy ===================== */
function fcfsStrategy(){
  try { return (localStorage.getItem("gufa:fcfsStrategy") || "arrival").toLowerCase(); }
  catch { return "arrival"; }
}

/* ===================== Next-Eligible Funnel (FCFS across banners) ===================== */
function readPivot(){ try { return String(localStorage.getItem(PIVOT_KEY)||""); } catch { return ""; } }
function storePivot(bKey){ try { bKey ? localStorage.setItem(PIVOT_KEY, String(bKey)) : localStorage.removeItem(PIVOT_KEY); } catch {} }

function pivotStillValid(pivot, eligSet){
  if (!pivot) return false;
  if (!(eligSet instanceof Set) || eligSet.size===0) return false;
  const parts = String(pivot).toLowerCase().split(":");
  const itemId = parts[0];

  const bag = window?.Cart?.get?.() || {};
  const live = (bag[pivot]?.qty|0) > 0;
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

    // earliest baseKey that intersects elig
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

    const { discount } = computeDiscount(lock, baseSubtotal);
    if (discount <= 0) continue;

    candidates.push({ cid, meta, lock, elig, earliestIdx, pivotKey, discount });
  }

  // Sort primary by arrival; we may later pick dominant based on strategy
  candidates.sort((a,b)=> a.earliestIdx - b.earliestIdx || b.discount - a.discount);
  return candidates;
}

async function enforceFunnelFCFS(){
  const { base } = splitBaseVsAddons();
  const candidates = computeFunnelCandidates(base);

  // Keep current lock if still valid
  const kept = getLock();
  if (kept){
    const elig = resolveEligibilitySet(kept);
    const { discount } = computeDiscount(kept, base);

    // If manual and still discounts, keep regardless of pivot
    if (discount > 0 && String(kept?.source||"").startsWith("apply:")) return;

    // If auto and pivot is still valid and discount > 0, keep
    if (discount > 0 && pivotStillValid(readPivot(), elig)) return;

    // Otherwise clear (will reselect below)
    await setLockWithReservation(null);
  }

  if (candidates.length){
    let chosen = candidates[0];
    if (fcfsStrategy() === "dominant"){
      // pick highest discount; tie-break by earliest arrival
      const maxD = Math.max(...candidates.map(c => c.discount));
      const maxes = candidates.filter(c => c.discount === maxD);
      chosen = maxes.sort((a,b)=> a.earliestIdx - b.earliestIdx)[0];
    }
    storePivot(chosen.pivotKey || "");
    const locked = { ...chosen.lock, source: "auto" };
    await setLockWithReservation(locked);
    return;
  }

  // No candidates: clear pivot and lock
  storePivot("");
  await setLockWithReservation(null);
}

/* ===================== [Apply Coupon] strict UI wiring ===================== */
function ensurePromoErrorHost() {
  const input = getUI().promoInput;
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

async function writeCouponLockFromMeta(couponId, meta){
  if (!couponId || !meta) return false;

  const m = activeMode();
  const t = meta.targets || {};
  const allowed = (m === "delivery") ? (t.delivery ?? true) : (t.dining ?? true);
  if (!allowed) return false;

  // Strict eligible set only
  const eligibleItemIds = Array.isArray(meta.eligibleItemIds) && meta.eligibleItemIds.length
    ? meta.eligibleItemIds.map(String)
    : computeEligibleItemIdsForCoupon(couponId);

  if (!eligibleItemIds || !eligibleItemIds.length) return false;

  const payload = {
    code:  String(meta.code || couponId).toUpperCase(),
    type:  String(meta.type || ""),
    value: Number(meta.value || 0),
    valid: { delivery: (t.delivery ?? true), dining: (t.dining ?? true) },
    scope: { couponId: String(couponId), eligibleItemIds },
    lockedAt: Date.now(),
    source: "apply:manual"
  };

  await setLockWithReservation(payload);
  try { window.dispatchEvent(new CustomEvent("cart:update", { detail: { coupon: payload } })); } catch {}
  return true;
}

function wireApplyCouponUI(){
  const UI = getUI();
  const input = UI.promoInput;
  const btn   = UI.promoApply;
  if (!btn || !input) return;

  const apply = async () => {
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

    // Hint seed: if no eligible in cart yet, remember one id
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

    const ok = await writeCouponLockFromMeta(found.id, found.meta);
    if (ok) {
      const L = getUI().promoLbl; const c = found.meta.code || found.id;
      if (L) { L.textContent = `Promotion (${String(c).toUpperCase()}):`; pulsePromoLabel(L); }
      showPromoError("");
      // manual lock overrides auto until removed
      window.dispatchEvent(new CustomEvent("cart:update"));
    } else {
      showPromoError("Invalid or Ineligible Coupon Code");
    }
  };

  if (!btn._wired){
    btn._wired = true;
    btn.addEventListener("click", (e)=>{ e.preventDefault(); apply(); }, false);
  }
  if (!input._wiredEnter){
    input._wiredEnter = true;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter"){ e.preventDefault(); apply(); }}, false);
  }
}
document.addEventListener("DOMContentLoaded", () => { try { wireApplyCouponUI(); } catch {} });

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
    items:      UIQ(CFG.items),
    empty:      UIQ(CFG.empty || null),
    count:      UIQ(CFG.count || null),
    subtotal:   UIQ(CFG.subtotal || null),
    servicetax: UIQ(CFG.servicetax || null),
    total:      UIQ(CFG.total || null),
    proceed:    UIQ(CFG.proceed || null),
    invFood:    UIQ(CFG.invFood || null),
    invAddons:  UIQ(CFG.invAddons || null),
    promoLbl:   UIQ(CFG.promoLbl || null),
    promoAmt:   UIQ(CFG.promoAmt || null),
    promoInput: UIQ(CFG.promoInput || null),
    promoApply: UIQ(CFG.promoApply || null),
    badge:      UIQ("#cart-count"),
    deliveryHost: UIQ("#delivery-form") || null,
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

function isAddressComplete(a){
  if (!a) return false;
  const okName  = !!String(a.name||"").trim();
  const okPhone = /^\d{10}$/.test(String(a.phone||"").trim());
  const okLine1 = !!String(a.line1||"").trim();
  const okPin   = /^\d{6}$/.test(String(a.pin||"").trim());
  return okName && okPhone && okLine1 && okPin;
}

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
        <div id="addr-warn" class="muted" style="margin-top:6px;font-size:12px;color:#B00020;display:none;">
          Please fill name, phone (10 digits), address line 1 and pincode to proceed.
        </div>
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
        area=$('#addr-area'), pin=$('#addr-pin'), notes=$('#addr-notes'), save=$('#addr-save'), warn=$('#addr-warn');
  const saved = getAddress() || {};
  if (name && !name.value)  name.value  = saved.name  || "";
  if (phone && !phone.value) phone.value= saved.phone || "";
  if (l1 && !l1.value)      l1.value    = saved.line1 || "";
  if (l2 && !l2.value)      l2.value    = saved.line2 || "";
  if (area && !area.value)  area.value  = saved.area  || "";
  if (pin && !pin.value)    pin.value   = saved.pin   || "";
  if (notes && !notes.value)notes.value = saved.notes || "";

  function onChange(){
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
    if (warn) warn.style.display = isAddressComplete(obj) ? "none" : "block";
    window.dispatchEvent(new CustomEvent("cart:update"));
  }

  ["input","change"].forEach(evt => {
    [name, phone, l1, l2, area, pin, notes].forEach(el => el && el.addEventListener(evt, onChange, false));
  });

  if (save && !save._wired){
    save._wired = true;
    save.addEventListener("click", onChange, false);
  }
}

/* ===================== Orphan addon sweep (external changes) ===================== */
function sweepOrphanAddons(){
  const bag = window?.Cart?.get?.() || {};
  const baseLive = new Set(Object.keys(bag).filter(k=>!isAddonKey(k) && (bag[k]?.qty|0) > 0).map(k=>baseKeyOf(k)));
  let changed = false;
  for (const k of Object.keys(bag)){
    if (isAddonKey(k)){
      const b = baseKeyOf(k);
      if (!baseLive.has(b) && (bag[k]?.qty|0) > 0){
        window.Cart.setQty(k, 0);
        changed = true;
      }
    }
  }
  if (changed) { try { window.dispatchEvent(new CustomEvent("cart:update")); } catch {} }
}

/* ===================== Render ===================== */
function render(){
  if (!resolveLayout()) return;

  // External hygiene before computing totals
  sweepOrphanAddons();

  enforceFunnelFCFS();

  const n = itemCount();
  if (R.badge)   R.badge.textContent = String(n);
  if (R.count)   R.count.textContent = `(${n} ${n===1?"item":"items"})`;
  if (R.empty)   R.empty.hidden      = n > 0;
  if (R.items)   R.items.hidden      = n === 0;

  // Proceed gating: also require address if delivery mode
  if (R.proceed){
    const addrOk = activeMode() === "delivery" ? isAddressComplete(getAddress()) : true;
    R.proceed.disabled = (n === 0) || !addrOk;
    const warn = document.querySelector("#addr-warn");
    if (warn) warn.style.display = addrOk ? "none" : "block";
  }

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

  // Next-eligible hint lifecycle (clear on lock or if target impossible)
  (function nextEligibleHint(){
    try {
      const targetId = localStorage.getItem("gufa:nextEligibleItem");
      const cid = String(locked?.scope?.couponId || "");
      if (cid !== __LAST_LOCKED_CID__) {
        __LAST_LOCKED_CID__ = cid;
        if (targetId) localStorage.removeItem("gufa:nextEligibleItem");
        const n = document.getElementById("next-eligible"); if (n) n.remove();
        return;
      }
      if (!targetId) { const n = document.getElementById("next-eligible"); if (n) n.remove(); return; }

      const bag = window?.Cart?.get?.() || {};
      const hasAnyEligibleBaseNow = Object.keys(bag).some(k => {
        const parts  = String(k).split(":");
        if (parts.length < 2) return false;
        const baseId = String(bag[k]?.id || parts[0]).toLowerCase();
        return baseId === String(targetId).toLowerCase() && Number(bag[k]?.qty||0) > 0;
      });

      // Clear if discount active OR target cannot ever be eligible under any coupon in current mode
      if (discount > 0 || hasAnyEligibleBaseNow) {
        localStorage.removeItem("gufa:nextEligibleItem");
        const n = document.getElementById("next-eligible"); if (n) n.remove();
        return;
      }

      // If target not in any coupon elig set (current catalogs), clear
      let targetEligibleSomewhere = false;
      if (window.COUPONS instanceof Map){
        for (const [cidX, metaX] of window.COUPONS){
          const lockX = buildLockFromMeta(String(cidX), metaX);
          if (!modeAllowed(lockX)) continue;
          const elig = resolveEligibilitySet(lockX);
          if (elig.has(String(targetId).toLowerCase())) { targetEligibleSomewhere = true; break; }
        }
      }
      if (!targetEligibleSomewhere) {
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

  // Manual Apply Coupon late wiring (in case after DOMContentLoaded)
  if (R.promoApply && !R.promoApply._wiredLate){
    R.promoApply._wiredLate = true;
    R.promoApply.addEventListener("click", async ()=>{
      const raw = (R.promoInput?.value || "").trim();
      if (!raw) { showPromoError(""); return; }
      const hydrated = await window.ensureCouponsReady();
      if (!hydrated && !(window.COUPONS instanceof Map && window.COUPONS.size > 0)) { showPromoError("Coupon data not available"); return; }
      const found = findCouponByCodeOrId(raw);
      if (!found) { showPromoError("Invalid or Ineligible Coupon Code"); return; }
      const fullLock = buildLockFromMeta(found.id, found.meta);
      if (!modeAllowed(fullLock)) { showPromoError("Invalid or Ineligible Coupon Code"); return; }
      const { base } = splitBaseVsAddons();
      const { discount: dz } = computeDiscount(fullLock, base);
      if (!dz || dz <= 0) { showPromoError("Invalid or Ineligible Coupon Code"); return; }
      fullLock.source = "apply:manual";
      await setLockWithReservation(fullLock);
      showPromoError("");
      window.dispatchEvent(new CustomEvent("cart:update"));
    }, false);
  }

  // Site-level hooks for badges/links
  safe(()=> window.updateAllMiniCartBadges && window.updateAllMiniCartBadges());
  safe(()=> window.updateCartLink && window.updateCartLink());
}

/* ===================== Boot & subscriptions ===================== */
async function boot(){
  resolveLayout();
  const inlined = (function(){ try { return hydrateCouponsFromInlineJson(); } catch { return false; }})();
  if (!inlined) { try { await window.ensureCouponsReady(); } catch {} }
  render();

  window.addEventListener("cart:update", render, false);
  window.addEventListener("serviceMode:changed", () => { try { render(); } catch {} }, false);
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
window.CartDebug.computeDiscount = computeDiscount;
window.CartDebug.eval = function(){
  const lock = getLock();
  const { base, add } = splitBaseVsAddons();
  const elig = Array.from(lock ? resolveEligibilitySet(lock) : new Set());
  const pivot = (function(){ try { return localStorage.getItem("gufa:promoPivot")||""; } catch { return ""; } })();
  const { discount } = computeDiscount(lock, base);
  const order = (function(){ try { return JSON.parse(localStorage.getItem("gufa:baseOrder")||"[]"); } catch { return []; } })();
  const strategy = fcfsStrategy();
  return { lock, mode:activeMode(), base, add, elig, pivot, order, discount, strategy };
};