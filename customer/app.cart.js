// app.cart.js
import { Cart } from "./cart.store.js";

document.addEventListener("DOMContentLoaded", () => {
  const cartBody = document.getElementById("cartBody");
  const cartTotal = document.getElementById("cartTotal");

  function renderCart() {
    cartBody.innerHTML = "";
    const items = Cart.getAll();

    if (!items.length) {
      cartBody.innerHTML = `<tr><td colspan="5" class="empty">Your cart is empty</td></tr>`;
      cartTotal.textContent = "₹0";
      return;
    }

    let total = 0;

    items.forEach(item => {
      const price = item.qtyType?.itemPrice || item.qtyType?.halfPrice || 0;
      const subtotal = price * item.qty;
      total += subtotal;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><img src="${item.imageUrl}" class="cart-img"/></td>
        <td>${item.name}</td>
        <td>₹${price}</td>
        <td>
          <button class="qty-btn dec" data-id="${item.id}">-</button>
          <span class="qty">${item.qty}</span>
          <button class="qty-btn inc" data-id="${item.id}">+</button>
        </td>
        <td>₹${subtotal}</td>
      `;

      cartBody.appendChild(tr);
    });

    cartTotal.textContent = `₹${total}`;

    // Qty buttons
    cartBody.querySelectorAll(".qty-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        if (btn.classList.contains("inc")) {
          Cart.increase(id);
        } else {
          Cart.decrease(id);
        }
        renderCart();
      });
    });
  }

  renderCart();
});
