// app.menu.js — Fixes: no nested buttons, robust switches, tolerant mapping, safe Firebase boot
import {
  collection, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

/* ---------- DOM ---------- */
// Home (primary) controls
const vegSwitch = $("#vegSwitch");
const nonvegSwitch = $("#nonvegSwitch");
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

/* ---------- State ---------- */
let db = null;               // set after dynamic import
let ITEMS = [];
let COURSES = [];            // [{id, label}]
let CATEGORIES = [];         // [{id, label}]

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
  try {
    const { Cart } = window;
    const bag = typeof Cart?.get === "function" ? Cart.get() : {};
    return Number(bag?.[key]?.qty || 0);
  } catch { return 0; }
}
function setQty(found, variantKey, price, nextQty) {
  const key = `${found.id}:${variantKey}`;
  const next = Math.max(0, Number(nextQty || 0));
  try {
    const { Cart } = window;
    Cart?.setQty?.(key, next, { id: found.id, name: found.name, variant: variantKey, price });
  } catch {}
  const badge = $(`.qty[data-key="${key}"] .num`);
  if (badge) badge.textContent = String(next);
}

function dietSpan(t){
  const raw = (t||"").toLowerCase();
  const v = raw.replace(/\s+/g, "-"); // tolerate "Non Veg", "nonveg", etc
  if (v.startsWith("veg")) return `<span class="diet diet-veg">Veg</span>`;
  if (v.startsWith("non-veg") || v.startsWith("nonveg")) return `<span class="diet diet-nonveg">Non-Veg</span>`;
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
  const v = (it.foodType||"").toLowerCase().replace(/\s+/g,"-");
  if (!vegOn && !nonvegOn) return false;
  if (vegOn && !nonvegOn) return v.startsWith("veg");
  if (!vegOn && nonvegOn) return v.startsWith("non-veg") || v.startsWith("nonveg");
  return true; // both on
}
function applyItemFiltersBase(items){
  return items.filter(it => it.inStock !== false && matchesVeg(it));
}
function courseMatch(it, course){ // accept by id OR label
  return it.foodCourse === course.id || it.foodCourse === course.label;
}
function categoryMatch(it, cat){
  return it.category === cat.id || it.category === cat.label;
}
function applyItemFiltersForOpen(items){
  let arr = applyItemFiltersBase(items);
  if (openKind === "course" && openId) {
    const course = COURSES.find(c => c.id === openId) || {id:openId, label:openId};
    arr = arr.filter(it => courseMatch(it, course));
  }
  if (openKind === "category" && openId) {
    const cat = CATEGORIES.find(c => c.id === openId) || {id:openId, label:openId};
    arr = arr.filter(it => categoryMatch(it, cat));
  }
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

/* ---------- Buckets rendering (Veg/Non-Veg affects images) ---------- */
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
const cssSafe = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "_");

function topbarHTML(){
  // Order: ← Back, Veg switch, Non-Veg switch, Food Course, Food Categories, Search
  return `
    <div class="topbar">
      <button class="back-btn" data-action="back">← Back</button>

      <button class="switch veg ${vegOn ? "on": ""}" role="switch" aria-checked="${vegOn}" data-action="veg">
        <span class="track"></span><span class="knob"></span><span class="label">Veg</span>
      </button>
      <button class="switch nonveg ${nonvegOn ? "on": ""}" role="switch" aria-checked="${nonvegOn}" data-action="nonveg">
        <span class="track"></span><span class="knob"></span><span class="label">Non-Veg</span>
      </button>

      <button class="pill-toggle course nav" data-action="nav-course">Food Course</button>
      <button class="pill-toggle category nav" data-action="nav-category">Food Categories</button>

      <div class="searchbar compact">
        <input type="text" class="tile-search" placeholder="Search dishes…" aria-label="Search dishes"/>
        <button class="searchbtn" data-action="search" aria-label="Search"></button>
      </div>
    </div>`;
}

/* Render buckets; if a tile is open, include panel with list inside
   NOTE: .bucket-tile is now a DIV (no nested button issues) */
