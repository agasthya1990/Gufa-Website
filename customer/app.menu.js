// app.menu.js — Swiggy/Zomato-style switches (opt-in), single-image tiles, latest image per group,
// strict in-bounds lists, smooth fades, global search, robust matching
import { db } from "./firebase.client.js";
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
let ITEMS = [];
let COURSES = [];            // [{id, label}]
let CATEGORIES = [];         // [{id, label}]

let vegOn = false;           // both OFF by default (opt-in)
let nonvegOn = false;

let mode = "home";           // 'home' | 'open-course' | 'open-category' | 'search'
let openKind = "";           // 'course' | 'category'
let openId = "";             // selected course/category id
let searchQuery = "";        // global search query

/* ---------- Utils ---------- */
const cssSafe = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
const normDiet = (t="") => t.toLowerCase().replace(/\s+/g,"-"); // "non veg" -> "non-veg"
function tsToMs(v){
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000 + (v.nanoseconds||0)/1e6;
  // string or unknown
  const d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/* ---------- Price & Cart helpers ---------- */
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
  try { return Number(window?.Cart?.get?.()?.[key]?.qty || 0); } catch { return 0; }
}
function setQty(found, variantKey, price, nextQty) {
  const key = `${found.id}:${variantKey}`;
  const next = Math.max(0, Number(nextQty || 0));
  try { window?.Cart?.setQty?.(key, next, { id: found.id, name: found.name, variant: variantKey, price }); } catch {}
  const badge = $(`.qty[data-key="${key}"] .num`);
  if (badge) badge.textContent = String(next);
}

/* ---------- Cards ---------- */
function dietSpan(t){
  const v = normDiet(t);
  if (v.startsWith("veg")) return `<span class="diet diet-veg">Veg</span>`;
  if (v.startsWith("non-veg") || v.startsWith("nonveg")) return `<span class="diet diet-nonveg">Non-Veg</span>`;
  return "";
}
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

