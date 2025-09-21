// customer/app.menu.js — bifurcations (Category / Food Course) + collages + qty steppers
import { db } from "./firebase.client.js";
import {
  collection, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { Cart } from "./app.cart.js";

/* ---------- dom helpers ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

/* ---------- containers ---------- */
const menuSection = $("#menu");
const grid = $("#menu .menu-grid") || $(".menu-grid");
const filtersEl = $(".filters");
if (!menuSection || !grid) console.error("[menu] Missing #menu or .menu-grid");

/* Inject “Browse by …” bifurcations above filters */
let bucketsWrap = $("#menuBuckets");
if (!bucketsWrap) {
  bucketsWrap = document.createElement("div");
  bucketsWrap.id = "menuBuckets";
  bucketsWrap.innerHTML = `
    <div class="bucket-group">
      <h3 class="bucket-title">Browse by Category</h3>
      <div id="catBuckets" class="bucket-grid"></div>
    </div>
    <div class="bucket-group">
      <h3 class="bucket-title">Browse by Food Course</h3>
      <div id="courseBuckets" class="bucket-grid"></div>
    </div>
  `;
  menuSection.insertBefore(bucketsWrap, filtersEl || grid);
}

/* ---------- state ---------- */
let ITEMS = [];           // [{id, ...}]
let CATS = new Set();     // category ids
let COURSES = new Set();  // course ids

/* ---------- helpers ---------- */
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
  if (typeof Cart.setQty === "function") {
    Cart.setQty(key, next, { id: found.id, name: found.name, variant: variantKey, price });
  } else {
    Cart.upsert({ key, id: found.id, name: found.name, variant: variantKey, price, qty: next });
  }
  const badge = $(`.qty[data-key="${key}"] .num`);
  if (badge) badge.textContent = String(next);
}

/* ---------- item cards with steppers ---------- */
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
  const tags = [m.category||"", m.foodCourse||"", m.foodType||""].filter(Boolean).join(" • ");
  const addons = Array.isArray(m.addons) && m.addons.length
    ? `<small class="muted">Add-ons: ${m.addons.join(", ")}</small>` : "";
  const steppers = variants.map(v => stepperHTML(m, v)).join("");

  return `
    <article class="menu-item" data-id="${m.id}">
      ${m.imageUrl ? `<img loading="lazy" src="${m.imageUrl}" alt="${m.name||""}"
        class="menu-img"/>` : ""}
      <h4 class="menu-name">${m.name || ""}</h4>
      <p class="menu-desc">${m.description || ""}</p>
      ${addons}
      <div class="row meta">
        <small class="muted">${tags}</small>
      </div>
      <div class="steppers">${steppers}</div>
    </article>
  `;
}

/* ---------- filters ---------- */
const selCat = $("#filter-category");
const selCourse = $("#filter-course");
const selType = $("#filter-type");
const inpSearch = $("#filter-search");

