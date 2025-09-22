// app.menu.js — stepper count > 1 fix, centered tiles intact.
//  • Read current quantity from DOM first (so + always increments).
//  • Still call Cart.setQty underneath; re-sync badges and header count.
//  • Tiles grid is centered by CSS; logic unchanged.
import { Cart } from "./cart.store.js";
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

const primaryBar = $("#menu .primary-bar");
const coursesSection = $("#coursesSection");
const categoriesSection = $("#categoriesSection");
const courseBuckets = $("#courseBuckets");
const categoryBuckets = $("#categoryBuckets");

const globalResults = $("#globalResults"); // our content view (List/Search)
let globalList = $("#globalResultsList");

const cartLink = $("#cartLink"); // header "Cart (n)"

/* ---------- State ---------- */
let ITEMS = [];
let COURSES = [];
let CATEGORIES = [];

let vegOn = false;
let nonvegOn = false;

let view = "home";     // 'home' | 'list' | 'search'
let listKind = "";     // 'course' | 'category'
let listId = "";       // selected id
let listLabel = "";
let searchQuery = "";

/* ---------- Utils ---------- */
const normDiet = (t="") => t.toLowerCase().replace(/\s+/g,"-");
const canon = (s="") => s.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();

/* Tiny edit-distance */
function editDistance(a="", b=""){
  const al=a.length, bl=b.length; if (!al) return bl; if (!bl) return al;
  const dp = Array.from({length: al+1}, (_,i)=>Array(bl+1).fill(0));
  for (let i=0;i<=al;i++) dp[i][0]=i; for (let j=0;j<=bl;j++) dp[0][j]=j;
  for (let i=1;i<=al;i++) for (let j=1;j<=bl;j++){
    const cost = a[i-1]===b[j-1] ? 0 : 1;
    dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+cost);
    if (i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1]) dp[i][j] = Math.min(dp[i][j], dp[i-2][j-2]+cost);
  }
  return dp[al][bl];
}
function fuzzyMatch(hay="", q=""){
  const H = canon(hay), Q = canon(q); if (!Q) return true;
  for (const t of Q.split(" ")){
    if (!t) continue;
    if (H.includes(t)) return true;
    const thr = t.length >= 5 ? 2 : 1;
    for (const w of H.split(" ")){
      if (!w) continue;
      if (Math.abs(w.length - t.length) > thr) continue;
      if (editDistance(w, t) <= thr) return true;
    }
  }
  return false;
}

/* ---------- Price & Cart ---------- */
function priceModel(qtyType) {
  if (!qtyType) return null;
  if (qtyType.type === "Not Applicable") {
    return { variants: [{ key: "single", label: "", price: Number(qtyType.itemPrice || 0) }] };
  }
  if (qtyType.type === "Half & Full") {
    return { variants: [
      { key: "half", label: "Half", price: Number(qtyType.halfPrice || 0) },
      { key: "full", label: "Full", price: Number(qtyType.fullPrice || 0) },
    ]};
  }
  return null;
}

/* Read qty primarily from DOM so + can always step past 1, then fallback to Cart */
function getQty(key) {
  const el = document.querySelector(`.qty[data-key="${key}"] .num`);
  if (el) {
    const v = parseInt(el.textContent || "0", 10);
    if (!Number.isNaN(v)) return v;
  }
  try { return Number(window?.Cart?.get?.()?.[key]?.qty || 0); } catch { return 0; }
}

function setQty(found, variantKey, price, nextQty) {
  const key = `${found.id}:${variantKey}`;
  const next = Math.max(0, Number(nextQty || 0));

  // Update DOM immediately (optimistic)
  const badge = document.querySelector(`.qty[data-key="${key}"] .num`);
  if (badge) badge.textContent = String(next);

  // Try to set in Cart (if available)
  try { Cart.setQty(key, next, { id: found.id, name: found.name, variant: variantKey, price }); } catch {}
  // Re-sync UI bits
  updateItemMiniCartBadge(found.id, /*maybeRock:*/ true);
  updateCartLink();

  // Post-check: if Cart is present but lags, try to reconcile after a tick
  setTimeout(() => {
    try {
      const bag = window?.Cart?.get?.() || {};
      const cartQty = Number(bag?.[key]?.qty || 0);
      if (cartQty !== next && badge) {
        badge.textContent = String(cartQty || next); // reflect whichever is non-zero
        updateItemMiniCartBadge(found.id);
        updateCartLink();
      }
    } catch {}
  }, 50);
}

