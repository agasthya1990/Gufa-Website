// customer/cart.store.js
// LocalStorage-backed cart used by menu, drawer, and checkout.
// Single source of truth. Also attaches to window.Cart for legacy code.

const STORAGE_KEY = "gufa_cart_v1";

function read() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function write(obj) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  try {
    window.dispatchEvent(new CustomEvent("cart:update", { detail: { cart: obj } }));
  } catch {}
}

export const Cart = {
  get() {
    return read(); // { [itemId:variantKey]: { id, name, variant, price, qty } }
  },
  set(obj) {
    write(obj || {});
  },
  setQty(key, qty, meta = {}) {
    const bag = read();
    const q = Math.max(0, Number(qty || 0));

    if (q <= 0) {
      delete bag[key];
      write(bag);
      return;
    }

    const prev = bag[key] || {};
    // Normalize and persist numbers
    bag[key] = {
      id: meta.id ?? prev.id,
      name: meta.name ?? prev.name,
      variant: meta.variant ?? prev.variant,
      price: Number(meta.price ?? prev.price ?? 0),
      qty: Number(q),
    };
    write(bag);
  },
  clear() {
    write({});
  },
};

// Legacy global for any existing code using window.Cart
if (typeof window !== "undefined") {
  window.Cart = Cart;
}
