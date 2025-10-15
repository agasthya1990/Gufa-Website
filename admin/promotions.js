// /admin/promotions.js
// Promotions Admin: Coupons (Dining|Delivery) + Banners + Link Coupon(s) + Publish targets
// Lean additive rewrite: preserves your original structure & imports; only adds features.
// Requires firebase.js exports { db, storage }

import { db, storage } from "./firebase.js";
import {
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp, query, orderBy, getDocs, where, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  ref as storageRef, uploadBytesResumable, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ===== Config (unchanged) =====
const BANNER_W = 200;
const BANNER_H = 50;
const BANNER_MIME = "image/jpeg";
const BANNER_QUALITY = 0.85;
const MAX_UPLOAD_MB = 10;
const BANNERS_DIR = "promoBanners";

// ===== Helpers (kept + minimal additions) =====
function isImageType(file){ return file && /^image\/(png|jpe?g|webp)$/i.test(file.type); }
function fileTooLarge(file){ return file && file.size > MAX_UPLOAD_MB * 1024 * 1024; }

function fileToImage(file){
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = (e) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = e.target.result;
    };
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

async function resizeToBannerBlob(file) {
  const img = await fileToImage(file);
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const side = Math.min(sw, sh);
  const sx = Math.max(0, Math.floor((sw - side) / 2));
  const sy = Math.max(0, Math.floor((sh - side) / 2));

  const canvas = document.createElement("canvas");
  canvas.width = BANNER_W;
  canvas.height = BANNER_H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, BANNER_W, BANNER_H);
  ctx.drawImage(img, sx, sy, side, side, 0, 0, BANNER_W, BANNER_H);

  return new Promise((res, rej) =>
    canvas.toBlob(
      (b) => (b ? res(b) : rej(new Error("Failed generating banner blob"))),
      BANNER_MIME,
      BANNER_QUALITY
    )
  );
}

const withTimeout = (p, ms, label="op") =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);

// ===== lightweight UI helpers for popovers / status pill (additive) =====
function ensurePopoverStyles(){
  if (document.getElementById("promo-popover-css")) return;
  const css = `
    .adm-pop { position:absolute; z-index:9999; background:#fff; border:2px solid #111;
      border-radius:10px; box-shadow:4px 4px 0 #111; padding:10px; display:none; }
    .adm-pop.show { display:block; animation: popIn 180ms ease-out both; }
    .adm-pop .row { display:flex; align-items:center; gap:8px; padding:4px 0; }
    .adm-pop .actions { display:flex; gap:8px; justify-content:flex-end; margin-top:8px; }
    @keyframes popIn { from {opacity:0; transform: translateY(6px) scale(.98);} to {opacity:1; transform:none;} }
  `;
  const s = document.createElement("style");
  s.id = "promo-popover-css";
  s.textContent = css;
  document.head.appendChild(s);
}


// Track which trigger opened which popover so we can re-position on resize/scroll
const POP_TRIG = new WeakMap();

function toggleAttachedPopover(pop, trigger){
  ensurePopoverStyles();
  ensureColumnStyles();

  // Close any open popovers first
  const wasOpen = pop.classList.contains("show");
  document.querySelectorAll(".adm-pop.show").forEach(el => {
    el.classList.remove("show");
    // remove any listeners attached for live positioning
    const off = el._popPositionOff;
    if (typeof off === "function") { try { off(); } catch(_){} }
    delete el._popPositionOff;
  });
  if (wasOpen) return;

  // Always append to <body> (global CSS already styles .adm-pop).
  // Body-mount keeps positioning consistent regardless of panel/container transforms.
  document.body.appendChild(pop);

  // Remember the trigger for this popover
  POP_TRIG.set(pop, trigger);

  // Compute + clamp within viewport
  const positionNow = () => {
    const t = POP_TRIG.get(pop);
    if (!t) return;

    const r = t.getBoundingClientRect();
    // Tentative placement: directly under the trigger
    let top  = window.scrollY + r.bottom + 6;

    // Pre-measure width for horizontal clamping
    const prevVis = pop.style.visibility;
    const prevDisp = pop.style.display;
    pop.style.visibility = "hidden";
    pop.style.display = "block";
    const popW = Math.max(pop.offsetWidth || 0, 280); // safe fallback
    pop.style.display = prevDisp;
    pop.style.visibility = prevVis;

    const pageLeft  = window.scrollX;
    const pageRight = pageLeft + document.documentElement.clientWidth;
    const margin = 16;
    let left = window.scrollX + r.left;

    const maxLeft = pageRight - popW - margin;
    const minLeft = pageLeft + margin;
    if (left > maxLeft) left = Math.max(minLeft, maxLeft);
    if (left < minLeft) left = minLeft;

    pop.style.top  = `${top}px`;
    pop.style.left = `${left}px`;
  };

  // Initial place
  positionNow();

  // Live re-position on resize/scroll (covers zoom/layout changes)
  const onResize = () => positionNow();
  const onScroll = () => positionNow();
  window.addEventListener("resize", onResize, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });

  // Store an "off" hook on the element so we can clean up when closing
  pop._popPositionOff = () => {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onScroll);
  };

  // Reveal
  requestAnimationFrame(() => pop.classList.add("show"));
}

