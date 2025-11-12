// customer/cart.store.js
// Single source of truth: localStorage["gufa_cart"] (FLAT object)
;(function () {
  const LS_KEY = "gufa_cart";

  // ---- helpers ----
  function readBag() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      // accept flat or {items:{...}} then normalize to flat
      if (parsed && typeof parsed === "object") {
        return (parsed.items && typeof parsed.items === "object") ? parsed.items : parsed;
      }
      return {};
    } catch { return {}; }
  }

  function writeBag(bag) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(bag || {})); } catch {}
    dispatch();
  }

  function dispatch() {
    try { window.dispatchEvent(new CustomEvent("cart:update")); } catch {}
  }

  // ---- public API ----
  
  const API = {
    // Returns flat object: { "itemId:variant[:addon]": {id,name,variant,price,thumb,qty} }
    get() { return readBag(); },

    // Write a single line; qty=0 removes the line
    // meta may include: { id, name, variant, price, thumb, origin }
    setQty(key, qty, meta) {
      const bag  = readBag();
      const next = Math.max(0, Number(qty) || 0);

      if (next <= 0) {
        delete bag[key];
        writeBag(bag);
        return;
      }

const prev = bag[key] || {};
bag[key] = {
  id:       meta?.id       ?? prev.id       ?? "",
  name:     meta?.name     ?? prev.name     ?? "",
  variant:  meta?.variant  ?? prev.variant  ?? "",
  price:    Number(meta?.price ?? prev.price ?? 0),
  thumb:    meta?.thumb    ?? prev.thumb    ?? "",
  qty:      next,
  bannerId: meta?.bannerId ?? prev.bannerId ?? "",
  origin:  ((meta && typeof meta.origin === "string" && meta.origin.trim())
            ? meta.origin
            : (prev.origin || (meta?.bannerId ? `banner:${meta.bannerId}` : (prev.bannerId ? `banner:${prev.bannerId}` : ""))))
};

// ——— Inference: if still missing, look up from cart-owned BANNERS ———
try {
  const itemIdLower = String((bag[key]?.id || key.split(":")[0]) || "").toLowerCase();
  const needBid = !bag[key].bannerId || !bag[key].origin;

  if (needBid) {
    const toArr = () => {
      const raw = window.BANNERS;
      if (raw instanceof Map) return Array.from(raw.entries()).map(([id, v]) => ({
        id: String(id),
        itemIds: Array.isArray(v?.itemIds) ? v.itemIds.map(String)
               : Array.isArray(v?.items)   ? v.items.map(String) : [],
        couponIds: Array.isArray(v?.couponIds) ? v.couponIds.map(String) : []
      }));
      if (Array.isArray(raw)) return raw;
      try { return JSON.parse(localStorage.getItem("gufa:BANNERS") || "[]") || []; } catch { return []; }
    };
    const B = toArr();

    // prefer current lock if it narrows it to exactly one banner
    let lock = null; try { lock = JSON.parse(localStorage.getItem("gufa_coupon") || "null"); } catch {}
    const lockedCid = String(lock?.scope?.couponId || "").trim();

    const carriers = B.filter(b => (Array.isArray(b.itemIds) ? b.itemIds : []).map(String).map(s=>s.toLowerCase()).includes(itemIdLower));
    let pick = "";
    if (lockedCid) {
      const byLock = carriers.filter(b => (Array.isArray(b.couponIds) ? b.couponIds.map(String) : []).includes(lockedCid));
      if (byLock.length === 1) pick = byLock[0].id;
    }
    if (!pick && carriers.length === 1) pick = carriers[0].id;

    if (pick) {
      if (!bag[key].bannerId) bag[key].bannerId = String(pick);
      if (!bag[key].origin || bag[key].origin === "") bag[key].origin = `banner:${pick}`;
    }
  }
} catch {}



      writeBag(bag);
    },

    clear() { writeBag({}); },


    count() {
      const bag = readBag();
      return Object.values(bag).reduce((n, it) => n + (Number(it.qty) || 0), 0);
    },

    subtotal() {
      const bag = readBag();
      return Object.values(bag).reduce((s, it) => s + (Number(it.price)||0)*(Number(it.qty)||0), 0);
    }
  };

  // expose
  window.Cart = API;
})();
