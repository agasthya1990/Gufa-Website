// app.menu.js — Course collages + Veg/Non-Veg toggles (both can be OFF) + live Firestore
import { db } from "./firebase.client.js";
import { Cart } from "./app.cart.js";
import {
  collection, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

/* ---------- DOM ---------- */
const menuSection = $("#menu");
const grid = $("#menu .menu-grid") || $(".menu-grid");
const filtersEl = $(".filters");
const courseBuckets = $("#courseBuckets");
if (!menuSection || !grid) console.error("[menu] Missing #menu or .menu-grid");

const vegBtn = $("#vegToggle");
const nonvegBtn = $("#nonvegToggle");

/* ---------- State ---------- */
let ITEMS = [];               // menu items
let COURSES = new Set();      // menuCourses doc.id values
let vegOn = true;             // both can be toggled freely; both OFF = show none
let nonvegOn = true;

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

  return `
    <article class="menu-item" data-id="${m.id}">
      ${m.imageUrl ? `<img loading="lazy" src="${m.imageUrl}" alt="${m.name||""}" class="menu-img"/>` : ""}
      <h4 class="menu-name">${m.name || ""}</h4>
      <p class="menu-desc">${m.description || ""}</p>
      ${addons}
      <div class="row meta"><small class="muted">${tags}</small></div>
      <div class="steppers">${steppers}</div>
    </article>
  `;
}

/* ---------- Filters (kept) ---------- */
const selCat = $("#filter-category");
const selCourse = $("#filter-course");
const selType = $("#filter-type");
const inpSearch = $("#filter-search");

/* Sync select based on toggles (includes both-OFF -> __none) */
function syncSelectFromToggles() {
  if (!selType) return;
  if (vegOn && nonvegOn) { selType.value = ""; return; }
  if (vegOn && !nonvegOn) { selType.value = "Veg"; return; }
  if (!vegOn && nonvegOn) { selType.value = "Non-Veg"; return; }
  // Both OFF → use hidden sentinel
  selType.value = "__none";
}
/* Sync toggles based on select */
function syncTogglesFromSelect() {
  const v = selType?.value || "";
  if (v === "") { vegOn = true; nonvegOn = true; }
  else if (v === "Veg") { vegOn = true; nonvegOn = false; }
  else if (v === "Non-Veg") { vegOn = false; nonvegOn = true; }
  else if (v === "__none") { vegOn = false; nonvegOn = false; }
  vegBtn?.classList.toggle("on", vegOn);
  nonvegBtn?.classList.toggle("on", nonvegOn);
  vegBtn?.setAttribute("aria-pressed", String(vegOn));
  nonvegBtn?.setAttribute("aria-pressed", String(nonvegOn));
}

function applyFilters(items) {
  const q = (inpSearch?.value || "").toLowerCase().trim();
  const crs = selCourse?.value || "";
  const cat = selCat?.value || "";

  return items.filter((it) => {
    if (crs && it.foodCourse !== crs) return false;
    if (cat && it.category !== cat) return false;

    // Primary type filter via toggles
    const t = (it.foodType || "").toLowerCase(); // "veg" | "non-veg"
    if (!vegOn && !nonvegOn) return false; // both OFF => show none
    if (vegOn && !nonvegOn && t !== "veg") return false;
    if (!vegOn && nonvegOn && t !== "non-veg") return false;

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

/* Course tiles (auto-collages) */
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
    if (it.foodCourse) {
      if (!byCourse.has(it.foodCourse)) byCourse.set(it.foodCourse, []);
      if (it.imageUrl) byCourse.get(it.foodCourse).push(it.imageUrl);
    }
  }

  const crs = Array.from(COURSES).sort((a,b)=>a.localeCompare(b));
  courseBuckets.innerHTML = crs.map(name => {
    const imgs = (byCourse.get(name) || []).slice(0,4);
    const count = (byCourse.get(name) || []).length;
    const disabled = count ? "" : "aria-disabled='true'";
    return `
      <button class="bucket-tile" data-kind="course" data-id="${name}" ${disabled}>
        ${collageHTML(imgs)}
        <span class="bucket-label">${name}</span>
      </button>`;
  }).join("");
}

/* ---------- Live data ---------- */
function listenCourses() {
  onSnapshot(collection(db, "menuCourses"), (snap) => {
    COURSES = new Set();
    snap.forEach(d => COURSES.add(d.id)); // match Admin doc.id
    // keep dropdown in sync (kept for users who prefer it)
    if (selCourse) {
      const selected = selCourse.value;
      selCourse.innerHTML = `<option value="">All Courses</option>` +
        Array.from(COURSES).sort().map(c => `<option>${c}</option>`).join("");
      if (selected && COURSES.has(selected)) selCourse.value = selected;
      if (selected && !COURSES.has(selected)) selCourse.value = "";
    }
    renderCourseBuckets();
  });
}
function listenItems() {
  const baseCol = collection(db, "menuItems");
  const renderFrom = (docs) => {
    ITEMS = docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(v => v.inStock !== false); // legacy items show unless explicitly false
    renderCourseBuckets();
    renderGrid();
  };
  try {
    const qLive = query(baseCol, orderBy("createdAt","desc"));
    onSnapshot(
      qLive,
      snap => renderFrom(snap.docs),
      () => onSnapshot(baseCol, snap => renderFrom(snap.docs)) // fallback (no index)
    );
  } catch {
    onSnapshot(baseCol, snap => renderFrom(snap.docs));
  }
}

/* ---------- Events ---------- */
// Tile click → set course filter and scroll to grid
document.addEventListener("click", (e) => {
  const tile = e.target.closest(".bucket-tile");
  if (!tile || tile.getAttribute("aria-disabled")==="true") return;
  if (tile.dataset.kind !== "course") return;
  const val = tile.dataset.id;
  if (selCourse) selCourse.value = val;
  renderGrid();
  grid.scrollIntoView({ behavior: "smooth", block: "start" });
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

// Primary toggles — both can be OFF (no auto re-enable)
vegBtn?.addEventListener("click", () => {
  vegOn = !vegOn;
  vegBtn.classList.toggle("on", vegOn);
  vegBtn.setAttribute("aria-pressed", String(vegOn));
  syncSelectFromToggles();
  renderGrid();
});
nonvegBtn?.addEventListener("click", () => {
  nonvegOn = !nonvegOn;
  nonvegBtn.classList.toggle("on", nonvegOn);
  nonvegBtn.setAttribute("aria-pressed", String(nonvegOn));
  syncSelectFromToggles();
  renderGrid();
});

// Keep legacy select in sync if user uses it
selType?.addEventListener("change", () => { syncTogglesFromSelect(); renderGrid(); });

// Other filters/search
[selCourse, selCat, inpSearch].forEach(el => {
  el && el.addEventListener("input", renderGrid);
  el && el.addEventListener("change", renderGrid);
});

/* ---------- Boot ---------- */
bindGridHandlers();
listenCourses();
listenItems();
syncTogglesFromSelect();  // init toggle UI from current select state