const statusPill = (active) =>
  active ? `<strong style="color:#16a34a">Active</strong>` : `<strong style="color:#dc2626">Inactive</strong>`;
// Column grid styles (lightweight; mirrors catalogue feel)
function ensureColumnStyles(){
  if (document.getElementById("promo-columns-css")) return;
  const css = `
    .adm-grid{display:grid;gap:8px;align-items:center;padding:6px 8px;border-bottom:1px dashed #eee}
    .adm-grid-head{font-weight:600;background:#fafafa;border-bottom:2px solid #111}
    .adm-grid-coupons{grid-template-columns: 1fr .9fr 1fr 1fr .8fr auto}
    .adm-actions{display:flex;gap:8px;justify-content:flex-end}
  `;
  const s = document.createElement("style");
  s.id = "promo-columns-css";
  s.textContent = css;
  document.head.appendChild(s);
}

// Represent a coupon's channels (supports old string field or new checklist)
function channelsToText(p){
  if (p?.channels && (p.channels.delivery || p.channels.dining)) {
    const out = [];
    if (p.channels.delivery) out.push("Delivery");
    if (p.channels.dining)  out.push("Dining");
    return out.join(", ");
  }
  // fallback to legacy single-value 'channel'
  return (p?.channel === "dining") ? "Dining" : "Delivery";
}
function primaryChannelClass(p){
  // for pill coloring; if both checked, bias to Delivery so it's consistent
  const ch = p?.channels;
  if (ch && (ch.delivery || ch.dining)) {
    return ch.dining && !ch.delivery ? "adm-pill--dining" : "adm-pill--delivery";
  }
  return p?.channel === "dining" ? "adm-pill--dining" : "adm-pill--delivery";
}