function renderCourseBuckets(fade = false) {
  if (!courseBuckets) return;
  const grid = courseBuckets;
  if (fade) grid.classList.add("fade-out");

  const filtered = applyItemFiltersBase(ITEMS);
  grid.innerHTML = COURSES
    .slice().sort((a,b)=>a.label.localeCompare(b.label))
    .map(course => {
      const imgs = filtered.filter(it => courseMatch(it, course) && it.imageUrl).slice(0,4).map(x=>x.imageUrl);
      const active = (mode.startsWith("open") && openKind==="course" && openId===course.id) ? "active tile-open" : "";
      return `
        <div class="bucket-tile ${active}" role="button" tabindex="0" data-kind="course" data-id="${course.id}">
          ${collageHTML(imgs)}
          <span class="bucket-label">${course.label}</span>
          ${active ? `<div class="panel">
            ${topbarHTML()}
            <div class="list-grid" id="tileList-course-${cssSafe(course.id)}"></div>
          </div>` : ``}
        </div>`;
    }).join("");

  if (fade) requestAnimationFrame(() => {
    grid.classList.remove("fade-out");
    grid.classList.add("fade-in");
    setTimeout(()=>grid.classList.remove("fade-in"),260);
  });

  if (mode === "open-course" && openId) renderTileList("course", openId);
}

