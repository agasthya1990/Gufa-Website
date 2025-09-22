// app.track.js — renders a simple, clean status timeline that matches your site.

(async function () {
  const $ = (s) => document.querySelector(s);
  const $btn = $("#track-btn");
  const $id = $("#order-id");
  const $tl = $("#timeline");
  const $note = $("#track-note");
  const $countTop = $("#cart-count");

  function setCartCount() {
    try {
      const bag = window?.Cart?.get?.() || {};
      const n = Object.values(bag).reduce((a, i) => a + (Number(i.qty)||0), 0);
      if ($countTop) $countTop.textContent = String(n);
    } catch {}
  }
  window.addEventListener("cart:update", setCartCount);
  document.addEventListener("DOMContentLoaded", setCartCount);

  function li(text, active) {
    const node = document.createElement("li");
    node.textContent = text;
    if (active) node.classList.add("active");
    return node;
  }

  const { doc, getDoc } =
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

  async function track(orderId) {
    $tl.innerHTML = "";
    $note.textContent = "";

    if (!orderId) return;

    try {
      const snap = await getDoc(doc(window.db, "orders", orderId));
      if (!snap.exists()) {
        $note.textContent = "Order not found. Please check the ID.";
        return;
      }
      const data = snap.data();
      const status = (data.status || "placed").toLowerCase();
      const stages = [
        { key:"placed",            label:"Placed" },
        { key:"accepted",          label:"Accepted" },
        { key:"preparing",         label:"Preparing" },
        { key:"out_for_delivery",  label:"Out for delivery" },
        { key:"delivered",         label:"Delivered" }
      ];
      const idx = Math.max(0, stages.findIndex(s => s.key === status));
      stages.forEach((s, i) => $tl.appendChild(li(s.label, i <= idx)));
      $note.textContent = `Status: ${stages[idx]?.label || "Placed"}`;
    } catch (e) {
      $note.textContent = "Could not read order right now. Please try again later.";
    }
  }

  $btn?.addEventListener("click", () => track(($id?.value || "").trim()));
  $id?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $btn?.click(); }});
})();