// ===== Public init (same entry point, same shell) =====
export function initPromotions() {
  const root = document.getElementById("promotionsRoot");
  if (!root) return; // guard
  ensureColumnStyles();

  // Build UI once if empty (kept identical)
  if (!root.dataset.wired) {
    root.dataset.wired = "1";
    root.innerHTML = `
<h3>Coupons</h3>
<form id="newCouponForm" class="adm-grid adm-grid-coupons" style="margin-bottom:8px">
  <div><input id="couponCode" class="adm-input" placeholder="Code (e.g. WELCOME20)" /></div>
 <div id="couponChannelsCell">
    <button type="button" class="adm-btn chip-btn jsCouponChannels">Channel</button>
  </div>
</div>

  <div>
    <div style="display:flex; gap:8px; align-items:center;">
      <select id="couponType" class="adm-select">
        <option value="percent">% off</option>
        <option value="flat">₹ off</option>
      </select>
      <input id="couponValue" class="adm-input" type="number" placeholder="Value" />
    </div>
  </div>
  <div id="couponUsageLimitCell"></div>
  <div class="adm-actions">
  <button type="submit" class="adm-btn adm-btn--primary">Add</button>
  </div>
</form>
<div id="couponsList" style="margin-bottom:12px"></div>
<h3>Banners</h3>
<form id="newBannerForm" class="adm-grid adm-grid-banners" style="margin-bottom:8px">
  <div><input id="bannerFile" class="adm-file" type="file" accept="image/*" /></div>
  <div><input id="bannerTitle" class="adm-input" placeholder="Title" /></div>
  <div id="newBannerLinkedCell">
    <div class="inline-tools">
      <button type="button" class="adm-btn chip-btn jsNewLinkCoupons">Link Coupons</button>
      <span id="newBannerLinkedPreview" class="adm-muted">(Preview)</span>
    </div>
  </div>
  <div id="newBannerTargetsCell">
    <div class="inline-tools">
      <button type="button" class="adm-btn chip-btn jsNewPublish">Publish</button>
      <span id="newBannerTargetsPreview" class="adm-muted">(Preview)</span>
    </div>
  </div>
  <div class="adm-actions">
  <button type="submit" class="adm-btn adm-btn--primary chip-btn">Upload</button>
  </div>
</form>
<div id="bannersList" style="margin-bottom:12px"></div>
    `;
  }

  // Sections (same)
  const couponsList = document.getElementById("couponsList");
  const newCouponForm = document.getElementById("newCouponForm");
  const codeInput = document.getElementById("couponCode");
  const chanInput = document.getElementById("couponChannel"); // "dining" | "delivery"
  const typeInput = document.getElementById("couponType");    // "percent" | "flat"
  const valInput  = document.getElementById("couponValue");
  const bannersList = document.getElementById("bannersList");
const newBannerForm = document.getElementById("newBannerForm");
const bannerFile = document.getElementById("bannerFile");
const bannerTitle = document.getElementById("bannerTitle");

// --- Add Banner: local state + helpers (for in-form popovers) ---
  
let NEW_BANNER_LINKED = [];                          // coupon ids
let NEW_BANNER_TARGETS = { delivery: false, dining: false };
let COUPON_CACHE = null;                             // {id: {code, channel}} once fetched

const btnLinkForm  = document.querySelector(".jsNewLinkCoupons");
const btnPubForm   = document.querySelector(".jsNewPublish");
const linkedPrev   = document.getElementById("newBannerLinkedPreview");
const targetsPrev  = document.getElementById("newBannerTargetsPreview");

function renderNewBannerLinked(){
  if (!linkedPrev) return;
  if (!NEW_BANNER_LINKED.length) { linkedPrev.innerHTML = "—"; return; }
  linkedPrev.innerHTML = NEW_BANNER_LINKED.map(id => {
    const c = COUPON_CACHE?.[id];
    if (!c) return `<span class="adm-pill">${id.slice(0,6)}</span>`;
    const cls = c.channel === "dining" ? "adm-pill--dining" : "adm-pill--delivery";
    return `<span class="adm-pill ${cls}">${c.code}</span>`;
  }).join(" ");
}

function renderNewBannerTargets(){
  if (!targetsPrev) return;
  const picks = [];
  if (NEW_BANNER_TARGETS.delivery) picks.push("Delivery");
  if (NEW_BANNER_TARGETS.dining)  picks.push("Dining");
  targetsPrev.textContent = picks.length ? picks.join(", ") : "—";
}

// In-form: open Link Coupons popover
if (btnLinkForm) {
  btnLinkForm.onclick = async (e) => {
    e.preventDefault();
    // fetch coupon cache once (active & not exhausted)
    if (!COUPON_CACHE) {
      COUPON_CACHE = {};
      const snapAll = await getDocs(query(collection(db, "promotions")));
      snapAll.forEach(d => {
        const v = d.data() || {};
        if (v.kind !== "coupon") return;
        const limit = v.usageLimit ?? null;
        const used  = v.usedCount ?? 0;
        const exhausted = limit !== null && used >= limit;
        const active = v.active !== false;
        if (!active || exhausted) return;
        COUPON_CACHE[d.id] = { code: v.code || d.id, channel: v.channel };
      });
    }

    const pop = document.createElement("div");
    pop.className = "adm-pop";
    const rows = Object.entries(COUPON_CACHE).map(([id, c]) => {
      const label = `${c.code} • ${c.channel === "dining" ? "Dining" : "Delivery"}`;
      const checked = NEW_BANNER_LINKED.includes(id) ? "checked" : "";
      return `<label class="row"><input type="checkbox" value="${id}" ${checked}> <span>${label}</span></label>`;
    }).join("") || `<div class="adm-muted">(No active coupons available)</div>`;

    pop.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px">Link Coupons</div>
      <div class="list" style="max-height:40vh;overflow:auto;min-width:260px">${rows}</div>
      <div class="actions">
      <button class="adm-btn adm-btn--primary jsSave">Save</button>
      <button class="adm-btn jsCancel">Cancel</button>
      </div>
    `;

    const listEl = pop.querySelector(".list");
    const btnSave = pop.querySelector(".jsSave");
    const btnCancel = pop.querySelector(".jsCancel");

    btnCancel.onclick = () => pop.classList.remove("show");
    btnSave.onclick = () => {
      NEW_BANNER_LINKED = Array.from(listEl.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
      renderNewBannerLinked();
      pop.classList.remove("show");
    };

    toggleAttachedPopover(pop, btnLinkForm);
  };
}

// In-form: open Publish popover
if (btnPubForm) {
  btnPubForm.onclick = (e) => {
    e.preventDefault();
    const pop = document.createElement("div");
    pop.className = "adm-pop";
    pop.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px">Publish Banner To</div>
      <label class="row"><input type="checkbox" value="delivery" class="jsTarget" ${NEW_BANNER_TARGETS.delivery ? "checked":""}> <span>Delivery Menu</span></label>
      <label class="row"><input type="checkbox" value="dining" class="jsTarget" ${NEW_BANNER_TARGETS.dining ? "checked":""}> <span>Dining Menu</span></label>
      <div class="actions">
      <button class="adm-btn adm-btn--primary jsSave">Save</button>
      <button class="adm-btn jsCancel">Cancel</button>
      </div>
    `;
    const btnSave = pop.querySelector(".jsSave");
    const btnCancel = pop.querySelector(".jsCancel");

    btnCancel.onclick = () => pop.classList.remove("show");
    btnSave.onclick = () => {
      const checked = Array.from(pop.querySelectorAll(".jsTarget:checked")).map(i => i.value);
      NEW_BANNER_TARGETS = { delivery: checked.includes("delivery"), dining: checked.includes("dining") };
      renderNewBannerTargets();
      pop.classList.remove("show");
    };

    toggleAttachedPopover(pop, btnPubForm);
  };
}


  // --- Inject Usage Limit field (optional) — additive, no layout change ---
  
if (newCouponForm && !document.getElementById("couponUsageLimit")) {
  const limCell = document.getElementById("couponUsageLimitCell");
  const lim = document.createElement("input");
  lim.id = "couponUsageLimit";
  lim.type = "number";
  lim.placeholder = "Usage Limit (optional)";
  lim.min = "1";
  lim.className = "adm-input";
  (limCell || newCouponForm).appendChild(lim);
}

// --- Add Coupon: local state + helpers (Channel button -> checklist popover) ---
let NEW_COUPON_CHANNELS = { delivery: true, dining: false };

const btnChForm = document.querySelector(".jsCouponChannels");

if (btnChForm) {
btnChForm.onclick = (e) => {
  e.preventDefault();
  const pop = document.createElement("div");
  pop.className = "adm-pop";
  pop.setAttribute("data-size", "sm"); // <-- make Channel popover compact
  pop.innerHTML = `

      <div style="font-weight:600;margin-bottom:6px">Select Channel(s)</div>
      <label class="row" style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" class="jsCh" value="delivery" ${NEW_COUPON_CHANNELS.delivery ? "checked":""}>
        <span>Delivery</span>
      </label>
      <label class="row" style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" class="jsCh" value="dining" ${NEW_COUPON_CHANNELS.dining ? "checked":""}>
        <span>Dining</span>
      </label>
      <div class="actions" style="margin-top:8px">
        <button class="adm-btn adm-btn--primary jsSave">Save</button>
        <button class="adm-btn jsCancel">Cancel</button>
      </div>
    `;
    const btnSave   = pop.querySelector(".jsSave");
    const btnCancel = pop.querySelector(".jsCancel");

    btnCancel.onclick = () => pop.classList.remove("show");
    btnSave.onclick = () => {
      const boxes = pop.querySelectorAll(".jsCh");
      let del = false, din = false;
      boxes.forEach(b => {
        if (b.value === "delivery") del = b.checked;
        if (b.value === "dining")   din = b.checked;
      });
      // require at least one
      if (!del && !din) { alert("Pick at least one channel"); return; }
      NEW_COUPON_CHANNELS = { delivery: del, dining: din };
      pop.classList.remove("show");
    };

    toggleAttachedPopover(pop, btnChForm);
  };
}

  
// ---------- Coupons (add columns + toggle; keep delete) ----------
if (couponsList) {
  // Pre-render header so labels never disappear while data loads
  couponsList.innerHTML = `
    <div class="adm-grid adm-grid-coupons adm-grid-head">
      <div>Code</div>
      <div>Channel</div>
      <div>Value</div>
      <div>Usage Limit</div>
      <div>Status</div>
      <div>Actions</div>
    </div>
    <div class="adm-muted" style="padding:8px">Loading…</div>
  `;

  onSnapshot(
    query(collection(db, "promotions"), orderBy("createdAt", "desc")),
    (snap) => {
      const header = `
        <div class="adm-grid adm-grid-coupons adm-grid-head">
          <div>Code</div>
          <div>Channel</div>
          <div>Value</div>
          <div>Usage Limit</div>
          <div>Status</div>
          <div>Actions</div>
        </div>
      `;
      const rows = [];

      snap.forEach(d => {
        const p = d.data();
        if (p?.kind !== "coupon") return;

const valueTxt = p.type === "percent" ? `${p.value}% off` : `₹${p.value} off`;
const lim = (p.usageLimit ?? "∞");
rows.push(`
  <div class="adm-grid adm-grid-coupons">
    <div><span class="adm-pill ${primaryChannelClass(p)}">${p.code || d.id}</span></div>
    <div>${channelsToText(p)}</div>
    <div class="adm-muted">${valueTxt}</div>
    <div class="adm-muted"><strong>${lim}</strong></div>
    <div>${statusPill(p.active !== false)}</div>
    <div class="adm-actions">
      <button data-id="${d.id}" class="adm-btn jsEditCoupon">Edit</button>
      <button data-id="${d.id}" data-active="${p.active !== false}" class="adm-btn jsToggleCoupon">
        ${(p.active !== false) ? "Disable" : "Enable"}
      </button>
      <button data-id="${d.id}" class="adm-btn jsDelCoupon">Delete</button>
    </div>
  </div>
`);

      });

      couponsList.innerHTML = rows.length
        ? (header + rows.join(""))
        : (header + `<div class="adm-muted" style="padding:8px">No coupons</div>`);

      // Toggle status (unchanged logic, just re-indented)
      couponsList.querySelectorAll(".jsToggleCoupon").forEach(btn => {
        btn.onclick = async () => {
          btn.disabled = true;
          try {
            const promoId = btn.dataset.id;
            const currentlyActive = btn.dataset.active === "true";

            // 1) Flip the coupon's active flag.
            await updateDoc(doc(db, "promotions", promoId), {
              active: !currentlyActive,
              updatedAt: serverTimestamp()
            });

            // 2) If DISABLING, remove this coupon from all menu items that reference it.
            if (currentlyActive) {
              const q = query(
                collection(db, "menuItems"),
                where("promotions", "array-contains", promoId)
              );
              const itSnap = await getDocs(q);

              const ops = [];
              itSnap.forEach(it => {
                ops.push(
                  updateDoc(doc(db, "menuItems", it.id), {
                    promotions: arrayRemove(promoId),
                    updatedAt: serverTimestamp()
                  })
                );
              });
              await Promise.all(ops);
            }
          } finally {
            btn.disabled = false;
          }
        };
      });

// Edit Coupon (code, channels checklist, type, value, usageLimit)
  
couponsList.querySelectorAll(".jsEditCoupon").forEach(btn => {
  btn.onclick = async () => {
    const id = btn.dataset.id;
    const ref = doc(db, "promotions", id);
    const snap = await getDoc(ref);
    const p = snap.exists() ? snap.data() : {};

    const chDel = !!p?.channels?.delivery || p?.channel === "delivery" || p?.channel === "both";
    const chDin = !!p?.channels?.dining   || p?.channel === "dining"   || p?.channel === "both";
    const pop = document.createElement("div");
    pop.className = "adm-pop";
    pop.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px">Edit Coupon</div>
      <div style="display:grid;grid-template-columns:120px 1fr;gap:8px;align-items:center">
        <label>Code</label>
         <input class="adm-input jsCode" style="width:6cm" value="${(p.code || "")}">
        <label>Channels</label>
        <div>
          <label style="display:inline-flex;align-items:center;gap:6px;margin-right:10px">
            <input type="checkbox" class="jsChDel" ${chDel ? "checked":""}>
            <span>Delivery</span>
          </label>
          <label style="display:inline-flex;align-items:center;gap:6px">
            <input type="checkbox" class="jsChDin" ${chDin ? "checked":""}>
            <span>Dining</span>
          </label>
        </div>
        
        <label>Type</label>
        <select class="adm-select jsType">
          <option value="percent" ${p.type==="percent"?"selected":""}>% off</option>
          <option value="flat" ${p.type==="flat"?"selected":""}>₹ off</option>
        </select>
        <label>Value</label>
        <input class="adm-input jsValue" type="number" style="width:3cm" value="${p.value ?? ""}">
        <label>Usage Limit</label>
        <input class="adm-input jsLimit" type="number" style="width:3cm" value="${p.usageLimit ?? ""}" placeholder="(optional)">
      </div>
      <div class="actions" style="margin-top:10px">
        <button class="adm-btn adm-btn--primary jsSave">Save</button>
        <button class="adm-btn jsCancel">Cancel</button>
      </div>
    `;

    const elCode  = pop.querySelector(".jsCode");
    const elDel   = pop.querySelector(".jsChDel");
    const elDin   = pop.querySelector(".jsChDin");
    const elType  = pop.querySelector(".jsType");
    const elValue = pop.querySelector(".jsValue");
    const elLimit = pop.querySelector(".jsLimit");
    const btnSave = pop.querySelector(".jsSave");
    const btnCancel = pop.querySelector(".jsCancel");

    btnCancel.onclick = () => pop.classList.remove("show");
    btnSave.onclick = async () => {
      const code = (elCode.value || "").trim();
      const v = Number(elValue.value || 0);
      const lim = elLimit.value ? Number(elLimit.value) : null;
      const d = !!elDel.checked, g = !!elDin.checked;
      if (!code || !(v>0) || (!d && !g)) { alert("Fill code, positive value, and at least one channel"); return; }
      const legacy = d && g ? "both" : (g ? "dining" : "delivery");
      try {
        await updateDoc(ref, {
          code,
          channel: legacy,
          channels: { delivery: d, dining: g },
          type: elType.value || "percent",
          value: v,
          usageLimit: lim,
          updatedAt: serverTimestamp()
        });
      } catch (e){ console.error(e); alert("Failed to save coupon"); }
      pop.classList.remove("show");
    };

    toggleAttachedPopover(pop, btn);
  };
});
      
      // Delete (kept)
      couponsList.querySelectorAll(".jsDelCoupon").forEach(btn => {
        btn.onclick = async () => {
          if (!confirm("Delete this coupon?")) return;
          btn.disabled = true;
          try { await deleteDoc(doc(db, "promotions", btn.dataset.id)); }
          finally { btn.disabled = false; }
        };
      });
    }
  );
}


  // Create coupon (add usageLimit/usedCount/active defaults; keep original fields)
  
  if (newCouponForm) {
    newCouponForm.onsubmit = async (e) => {
      e.preventDefault();
      const code = (codeInput?.value || "").trim();
      const type = typeInput?.value || "percent";
      const value = Number(valInput?.value || 0);

// validate: need code, positive value, and at least one channel chosen in the popover
const del = !!NEW_COUPON_CHANNELS.delivery;
const din = !!NEW_COUPON_CHANNELS.dining;

if (!code || !(value > 0) || (!del && !din)) {
  return alert("Enter code, positive value, and select at least one channel");
}

// legacy single 'channel' string for backward compatibility
const legacyChannel = del && din ? "both" : (din ? "dining" : "delivery");

const id = crypto.randomUUID();
await setDoc(doc(db, "promotions", id), {
  kind: "coupon",
  code,
  channel: legacyChannel,                      // legacy (old UI paths)
  channels: { delivery: del, dining: din },    // new checklist source of truth
  type,
  value,
  usageLimit: Number(document.getElementById("couponUsageLimit")?.value || "") || null,
  createdAt: serverTimestamp(),
  active: true
});

newCouponForm.reset();
// reset popover state to default (Delivery only)
NEW_COUPON_CHANNELS = { delivery: true, dining: false };

    };
  }


// ---------- Banners (add link/publish/status; keep delete) ----------
if (bannersList) {
  // Pre-render header so labels never disappear while data loads
  bannersList.innerHTML = `
    <div class="adm-grid adm-grid-banners adm-grid-head">
      <div>Preview</div>
      <div>Title</div>
      <div>Linked Coupons</div>
      <div>Published To</div>
      <div>Status</div>
      <div>Actions</div>
    </div>
    <div class="adm-muted" style="padding:8px">Loading…</div>
  `;

  onSnapshot(
    query(collection(db, "promotions"), orderBy("createdAt", "desc")),
    (snap) => {
      const headerB = `
        <div class="adm-grid adm-grid-banners adm-grid-head">
          <div>Preview</div>
          <div>Title</div>
          <div>Linked Coupons</div>
          <div>Published To</div>
          <div>Status</div>
          <div>Actions</div>
        </div>
      `;

      // 1) Build a local coupon map from this same snapshot (id -> {code, channel})
      const couponMap = {};
      snap.forEach(d => {
        const v = d.data();
        if (v?.kind === "coupon") {
          couponMap[d.id] = { code: v.code || d.id, channel: v.channel };
        }
      });

      // 2) Build the banner rows
      const rows = [];
      snap.forEach(d => {
        const p = d.data();
        if (p?.kind !== "banner") return;

        const publishedTo = (p.targets && (p.targets.delivery || p.targets.dining))
          ? ["delivery","dining"].filter(k => p.targets?.[k]).map(k => k[0].toUpperCase()+k.slice(1)).join(", ")
          : "—";

        // Linked coupons as color-coded pills; fallback to id if coupon missing
        let linkedHTML = "—";
        const arr = Array.isArray(p.linkedCouponIds) ? p.linkedCouponIds : [];
        if (arr.length) {
          linkedHTML = arr.map(cid => {
            const c = couponMap[cid];
            if (!c) return `<span class="adm-pill">${cid.slice(0,6)}</span>`;
            const cls = c.channel === "dining" ? "adm-pill--dining" : "adm-pill--delivery";
            return `<span class="adm-pill ${cls}">${c.code}</span>`;
          }).join(" ");
        }

        rows.push(`
          <div class="adm-grid adm-grid-banners" data-id="${d.id}">
            <div><img src="${p.imageUrl}" alt="" width="80" height="20" style="object-fit:cover;border-radius:6px;border:1px solid #eee"/></div>
            <div>${p.title || "(untitled)"}</div>
            <div>${linkedHTML}</div>
            <div class="adm-muted">${publishedTo}</div>
            <div>${statusPill(p.active !== false)}</div>
            <div class="adm-actions">
            <button class="adm-btn jsEditBanner" data-id="${d.id}">Edit</button>
            <button class="adm-btn jsToggleBanner" data-id="${d.id}" data-active="${p.active !== false}">${(p.active !== false) ? "Disable" : "Enable"}</button>
            <button class="adm-btn jsDelBanner" data-id="${d.id}">Delete</button>
            </div>
          </div>
        `);
      });

      
      bannersList.innerHTML = rows.length
        ? (headerB + rows.join(""))
        : (headerB + `<div class="adm-muted" style="padding:8px">No banners</div>`);

      // 🔧 Wire events **inside** the snapshot (so they match the latest DOM)
      bannersList.querySelectorAll(".jsDelBanner").forEach(btn => {
        btn.onclick = async () => {
          if (!confirm("Delete this banner?")) return;
          btn.disabled = true;
          try { await deleteDoc(doc(db, "promotions", btn.dataset.id)); }
          finally { btn.disabled = false; }
        };
      });

      bannersList.querySelectorAll(".jsToggleBanner").forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.id;
          const currentlyActive = btn.dataset.active === "true";
          btn.disabled = true;
          try { await updateDoc(doc(db, "promotions", id), { active: !currentlyActive, updatedAt: serverTimestamp() }); }
          catch (e){ console.error(e); alert("Failed to update banner status."); }
          finally { btn.disabled = false; }
        };
      });
      
      // Edit Banner (title + linked coupons + publish targets)
      bannersList.querySelectorAll(".jsEditBanner").forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.id;
          const ref = doc(db, "promotions", id);
          const snap = await getDoc(ref);
          const p = snap.exists() ? snap.data() : {};

          // Load coupon cache (active & not exhausted) for linking
          const couponCache = {};
          const all = await getDocs(query(collection(db, "promotions")));
          all.forEach(d => {
            const v = d.data() || {};
            if (v.kind !== "coupon") return;
            const limit = v.usageLimit ?? null;
            const used  = v.usedCount ?? 0;
            const exhausted = limit !== null && used >= limit;
            const active = v.active !== false;
            if (!active || exhausted) return;
            couponCache[d.id] = { code: v.code || d.id, channel: v.channel, channels: v.channels || null };
          });

          const linked = Array.isArray(p.linkedCouponIds) ? p.linkedCouponIds.slice() : [];
          const deliveryChecked = !!p?.targets?.delivery;
          const diningChecked   = !!p?.targets?.dining;

          const rows = Object.entries(couponCache).map(([cid, c]) => {
            const text = `${c.code} • ${channelsToText(c)}`;
            const checked = linked.includes(cid) ? "checked" : "";
            return `<label class="row"><input type="checkbox" value="${cid}" ${checked}> <span>${text}</span></label>`;
          }).join("") || `<div class="adm-muted">(No active coupons available)</div>`;

          const pop = document.createElement("div");
          pop.className = "adm-pop";
          pop.innerHTML = `
            <div style="font-weight:600;margin-bottom:6px">Edit Banner</div>
            <div style="display:grid;grid-template-columns:120px 1fr;gap:8px;align-items:center">
              <label>Title</label>
              <input class="adm-input jsTitle" style="width:5cm" value="${p.title || ""}">
              <label>Linked Coupons</label>
              <div class="list" style="max-height:40vh;overflow:auto;min-width:260px">${rows}</div>
              <label>Publish To</label>
              <div>
                <label style="display:inline-flex;align-items:center;gap:6px;margin-right:10px">
                  <input type="checkbox" class="jsTgt" value="delivery" ${deliveryChecked?"checked":""}> <span>Delivery</span>
                </label>
                <label style="display:inline-flex;align-items:center;gap:6px">
                  <input type="checkbox" class="jsTgt" value="dining" ${diningChecked?"checked":""}> <span>Dining</span>
                </label>
              </div>
            </div>
            <div class="actions" style="margin-top:10px">
              <button class="adm-btn adm-btn--primary jsSave">Save</button>
              <button class="adm-btn jsCancel">Cancel</button>
            </div>
          `;

          const elTitle = pop.querySelector(".jsTitle");
          const btnSave = pop.querySelector(".jsSave");
          const btnCancel = pop.querySelector(".jsCancel");

          btnCancel.onclick = () => pop.classList.remove("show");
          btnSave.onclick = async () => {
            const title = (elTitle.value || "").trim();
            const ids = Array.from(pop.querySelectorAll('input[type="checkbox"]:not(.jsTgt):checked')).map(i => i.value);
            const checked = Array.from(pop.querySelectorAll(".jsTgt:checked")).map(i => i.value);
            const targets = { delivery: checked.includes("delivery"), dining: checked.includes("dining") };
            try {
              await updateDoc(ref, { title, linkedCouponIds: ids, targets, updatedAt: serverTimestamp() });
            } catch (e){ console.error(e); alert("Failed to save banner"); }
            pop.classList.remove("show");
          };

          toggleAttachedPopover(pop, btn);
        };
      });
    } 
  );  
} 


  
  // Create banner (add defaults for new features; keep your uploader flow)

  if (newBannerForm) {
    newBannerForm.onsubmit = async (e) => {
      e.preventDefault();
      const file = bannerFile?.files?.[0];
      if (!file) return alert("Pick an image");
      if (!isImageType(file)) return alert("Pick a PNG/JPEG/WEBP image");
      if (fileTooLarge(file)) return alert(`Max ${MAX_UPLOAD_MB}MB image`);

      const blob = await resizeToBannerBlob(file);
      const path = `${BANNERS_DIR}/${Date.now()}_${file.name}`;
      const ref = storageRef(storage, path);

      const imageUrl = await withTimeout(
        uploadBytesResumable(ref, blob).then(() => getDownloadURL(ref)),
        60000,
        "upload"
      );

      const id = crypto.randomUUID();
      await setDoc(doc(db, "promotions", id), {
  kind: "banner",
  title: (bannerTitle?.value || "").trim(),
  imageUrl,
  linkedCouponIds: Array.isArray(NEW_BANNER_LINKED) ? NEW_BANNER_LINKED : [],
  targets: {
    delivery: !!NEW_BANNER_TARGETS?.delivery,
    dining:  !!NEW_BANNER_TARGETS?.dining
  },
  createdAt: serverTimestamp(),
  active: true
});
 newBannerForm.reset();
    };
  }
}

// Boot once (same pattern)
import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
if (typeof window !== "undefined") {
  if (!window.__PROMOTIONS_BOOTED__) {
    window.__PROMOTIONS_BOOTED__ = true;
    onAuthStateChanged(auth, (user) => {
      if (user) { try { initPromotions?.(); } catch (e) { console.error(e); } }
    });
  }
}