function applyFilters(items) {
  const q = (inpSearch?.value || "").toLowerCase().trim();
  const cat = selCat?.value || "";
  const crs = selCourse?.value || "";
  const typ = selType?.value || "";

  return items.filter((it) => {
    if (cat && it.category !== cat) return false;
    if (crs && it.foodCourse !== crs) return false;
    if (typ && it.foodType !== typ) return false;
    if (q) {
      const hay = [
        it.name, it.description, it.category, it.foodCourse,
        ...(Array.isArray(it.addons) ? it.addons : [])
      ].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ---------- renderers ---------- */
function renderGrid() {
  if (!grid) return;
  const filtered = applyFilters(ITEMS);
  if (!filtered.length) {
    grid.innerHTML = `<div class="menu-item placeholder">No items match your selection.</div>`;
    return;
  }
  grid.innerHTML = filtered.map(itemCardHTML).join("");
}

/* Collages */
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

function renderBuckets() {
  const catEl = $("#catBuckets");
  const courseEl = $("#courseBuckets");
  if (!catEl || !courseEl) return;

  // Gather images by group
  const byCat = new Map(); const byCourse = new Map();
  for (const it of ITEMS) {
    if (it.category) {
      if (!byCat.has(it.category)) byCat.set(it.category, []);
      if (it.imageUrl) byCat.get(it.category).push(it.imageUrl);
    }
    if (it.foodCourse) {
      if (!byCourse.has(it.foodCourse)) byCourse.set(it.foodCourse, []);
      if (it.imageUrl) byCourse.get(it.foodCourse).push(it.imageUrl);
    }
  }

  // Categories
  const cats = Array.from(CATS).sort((a,b)=>a.localeCompare(b));
  catEl.innerHTML = cats.map(name => {
    const imgs = (byCat.get(name) || []).slice(0,4);
    const count = (byCat.get(name) || []).length;
    return `
      <button class="bucket-tile" data-kind="category" data-id="${name}" ${count? "":"disabled"}>
        ${collageHTML(imgs)}
        <div class="bucket-meta">
          <div class="bucket-name">${name}</div>
          <div class="bucket-count">${count} item${count===1?"":"s"}</div>
        </div>
      </button>`;
  }).join("");

  // Courses
  const crs = Array.from(COURSES).sort((a,b)=>a.localeCompare(b));
  courseEl.innerHTML = crs.map(name => {
    const imgs = (byCourse.get(name) || []).slice(0,4);
    const count = (byCourse.get(name) || []).length;
    return `
      <button class="bucket-tile" data-kind="course" data-id="${name}" ${count? "":"disabled"}>
        ${collageHTML(imgs)}
        <div class="bucket-meta">
          <div class="bucket-name">${name}</div>
          <div class="bucket-count">${count} item${count===1?"":"s"}</div>
        </div>
      </button>`;
  }).join("");
}

/* ---------- live data ---------- */
function listenCategories() {
  onSnapshot(collection(db, "menuCategories"), (snap) => {
    const prev = new Set(CATS);
    CATS = new Set();
    snap.forEach(d => CATS.add(d.id));
    // keep filter options in sync
    if (selCat) {
      const selected = selCat.value;
      selCat.innerHTML = `<option value="">All Categories</option>` +
        Array.from(CATS).sort().map(c => `<option>${c}</option>`).join("");
      if (selected && CATS.has(selected)) selCat.value = selected;
      // if selection points to now-missing category, clear it
      if (selected && !CATS.has(selected)) selCat.value = "";
    }
    if (prev.size !== CATS.size) renderBuckets();
  });
}
function listenCourses() {
  onSnapshot(collection(db, "menuCourses"), (snap) => {
    const prev = new Set(COURSES);
    COURSES = new Set();
    snap.forEach(d => COURSES.add(d.id));
    if (selCourse) {
      const selected = selCourse.value;
      selCourse.innerHTML = `<option value="">All Courses</option>` +
        Array.from(COURSES).sort().map(c => `<option>${c}</option>`).join("");
      if (selected && COURSES.has(selected)) selCourse.value = selected;
      if (selected && !COURSES.has(selected)) selCourse.value = "";
    }
    if (prev.size !== COURSES.size) renderBuckets();
  });
}
function listenItems() {
  const baseCol = collection(db, "menuItems");
  const renderFrom = (docs) => {
    ITEMS = docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(v => v.inStock !== false); // show legacy docs too
    renderBuckets();
    renderGrid();
  };
  try {
    const qLive = query(baseCol, orderBy("createdAt","desc"));
    onSnapshot(
      qLive,
      snap => renderFrom(snap.docs),
      () => {
        // fallback: still live without ordering
        onSnapshot(baseCol, snap => renderFrom(snap.docs));
      }
    );
  } catch {
    onSnapshot(baseCol, snap => renderFrom(snap.docs));
  }
}

/* ---------- events ---------- */
// Buckets → set filters and scroll to grid (bind once)
bucketsWrap.addEventListener("click", (e) => {
  const tile = e.target.closest(".bucket-tile");
  if (!tile) return;
  const kind = tile.dataset.kind;
  const val = tile.dataset.id;
  if (kind === "category" && selCat) { selCat.value = val; if (selCourse) selCourse.value=""; }
  if (kind === "course" && selCourse){ selCourse.value = val; if (selCat) selCat.value=""; }
  renderGrid();
  grid.scrollIntoView({ behavior: "smooth", block: "start" });
});

// Filters → re-render (bind once)
[selCat, selCourse, selType, inpSearch].forEach(el => {
  if (!el) return;
  el.addEventListener("input", renderGrid, { passive: true });
  el.addEventListener("change", renderGrid);
});

// Single delegated handler for all item steppers (bind once)
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

    // variant price lookup
    const pm = priceModel(found.qtyType);
    const v = (pm?.variants || []).find(x => x.key === variantKey);
    if (!v || !v.price) return;

    const key = `${id}:${variantKey}`;
    const now = getQty(key);
    const next = Math.max(0, now + (btn.classList.contains("inc") ? 1 : -1));
    setQty(found, variantKey, v.price, next);
  });
}

/* ---------- boot ---------- */
bindGridHandlers();
listenCategories();
listenCourses();
listenItems();
