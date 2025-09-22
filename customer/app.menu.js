// app.menu.js — Collage-driven lists, strict scoping, fade transitions, global search, Veg/Non-Veg colored text
import { db } from "./firebase.client.js";
import { Cart } from "./app.cart.js";
import {
  collection, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

/* ---------- DOM ---------- */
// Home (primary) controls
const vegBtn = $("#vegToggle");
const nonvegBtn = $("#nonvegToggle");
const courseToggle = $("#courseToggle");
const categoryToggle = $("#categoryToggle");
const searchInputHome = $("#filter-search");
const searchBtnHome = $("#searchBtn");

// Buckets
const coursesSection = $("#coursesSection");
const categoriesSection = $("#categoriesSection");
const courseBuckets = $("#courseBuckets");
const categoryBuckets = $("#categoryBuckets");

// Global search view
const globalResults = $("#globalResults");
const globalList = $("#globalResultsList");
const backFromSearch = $("#backFromSearch");
const vegToggleSearch = $("#vegToggleSearch");
const nonvegToggleSearch = $("#nonvegToggleSearch");
const courseNavSearch = $("#courseNavSearch");
const categoryNavSearch = $("#categoryNavSearch");
const searchInputSearchView = $("#filter-search-searchView");
const searchBtnSearchView = $("#searchBtnSearchView");

/* ---------- State ---------- */
let ITEMS = [];
let COURSES = new Set();     // menuCourses IDs
let CATEGORIES = new Set();  // menuCategories IDs

let vegOn = true;
let nonvegOn = true;

let mode = "home";           // 'home' | 'open-course' | 'open-category' | 'search'
let openKind = "";           // 'course' | 'category'
let openId = "";             // selected course/category id
let searchQuery = "";        // global search query

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

function dietSpan(t){
  const v = (t||"").toLowerCase();
  if (v === "veg") return `<span class="diet diet-veg">Veg</span>`;
  if (v === "non-veg") return `<span class="diet diet-nonveg">Non-Veg</span>`;
  return "";
}

/* ---------- Cards ---------- */
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
  const tagsLeft = [m.foodCourse||"", m.category||""].filter(Boolean).join(" • ");
  const diet = dietSpan(m.foodType);
  const addons = Array.isArray(m.addons) && m.addons.length
    ? `<small class="muted">Add-ons: ${m.addons.join(", ")}</small>` : "";
  const steppers = variants.map(v => stepperHTML(m, v)).join("");

  return `
    <article class="menu-item" data-id="${m.id}">
      ${m.imageUrl ? `<img loading="lazy" src="${m.imageUrl}" alt="${m.name||""}" class="menu-img"/>` : ""}
      <h4 class="menu-name">${m.name || ""}</h4>
      <p class="menu-desc">${m.description || ""}</p>
      ${addons}
      <div class="row meta">
        <small class="muted">${tagsLeft}</small>
        ${diet}
      </div>
      <div class="steppers">${steppers}</div>
    </article>
  `;
}

