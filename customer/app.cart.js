// app.cart.rewrite.js
// Clean rewrite of cart promotion logic with strict banner-origin enforcement.
// Goals:
// 1) FCFS among banner-origin items currently in cart
// 2) Auto-switch when same/different eligible item is added from another banner
// 3) Reject promotions for items added outside banner flow
// 4) Keep one non-stackable lock only
// 5) Preserve localStorage compatibility where possible

(function(){
  'use strict';

  /* ===================== Constants ===================== */
  const COUPON_KEY = 'gufa_coupon';
  const CART_KEY = 'gufa_cart';
  const MODE_KEY_1 = 'gufa_mode';
  const MODE_KEY_2 = 'gufa:serviceMode';
  const BANNER_MENU_KEY = 'gufa:BANNER_MENU';
  const BASE_ORDER_KEY = 'gufa:baseOrder';
  const SERVICE_TAX_RATE = 0.05;

  /* ===================== Small utils ===================== */
  const asNum = (v) => Math.max(0, Number(v) || 0);
  const lower = (v) => String(v || '').trim().toLowerCase();
  const upper = (v) => String(v || '').trim().toUpperCase();
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const isAddonKey = (key) => String(key).split(':').length >= 3;
  const baseKeyOf = (key) => String(key).split(':').slice(0, 2).join(':');
  const baseIdOfKey = (key) => String(key).split(':')[0].toLowerCase();
  const INR = (v) => '₹' + Math.round(Number(v) || 0).toLocaleString('en-IN');

  function readJSON(key, fallback){
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value){
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function removeKey(key){
    try { localStorage.removeItem(key); } catch {}
  }

  /* ===================== Catalog hydration ===================== */
  if (!(window.COUPONS instanceof Map)) window.COUPONS = new Map();
  if (!(window.BANNER_MENU instanceof Map)) window.BANNER_MENU = new Map();

  function hydrateBannerMenu(){
    const parsed = readJSON(BANNER_MENU_KEY, {});
    const map = new Map();
    if (isObj(parsed)) {
      for (const [bannerId, itemIds] of Object.entries(parsed)) {
        if (!bannerId || !Array.isArray(itemIds)) continue;
        map.set(String(bannerId), itemIds.map(v => String(v).toLowerCase()));
      }
    }
    window.BANNER_MENU = map;
    return map;
  }

  function hydrateCouponsFromLS(){
    if (window.COUPONS.size > 0) return window.COUPONS;
    const dump = readJSON('gufa:COUPONS', []);
    if (Array.isArray(dump)) {
      for (const row of dump) {
        if (!Array.isArray(row) || row.length < 2) continue;
        const [id, meta] = row;
        window.COUPONS.set(String(id), meta || {});
      }
    } else if (isObj(dump)) {
      for (const [id, meta] of Object.entries(dump)) {
        window.COUPONS.set(String(id), meta || {});
      }
    }
    return window.COUPONS;
  }

  hydrateBannerMenu();
  hydrateCouponsFromLS();

  /* ===================== Cart access ===================== */
  function getCartBag(){
    try {
      const live = window?.Cart?.get?.();
      if (isObj(live)) return live;
    } catch {}

    const parsed = readJSON(CART_KEY, {});
    if (isObj(parsed?.items)) return parsed.items;
    if (isObj(parsed)) return parsed;
    return {};
  }

  function setQty(key, qty, payload){
    if (window?.Cart?.setQty) {
      window.Cart.setQty(key, qty, payload);
      return;
    }
    const bag = getCartBag();
    if (qty <= 0) {
      delete bag[key];
    } else {
      bag[key] = Object.assign({}, bag[key] || {}, payload || {}, { qty });
    }
    writeJSON(CART_KEY, bag);
  }

  function cartEntries(){
    return Object.entries(getCartBag());
  }

  function splitBaseVsAddons(){
    let base = 0;
    let addons = 0;
    for (const [key, it] of cartEntries()) {
      const line = asNum(it?.price) * asNum(it?.qty);
      if (isAddonKey(key)) addons += line;
      else base += line;
    }
    return { base, addons };
  }

  /* ===================== Mode ===================== */
  function activeMode(){
    const m1 = lower(localStorage.getItem(MODE_KEY_2));
    const m2 = lower(localStorage.getItem(MODE_KEY_1));
    if (m1 === 'delivery' || m1 === 'dining') return m1;
    if (m2 === 'delivery' || m2 === 'dining') return m2;
    return 'delivery';
  }

  /* ===================== Base order ===================== */
  function readBaseOrder(){
    const arr = readJSON(BASE_ORDER_KEY, []);
    return Array.isArray(arr) ? arr.map(String) : [];
  }

  function writeBaseOrder(arr){
    const unique = [];
    const seen = new Set();
    for (const x of arr || []) {
      const key = String(x);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(key);
    }
    writeJSON(BASE_ORDER_KEY, unique);
  }

  function syncBaseOrderWithCart(){
    const bag = getCartBag();
    const liveBaseKeys = Object.keys(bag)
      .filter(k => !isAddonKey(k))
      .filter(k => asNum(bag[k]?.qty) > 0)
      .map(baseKeyOf);

    const liveSet = new Set(liveBaseKeys);
    let order = readBaseOrder();

    for (const baseKey of liveBaseKeys) {
      if (!order.includes(baseKey)) order.push(baseKey);
    }

    order = order.filter(k => liveSet.has(k));
    writeBaseOrder(order);
    return order;
  }

  /* ===================== Promotion helpers ===================== */
  function getLock(){
    const lock = readJSON(COUPON_KEY, null);
    return isObj(lock) ? lock : null;
  }

  function setLock(lock){
    if (!lock) removeKey(COUPON_KEY);
    else writeJSON(COUPON_KEY, lock);
  }

  function couponMetaByIdOrCode(input){
    const needle = upper(input);
    if (!needle || !(window.COUPONS instanceof Map)) return null;

    if (window.COUPONS.has(needle)) {
      return { couponId: needle, meta: window.COUPONS.get(needle) || {} };
    }

    for (const [couponId, meta] of window.COUPONS.entries()) {
      if (upper(meta?.code) === needle) {
        return { couponId: String(couponId), meta: meta || {} };
      }
    }
    return null;
  }

  function findBannerIdForCoupon(couponId, meta){
    if (meta?.bannerId) return String(meta.bannerId);

    const code = lower(meta?.code);
    const cid = lower(couponId);

    // Optional hook: if your banner docs also exist in window.BANNERS, map them here.
    if (window.BANNERS instanceof Map) {
      for (const [bannerId, bannerMeta] of window.BANNERS.entries()) {
        const b = bannerMeta || {};
        if (lower(b.couponId) === cid || lower(b.code) === code || lower(b.couponCode) === code) {
          return String(bannerId);
        }
      }
    }

    return '';
  }

  function eligibleItemIdsForBanner(bannerId){
    if (!bannerId || !(window.BANNER_MENU instanceof Map)) return new Set();
    const arr = window.BANNER_MENU.get(String(bannerId));
    return new Set((Array.isArray(arr) ? arr : []).map(v => String(v).toLowerCase()));
  }

  function eligibleItemIdsForCoupon(couponId, meta){
    const direct = [];
    const list1 = Array.isArray(meta?.eligibleItemIds) ? meta.eligibleItemIds : [];
    const list2 = Array.isArray(meta?.eligibleIds) ? meta.eligibleIds : [];
    const list3 = Array.isArray(meta?.itemIds) ? meta.itemIds : [];
    for (const x of [...list1, ...list2, ...list3]) direct.push(String(x).toLowerCase());

    if (direct.length) return new Set(direct);

    const bannerId = findBannerIdForCoupon(couponId, meta);
    const bannerElig = eligibleItemIdsForBanner(bannerId);
    if (bannerElig.size) return bannerElig;

    if (Array.isArray(window.ITEMS)) {
      const out = new Set();
      for (const item of window.ITEMS) {
        const ids = Array.isArray(item?.promotions) ? item.promotions
          : Array.isArray(item?.coupons) ? item.coupons
          : Array.isArray(item?.couponIds) ? item.couponIds
          : [];
        if (ids.map(String).includes(String(couponId))) {
          out.add(String(item.id).toLowerCase());
        }
      }
      return out;
    }

    return new Set();
  }

  function buildLockFromCoupon(couponId, meta, options = {}){
    const bannerId = options.bannerId || findBannerIdForCoupon(couponId, meta);
    const eligibleItemIds = options.eligibleItemIds || Array.from(eligibleItemIdsForCoupon(couponId, meta));

    return {
      code: upper(meta?.code || couponId),
      type: lower(meta?.type || 'flat'),
      value: Number(meta?.value || 0),
      minOrder: Number(meta?.minOrder || 0),
      valid: meta?.targets ? {
        delivery: !!meta.targets.delivery,
        dining: !!meta.targets.dining
      } : undefined,
      scope: {
        couponId: String(couponId),
        bannerId: bannerId ? String(bannerId) : '',
        eligibleItemIds: eligibleItemIds.map(v => String(v).toLowerCase()),
        baseId: options.baseId ? String(options.baseId).toLowerCase() : ''
      },
      source: options.source || (bannerId ? 'auto:banner' : 'manual'),
      lockedAt: Date.now(),
      meta: meta || {}
    };
  }

  function modeAllowed(lock){
    const mode = activeMode();
    if (isObj(lock?.valid) && mode in lock.valid) return !!lock.valid[mode];
    return true;
  }

  function isKnownBannerOrigin(origin){
    const raw = String(origin || '');
    if (!raw.startsWith('banner:')) return false;
    const bannerId = raw.slice('banner:'.length).trim();
    return !!bannerId && window.BANNER_MENU instanceof Map && window.BANNER_MENU.has(bannerId);
  }

  function lineBannerId(it){
    const origin = String(it?.origin || '');
    if (!origin.startsWith('banner:')) return '';
    const bannerId = origin.slice('banner:'.length).trim();
    return isKnownBannerOrigin(origin) ? bannerId : '';
  }

  function isBannerScoped(lock){
    return !!String(lock?.scope?.bannerId || '').trim();
  }

  function resolveEligibilitySet(lock){
    const ids = Array.isArray(lock?.scope?.eligibleItemIds) ? lock.scope.eligibleItemIds : [];
    return new Set(ids.map(v => String(v).toLowerCase()));
  }

  function checkUsageAvailable(meta){
    if (!meta) return true;
    if (typeof meta.usageLimit === 'number' && meta.usageLimit <= 0) return false;
    if (typeof meta.usageLimit === 'number' && typeof meta.usedCount === 'number') {
      return meta.usedCount < meta.usageLimit;
    }
    return true;
  }

  function computeDiscount(lock){
    if (!lock) return { discount: 0, eligibleBaseSubtotal: 0, eligibleQty: 0 };
    if (!modeAllowed(lock)) return { discount: 0, eligibleBaseSubtotal: 0, eligibleQty: 0 };

    const { base } = splitBaseVsAddons();
    const minOrder = Number(lock?.minOrder || 0);
    if (minOrder > 0 && base < minOrder) {
      return { discount: 0, eligibleBaseSubtotal: 0, eligibleQty: 0 };
    }

    const elig = resolveEligibilitySet(lock);
    if (!elig.size) return { discount: 0, eligibleBaseSubtotal: 0, eligibleQty: 0 };

    const bannerOnly = isBannerScoped(lock);
    const lockBannerId = lower(lock?.scope?.bannerId);

    let eligibleBaseSubtotal = 0;
    let eligibleQty = 0;

    for (const [key, it] of cartEntries()) {
      if (isAddonKey(key)) continue;

      const qty = asNum(it?.qty);
      if (qty <= 0) continue;

      const baseId = lower(it?.id || baseIdOfKey(key));
      if (!elig.has(baseId)) continue;

      if (bannerOnly) {
        const bannerId = lineBannerId(it);
        if (!bannerId || lower(bannerId) !== lockBannerId) continue;
      }

      eligibleBaseSubtotal += asNum(it?.price) * qty;
      eligibleQty += qty;
    }

    if (eligibleBaseSubtotal <= 0) {
      return { discount: 0, eligibleBaseSubtotal: 0, eligibleQty: 0 };
    }

    const type = lower(lock?.type);
    const value = Number(lock?.value || 0);
    let discount = 0;

    if (type === 'percent') {
      discount = Math.round(eligibleBaseSubtotal * (value / 100));
    } else {
      discount = Math.min(value * eligibleQty, eligibleBaseSubtotal);
    }

    return {
      discount: Math.max(0, Math.round(discount)),
      eligibleBaseSubtotal,
      eligibleQty
    };
  }

  /* ===================== FCFS candidate resolution ===================== */
  function bannerBaseCandidatesInFCFSOrder(){
    const bag = getCartBag();
    const order = syncBaseOrderWithCart();
    const out = [];

    for (const baseKey of order) {
      const line = bag[baseKey];
      if (!line || asNum(line.qty) <= 0) continue;
      const bannerId = lineBannerId(line);
      if (!bannerId) continue;

      out.push({
        baseKey,
        baseId: lower(line?.id || baseIdOfKey(baseKey)),
        bannerId: String(bannerId),
        line
      });
    }

    return out;
  }

  function candidateLockForBannerEntry(entry){
    if (!entry?.bannerId || !entry?.baseId) return null;

    for (const [couponId, meta] of window.COUPONS.entries()) {
      if (!meta || !checkUsageAvailable(meta)) continue;

      const bannerId = findBannerIdForCoupon(couponId, meta);
      if (lower(bannerId) !== lower(entry.bannerId)) continue;

      const elig = eligibleItemIdsForCoupon(couponId, meta);
      if (!elig.size || !elig.has(lower(entry.baseId))) continue;

      const lock = buildLockFromCoupon(couponId, meta, {
        bannerId,
        eligibleItemIds: Array.from(elig),
        baseId: entry.baseId,
        source: 'auto:banner'
      });

      const result = computeDiscount(lock);
      if (result.discount > 0) {
        return Object.assign(lock, { _discount: result.discount });
      }
    }

    return null;
  }

  function findWinningAutoBannerLock(){
    const entries = bannerBaseCandidatesInFCFSOrder();
    for (const entry of entries) {
      const candidate = candidateLockForBannerEntry(entry);
      if (candidate) return candidate;
    }
    return null;
  }

  function manualLockStillValid(lock){
    if (!lock) return false;
    if (isBannerScoped(lock)) return false;
    const result = computeDiscount(lock);
    return result.discount > 0;
  }

  /* ===================== Core promotion resolver ===================== */
  function sameWinner(a, b){
    if (!a && !b) return true;
    if (!a || !b) return false;
    return lower(a?.scope?.couponId) === lower(b?.scope?.couponId)
      && lower(a?.scope?.bannerId) === lower(b?.scope?.bannerId)
      && lower(a?.scope?.baseId || a?.baseId) === lower(b?.scope?.baseId || b?.baseId);
  }

  function resolvePromotionLock(){
    const current = getLock();

    // Manual non-banner coupon stays only if still valid.
    if (current && !isBannerScoped(current) && manualLockStillValid(current)) {
      return current;
    }

    // For banner coupons, always re-evaluate winner from current cart.
    const winner = findWinningAutoBannerLock();

    if (!winner) {
      if (current) setLock(null);
      return null;
    }

    if (!sameWinner(current, winner)) {
      setLock(winner);
      return winner;
    }

    return current;
  }

  /* ===================== Manual apply by code ===================== */
  function applyCouponByInput(input){
    const found = couponMetaByIdOrCode(input);
    if (!found) return { ok: false, reason: 'invalid-or-inactive' };

    const { couponId, meta } = found;
    if (meta?.active === false) return { ok: false, reason: 'invalid-or-inactive' };
    if (!checkUsageAvailable(meta)) return { ok: false, reason: 'usage-exhausted' };

    const lock = buildLockFromCoupon(couponId, meta, { source: 'manual' });
    const result = computeDiscount(lock);
    if (result.discount <= 0) return { ok: false, reason: 'not-applicable' };

    setLock(lock);
    emitCartUpdate('manual-coupon-applied');
    return { ok: true, lock };
  }

  /* ===================== Cart/UI helpers ===================== */
  function groupCart(){
    const map = new Map();
    for (const [key, it] of cartEntries()) {
      const bKey = baseKeyOf(key);
      if (!map.has(bKey)) map.set(bKey, { base: null, addons: [] });
      if (isAddonKey(key)) {
        map.get(bKey).addons.push({ key, it, name: it?.addons?.[0]?.name || String(key).split(':')[2] });
      } else {
        map.get(bKey).base = { key, it };
      }
    }
    return map;
  }

  function removeAllAddonsOf(baseKey){
    const bag = getCartBag();
    for (const key of Object.keys(bag)) {
      if (isAddonKey(key) && baseKeyOf(key) === baseKey) {
        setQty(key, 0);
      }
    }
  }

  function resolveLayout(){
    const cfg = (window.CART_UI && window.CART_UI.list) ? window.CART_UI.list : {};
    return {
      items: document.querySelector(cfg.items || '#cart-items'),
      empty: document.querySelector(cfg.empty || '#cart-empty'),
      subtotal: document.querySelector(cfg.subtotal || '#subtotal-amt'),
      servicetax: document.querySelector(cfg.servicetax || '#servicetax-amt'),
      total: document.querySelector(cfg.total || '#total-amt'),
      promoLbl: document.querySelector(cfg.promoLbl || '#promo-label'),
      promoAmt: document.querySelector(cfg.promoAmt || '#promo-amt'),
      promoInput: document.querySelector(cfg.promoInput || '#promo-input'),
      promoApply: document.querySelector(cfg.promoApply || '#promo-apply'),
      proceed: document.querySelector(cfg.proceed || '#proceed-btn')
    };
  }

  function emitCartUpdate(reason){
    try {
      window.dispatchEvent(new CustomEvent('cart:update', { detail: { reason } }));
    } catch {}
  }

  function render(){
    const ui = resolveLayout();
    if (!ui.items) return;

    const groups = groupCart();
    const lock = resolvePromotionLock();
    const { base, addons } = splitBaseVsAddons();
    const discountInfo = computeDiscount(lock);
    const discount = discountInfo.discount;
    const taxable = Math.max(0, base + addons - discount);
    const serviceTax = Math.round(taxable * SERVICE_TAX_RATE);
    const total = taxable + serviceTax;

    ui.items.innerHTML = '';

    if (groups.size === 0) {
      if (ui.empty) ui.empty.hidden = false;
    } else {
      if (ui.empty) ui.empty.hidden = true;

      for (const [baseKey, g] of groups.entries()) {
        if (!g.base) continue;
        const base = g.base.it;

        const li = document.createElement('li');
        li.className = 'cart-row grouped';
        li.dataset.key = baseKey;

        const left = document.createElement('div');
        const title = document.createElement('h3');
        title.className = 'cart-title';
        title.textContent = base?.name || '';

        const sub = document.createElement('p');
        sub.className = 'cart-sub';
        sub.textContent = `${base?.variant || ''} • ${INR(asNum(base?.price))}`;
        left.append(title, sub);

        const right = document.createElement('div');
        right.className = 'row-right';

        const lineSubtotal = document.createElement('div');
        lineSubtotal.className = 'line-subtotal';
        lineSubtotal.textContent = INR(asNum(base?.price) * asNum(base?.qty));

        const stepper = document.createElement('div');
        stepper.className = 'stepper';
        const minus = document.createElement('button');
        const out = document.createElement('output');
        const plus = document.createElement('button');
        minus.textContent = '–';
        plus.textContent = '+';
        out.textContent = String(asNum(base?.qty));
        stepper.append(minus, out, plus);

        minus.addEventListener('click', () => {
          const currentQty = asNum(getCartBag()?.[baseKey]?.qty);
          const nextQty = Math.max(0, currentQty - 1);
          setQty(baseKey, nextQty, base);
          if (nextQty === 0) removeAllAddonsOf(baseKey);
          emitCartUpdate('base-minus');
          render();
        });

        plus.addEventListener('click', () => {
          const currentQty = asNum(getCartBag()?.[baseKey]?.qty);
          setQty(baseKey, currentQty + 1, base);
          emitCartUpdate('base-plus');
          render();
        });

        const remove = document.createElement('button');
        remove.className = 'remove-link';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
          setQty(baseKey, 0);
          removeAllAddonsOf(baseKey);
          emitCartUpdate('base-remove');
          render();
        });

        right.append(stepper, lineSubtotal, remove);
        li.append(left, right);
        ui.items.appendChild(li);

        for (const addon of g.addons) {
          const row = document.createElement('div');
          row.className = 'addon-row';
          row.innerHTML = `<div class="addon-label muted">+ ${addon.name}</div><div class="line-subtotal">${INR(asNum(addon.it?.price) * asNum(addon.it?.qty))}</div>`;
          ui.items.appendChild(row);
        }
      }
    }

    if (ui.subtotal) ui.subtotal.textContent = INR(base + addons);
    if (ui.servicetax) ui.servicetax.textContent = INR(serviceTax);
    if (ui.total) ui.total.textContent = INR(total);

    if (ui.promoLbl) {
      ui.promoLbl.textContent = lock ? `Promotion (${upper(lock.code || lock?.scope?.couponId)})` : 'Promotion';
    }
    if (ui.promoAmt) {
      ui.promoAmt.textContent = discount > 0 ? `- ${INR(discount)}` : INR(0);
    }
    if (ui.proceed) {
      ui.proceed.disabled = groups.size === 0;
    }
  }

  /* ===================== Promo UI ===================== */
  function wireApplyCouponUI(){
    const ui = resolveLayout();
    if (!ui.promoInput || !ui.promoApply) return;

    const apply = () => {
      const value = ui.promoInput.value;
      const result = applyCouponByInput(value);
      if (!result.ok) {
        if (ui.promoLbl) ui.promoLbl.textContent = 'Promotion (): invalid or inactive';
        return;
      }
      render();
    };

    ui.promoApply.addEventListener('click', apply);
    ui.promoInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') apply();
    });
  }

  /* ===================== Public debug API ===================== */
  window.CartAPI = Object.assign(window.CartAPI || {}, {
    activeMode,
    getCartBag,
    getLock,
    setLock,
    resolveEligibilitySet,
    computeDiscount,
    findWinningAutoBannerLock,
    resolvePromotionLock,
    applyCouponByInput,
    render
  });

  /* ===================== Boot ===================== */
  function boot(){
    syncBaseOrderWithCart();
    wireApplyCouponUI();
    render();

    window.addEventListener('cart:update', () => {
      syncBaseOrderWithCart();
      render();
    }, false);

    window.addEventListener('storage', (e) => {
      if (!e) return;
      if ([CART_KEY, COUPON_KEY, MODE_KEY_1, MODE_KEY_2, 'gufa:COUPONS', BANNER_MENU_KEY].includes(e.key)) {
        hydrateBannerMenu();
        hydrateCouponsFromLS();
        syncBaseOrderWithCart();
        render();
      }
    }, false);

    window.addEventListener('serviceMode:changed', () => {
      render();
    }, false);

    window.addEventListener('mode:change', () => {
      render();
    }, false);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') render();
    }, false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
