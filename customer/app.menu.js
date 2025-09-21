import { db } from "./firebase.client.js";
import {
  collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { Cart } from "./app.cart.js";

// --- Fetchers (Admin → Customer sync) ---
async function fetchMenuItems() {
  const snap = await getDocs(collection(db, "menuItems"));
  const out = [];
  snap.forEach(d => out.push({ id: d.id, ...d.data() }));
  // Only show inStock (default true if undefined)
  return out.filter(x => x.inStock !== false);
}

async function fetchList(colName) {
  const snap = await getDocs(collection(db, colName));
  const arr = [];
  snap.forEach(d => arr.push(d.id));
  return arr.sort();
}

async function fetchBanners() {
  const snap = await getDocs(collection(db, "promotions"));
  const arr = [];
  snap.forEach(d => {
    const v = d.data();
    if (v.kind === "banner" && v.active) arr.push(v);
  });
  return arr;
}

// --- UI helpers ---
function priceModel(qtyType) {
  if (!qtyType) return null;
  if (qtyType.type === "Not Applicable") {
    return { variants: [{ key: "single", label: "", price: qtyType.itemPrice || 0 }] };
  }
  if (qtyType.type === "Half & Full") {
    return {
      variants: [
        { key: "half", label: "Half", price: qtyType.halfPrice || 0 },
        { key: "full", label: "Full", price: qtyType.fullPrice || 0 }
      ]
    };
  }
  return null;
}

function itemCardHTML(m) {
  const pm = priceModel(m.qtyType);
  const buttons = pm?.variants?.map(v => `
    <button class="btn add-btn" data-id="${m.id}" data-vid="${v.key}" data-price="${v.price}">
      ${v.label ? `${v.label} — ` : ""}₹${v.price}
    </button>
  `).join("") || "";

  const addons = Array.isArray(m.addons) && m.addons.length
    ? `<small>Add-ons: ${m.addons.join(", ")}</small>` : "";

  return `
    <div class="menu-item">
      ${m.imageUrl ? `<img src="${m.imageUrl}" alt="${m.name}" style="width:100%;height:160px;object-fit:cover;border-radius:8px 8px 0 0;margin:-16px -16px 8px">` : ""}
      <strong>${m.name}</strong><br>
      <small>${m.description || ""}</small><br>
      ${addons}
      <div class="row" style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">${buttons}</div>
    </div>
  `;
}

function applyFilters(items) {
  const q = (document.getElementById("filter-search")?.value || "").toLowerCase().trim();
  const cat = document.getElementById("filter-category")?.value || "";
  const crs = document.getElementById("filter-course")?.value || "";
  const typ = document.getElementById("filter-type")?.value || "";

  return items.filter(it => {
    if (cat && it.category !== cat) return false;
    if (crs && it.foodCourse !== crs) return false;
    if (typ && it.foodType !== typ) return false;
    if (q) {
      const hay = `${it.name} ${it.description || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// --- Bootstrap ---
(async function initMenu() {
  // parallel fetches from Admin-managed collections
  const [items, cats, courses, banners] = await Promise.all([
    fetchMenuItems(), fetchList("menuCategories"), fetchList("menuCourses"), fetchBanners()
  ]);

  // Populate filters
  const catSel = document.getElementById("filter-category");
  const crsSel = document.getElementById("filter-course");
  cats.forEach(c => { const o = document.createElement("option"); o.value = c; o.textContent = c; catSel?.appendChild(o); });
  courses.forEach(c => { const o = document.createElement("option"); o.value = c; o.textContent = c; crsSel?.appendChild(o); });

  // Render banners (if you add a banner container later)
  // Example: document.getElementById("banners").innerHTML = banners.map(b => `<img src="${b.imageUrl}" alt="${b.title||""}">`).join("");

  // Render grid
  const grid = document.querySelector(".menu-grid");
  const render = () => {
    const filtered = applyFilters(items);
    grid.innerHTML = filtered.length ? filtered.map(itemCardHTML).join("") : `<div class="menu-item">No items found.</div>`;

    // Hook up Add buttons
    grid.querySelectorAll(".add-btn").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const variant = btn.dataset.vid;
        const price = parseFloat(btn.dataset.price || "0");
        const found = items.find(x => x.id === id);
        if (!found) return;
        const key = `${id}:${variant}`;
        Cart.upsert({ key, id, name: found.name, variant, price, qty: 1 });
      };
    });
  };

  // Re-render on filter input
  ["filter-search", "filter-category", "filter-course", "filter-type"].forEach(id => {
    const el = document.getElementById(id);
    el && el.addEventListener("input", render);
    el && el.addEventListener("change", render);
  });

  render();
})();