function renderCategoryBuckets(fade = false) {
  if (!categoryBuckets) return;
  const grid = categoryBuckets;
  if (fade) grid.classList.add("fade-out");

  const filtered = applyItemFiltersBase(ITEMS);
  grid.innerHTML = CATEGORIES
    .slice().sort((a,b)=>a.label.localeCompare(b.label))
    .map(cat => {
      const imgs = filtered.filter(it => categoryMatch(it, cat) && it.imageUrl).slice(0,4).map(x=>x.imageUrl);
      const active = (mode.startsWith("open") && openKind==="category" && openId===cat.id) ? "active tile-open" : "";
      return `
        <div class="bucket-tile ${active}" role="button" tabindex="0" data-kind="category" data-id="${cat.id}">
          ${collageHTML(imgs)}
          <span class="bucket-label">${cat.label}</span>
          ${active ? `<div class="panel">
            ${topbarHTML()}
            <div class="list-grid" id="tileList-category-${cssSafe(cat.id)}"></div>
          </div>` : ``}
        </div>`;
    }).join("");

  if (fade) requestAnimationFrame(() => {
    grid.classList.remove("fade-out");
    grid.classList.add("fade-in");
    setTimeout(()=>grid.classList.remove("fade-in"),260);
  });

  if (mode === "open-category" && openId) renderTileList("category", openId);
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

  renderCourseBuckets();
  renderCategoryBuckets();

  if (kind === "course") coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (kind === "category") categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" });

  renderTileList(kind, id);
}
function closeTileToHome(){
  mode = "home"; openKind = ""; openId = "";
  globalResults.classList.add("hidden");
  renderCourseBuckets();
  renderCategoryBuckets();
  document.getElementById("menuTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function enterSearchMode(q){
  searchQuery = q;
  mode = "search";
  globalResults.classList.remove("hidden");
  document.getElementById("menuTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
  renderGlobalResults();
}
function exitSearchMode(){
  searchQuery = "";
  globalResults.classList.add("hidden");
  closeTileToHome();
}

/* ---------- Live data (start only after Firebase loads) ---------- */
function listenCourses() {
  onSnapshot(collection(db, "menuCourses"), (snap) => {
    const list = [];
    snap.forEach(d => list.push({ id: d.id, label: d.data()?.name || d.id }));
    COURSES = list;
    renderCourseBuckets();
  });
}
function listenCategories() {
  onSnapshot(collection(db, "menuCategories"), (snap) => {
    const list = [];
    snap.forEach(d => list.push({ id: d.id, label: d.data()?.name || d.id }));
    CATEGORIES = list;
    renderCategoryBuckets();
  });
}
function listenItems() {
  const baseCol = collection(db, "menuItems");
  const renderFrom = (docs) => {
    ITEMS = docs.map(d => ({ id: d.id, ...d.data() }));
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
// Guard: ignore clicks inside an open panel’s controls
document.addEventListener("click", (e) => {
  if (e.target.closest(".panel")) {
    // panel has its own handlers below
    return;
  }
  const tile = e.target.closest(".bucket-tile");
  if (!tile) return;
  const kind = tile.dataset.kind;
  const val = tile.dataset.id;
  if (mode === "open-course" && kind==="course" && openId===val) { closeTileToHome(); return; }
  if (mode === "open-category" && kind==="category" && openId===val) { closeTileToHome(); return; }
  openTile(kind, val);
  renderTileList(kind, val);
});

// Delegated actions inside any tile topbar & global search topbar
document.addEventListener("click", (e) => {
  const actBtn = e.target.closest("[data-action]");
  if (!actBtn) return;
  const action = actBtn.getAttribute("data-action");

  if (action === "back") {
    if (mode === "search") exitSearchMode(); else closeTileToHome();
    return;
  }
  if (action === "veg") {
    vegOn = !vegOn;
    // reflect switches
    actBtn.classList.toggle("on", vegOn);
    actBtn.setAttribute("aria-checked", String(vegOn));
    vegSwitch?.classList.toggle("on", vegOn);
    vegSwitch?.setAttribute("aria-checked", String(vegOn));
    renderCourseBuckets(true); renderCategoryBuckets(true);
    if (mode.startsWith("open") && openId) renderTileList(openKind, openId, true);
    if (mode === "search") renderGlobalResults(true);
    return;
  }
  if (action === "nonveg") {
    nonvegOn = !nonvegOn;
    actBtn.classList.toggle("on", nonvegOn);
    actBtn.setAttribute("aria-checked", String(nonvegOn));
    nonvegSwitch?.classList.toggle("on", nonvegOn);
    nonvegSwitch?.setAttribute("aria-checked", String(nonvegOn));
    renderCourseBuckets(true); renderCategoryBuckets(true);
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
    if (searchInputHome) searchInputHome.value = q;
    return;
  }
});

// Home switches (always work, even before Firebase loads)
function updateVegVisual(on){ vegOn = on; vegSwitch?.classList.toggle("on", on); vegSwitch?.setAttribute("aria-checked", String(on)); }
function updateNonVegVisual(on){ nonvegOn = on; nonvegSwitch?.classList.toggle("on", on); nonvegSwitch?.setAttribute("aria-checked", String(on)); }

vegSwitch?.addEventListener("click", () => {
  updateVegVisual(!vegOn);
  fadeBucketsAnd(() => { renderCourseBuckets(); renderCategoryBuckets(); if (mode==="open-course"&&openId) renderTileList("course",openId); if (mode==="open-category"&&openId) renderTileList("category",openId); if (mode==="search") renderGlobalResults(); });
});
nonvegSwitch?.addEventListener("click", () => {
  updateNonVegVisual(!nonvegOn);
  fadeBucketsAnd(() => { renderCourseBuckets(); renderCategoryBuckets(); if (mode==="open-course"&&openId) renderTileList("course",openId); if (mode==="open-category"&&openId) renderTileList("category",openId); if (mode==="search") renderGlobalResults(); });
});

// Nav chips (home bar) — smooth scroll only
courseToggle?.addEventListener("click", () => { coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); });
categoryToggle?.addEventListener("click", () => { categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); });

// Steppers (delegated)
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

/* ---------- Boot ---------- */
// 1) Bind UI immediately
updateVegVisual(vegOn);
updateNonVegVisual(nonvegOn);

// 2) Load Firebase lazily; start listeners only when ready
(async () => {
  try {
    const mod = await import("./firebase.client.js");
    db = mod?.db || null;
  } catch (e) {
    console.error("Firebase init failed:", e);
  }
  if (!db) return; // UI still usable (switches animate), data won’t load without db

  listenCourses();
  listenCategories();
  listenItems();
})();
