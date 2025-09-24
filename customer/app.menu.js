// app.menu.js — align menu cards with the real Cart store and folder paths (no UI changes)

(function () {
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  /* ---------- Header cart link (already on your page) ---------- */
  const cartLink = $("#cartLink"); // e.g., "Cart (0)"

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

  const globalResults = $("#globalResults");
  let globalList = $("#globalResultsList");

  /* ---------- Helpers ---------- */
  const normDiet = (t="") => t.toLowerCase().replace(/\s+/g,"-");
  const canon = (s="") => s.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();

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

  /* ---------- Price & Cart (real cart API) ---------- */
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

  function getQty(key) {
  const el = document.querySelector(`.qty[data-key="${key}"] .num`);
  if (el) {
    const v = parseInt(el.textContent || "0", 10);
    if (!Number.isNaN(v)) return v;
  }
  try {
    const bag = window?.Cart?.get?.() || {};
    // exact key qty
    let q = Number(bag?.[key]?.qty || 0);
    // include composite children like "item:variant:addonKey"
    const prefix = key + ":";
    for (const [k, entry] of Object.entries(bag)) {
      if (k.startsWith(prefix)) q += Number(entry?.qty || 0);
    }
    return q;
  } catch { return 0; }
}


  function totalQtyForItem(itemId){
  // DOM steppers total
  const nodes = document.querySelectorAll(`.stepper[data-item="${itemId}"] .qty .num`);
  let domSum = Array.from(nodes).reduce((a,el)=> a + (parseInt(el.textContent||"0",10)||0), 0);

  // Include Cart store entries (covers add-on composite keys)
  try {
    const bag = window?.Cart?.get?.() || {};
    const cartSum = Object.entries(bag).reduce((acc, [k, entry]) => {
      if (k.startsWith(`${itemId}:`)) acc += Number(entry?.qty||0)||0;
      return acc;
    }, 0);
    // If cartSum is larger (e.g., due to add-on combos), prefer it
    return Math.max(domSum, cartSum);
  } catch { return domSum; }
}


  function updateCartLink(){
  try {
    const bag = window?.Cart?.get?.() || {};
    const total = Object.values(bag).reduce((a,entry)=> a + (Number(entry?.qty||0)||0), 0);
    if (cartLink) cartLink.textContent = `Cart (${total})`;
  } catch {
    if (cartLink) cartLink.textContent = `Cart (0)`;
  }
}
 

  function updateItemMiniCartBadge(itemId, rock=false){
    const btn = document.querySelector(`.menu-item[data-id="${itemId}"] .mini-cart-btn`);
    if (!btn) return;
  // include all cart entries starting with this itemId (covers add-ons)
const bag = window?.Cart?.get?.() || {};
let q = 0;
for (const [k, entry] of Object.entries(bag)) {
  if (k.startsWith(itemId + ":")) q += Number(entry?.qty || 0);
}

// fallback: if cart not updated yet, use DOM steppers to show immediate feedback
if (q === 0) {
  const nodes = document.querySelectorAll(`.stepper[data-item="${itemId}"] .qty .num`);
  q = Array.from(nodes).reduce((a,el)=> a + (parseInt(el.textContent||"0",10)||0), 0);
}

btn.classList.toggle("active", q>0);
let b = btn.querySelector(".badge");
if (q>0){
  if (!b){ b = document.createElement("span"); b.className = "badge"; btn.appendChild(b); }
  const prev = Number(b.textContent||"0");
  b.textContent = String(q);
  if (rock){
    btn.classList.remove("rock");
    void btn.offsetWidth; // reflow
    btn.classList.add("rock");
    setTimeout(()=>btn.classList.remove("rock"), 350);
  }
} else {
  if (b) b.remove();
}
    
  function updateAllMiniCartBadges(){
    document.querySelectorAll(".menu-item").forEach(card=>{
      const id = card.getAttribute("data-id");
      updateItemMiniCartBadge(id);
    });
  }

  function setQty(found, variantKey, price, nextQty) {
    const key = `${found.id}:${variantKey}`;
    const next = Math.max(0, Number(nextQty || 0));

    const badge = document.querySelector(`.qty[data-key="${key}"] .num`);
    if (badge) badge.textContent = String(next);

    try {
      window.Cart?.setQty?.(key, next, { id: found.id, name: found.name, variant: variantKey, price });
    } catch {}

    updateItemMiniCartBadge(found.id, /*rock:*/ true);
    updateCartLink();

    setTimeout(() => {
      try {
        const bag = window?.Cart?.get?.() || {};
        const cartQty = Number(bag?.[key]?.qty || 0);
        if (cartQty !== next && badge) {
          badge.textContent = String(cartQty || next);
          updateItemMiniCartBadge(found.id);
          updateCartLink();
        }
      } catch {}
    }, 50);
  }

  /* ---------- Card templates ---------- */
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
  ? `
    <button class="addons-btn gold glow shimmer" data-action="addons"
            aria-expanded="false" aria-controls="addons-${m.id}">
      Add-ons
    </button>
    <div id="addons-${m.id}" class="addons-popover" role="dialog" aria-hidden="true">
      <div class="bubble">
        <div class="addon-list">
        ${m.addons.map(a => {
          const n = (typeof a === "string") ? a : (a.name || "");
          const p = (typeof a === "string") ? 0 : Number(a.price || 0);
          return `
            <label class="addon-row">
              <input type="checkbox" data-addon="${n}" data-price="${p}">
              <span class="name">${n}</span>
              <span class="price">₹${p}</span>
            </label>
          `;
        }).join("")}
        </div>
        <div class="addon-actions">
          <button class="addons-add gold" data-action="addons-add" disabled>
            Add to Purchase
          </button>
        </div>
      </div>
    </div>
  `
  : "";

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
        <div class="row meta">
          <small class="muted">${tagsLeft}</small>
          ${diet}
        </div>
        <div class="steppers">${steppers}</div>
      </article>
    `;
  }

  /* ---------- Filters & Search ---------- */
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
  const addonNames = Array.isArray(it.addons) ? it.addons.map(a => typeof a === "string" ? a : a.name) : [];
  const parts = [ it.name, it.description, it.foodCourse, it.category, ...addonNames ].filter(Boolean);
  return parts.join(" ");
}

  function applySearch(items, q){ if (!q) return items; return items.filter(it => fuzzyMatch(searchHaystack(it), q)); }

  /* ---------- Tiles (centered grid) ---------- */
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

  /* ---------- Renderers ---------- */
  function renderCourseBuckets() {
    if (!courseBuckets) return;
    const filtered = baseFilter(ITEMS);
    courseBuckets.innerHTML = COURSES.slice().sort((a,b)=>a.label.localeCompare(b.label)).map(course => {
      const itemsIn = filtered.filter(it => courseMatch(it, course));
      const imgUrl = latestImageForGroup(itemsIn.length ? itemsIn : ITEMS.filter(it=>courseMatch(it, course)));
      return tileHTML("course", course.id, course.label, imgUrl);
    }).join("");
  }
  function renderCategoryBuckets() {
    if (!categoryBuckets) return;
    const filtered = baseFilter(ITEMS);
    categoryBuckets.innerHTML = CATEGORIES.slice().sort((a,b)=>a.label.localeCompare(b.label)).map(cat => {
      const itemsIn = filtered.filter(it => categoryMatch(it, cat));
      const imgUrl = latestImageForGroup(itemsIn.length ? itemsIn : ITEMS.filter(it=>categoryMatch(it, cat)));
      return tileHTML("category", cat.id, cat.label, imgUrl);
    }).join("");
  }

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
  function renderContentView(){
    if (!globalResults) return;
    const listIdDom = "globalResultsList";
    globalResults.innerHTML = `${topbarHTML()}<div id="${listIdDom}" class="list-grid"></div>`;
    globalList = document.getElementById(listIdDom);

    const base = view==="search" ? applySearch(baseFilter(ITEMS), searchQuery) : itemsForList();
    globalList.innerHTML = base.length
      ? base.map(itemCardHTML).join("")
      : `<div class="menu-item placeholder">No items match your selection.</div>`;

    updateAllMiniCartBadges();
    updateCartLink();
  }

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

  /* ---------- Live data (use window.db) ---------- */
  async function listenAll() {
    const { collection, onSnapshot, query, orderBy } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

    const db = window.db; // set by firebase.client.js

    // Courses
    try {
      onSnapshot(collection(db, "menuCourses"), (snap) => {
        const list = []; snap.forEach(d => list.push({ id: d.id, label: d.data()?.name || d.id }));
        COURSES = list; if (view === "home") renderCourseBuckets();
      });
    } catch {}

    // Categories
    try {
      onSnapshot(collection(db, "menuCategories"), (snap) => {
        const list = []; snap.forEach(d => list.push({ id: d.id, label: d.data()?.name || d.id }));
        CATEGORIES = list; if (view === "home") renderCategoryBuckets();
      });
    } catch {}

    // Items (with fallback if orderBy not available)
    const baseCol = collection(db, "menuItems");
    const renderFrom = (docs) => {
      ITEMS = docs.map(d => ({ id: d.id, ...d.data() }));
      if ((!COURSES?.length) || (!CATEGORIES?.length)) {
        const cm = new Map(), gm = new Map();
        for (const it of ITEMS) { const c=(it.foodCourse||"").trim(); if (c) cm.set(c, {id:c,label:c}); const g=(it.category||"").trim(); if (g) gm.set(g,{id:g,label:g}); }
        if (!COURSES?.length)    COURSES    = Array.from(cm.values());
        if (!CATEGORIES?.length) CATEGORIES = Array.from(gm.values());
      }
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

  /* ---------- Events ---------- */
  // Tile clicks => list view
  document.addEventListener("click", (e) => {
    const tile = e.target.closest(".bucket-tile");
    if (!tile) return;
    enterList(tile.dataset.kind, tile.dataset.id, tile.dataset.label || tile.dataset.id);
  });
    
// Toggle Add-ons popover
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".addons-btn");
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();

  const card = btn.closest(".menu-item");
  const pop = card?.querySelector(".addons-popover");
  if (!pop) return;

  // Close others
  document.querySelectorAll('.addons-popover[aria-hidden="false"]').forEach(p => {
    if (p !== pop) {
      p.setAttribute("aria-hidden", "true");
      const b = p.previousElementSibling;
      if (b?.classList.contains("addons-btn")) b.setAttribute("aria-expanded", "false");
    }
  });

  const isOpen = pop.getAttribute("aria-hidden") === "false";
  pop.setAttribute("aria-hidden", isOpen ? "true" : "false");
  btn.setAttribute("aria-expanded", isOpen ? "false" : "true");

  // Set initial disabled state
  const addBtn = pop.querySelector('.addons-add');
  const any = !!pop.querySelector('.addon-row input[type="checkbox"]:checked');
  if (addBtn) addBtn.disabled = !any;
});

// Enable/disable Add to Purchase based on checks
document.addEventListener("change", (e) => {
  if (!e.target.matches('.addon-row input[type="checkbox"]')) return;
  const pop = e.target.closest('.addons-popover'); if (!pop) return;
  const addBtn = pop.querySelector('.addons-add'); if (!addBtn) return;
  const any = !!pop.querySelector('.addon-row input[type="checkbox"]:checked');
  addBtn.disabled = !any;
});

document.addEventListener("click", (e) => {
  const addBtn = e.target.closest('.addons-add[data-action="addons-add"]');
  if (!addBtn) return;

  const pop = addBtn.closest('.addons-popover');
  const card = addBtn.closest('.menu-item');
  const itemId = card?.getAttribute('data-id');
  if (!pop || !card || !itemId) return;

  const found = ITEMS.find(x => x.id === itemId); if (!found) return;

  // Gather selected add-ons
  const picks = Array.from(pop.querySelectorAll('.addon-row input[type="checkbox"]:checked')).map(el => ({
    name: el.getAttribute('data-addon') || "",
    price: Number(el.getAttribute('data-price') || 0)
  })).filter(a => a.name);

  if (!picks.length) return; // shouldn't happen because button is disabled otherwise

  // Choose default variant: prefer 'full' if available, else first priced variant
  const pm = priceModel(found.qtyType);
  const variants = (pm?.variants || []).filter(v => v.price > 0);
  const preferFull = variants.find(v => v.key === "full") || variants[0];
  if (!preferFull) return;

  // Build composite cart key (stable order for add-ons)
  const addonKey = picks.map(a => a.name).sort().join('+');
  const variantKey = preferFull.key;
  const baseKey = `${found.id}:${variantKey}`;
  const key = addonKey ? `${baseKey}:${addonKey}` : baseKey;

  // Unit price = base + sum(add-ons)
  const unitPrice = Number(preferFull.price || 0) + picks.reduce((s,a)=> s + (Number(a.price||0)||0), 0);

  // Current qty from store
  let nextQty = 1;
  try {
    const bag = window?.Cart?.get?.() || {};
    nextQty = Number(bag?.[key]?.qty || 0) + 1;
  } catch {}

  // Write to Cart with meta including add-ons
  try {
    window.Cart?.setQty?.(key, nextQty, {
      id: found.id,
      name: found.name,
      variant: variantKey,
      price: unitPrice,
      addons: picks
    });
  } catch {}

  // Animate: close genie back to button
  pop.classList.add('genie-out');
  setTimeout(() => {
    pop.setAttribute('aria-hidden','true');
    const btn = card.querySelector('.addons-btn');
    if (btn) btn.setAttribute('aria-expanded','false');
    pop.classList.remove('genie-out');
  }, 180);

// Refresh badges & header (ensures gold highlight + numbers)
updateAllMiniCartBadges();
updateCartLink();

// Rock the mini cart button every time
const btn = card.querySelector(".mini-cart-btn");
if (btn) {
  btn.classList.remove("rock");
  void btn.offsetWidth;  // reflow to retrigger
  btn.classList.add("rock");
  setTimeout(() => btn.classList.remove("rock"), 350);
}
});

// Dismiss on outside click
document.addEventListener("click", (e) => {
  document.querySelectorAll('.addons-popover[aria-hidden="false"]').forEach(p => {
    if (!p.contains(e.target) && !e.target.closest(".addons-btn")) {
      p.setAttribute("aria-hidden", "true");
      const b = p.previousElementSibling;
      if (b?.classList.contains("addons-btn")) b.setAttribute("aria-expanded", "false");
    }
  });
});

// Dismiss on Esc
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  document.querySelectorAll('.addons-popover[aria-hidden="false"]').forEach(p => {
    p.setAttribute("aria-hidden", "true");
    const b = p.previousElementSibling;
    if (b?.classList.contains("addons-btn")) b.setAttribute("aria-expanded", "false");
  });
});

  
  // Topbar actions
  document.addEventListener("click", (e) => {
    const actBtn = e.target.closest("[data-action]"); if (!actBtn) return;
    const action = actBtn.getAttribute("data-action");

    if (action === "back") { showHome(); if (listKind === "course") coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); if (listKind === "category") categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (action === "veg")    { vegOn = !vegOn; renderAfterToggle(); return; }
    if (action === "nonveg") { nonvegOn = !nonvegOn; renderAfterToggle(); return; }
    if (action === "nav-course")   { showHome(); coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (action === "nav-category") { showHome(); categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (action === "search") {
      const wrap = actBtn.closest(".topbar"); const field = wrap?.querySelector(".tile-search");
      enterSearch((field?.value || "").trim()); if (searchInputHome) searchInputHome.value = (field?.value || "").trim(); return;
    }
  });
  function renderAfterToggle(){
    vegSwitch?.classList.toggle("on", vegOn); vegSwitch?.setAttribute("aria-checked", String(vegOn));
    nonvegSwitch?.classList.toggle("on", nonvegOn); nonvegSwitch?.setAttribute("aria-checked", String(nonvegOn));
    if (view==="home"){ renderCourseBuckets(); renderCategoryBuckets(); } else { renderContentView(); }
  }

  // Home switches + search
  vegSwitch?.addEventListener("click", () => { vegOn = !vegOn; renderAfterToggle(); });
  nonvegSwitch?.addEventListener("click", () => { nonvegOn = !nonvegOn; renderAfterToggle(); });
  courseToggle?.addEventListener("click", () => { coursesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  categoryToggle?.addEventListener("click", () => { categoriesSection?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  searchBtnHome?.addEventListener("click", () => enterSearch((searchInputHome?.value || "").trim()));
  searchInputHome?.addEventListener("keydown", (e) => { if (e.key === "Enter") enterSearch((searchInputHome?.value || "").trim()); });

  /* Steppers — DOM-first qty, then store */
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".inc, .dec"); if (!btn) return;
    const wrap = btn.closest(".stepper"); const id = wrap?.dataset.item; const variantKey = wrap?.dataset.variant;
    const found = ITEMS.find(x => x.id === id); if (!found) return;
    const pm = priceModel(found.qtyType); const v = (pm?.variants || []).find(x => x.key === variantKey); if (!v || !v.price) return;

    const key = `${id}:${variantKey}`;
    const now = getQty(key);
    const next = Math.max(0, now + (btn.classList.contains("inc") ? 1 : -1));
    setQty(found, variantKey, v.price, next);
  });

 // Mini cart button click: go to checkout
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".mini-cart-btn"); if (!btn) return;
  e.preventDefault(); window.location.href = "checkout.html";
});

  /* ---------- Boot ---------- */
  async function boot(){
    showHome(); // renders tiles on load if sections present
    updateCartLink();
    await listenAll();
  }
  document.addEventListener("DOMContentLoaded", boot);

 // Keep header & badges in sync whenever the cart store updates
window.addEventListener("cart:update", () => {
  updateAllMiniCartBadges();
  updateCartLink();
});

})();
