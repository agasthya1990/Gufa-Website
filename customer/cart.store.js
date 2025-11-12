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
const incomingOrigin = (meta && typeof meta.origin === "string" && meta.origin.trim()) ? meta.origin : "";
const nextOrigin =
  incomingOrigin ||
  prev.origin ||
  (meta && typeof meta.bannerId === "string" && meta.bannerId.trim() ? `banner:${meta.bannerId}` : "");

bag[key] = {
  id:        meta?.id        ?? prev.id        ?? "",
  name:      meta?.name      ?? prev.name      ?? "",
  variant:   meta?.variant   ?? prev.variant   ?? "",
  price:     Number(meta?.price ?? prev.price ?? 0),
  thumb:     meta?.thumb     ?? prev.thumb     ?? "",
  qty:       next,
  // new: keep explicit bannerId alongside origin for easy auditing
  bannerId:  (typeof meta?.bannerId === "string" && meta.bannerId.trim())
               ? meta.bannerId
               : (prev.bannerId || ""),
  origin:    nextOrigin
};




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
