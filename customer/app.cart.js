// app.cart.js — lightweight Cart store with localStorage + live "Cart (n)" badge
- import { Cart } from "./app.cart.js";
+ import { Cart } from "./cart.store.js";

export const Cart = (() => {
  const KEY = "gufa_cart";
  const listeners = new Set();

  function _load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
    catch { return {}; }
  }
  function _save(obj) {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); }
    catch {}
    _emit();
  }
  function _emit() {
    const state = get();
    listeners.forEach(fn => { try { fn(state); } catch {} });
    _renderBadge();
  }

  function get() { return _load(); }

  // Upsert an item: { key, id, name, variant, price, qty }
  function upsert(item) {
    const bag = _load();
    const current = bag[item.key] || { ...item, qty: 0 };
    const next = Math.max(0, Number(item.qty ?? current.qty));
    if (next === 0) {
      delete bag[item.key];
    } else {
      bag[item.key] = { ...current, ...item, qty: next };
    }
    _save(bag);
  }

  // Set quantity quickly (used by steppers)
  function setQty(key, qty, meta = {}) {
    const bag = _load();
    const next = Math.max(0, Number(qty));
    if (next === 0) delete bag[key];
    else bag[key] = { ...(bag[key] || {}), ...meta, qty: next, key };
    _save(bag);
  }

  function clear() { _save({}); }

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function _count(bag) {
    return Object.values(bag || {}).reduce((n, it) => n + Number(it.qty || 0), 0);
  }

  // Small UX: auto-update "Cart (n)" in header if #cartLink exists
  function _renderBadge() {
    const a = document.getElementById("cartLink");
    if (!a) return;
    const n = _count(_load());
    a.textContent = `Cart (${n})`;
  }

  // Keep badge updated across tabs
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) _renderBadge();
  });

  // initial badge paint
  queueMicrotask(_renderBadge);

  return { KEY, get, upsert, setQty, clear, subscribe };
})();
