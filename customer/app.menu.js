// app.menu.js — Home bar hides in list/search, shows in home.
//  • Home view: two bifurcation grids (Food Course / Food Categories) with single-image tiles
//  • Click a tile => full-page LIST view with its own top bar; home bar hidden
//  • Back returns to grids; home bar shown again
//  • Veg/Non-Veg switches are opt-in (both OFF => all), latest image per group, smooth fades
import { db } from "./firebase.client.js";
import {
  collection, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

/* ---------- DOM ---------- */
const vegSwitch = $("#vegSwitch");
const nonvegSwitch = $("#nonvegSwitch");
const courseToggle = $("#courseToggle");
const categoryToggle = $("#categoryToggle");
const searchInputHome = $("#filter-search");
const searchBtnHome = $("#searchBtn");

const primaryBar = $("#menu .primary-bar");      // << NEW: home bar wrapper
const coursesSection = $("#coursesSection");
const categoriesSection = $("#categoriesSection");
const courseBuckets = $("#courseBuckets");
const categoryBuckets = $("#categoryBuckets");

const globalResults = $("#globalResults"); // used as our full-page "content view"
let globalList = $("#globalResultsList");  // recreated per mode to ensure clean markup

/* ---------- State ---------- */
let ITEMS = [];
let COURSES = [];    // [{id, label}]
let CATEGORIES = []; // [{id, label}]

let vegOn = false;     // opt-in filters: both OFF by default
let nonvegOn = false;

let view = "home";     // 'home' | 'list' | 'search'
let listKind = "";     // 'course' | 'category'
let listId = "";       // selected id
let listLabel = "";    // label for UI
let searchQuery = "";  // global search text

/* ---------- Utils ---------- */
const cssSafe = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
const normDiet = (t="") => t.toLowerCase().replace(/\s+/g,"-");
const tsToMs = (v) => {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000 + (v.nanoseconds||0)/1e6;
  const d = new Date(v); return isNaN(d.getTime()) ? 0 : d.getTime();
};

/* ---------- Price & Cart ---------- */
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

/* ---------- Filtering ---------- */
function matchesDiet(it){
  const t = normDiet(it.foodType || "");
  if (vegOn && !nonvegOn) return t.startsWith("veg");
  if (!vegOn && nonvegOn) return t.startsWith("non-veg") || t.startsWith("nonveg");
  // both ON or both OFF -> all items
  return true;
}
const baseFilter = items => items.filter(it => it.inStock !== false && matchesDiet(it));
const courseMatch   = (it, c) => it.foodCourse === c.id || it.foodCourse === c.label;
const categoryMatch = (it, c) => it.category   === c.id || it.category   === c.label;

function itemsForList(){
  let arr = baseFilter(ITEMS);
  if (view === "list" && listKind && listId) {
    if (listKind === "course") {
      const c = COURSES.find(x=>x.id===listId) || {id:listId, label:listId};
      arr = arr.filter(it=>courseMatch(it, c));
    } else {
      const c = CATEGORIES.find(x=>x.id===listId) || {id:listId, label:listId};
      arr = arr.filter(it=>categoryMatch(it, c));
    }
  } else if (view === "search" && searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    arr = arr.filter(it=>{
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
  const withTs = items.map(i => ({ ...i, _ts: Math.max(tsToMs(i.updatedAt), tsToMs(i.createdAt)) }));
  withTs.sort((a,b)=> b._ts - a._ts);
  const hit = withTs.find(x => x.imageUrl);
  return hit?.imageUrl || "";
}
function tileHTML(kind, id, label, imgUrl){
  return `
    <div class="bucket-tile" role="button" tabindex="0" data-kind="${kind}" data-id="${id}" data-label="${label}">
      <div class="tile-img">${imgUrl ? `<img loading="lazy" src="${imgUrl}" alt="${label}">` : ""}</div>
      <span class="bucket-label">${label}</span>
    </div>
  `;
}

/* ---------- Render: Home (grids) ---------- */
function renderCourseBuckets(fade = false) {
  if (!courseBuckets) return;
  const grid = courseBuckets;
  if (fade) grid.classList.add("fade-out");

  const filtered = baseFilter(ITEMS);
  const html = COURSES
    .slice().sort((a,b)=>a.label.localeCompare(b.label))
    .map(course => {
      const itemsIn = filtered.filter(it => courseMatch(it, course));
      const imgUrl = latestImageForGroup(itemsIn.length ? itemsIn : ITEMS.filter(it=>courseMatch(it, course)));
      return tileHTML("course", course.id, course.label, imgUrl);
    }).join("");
  grid.innerHTML = html;

  if (fade) requestAnimationFrame(() => {
    grid.classList.remove("fade-out");
    grid.classList.add("fade-in");
    setTimeout(()=>grid.classList.remove("fade-in"),260);
  });
}
function renderCategoryBuckets(fade = false) {
  if (!categoryBuckets) return;
  const grid = categoryBuckets;
  if (fade) grid.classList.add("fade-out");

  const filtered = baseFilter(ITEMS);
  const html = CATEGORIES
    .slice().sort((a,b)=>a.label.localeCompare(b.label))
    .map(cat => {
      const itemsIn = filtered.filter(it => categoryMatch(it, cat));
      const imgUrl = latestImageForGroup(itemsIn.length ? itemsIn : ITEMS.filter(it=>categoryMatch(it, cat)));
      return tileHTML("category", cat.id, cat.label, imgUrl);
    }).join("");
  grid.innerHTML = html;

  if (fade) requestAnimationFrame(() => {
    grid.classList.remove("fade-out");
    grid.classList.add("fade-in");
    setTimeout(()=>grid.classList.remove("fade-in"),260);
  });
}

/* ---------- Render: Content view (List/Search) ---------- */
function topbarHTML(){
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
        <input type="text" class="tile-search" placeholder="Search dishes…" aria-label="Search dishes" value="${view==="search" ? (searchQuery||"").replace(/"/g,'&quot;') : ""}"/>
        <button class="searchbtn" data-action="search" aria-label="Search"></button>
      </div>
    </div>`;
}
function renderContentView(fade=false){
  if (!globalResults) return;

  // Build the content view fresh (topbar + list)
  const listId = "globalResultsList";
  globalResults.innerHTML = `${topbarHTML()}<div id="${listId}" class="list-grid"></div>`;
  globalList = $("#"+listId);

  // Fill with items
  if (fade) globalList.classList.add("fade-out");
  const items = itemsForList();
  globalList.innerHTML = items.length
    ? items.map(itemCardHTML).join("")
    : `<div class="menu-item placeholder">No items match your selection.</div>`;
  if (fade) requestAnimationFrame(()=>{
    globalList.classList.remove("fade-out");
    globalList.classList.add("fade-in");
    setTimeout(()=>globalList.classList.remove("fade-in"),260);
  });
}

/* ---------- View transitions (now hide/show the PRIMARY BAR) ---------- */
function showHome(){
  view = "home"; listKind=""; listId=""; listLabel="";
  globalResults.classList.add("hidden");
  coursesSection.classList.remove("hidden");
  categoriesSection.classList.remove("hidden");
  primaryBar?.classList.remove("hidden");           // << SHOW home bar

  document.getElementById("menuTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
  renderCourseBuckets(); renderCategoryBuckets();
}
function enterList(kind, id, label){
  view = "list"; listKind=kind; listId=id; listLabel=label||id;
  coursesSection.classList.add("hidden");
  categoriesSection.classList.add("hidden");
  primaryBar?.classList.add("hidden");              // << HIDE home bar
  globalResults.classList.remove("hidden");
  renderContentView();
  document.getElementById("menuTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function enterSearch(q){
  view = "search";
  searchQuery = q || "";
  coursesSection.classList.add("hidden");
  categoriesSection.classList.add("hidden");
  primaryBar?.classList.add("hidden");              // << HIDE home bar
  globalResults.classList.remove("hidden");
  renderContentView();
  document.getElementById("menuTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Live data ---------- */
function ensureGroupsFromItems(){
  if ((!COURSES || !COURSES.length) && ITEMS.length) {
    const map = new Map();
    for (const it of ITEMS) {
      const key = (it.foodCourse||"").trim();
      if (key) map.set(key, { id:key, label:key });
    }
    COURSES = Array.from(map.values());
  }
  if ((!CATEGORIES || !CATEGORIES.length) && ITEMS.length) {
    const map = new Map();
    for (const it of ITEMS) {
      const key = (it.category||"").trim();
      if (key) map.set(key, { id:key, label:key });
    }
    CATEGORIES = Array.from(map.values());
  }
}
function listenCourses() {
  onSnapshot(collection(db, "menuCourses"), (snap) => {
    const list = [];
    snap.forEach(d => list.push({ id: d.id, label: d.data()?.name || d.id }));
    COURSES = list;
    if (view === "home") renderCourseBuckets();
  }, () => {});
}
function listenCategories() {
  onSnapshot(collection(db, "menuCategories"), (snap) => {
    const list = [];
    snap.forEach(d => list.push({ id: d.id, label: d.data()?.name || d.id }));
    CATEGORIES = list;
    if (view === "home") renderCategoryBuckets();
  }, () => {});
}
function listenItems() {
  const baseCol = collection(db, "menuItems");
  const renderFrom = (docs) => {
    ITEMS = docs.map(d => ({ id: d.id, ...d.data() }));
    ensureGroupsFromItems();

    if (view === "home") {
      renderCourseBuckets();
      renderCategoryBuckets();
    } else {
      renderContentView();
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

/* ---------- Switch syncing ---------- */
function syncHomeSwitches(){
  vegSwitch?.classList.toggle("on", vegOn);
  vegSwitch?.setAttribute("aria-checked", String(vegOn));
  nonvegSwitch?.classList.toggle("on", nonvegOn);
  nonvegSwitch?.setAttribute("aria-checked", String(nonvegOn));
}
function syncTopbarSwitches(){
  $$(".topbar [data-action='veg']").forEach(b=>{
    b.classList.toggle("on", vegOn);
    b.setAttribute("aria-checked", String(vegOn));
  });
  $$(".topbar [data-action='nonveg']").forEach(b=>{
    b.classList.toggle("on", nonvegOn);
    b.setAttribute("aria-checked", String(nonvegOn));
  });
}

/* ---------- Events ---------- */
// Tile clicks => enter full-page list view
document.addEventListener("click", (e) => {
  const tile = e.target.closest(".bucket-tile");
  if (!tile) return;
  const kind = tile.dataset.kind;
  const id = tile.dataset.id;
  const label = tile.dataset.label || id;
  enterList(kind, id, label);
});

// Topbar actions (in content view)
document.addEventListener("click", (e) => {
  const actBtn = e.target.closest("[data-action]");
  if (!actBtn) return;
  const action = actBtn.getAttribute("data-action");

  if (action === "back") {
    showHome();
    if (listKind === "course") coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (listKind === "category") categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (action === "veg") {
    vegOn = !vegOn; syncHomeSwitches(); syncTopbarSwitches();
    if (view === "home") { renderCourseBuckets(true); renderCategoryBuckets(true); }
    else renderContentView(true);
    return;
  }
  if (action === "nonveg") {
    nonvegOn = !nonvegOn; syncHomeSwitches(); syncTopbarSwitches();
    if (view === "home") { renderCourseBuckets(true); renderCategoryBuckets(true); }
    else renderContentView(true);
    return;
  }
  if (action === "nav-course") { showHome(); coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (action === "nav-category") { showHome(); categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (action === "search") {
    const wrap = actBtn.closest(".topbar");
    const field = wrap?.querySelector(".tile-search");
    const q = (field?.value || "").trim();
    enterSearch(q);
    if (searchInputHome) searchInputHome.value = q;
    return;
  }
});

// Home switches (opt-in) + search
vegSwitch?.addEventListener("click", () => {
  vegOn = !vegOn; syncHomeSwitches(); syncTopbarSwitches();
  renderCourseBuckets(true); renderCategoryBuckets(true);
});
nonvegSwitch?.addEventListener("click", () => {
  nonvegOn = !nonvegOn; syncHomeSwitches(); syncTopbarSwitches();
  renderCourseBuckets(true); renderCategoryBuckets(true);
});
courseToggle?.addEventListener("click", () => { coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); });
categoryToggle?.addEventListener("click", () => { categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); });

searchBtnHome?.addEventListener("click", () => {
  const q = (searchInputHome?.value || "").trim();
  enterSearch(q);
});
searchInputHome?.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  enterSearch((searchInputHome?.value || "").trim());
});

/* Steppers (delegated) */
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
function boot(){
  syncHomeSwitches();
  listenCourses();
  listenCategories();
  listenItems();
}
boot();
