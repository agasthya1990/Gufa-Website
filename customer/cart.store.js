/* cart.store.js — global Cart (no exports). Works in plain <script> tags.

Schema saved in localStorage:
{
  items: {
    [key]: { id, name, variant, price, qty, thumb? }
  }
}
- key format is up to callers (we usually use "itemId:variant")
- price is the chosen unit price at add time
*/

(function (window, document) {
  const LS_KEY = "gufa_cart_v1";

  // ---- internal helpers ----
  function readState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== "object") return { items: {} };
      if (!parsed.items || typeof parsed.items !== "object") parsed.items = {};
      return parsed;
    } catch {
      return { items: {} };
    }
  }

  function writeState(state) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch {}
    dispatch();
  }

  function dispatch() {
    try {
      const state = readState();
      const ev = new CustomEvent("cart:update", { detail: { cart: state } });
      window.dispatchEvent(ev);
    } catch {}
  }

  // ---- public API ----
  function get() {
    return readState().items;
  }

  // setQty(key, qty, meta) — qty <= 0 removes the line
  // meta may include: { id, name, variant, price, thumb }
  function setQty(key, qty, meta) {
    if (!key) return;
    const q = Math.max(0, Number(qty) || 0);
    const state = readState();

    if (q <= 0) {
      delete state.items[key];
    } else {
      const prev = state.items[key] || {};
      state.items[key] = {
        id: meta?.id ?? prev.id ?? "",
        name: meta?.name ?? prev.name ?? "",
        variant: meta?.variant ?? prev.variant ?? "",
        price: Number(meta?.price ?? prev.price ?? 0) || 0,
        thumb: meta?.thumb ?? prev.thumb ?? "",
        qty: q
      };
    }
    writeState(state);
  }

  function clear() {
    writeState({ items: {} });
  }

  // convenience (used by some headers/pages)
  function count() {
    const items = get();
    return Object.values(items).reduce((n, it) => n + (Number(it.qty) || 0), 0);
  }

  function subtotal() {
    const items = get();
    return Object.values(items).reduce(
      (sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0),
      0
    );
  }

  // simple pub/sub if you prefer callbacks instead of window event
  const listeners = new Set();
  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    listeners.add(fn);
    // call immediately with current state
    try { fn(readState()); } catch {}
    const off = () => listeners.delete(fn);
    // also mirror window event
    const onWin = (e) => fn(e.detail?.cart || readState());
    window.addEventListener("cart:update", onWin);
    return () => {
      off();
      window.removeEventListener("cart:update", onWin);
    };
  }

  // keep callbacks in sync with window event
  window.addEventListener("cart:update", () => {
    const state = readState();
    listeners.forEach(fn => {
      try { fn(state); } catch {}
    });
  });

  // expose globally
  window.Cart = {
    // core
    get, setQty, clear,
    // helpers
    count, subtotal,
    // optional
    subscribe
  };

  // fire once on load so pages can paint immediately
  dispatch();
})(window, document);
