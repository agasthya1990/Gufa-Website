// app.menu.js — Courses & Categories collages + 4 toggles + Veg/Non-Veg badges + live Firestore
import { db } from "./firebase.client.js";
import { Cart } from "./app.cart.js";
import {
  collection, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

/* ---------- DOM ---------- */
const grid = $("#menu .menu-grid");
const courseBuckets = $("#courseBuckets");
const categoryBuckets = $("#categoryBuckets");
const inpSearch = $("#filter-search");

const vegBtn = $("#vegToggle");
const nonvegBtn = $("#nonvegToggle");
const courseToggle = $("#courseToggle");
const categoryToggle = $("#categoryToggle");

/* ---------- State ---------- */
let ITEMS = [];
let COURSES = new Set();     // menuCourses doc.id
let CATEGORIES = new Set();  // menuCategories doc.id

// Toggles (both Veg & Non-Veg may be OFF; Course/Category toggle enable applying the chosen selection)
let vegOn = true;
let nonvegOn = true;
let courseFilterOn = true;
let categoryFilterOn = true;

// Current chosen course/category from collages
let selectedCourse = "";
let selectedCategory = "";

/* ---------- Helpers ---------- */
function priceModel(qtyType) {
  if (!qtyType) return null;
  if (qtyType.type === "Not Applicable") {
    return { variants: [{ key: "single", label: "", price: Number(qtyType.itemPrice || 0) }] };
  }
  if (qtyType.type === "Half & Full") {
    return {
      variants: [
        { key: "half", label: "Half", price: Number(qtyType.halfPrice || 0) },
        { key: "full", label: "Full", price: Number(qtyType.fullPrice || 0) },
      ]
    };
  }
  return null;
}
function getQty(key) {
  const bag = typeof Cart.get === "function" ? Cart.get() : {};
  return Number(bag?.[key]?.qty || 0);
}
function setQty(found, variantKey, price, nextQty) {
  const key = `${found.id}:${variantKey}`;
  const next = Math.max(0, Number(nextQty || 0));
  Cart.setQty(key, next, { id: found.id, name: found.name, variant: variantKey, price });
  const badge = $(`.qty[data-key="${key}"] .num`);
  if (badge) badge.textContent = String(next);
}

/* ---------- Item card ---------- */
function dietClass(t){ const v = (t||"").toLowerCase(); return v==="veg" ? "veg" : (v==="non-veg" ? "nonveg" : ""); }
function dietLabel(t){ const v = (t||"").toLowerCase(); return v==="veg" ? "Veg" : (v==="non-veg" ? "Non-Veg" : ""); }

function stepperHTML(found, variant) {
  const key = `${found.id}:${variant.key}`;
  const qty = getQty(key);
  return `
    <div class="stepper" data-item="${found.id}" data-variant="${variant.key}">
      <span class="vlabel">${variant.label || ""}</span>
      <div class="qty" data-key="${key}">
        <button class="dec" aria-label="decrease">−</button>
        <span class="num">${qty}</span>
        <button class="inc" aria-label="increase">+</button>
      </div>
      <span class="vprice">₹${variant.price}</span>
    </div>
  `;
}
function itemCardHTML(m) {
  const pm = priceModel(m.qtyType);
  const variants = (pm?.variants || []).filter(v => v.price > 0);
  const tags = [m.foodCourse||"", m.foodType||"", m.category||""].filter(Boolean).join(" • ");
  const addons = Array.isArray(m.addons) && m.addons.length
    ? `<small class="muted">Add-ons: ${m.addons.join(", ")}</small>` : "";
  const steppers = variants.map(v => stepperHTML(m, v)).join("");

  const dc = dietClass(m.foodType);
  const dl = dietLabel(m.foodType);

  return `
    <article class="menu-item ${dc}" data-id="${m.id}">
      ${dl ? `<span class="diet-badge ${dc}">${dl}</span>` : ""}
      ${m.imageUrl ? `<img loading="lazy" src="${m.imageUrl}" alt="${m.name||""}" class="menu-img"/>` : ""}
      <h4 class="menu-name">${m.name || ""}</h4>
      <p class="menu-desc">${m.description || ""}</p>
      ${addons}
      <div class="row meta"><small class="muted">${tags}</small></div>
      <div class="steppers">${steppers}</div>
    </article>
  `;
}

/* ---------- Filtering ---------- */
function applyFilters(items) {
  const q = (inpSearch?.value || "").toLowerCase().trim();

  return items.filter((it) => {
    // Stock
    if (it.inStock === false) return false;

    // Veg/Non-Veg logic (both OFF => show none)
    const t = (it.foodType || "").toLowerCase(); // "veg" | "non-veg"
    if (!vegOn && !nonvegOn) return false;
    if (vegOn && !nonvegOn && t !== "veg") return false;
    if (!vegOn && nonvegOn && t !== "non-veg") return false;

    // Course/Category toggles apply the chosen selection if any
    if (courseFilterOn && selectedCourse && it.foodCourse !== selectedCourse) return false;
    if (categoryFilterOn && selectedCategory && it.category !== selectedCategory) return false;

    // Search
    if (q) {
      const hay = [
        it.name, it.description, it.foodCourse, it.category,
        ...(Array.isArray(it.addons) ? it.addons : [])
      ].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ---------- Renderers ---------- */
function renderGrid() {
  if (!grid) return;
  const filtered = applyFilters(ITEMS);
  grid.innerHTML = filtered.length
    ? filtered.map(itemCardHTML).join("")
    : `<div class="menu-item placeholder">No items match your selection.</div>`;
}

function collageHTML(imgs) {
  const a = imgs[0] || "", b = imgs[1] || "", c = imgs[2] || "", d = imgs[3] || "";
  return `
    <div class="collage">
      ${a ? `<img loading="lazy" src="${a}" alt="">` : `<div class="ph"></div>`}
      ${b ? `<img loading="lazy" src="${b}" alt="">` : `<div class="ph"></div>`}
      ${c ? `<img loading="lazy" src="${c}" alt="">` : `<div class="ph"></div>`}
      ${d ? `<img loading="lazy" src="${d}" alt="">` : `<div class="ph"></div>`}
    </div>`;
}
function renderCourseBuckets() {
  if (!courseBuckets) return;

  const byCourse = new Map();
  for (const it of ITEMS) {
    if (!it.foodCourse) continue;
    if (!byCourse.has(it.foodCourse)) byCourse.set(it.foodCourse, []);
    if (it.imageUrl) byCourse.get(it.foodCourse).push(it.imageUrl);
  }

  const crs = Array.from(COURSES).sort((a,b)=>a.localeCompare(b));
  courseBuckets.innerHTML = crs.map(name => {
    const imgs = (byCourse.get(name) || []).slice(0,4);
    const active = selectedCourse === name ? "active" : "";
    return `
      <button class="bucket-tile ${active}" data-kind="course" data-id="${name}">
        ${collageHTML(imgs)}
        <span class="bucket-label">${name}</span>
      </button>`;
  }).join("");
}
function renderCategoryBuckets() {
  if (!categoryBuckets) return;

  const byCat = new Map();
  for (const it of ITEMS) {
    if (!it.category) continue;
    if (!byCat.has(it.category)) byCat.set(it.category, []);
    if (it.imageUrl) byCat.get(it.category).push(it.imageUrl);
  }

  const cats = Array.from(CATEGORIES).sort((a,b)=>a.localeCompare(b));
  categoryBuckets.innerHTML = cats.map(name => {
    const imgs = (byCat.get(name) || []).slice(0,4);
    const active = selectedCategory === name ? "active" : "";
    return `
      <button class="bucket-tile ${active}" data-kind="category" data-id="${name}">
        ${collageHTML(imgs)}
        <span class="bucket-label">${name}</span>
      </button>`;
  }).join("");
}

/* ---------- Live data ---------- */
function listenCourses() {
  onSnapshot(collection(db, "menuCourses"), (snap) => {
    COURSES = new Set();
    snap.forEach(d => COURSES.add(d.id));
    renderCourseBuckets();
  });
}
function listenCategories() {
  onSnapshot(collection(db, "menuCategories"), (snap) => {
    CATEGORIES = new Set();
    snap.forEach(d => CATEGORIES.add(d.id));
    renderCategoryBuckets();
  });
}
function listenItems() {
  const baseCol = collection(db, "menuItems");
  const renderFrom = (docs) => {
    ITEMS = docs.map(d => ({ id: d.id, ...d.data() }));
    renderCourseBuckets();
    renderCategoryBuckets();
    renderGrid();
  };
  try {
    const qLive = query(baseCol, orderBy("createdAt","desc"));
    onSnapshot(
      qLive,
      snap => renderFrom(snap.docs),
      () => onSnapshot(baseCol, snap => renderFrom(snap.docs))
    );
  } catch {
    onSnapshot(baseCol, snap => renderFrom(snap.docs));
  }
}

/* ---------- Events ---------- */
// Collage clicks (store selection; filtering depends on toggles)
document.addEventListener("click", (e) => {
  const tile = e.target.closest(".bucket-tile");
  if (!tile) return;
  const kind = tile.dataset.kind;
  const val = tile.dataset.id;
  if (kind === "course") {
    selectedCourse = (selectedCourse === val) ? "" : val; // toggle select
    renderCourseBuckets();
  } else if (kind === "category") {
    selectedCategory = (selectedCategory === val) ? "" : val;
    renderCategoryBuckets();
  }
  renderGrid();
});

// Grid steppers (delegated)
let gridHandlerBound = false;
function bindGridHandlers() {
  if (gridHandlerBound || !grid) return;
  gridHandlerBound = true;
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".inc, .dec");
    if (!btn) return;
    const wrap = btn.closest(".stepper");
    const id = wrap?.dataset.item;
    const variantKey = wrap?.dataset.variant;
    const found = ITEMS.find(x => x.id === id);
    if (!found) return;

    const pm = priceModel(found.qtyType);
    const v = (pm?.variants || []).find(x => x.key === variantKey);
    if (!v || !v.price) return;

    const key = `${id}:${variantKey}`;
    const now = getQty(key);
    const next = Math.max(0, now + (btn.classList.contains("inc") ? 1 : -1));
    setQty(found, variantKey, v.price, next);
  });
}

// Toggles (Veg/Non-Veg can be OFF; Course/Category toggles control application)
vegBtn?.addEventListener("click", () => {
  vegOn = !vegOn;
  vegBtn.classList.toggle("on", vegOn);
  vegBtn.setAttribute("aria-pressed", String(vegOn));
  renderGrid();
});
nonvegBtn?.addEventListener("click", () => {
  nonvegOn = !nonvegOn;
  nonvegBtn.classList.toggle("on", nonvegOn);
  nonvegBtn.setAttribute("aria-pressed", String(nonvegOn));
  renderGrid();
});
courseToggle?.addEventListener("click", () => {
  courseFilterOn = !courseFilterOn;
  courseToggle.classList.toggle("on", courseFilterOn);
  courseToggle.setAttribute("aria-pressed", String(courseFilterOn));
  renderGrid();
});
categoryToggle?.addEventListener("click", () => {
  categoryFilterOn = !categoryFilterOn;
  categoryToggle.classList.toggle("on", categoryFilterOn);
  categoryToggle.setAttribute("aria-pressed", String(categoryFilterOn));
  renderGrid();
});

// Search
inpSearch?.addEventListener("input", renderGrid);

/* ---------- Boot ---------- */
bindGridHandlers();
listenCourses();
listenCategories();
listenItems();