function totalQtyForItem(itemId){
  const nodes = document.querySelectorAll(`.stepper[data-item="${itemId}"] .qty .num`);
  return Array.from(nodes).reduce((a,el)=> a + (parseInt(el.textContent||"0",10)||0), 0);
}
function updateItemMiniCartBadge(itemId, maybeRock=false){
  const btn = document.querySelector(`.menu-item[data-id="${itemId}"] .mini-cart-btn`);
  if (!btn) return;
  const q = totalQtyForItem(itemId);
  btn.classList.toggle("active", q>0);
  let b = btn.querySelector(".badge");
  if (q>0){
    if (!b){ b = document.createElement("span"); b.className = "badge"; btn.appendChild(b); }
    const prev = Number(b.textContent||"0");
    b.textContent = String(q);
    if (maybeRock && prev===0 && q>0){
      btn.classList.add("rock");
      setTimeout(()=>btn.classList.remove("rock"), 400);
    }
  } else { if (b) b.remove(); }
}
function updateAllMiniCartBadges(){
  document.querySelectorAll(".menu-item").forEach(card=>{
    const id = card.getAttribute("data-id");
    updateItemMiniCartBadge(id);
  });
}
function updateCartLink(){
  // prefer DOM sum so header count reflects stepping instantly
  let totalDOM = 0;
  document.querySelectorAll(".qty .num").forEach(el => {
    totalDOM += (parseInt(el.textContent||"0",10) || 0);
  });
  let total = totalDOM;
  // fallback to Cart if DOM shows 0 and Cart has items
  if (total === 0) {
    try {
      const bag = window?.Cart?.get?.() || {};
      total = Object.values(bag).reduce((a,entry)=> a + (Number(entry?.qty||0)||0), 0);
    } catch {}
  }
  if (cartLink) cartLink.textContent = `Cart (${total})`;
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
function miniCartButtonHTML(){
  return `
    <button class="mini-cart-btn" data-action="goto-cart" title="Go to cart" aria-label="Go to cart">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M7 7l5-5 5 5"/>
        <path d="M3 7h18l-2 12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L3 7z" fill="currentColor"/>
      </svg>
    </button>
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
      <div class="menu-header">
        <h4 class="menu-name">${m.name || ""}</h4>
        ${miniCartButtonHTML()}
      </div>
      <p class="menu-desc">${m.description || ""}</p>
      ${addons}
      <div class="row.meta">
        <small class="muted">${tagsLeft}</small>
        ${diet}
      </div>
      <div class="steppers">${steppers}</div>
    </article>
  `;
}

/* ---------- Filtering & Search ---------- */
function matchesDiet(it){
  const t = normDiet(it.foodType || "");
  if (vegOn && !nonvegOn) return t.startsWith("veg");
  if (!vegOn && nonvegOn) return t.startsWith("non-veg") || t.startsWith("nonveg");
  return true;
}
const baseFilter = items => items.filter(it => it.inStock !== false && matchesDiet(it));
const courseMatch   = (it, c) => it.foodCourse === c.id || it.foodCourse === c.label;
const categoryMatch = (it, c) => it.category   === c.id || it.category   === c.label;

function searchHaystack(it){
  const parts = [ it.name, it.description, it.foodCourse, it.category, ...(Array.isArray(it.addons)?it.addons:[]) ].filter(Boolean);
  return parts.join(" ");
}
function applySearch(items, q){ if (!q) return items; return items.filter(it => fuzzyMatch(searchHaystack(it), q)); }

/* ---------- Tiles ---------- */
function tsToMs(v){
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000 + (v.nanoseconds||0)/1e6;
  const d = new Date(v); return isNaN(d.getTime()) ? 0 : d.getTime();
}
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
  const html = COURSES.slice().sort((a,b)=>a.label.localeCompare(b.label)).map(course => {
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
  const html = CATEGORIES.slice().sort((a,b)=>a.label.localeCompare(b.label)).map(cat => {
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
  }
  return arr;
}
function renderContentView(fade=false){
  if (!globalResults) return;
  const listIdDom = "globalResultsList";
  globalResults.innerHTML = `${topbarHTML()}<div id="${listIdDom}" class="list-grid"></div>`;
  globalList = document.getElementById(listIdDom);

  if (fade) globalList.classList.add("fade-out");
  const base = view==="search" ? applySearch(baseFilter(ITEMS), searchQuery) : itemsForList();
  globalList.innerHTML = base.length
    ? base.map(itemCardHTML).join("")
    : `<div class="menu-item placeholder">No items match your selection.</div>`;
  if (fade) requestAnimationFrame(()=>{
    globalList.classList.remove("fade-out");
    globalList.classList.add("fade-in");
    setTimeout(()=>globalList.classList.remove("fade-in"),260);
  });

  updateAllMiniCartBadges();
  updateCartLink();
}

/* ---------- View transitions (hide/show PRIMARY BAR) ---------- */
function showHome(){
  view = "home"; listKind=""; listId=""; listLabel="";
  globalResults.classList.add("hidden");
  coursesSection.classList.remove("hidden");
  categoriesSection.classList.remove("hidden");
  primaryBar?.classList.remove("hidden");
  document.getElementById("menuTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
  renderCourseBuckets(); renderCategoryBuckets();
}
function enterList(kind, id, label){
  view = "list"; listKind=kind; listId=id; listLabel=label||id;
  coursesSection.classList.add("hidden");
  categoriesSection.classList.add("hidden");
  primaryBar?.classList.add("hidden");
  globalResults.classList.remove("hidden");
  renderContentView();
  document.getElementById("menuTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function enterSearch(q){
  view = "search";
  searchQuery = q || "";
  coursesSection.classList.add("hidden");
  categoriesSection.classList.add("hidden");
  primaryBar?.classList.add("hidden");
  globalResults.classList.remove("hidden");
  renderContentView();
  document.getElementById("menuTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Live data ---------- */
function ensureGroupsFromItems(){
  if ((!COURSES || !COURSES.length) && ITEMS.length) {
    const map = new Map();
    for (const it of ITEMS) { const k = (it.foodCourse||"").trim(); if (k) map.set(k, { id:k, label:k }); }
    COURSES = Array.from(map.values());
  }
  if ((!CATEGORIES || !CATEGORIES.length) && ITEMS.length) {
    const map = new Map();
    for (const it of ITEMS) { const k = (it.category||"").trim(); if (k) map.set(k, { id:k, label:k }); }
    CATEGORIES = Array.from(map.values());
  }
}
function listenCourses() {
  onSnapshot(collection(db, "menuCourses"), (snap) => {
    const list = []; snap.forEach(d => list.push({ id: d.id, label: d.data()?.name || d.id }));
    COURSES = list; if (view === "home") renderCourseBuckets();
  }, () => {});
}
function listenCategories() {
  onSnapshot(collection(db, "menuCategories"), (snap) => {
    const list = []; snap.forEach(d => list.push({ id: d.id, label: d.data()?.name || d.id }));
    CATEGORIES = list; if (view === "home") renderCategoryBuckets();
  }, () => {});
}
function listenItems() {
  const baseCol = collection(db, "menuItems");
  const renderFrom = (docs) => {
    ITEMS = docs.map(d => ({ id: d.id, ...d.data() }));
    ensureGroupsFromItems();
    if (view === "home") { renderCourseBuckets(); renderCategoryBuckets(); }
    else { renderContentView(); }
    updateAllMiniCartBadges(); updateCartLink();
  };
  try {
    const qLive = query(baseCol, orderBy("createdAt","desc"));
    onSnapshot(qLive, snap => renderFrom(snap.docs), () => onSnapshot(baseCol, snap => renderFrom(snap.docs)));
  } catch {
    onSnapshot(baseCol, snap => renderFrom(snap.docs));
  }
}

/* ---------- Switch syncing ---------- */
function syncHomeSwitches(){
  vegSwitch?.classList.toggle("on", vegOn); vegSwitch?.setAttribute("aria-checked", String(vegOn));
  nonvegSwitch?.classList.toggle("on", nonvegOn); nonvegSwitch?.setAttribute("aria-checked", String(nonvegOn));
}
function syncTopbarSwitches(){
  document.querySelectorAll(".topbar [data-action='veg']").forEach(b=>{ b.classList.toggle("on", vegOn); b.setAttribute("aria-checked", String(vegOn)); });
  document.querySelectorAll(".topbar [data-action='nonveg']").forEach(b=>{ b.classList.toggle("on", nonvegOn); b.setAttribute("aria-checked", String(nonvegOn)); });
}

/* ---------- Events ---------- */
// Tile clicks => list view
document.addEventListener("click", (e) => {
  const tile = e.target.closest(".bucket-tile");
  if (!tile) return;
  enterList(tile.dataset.kind, tile.dataset.id, tile.dataset.label || tile.dataset.id);
});

// Topbar actions (in content view)
document.addEventListener("click", (e) => {
  const actBtn = e.target.closest("[data-action]"); if (!actBtn) return;
  const action = actBtn.getAttribute("data-action");

  if (action === "back") { showHome(); if (listKind === "course") coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); if (listKind === "category") categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (action === "veg")    { vegOn = !vegOn; syncHomeSwitches(); syncTopbarSwitches(); view==="home" ? (renderCourseBuckets(true), renderCategoryBuckets(true)) : renderContentView(true); return; }
  if (action === "nonveg") { nonvegOn = !nonvegOn; syncHomeSwitches(); syncTopbarSwitches(); view==="home" ? (renderCourseBuckets(true), renderCategoryBuckets(true)) : renderContentView(true); return; }
  if (action === "nav-course")   { showHome(); coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (action === "nav-category") { showHome(); categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (action === "search") {
    const wrap = actBtn.closest(".topbar"); const field = wrap?.querySelector(".tile-search");
    enterSearch((field?.value || "").trim()); if (searchInputHome) searchInputHome.value = (field?.value || "").trim(); return;
  }
});

// Home switches + search
vegSwitch?.addEventListener("click", () => { vegOn = !vegOn; syncHomeSwitches(); syncTopbarSwitches(); renderCourseBuckets(true); renderCategoryBuckets(true); });
nonvegSwitch?.addEventListener("click", () => { nonvegOn = !nonvegOn; syncHomeSwitches(); syncTopbarSwitches(); renderCourseBuckets(true); renderCategoryBuckets(true); });
courseToggle?.addEventListener("click", () => { coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); });
categoryToggle?.addEventListener("click", () => { categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); });
searchBtnHome?.addEventListener("click", () => enterSearch((searchInputHome?.value || "").trim()));
searchInputHome?.addEventListener("keydown", (e) => { if (e.key === "Enter") enterSearch((searchInputHome?.value || "").trim()); });

/* Steppers (delegated) — now reads DOM qty first */
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".inc, .dec"); if (!btn) return;
  const wrap = btn.closest(".stepper"); const id = wrap?.dataset.item; const variantKey = wrap?.dataset.variant;
  const found = ITEMS.find(x => x.id === id); if (!found) return;
  const pm = priceModel(found.qtyType); const v = (pm?.variants || []).find(x => x.key === variantKey); if (!v || !v.price) return;

  const key = `${id}:${variantKey}`;
  const now = getQty(key); // DOM-first
  const next = Math.max(0, now + (btn.classList.contains("inc") ? 1 : -1));
  setQty(found, variantKey, v.price, next);
});

// Mini cart button click: go to checkout
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".mini-cart-btn"); if (!btn) return;
  e.preventDefault(); window.location.href = "customer/checkout.html";
});

/* ---------- Boot ---------- */
function boot(){
  syncHomeSwitches();
  listenCourses(); listenCategories(); listenItems();
  updateCartLink();
}
boot();