/* ---------- Filtering (opt-in logic like Swiggy/Zomato) ---------- */
function matchesDiet(it){
  const t = normDiet(it.foodType || "");
  if (vegOn && !nonvegOn) return t.startsWith("veg");
  if (!vegOn && nonvegOn) return t.startsWith("non-veg") || t.startsWith("nonveg");
  // both ON or both OFF -> all items
  return true;
}
function applyItemFiltersBase(items){
  return items.filter(it => it.inStock !== false && matchesDiet(it));
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

/* ---------- Tiles (single-image) ---------- */
function latestImageForGroup(items){
  if (!items.length) return "";
  // prefer updatedAt, fallback to createdAt
  const withTs = items.map(i => ({ ...i, _ts: Math.max(tsToMs(i.updatedAt), tsToMs(i.createdAt)) }));
  withTs.sort((a,b)=> b._ts - a._ts);
  const hit = withTs.find(x => x.imageUrl);
  return hit?.imageUrl || "";
}
function tileHTML(kind, id, label, imgsCount, imgUrl, active){
  const act = active ? "active tile-open" : "";
  const safe = cssSafe(id);
  const listId = `tileList-${kind}-${safe}`;
  return `
    <div class="bucket-tile ${act}" role="button" tabindex="0" data-kind="${kind}" data-id="${id}">
      <div class="tile-img">${imgUrl ? `<img loading="lazy" src="${imgUrl}" alt="${label}">` : ""}</div>
      <span class="bucket-label">${label}</span>
      <span class="count-badge">${imgsCount}</span>
      ${active ? `
        <div class="panel">
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
          </div>
          <div class="list-grid" id="${listId}"></div>
        </div>` : ``}
    </div>
  `;
}

/* ---------- Render buckets ---------- */
function renderCourseBuckets(fade = false) {
  if (!courseBuckets) return;
  const grid = courseBuckets;
  if (fade) grid.classList.add("fade-out");

  const filtered = applyItemFiltersBase(ITEMS);
  const html = COURSES
    .slice().sort((a,b)=>a.label.localeCompare(b.label))
    .map(course => {
      const itemsIn = filtered.filter(it => courseMatch(it, course));
      const imgUrl = latestImageForGroup(itemsIn);
      const active = (mode.startsWith("open") && openKind==="course" && openId===course.id);
      return tileHTML("course", course.id, course.label, itemsIn.length, imgUrl, active);
    }).join("");
  grid.innerHTML = html;

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
  const html = CATEGORIES
    .slice().sort((a,b)=>a.label.localeCompare(b.label))
    .map(cat => {
      const itemsIn = filtered.filter(it => categoryMatch(it, cat));
      const imgUrl = latestImageForGroup(itemsIn);
      const active = (mode.startsWith("open") && openKind==="category" && openId===cat.id);
      return tileHTML("category", cat.id, cat.label, itemsIn.length, imgUrl, active);
    }).join("");
  grid.innerHTML = html;

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

/* ---------- Live data ---------- */
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

/* ---------- Switch syncing ---------- */
function syncHomeSwitches(){
  vegSwitch?.classList.toggle("on", vegOn);
  vegSwitch?.setAttribute("aria-checked", String(vegOn));
  nonvegSwitch?.classList.toggle("on", nonvegOn);
  nonvegSwitch?.setAttribute("aria-checked", String(nonvegOn));
}
function syncAllTopbarSwitches(){
  $$(".topbar [data-action='veg']").forEach(b=>{
    b.classList.toggle("on", vegOn);
    b.setAttribute("aria-checked", String(vegOn));
  });
  $$(".topbar [data-action='nonveg']").forEach(b=>{
    b.classList.toggle("on", nonvegOn);
    b.setAttribute("aria-checked", String(nonvegOn));
  });
}

/* ---------- Event wiring ---------- */
// Guard: clicks inside panel controls should not re-trigger tile open/close
document.addEventListener("click", (e) => {
  if (e.target.closest(".panel")) return;
  const tile = e.target.closest(".bucket-tile");
  if (!tile) return;
  const kind = tile.dataset.kind;
  const val = tile.dataset.id;
  if (mode === "open-course" && kind==="course" && openId===val) { closeTileToHome(); return; }
  if (mode === "open-category" && kind==="category" && openId===val) { closeTileToHome(); return; }
  openTile(kind, val);
});

// Delegated actions inside any tile topbar & global search topbar
document.addEventListener("click", (e) => {
  const actBtn = e.target.closest("[data-action]");
  if (!actBtn) return;
  const action = actBtn.getAttribute("data-action");

  if (action === "back") { if (mode === "search") exitSearchMode(); else closeTileToHome(); return; }

  if (action === "veg") {
    vegOn = !vegOn; syncHomeSwitches(); syncAllTopbarSwitches();
    renderCourseBuckets(true); renderCategoryBuckets(true);
    if (mode.startsWith("open") && openId) renderTileList(openKind, openId, true);
    if (mode === "search") renderGlobalResults(true);
    return;
  }
  if (action === "nonveg") {
    nonvegOn = !nonvegOn; syncHomeSwitches(); syncAllTopbarSwitches();
    renderCourseBuckets(true); renderCategoryBuckets(true);
    if (mode.startsWith("open") && openId) renderTileList(openKind, openId, true);
    if (mode === "search") renderGlobalResults(true);
    return;
  }
  if (action === "nav-course") { coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (action === "nav-category") { categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (action === "search") {
    const wrap = actBtn.closest(".topbar");
    const field = wrap?.querySelector(".tile-search");
    const q = (field?.value || "").trim();
    enterSearchMode(q);
    if (searchInputHome) searchInputHome.value = q;
    return;
  }
});

// Home switches (opt-in)
vegSwitch?.addEventListener("click", () => {
  vegOn = !vegOn; syncHomeSwitches(); syncAllTopbarSwitches();
  fadeBucketsAnd(() => {
    renderCourseBuckets();
    renderCategoryBuckets();
    if (mode === "open-course" && openId) renderTileList("course", openId);
    if (mode === "open-category" && openId) renderTileList("category", openId);
    if (mode === "search") renderGlobalResults();
  });
});
nonvegSwitch?.addEventListener("click", () => {
  nonvegOn = !nonvegOn; syncHomeSwitches(); syncAllTopbarSwitches();
  fadeBucketsAnd(() => {
    renderCourseBuckets();
    renderCategoryBuckets();
    if (mode === "open-course" && openId) renderTileList("course", openId);
    if (mode === "open-category" && openId) renderTileList("category", openId);
    if (mode === "search") renderGlobalResults();
  });
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

/* ---------- Live data ---------- */
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

/* ---------- Boot ---------- */
syncHomeSwitches(); // reflect defaults (both off)
listenCourses();
listenCategories();
listenItems();
