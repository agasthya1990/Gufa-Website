// customer/app.menu.js — bifurcations (Category / Food Course) + collages + qty steppers
import { db } from "./firebase.client.js";
import {
  collection, onSnapshot, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { Cart } from "./app.cart.js";

/* ---------- tiny dom helpers ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

/* ---------- containers ---------- */
const menuSection = $("#menu");
const grid = $("#menu .menu-grid") || $(".menu-grid");
const filtersEl = $(".filters");
if (!menuSection || !grid) {
  console.error("[menu] Missing #menu or .menu-grid container"); 
}

/* Inject “Browse by …” bifurcations above filters (no HTML edits required) */
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
let ITEMS = [];     // [{id, ...data}]
let CATS  = new Set();   // string ids
let COURSES = new Set(); // string ids

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
  const bag = Cart.get?.() || {};
  return Number(bag[key]?.qty || 0);
}
function setQty(found, variant, price, next) {
  const key = `${found.id}:${variant}`;
  next = Math.max(0, Number(next||0));
  if (typeof Cart.setQty === "function") {
    Cart.setQty(key, next, { id: found.id, name: found.name, variant, price });
  } else {
    // Fallback: upsert with the target qty (most carts interpret qty=0 as remove)
    Cart.upsert({ key, id: found.id, name: found.name, variant, price, qty: next });
  }
  const badge = $(`.qty[data-key="${key}"] .num`);
  if (badge) badge.textContent = String(next);
}

/* ---------- item card renderer with steppers ---------- */
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
        style="width:100%;height:160px;object-fit:cover;border-radius:8px 8px 0 0;margin:-16px -16px 8px"/>` : ""}
      <h4 style="margin:10px 0 4px">${m.name || ""}</h4>
      <p style="margin:0 0 6px">${m.description || ""}</p>
      ${addons}
      <div class="row" style="margin-top:8px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <small class="muted">${tags}</small>
      </div>
      <div class="steppers">${steppers}</div>
    </article>
  `;
}

/* ---------- filters (keep your selects working) ---------- */
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
        it.name, it.description, it.category, it.foodCourse, ...(Array.isArray(it.addons)? it.addons:[])
      ].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ---------- grid + stepper wiring ---------- */
function renderGrid() {
  if (!grid) return;
  const filtered = applyFilters(ITEMS);
  if (!filtered.length) {
    grid.innerHTML = `<div class="menu-item placeholder">No items match your selection.</div>`;
    return;
  }
  grid.innerHTML = filtered.map(itemCardHTML).join("");

  // Stepper handlers (event delegation)
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".inc, .dec");
    if (!btn) return;
    const step = btn.classList.contains("inc") ? +1 : -1;
    const wrap = btn.closest(".stepper");
    const id = wrap?.dataset.item;
    const variant = wrap?.dataset.variant;
    const found = ITEMS.find(x => x.id === id);
    if (!found) return;

    // price lookup from model
    const pm = priceModel(found.qtyType);
    const v = (pm?.variants || []).find(x => x.key === variant);
    if (!v || !v.price) return;

    const key = `${id}:${variant}`;
    const now = getQty(key);
    const next = Math.max(0, now + step);
    setQty(found, variant, v.price, next);
  }, { once: true }); // attach once per render; re-attached next render
}

/* ---------- build collages for buckets ---------- */
function collageHTML(imgs) {
  const a = imgs[0] || "", b = imgs[1] || "", c = imgs[2] || "", d = imgs[3] || "";
  // 2x2 collage (falls back gracefully if fewer than 4)
  return `
    <div class="collage">
      ${a ? `<img loading="lazy" src="${a}" alt="">` : `<div class="ph"></div>`}
      ${b ? `<img loading="lazy" src="${b}" alt="">` : `<div class="ph"></div>`}
      ${c ? `<img loading="lazy" src="${c}" alt="">` : `<div class="ph"></div>`}
      ${d ? `<img loading="lazy" src="${d}" alt="">` : `<div class="ph"></div>`}
    </div>
  `;
}
function renderBuckets() {
  const catEl = $("#catBuckets");
  const courseEl = $("#courseBuckets");
  if (!catEl || !courseEl) return;

  // Group items for quick collage picks
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

  // Categories: show all known, even if zero items (disabled look)
  const catList = Array.from(CATS).sort((a,b)=>a.localeCompare(b));
  catEl.innerHTML = catList.map(name => {
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
  const crsList = Array.from(COURSES).sort((a,b)=>a.localeCompare(b));
  courseEl.innerHTML = crsList.map(name => {
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

  // Click → set filters and scroll to grid
  bucketsWrap.addEventListener("click", (e) => {
    const tile = e.target.closest(".bucket-tile");
    if (!tile) return;
    const kind = tile.dataset.kind;
    const val = tile.dataset.id;
    if (kind === "category" && selCat) { selCat.value = val; if (selCourse) selCourse.value=""; }
    if (kind === "course" && selCourse){ selCourse.value = val; if (selCat) selCat.value=""; }
    renderGrid();
    grid.scrollIntoView({ behavior: "smooth", block: "start" });
  }, { once: true });
}

/* ---------- live data ---------- */
function listenCategories() {
  onSnapshot(collection(db, "menuCategories"), (snap) => {
    CATS = new Set(); snap.forEach(d => CATS.add(d.id));
    // keep the filters select in sync (if present)
    if (selCat) {
      const selected = selCat.value;
      selCat.innerHTML = `<option value="">All Categories</option>` + 
        Array.from(CATS).sort().map(c => `<option>${c}</option>`).join("");
      if (selected && CATS.has(selected)) selCat.value = selected;
    }
    renderBuckets();
  });
}
function listenCourses() {
  onSnapshot(collection(db, "menuCourses"), (snap) => {
    COURSES = new Set(); snap.forEach(d => COURSES.add(d.id));
    if (selCourse) {
      const selected = selCourse.value;
      selCourse.innerHTML = `<option value="">All Courses</option>` + 
        Array.from(COURSES).sort().map(c => `<option>${c}</option>`).join("");
      if (selected && COURSES.has(selected)) selCourse.value = selected;
    }
    renderBuckets();
  });
}
function listenItems() {
  // Show in-stock items; newest first (fallback if index missing: remove orderBy)
  try {
    const qLive = query(collection(db, "menuItems"), orderBy("createdAt","desc"));
    onSnapshot(qLive, (snap) => {
      ITEMS = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderBuckets();
      renderGrid();
    });
  } catch (e) {
    // fallback (no index) — still live on collection without ordering
    onSnapshot(collection(db, "menuItems"), (snap) => {
      const tmp = []; snap.forEach(d => { const v=d.data(); if (v.inStock!==false) tmp.push({ id:d.id, ...v }) });
      ITEMS = tmp; renderBuckets(); renderGrid();
    });
  }
}

/* ---------- filter listeners ---------- */
[selCat, selCourse, selType, inpSearch].forEach(el => {
  el && el.addEventListener("change", renderGrid);
  el && el.addEventListener("input", renderGrid);
});

/* ---------- boot ---------- */
listenCategories();  // auto-creates bifurcations even before items exist
listenCourses();
listenItems();
