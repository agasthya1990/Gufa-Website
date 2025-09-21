
// Minimal local cart (keyed by itemId:variant)
const KEY = "gufa_cart_v1";

export const Cart = {
  get() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
  },
  save(c) {
    localStorage.setItem(KEY, JSON.stringify(c));
    window.dispatchEvent(new Event("cart:changed"));
  },
  upsert(item) {
    const c = Cart.get();
    const k = item.key;
    c[k] = c[k] || { ...item, qty: 0 };
    c[k].qty += item.qty || 1;
    Cart.save(c);
  },
  setQty(key, qty) {
    const c = Cart.get();
    if (c[key]) {
      c[key].qty = qty;
      if (qty <= 0) delete c[key];
      Cart.save(c);
    }
  },
  clear() {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new Event("cart:changed"));
  },
  count() {
    return Object.values(Cart.get()).reduce((s, i) => s + i.qty, 0);
  }
};

// Update any "Cart (N)" link counts automatically
(function initCartBadge() {
  const links = Array.from(document.querySelectorAll(".cart-link"));
  const render = () => {
    const n = Cart.count();
    links.forEach(a => a.textContent = `Cart (${n})`);
  };
  render();
  window.addEventListener("cart:changed", render);
})();
