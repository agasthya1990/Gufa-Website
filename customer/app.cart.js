// app.cart.js — header badge + cross-page sync (bridged to cart.store.js)
import { Cart } from "./cart.store.js";

function countItems(bag) {
  return Object.values(bag || {}).reduce((n, it) => n + Number(it.qty || 0), 0);
}

function renderHeaderCount() {
  const a = document.getElementById("cartLink");
  if (!a) return;
  const n = countItems(Cart.get());
  a.textContent = `Cart (${n})`;
}

// initial paint
renderHeaderCount();

// repaint when any page updates the cart (custom event fired by cart.store.js)
window.addEventListener("cart:update", renderHeaderCount);

// repaint on cross-tab localStorage changes
window.addEventListener("storage", (e) => {
  if (e.key === "gufa_cart_v1") renderHeaderCount();
});
