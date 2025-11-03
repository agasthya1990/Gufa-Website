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

  const prev = bag[key] || {};
  bag[key] = {
    id:       meta?.id       ?? prev.id       ?? "",
    name:     meta?.name     ?? prev.name     ?? "",
    variant:  meta?.variant  ?? prev.variant  ?? "",
    price:    Number(meta?.price ?? prev.price ?? 0),
    thumb:    meta?.thumb    ?? prev.thumb    ?? "",
    qty:      next,
    // NEW: persist provenance if provided; keep existing if already set
    origin:   (meta?.origin ?? prev.origin ?? "")
  };


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