/* ---------- Filtering ---------- */
function matchesVeg(it){
  const t = (it.foodType||"").toLowerCase();
  if (!vegOn && !nonvegOn) return false;
  if (vegOn && !nonvegOn) return t === "veg";
  if (!vegOn && nonvegOn) return t === "non-veg";
  return true; // both on
}
function applyItemFiltersBase(items){
  return items.filter(it => it.inStock !== false && matchesVeg(it));
}
function applyItemFiltersForOpen(items){
  let arr = applyItemFiltersBase(items);
  if (openKind === "course" && openId) arr = arr.filter(it => it.foodCourse === openId);
  if (openKind === "category" && openId) arr = arr.filter(it => it.category === openId);
  return arr;
}
function applyItemFiltersForSearch(items){
  const q = (searchQuery||"").toLowerCase().trim();
  let arr = applyItemFiltersBase(items);
  if (q) {
    arr = arr.filter(it => {
      const hay = [
        it.name, it.description, it.foodCourse, it.category,
        ...(Array.isArray(it.addons) ? it.addons : [])
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }
  return arr;
}

/* ---------- Buckets rendering (apply Veg/Non-Veg to images & counts) ---------- */
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

function renderCourseBuckets(fade = false) {
  if (!courseBuckets) return;
  const grid = courseBuckets;
  if (fade) grid.classList.add("fade-out");

  const filtered = applyItemFiltersBase(ITEMS);
  const byCourse = new Map();
  for (const it of filtered) {
    if (!it.foodCourse) continue;
    if (!byCourse.has(it.foodCourse)) byCourse.set(it.foodCourse, []);
    if (it.imageUrl) byCourse.get(it.foodCourse).push(it.imageUrl);
  }
  const crs = Array.from(COURSES).sort((a,b)=>a.localeCompare(b));
  grid.innerHTML = crs.map(name => {
    const imgs = (byCourse.get(name) || []).slice(0,4);
    const active = (mode.startsWith("open") && openKind==="course" && openId===name) ? "active" : "";
    return `
      <button class="bucket-tile ${active}" data-kind="course" data-id="${name}">
        ${collageHTML(imgs)}
        <span class="bucket-label">${name}</span>
        ${active ? `<div class="panel">
          ${topbarHTML()}
          <div class="list-grid" id="tileList-course-${cssSafe(name)}"></div>
        </div>` : ``}
      </button>`;
  }).join("");

  if (fade) requestAnimationFrame(() => {
    grid.classList.remove("fade-out");
    grid.classList.add("fade-in");
    setTimeout(()=>grid.classList.remove("fade-in"),260);
  });

  // If a course is open, render its list inside the tile
  if (mode === "open-course" && openId) {
    renderTileList("course", openId);
  }
}

function renderCategoryBuckets(fade = false) {
  if (!categoryBuckets) return;
  const grid = categoryBuckets;
  if (fade) grid.classList.add("fade-out");

  const filtered = applyItemFiltersBase(ITEMS);
  const byCat = new Map();
  for (const it of filtered) {
    if (!it.category) continue;
    if (!byCat.has(it.category)) byCat.set(it.category, []);
    if (it.imageUrl) byCat.get(it.category).push(it.imageUrl);
  }
  const cats = Array.from(CATEGORIES).sort((a,b)=>a.localeCompare(b));
  grid.innerHTML = cats.map(name => {
    const imgs = (byCat.get(name) || []).slice(0,4);
    const active = (mode.startsWith("open") && openKind==="category" && openId===name) ? "active" : "";
    return `
      <button class="bucket-tile ${active}" data-kind="category" data-id="${name}">
        ${collageHTML(imgs)}
        <span class="bucket-label">${name}</span>
        ${active ? `<div class="panel">
          ${topbarHTML()}
          <div class="list-grid" id="tileList-category-${cssSafe(name)}"></div>
        </div>` : ``}
      </button>`;
  }).join("");

  if (fade) requestAnimationFrame(() => {
    grid.classList.remove("fade-out");
    grid.classList.add("fade-in");
    setTimeout(()=>grid.classList.remove("fade-in"),260);
  });

  // If a category is open, render its list inside the tile
  if (mode === "open-category" && openId) {
    renderTileList("category", openId);
  }
}

function cssSafe(s){ return String(s).replace(/[^a-zA-Z0-9_-]/g, "_"); }

/* ---------- Topbar (inside opened tile and in global search) ---------- */
function topbarHTML(){
  return `
    <div class="topbar">
      <button class="back-btn" data-action="back">← Back</button>
      <button class="pill-toggle veg ${vegOn ? "on": ""}" data-action="veg">Veg</button>
      <button class="pill-toggle nonveg ${nonvegOn ? "on": ""}" data-action="nonveg">Non-Veg</button>
      <button class="pill-toggle course nav" data-action="nav-course">Food Course</button>
      <button class="pill-toggle category nav" data-action="nav-category">Food Categories</button>
      <div class="searchbar compact">
        <input type="text" class="tile-search" placeholder="Search dishes…" aria-label="Search dishes"/>
        <button class="searchbtn" data-action="search"></button>
      </div>
    </div>`;
}

/* ---------- Lists (inside tiles & global search) ---------- */
function renderTileList(kind, id, fade = false){
  const listId = `tileList-${kind}-${cssSafe(id)}`;
  const list = document.getElementById(listId);
  if (!list) return;
  if (fade) list.classList.add("fade-out");

  openKind = kind; openId = id;
  const items = applyItemFiltersForOpen(ITEMS);
  list.innerHTML = items.length
    ? items.map(itemCardHTML).join("")
    : `<div class="menu-item placeholder">No items match your selection.</div>`;

  if (fade) requestAnimationFrame(() => {
    list.classList.remove("fade-out");
    list.classList.add("fade-in");
    setTimeout(()=>list.classList.remove("fade-in"),260);
  });
}

function renderGlobalResults(fade = false){
  if (fade) globalList.classList.add("fade-out");
  const items = applyItemFiltersForSearch(ITEMS);
  globalList.innerHTML = items.length
    ? items.map(itemCardHTML).join("")
    : `<div class="menu-item placeholder">No items match your selection.</div>`;

  if (fade) requestAnimationFrame(() => {
    globalList.classList.remove("fade-out");
    globalList.classList.add("fade-in");
    setTimeout(()=>globalList.classList.remove("fade-in"),260);
  });
}

/* ---------- Mode switches ---------- */
function openTile(kind, id){
  mode = kind === "course" ? "open-course" : "open-category";
  openKind = kind; openId = id;

  // Close any other open state by re-rendering both sections
  renderCourseBuckets();
  renderCategoryBuckets();

  // Ensure the relevant section scrolls into view
  if (kind === "course") coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (kind === "category") categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" });

  // After DOM is ready, render list inside tile
  renderTileList(kind, id);
}

function closeTileToHome(){
  mode = "home"; openKind = ""; openId = "";
  // Hide global search if visible
  globalResults.classList.add("hidden");
  // Repaint collages (no active tiles)
  renderCourseBuckets();
  renderCategoryBuckets();
  // Scroll back to top of Menu
  document.getElementById("menuTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function enterSearchMode(q){
  searchQuery = q;
  mode = "search";
  globalResults.classList.remove("hidden");
  // Hide bifurcations visually by scrolling to results; buckets remain in DOM but out of view
  document.getElementById("menuTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
  renderGlobalResults();
}

function exitSearchMode(){
  searchQuery = "";
  globalResults.classList.add("hidden");
  closeTileToHome();
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
    // Rebuild UI per mode
    if (mode === "home") {
      renderCourseBuckets();
      renderCategoryBuckets();
    } else if (mode === "open-course" || mode === "open-category") {
      renderCourseBuckets();
      renderCategoryBuckets();
    } else if (mode === "search") {
      renderGlobalResults();
    }
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

/* ---------- Anim utilities ---------- */
function fadeBucketsAnd(fn){
  courseBuckets.classList.add("fade-out");
  categoryBuckets.classList.add("fade-out");
  setTimeout(() => {
    fn();
    courseBuckets.classList.remove("fade-out");
    categoryBuckets.classList.remove("fade-out");
    courseBuckets.classList.add("fade-in");
    categoryBuckets.classList.add("fade-in");
    setTimeout(()=>{ courseBuckets.classList.remove("fade-in"); categoryBuckets.classList.remove("fade-in"); }, 260);
  }, 180);
}

/* ---------- Event wiring ---------- */
// Home toggles → filter collages (and open lists) with fade
vegBtn?.addEventListener("click", () => {
  vegOn = !vegOn;
  vegBtn.classList.toggle("on", vegOn);
  fadeBucketsAnd(() => {
    renderCourseBuckets();
    renderCategoryBuckets();
    if (mode === "open-course" && openId) renderTileList("course", openId);
    if (mode === "open-category" && openId) renderTileList("category", openId);
    if (mode === "search") renderGlobalResults();
  });
});
nonvegBtn?.addEventListener("click", () => {
  nonvegOn = !nonvegOn;
  nonvegBtn.classList.toggle("on", nonvegOn);
  fadeBucketsAnd(() => {
    renderCourseBuckets();
    renderCategoryBuckets();
    if (mode === "open-course" && openId) renderTileList("course", openId);
    if (mode === "open-category" && openId) renderTileList("category", openId);
    if (mode === "search") renderGlobalResults();
  });
});

// Nav chips (home bar) — smooth scroll only
courseToggle?.addEventListener("click", () => {
  coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" });
});
categoryToggle?.addEventListener("click", () => {
  categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" });
});

// Collage clicks → open list inside that collage
document.addEventListener("click", (e) => {
  const tile = e.target.closest(".bucket-tile");
  if (!tile) return;
  const kind = tile.dataset.kind;
  const val = tile.dataset.id;
  // Toggle open/close
  if (mode === "open-course" && kind==="course" && openId===val) { closeTileToHome(); return; }
  if (mode === "open-category" && kind==="category" && openId===val) { closeTileToHome(); return; }
  openTile(kind, val);
  // After opening, ensure list is rendered
  renderTileList(kind, val);
  // Attach delegated handlers for that tile's topbar actions
});

// Delegated actions inside any tile topbar
document.addEventListener("click", (e) => {
  const actBtn = e.target.closest("[data-action]");
  if (!actBtn) return;
  const action = actBtn.getAttribute("data-action");

  if (action === "back") {
    closeTileToHome();
    return;
  }
  if (action === "veg") {
    vegOn = !vegOn;
    // reflect on both home & tile buttons
    vegBtn?.classList.toggle("on", vegOn);
    actBtn.classList.toggle("on", vegOn);
    renderCourseBuckets(true);
    renderCategoryBuckets(true);
    if (mode.startsWith("open") && openId) renderTileList(openKind, openId, true);
    if (mode === "search") renderGlobalResults(true);
    return;
  }
  if (action === "nonveg") {
    nonvegOn = !nonvegOn;
    nonvegBtn?.classList.toggle("on", nonvegOn);
    actBtn.classList.toggle("on", nonvegOn);
    renderCourseBuckets(true);
    renderCategoryBuckets(true);
    if (mode.startsWith("open") && openId) renderTileList(openKind, openId, true);
    if (mode === "search") renderGlobalResults(true);
    return;
  }
  if (action === "nav-course") {
    coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (action === "nav-category") {
    categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (action === "search") {
    const wrap = actBtn.closest(".topbar");
    const field = wrap?.querySelector(".tile-search");
    const q = (field?.value || "").trim();
    enterSearchMode(q);
    // Sync both search inputs
    if (searchInputHome) searchInputHome.value = q;
    if (searchInputSearchView) searchInputSearchView.value = q;
    return;
  }
});

// Tile search enter key
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const field = e.target.closest(".tile-search");
  if (field) {
    const q = field.value.trim();
    enterSearchMode(q);
    if (searchInputHome) searchInputHome.value = q;
    if (searchInputSearchView) searchInputSearchView.value = q;
  }
});

// Home search
searchBtnHome?.addEventListener("click", () => {
  const q = (searchInputHome?.value || "").trim();
  enterSearchMode(q);
  if (searchInputSearchView) searchInputSearchView.value = q;
});
searchInputHome?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const q = (searchInputHome?.value || "").trim();
    enterSearchMode(q);
    if (searchInputSearchView) searchInputSearchView.value = q;
  }
});

// Search view controls
backFromSearch?.addEventListener("click", () => exitSearchMode());
vegToggleSearch?.addEventListener("click", () => {
  vegOn = !vegOn;
  vegBtn?.classList.toggle("on", vegOn); vegToggleSearch.classList.toggle("on", vegOn);
  renderGlobalResults(true);
  renderCourseBuckets(true); renderCategoryBuckets(true);
});
nonvegToggleSearch?.addEventListener("click", () => {
  nonvegOn = !nonvegOn;
  nonvegBtn?.classList.toggle("on", nonvegOn); nonvegToggleSearch.classList.toggle("on", nonvegOn);
  renderGlobalResults(true);
  renderCourseBuckets(true); renderCategoryBuckets(true);
});
courseNavSearch?.addEventListener("click", () => {
  exitSearchMode();
  coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" });
});
categoryNavSearch?.addEventListener("click", () => {
  exitSearchMode();
  categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" });
});
searchBtnSearchView?.addEventListener("click", () => {
  const q = (searchInputSearchView?.value || "").trim();
  searchQuery = q; renderGlobalResults(true);
});
searchInputSearchView?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const q = (searchInputSearchView?.value || "").trim();
    searchQuery = q; renderGlobalResults(true);
  }
});

// Steppers (delegated)
let gridHandlerBound = false;
function bindStepperHandlers() {
  if (gridHandlerBound) return;
  gridHandlerBound = true;
  document.addEventListener("click", (e) => {
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

/* ---------- Boot ---------- */
bindStepperHandlers();
listenCourses();
listenCategories();
listenItems();
