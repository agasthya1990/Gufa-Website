// /admin/promotions.js
// Promotions Admin: Coupons (Dining|Delivery) + Banners + Link Coupon(s) + Publish targets
// Lean additive rewrite: preserves your original structure & imports; only adds features.
// Requires firebase.js exports { db, storage }

import { db, storage } from "./firebase.js";
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot,
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
function toggleAttachedPopover(pop, trigger){
  ensurePopoverStyles();
  ensureColumnStyles();
  const open = pop.classList.contains("show");
  document.querySelectorAll(".adm-pop.show").forEach(el => el.classList.remove("show"));
  if (open) return;
  const r = trigger.getBoundingClientRect();
  pop.style.top = `${window.scrollY + r.bottom + 6}px`;
  pop.style.left = `${window.scrollX + r.left}px`;
  document.body.appendChild(pop);
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
  <div>
    <select id="couponChannel" class="adm-select">
      <option value="delivery">Delivery</option>
      <option value="dining">Dining</option>
    </select>
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
  <div><strong style="color:#16a34a">Active</strong></div>
  <div class="adm-actions">
  <button type="submit" class="adm-btn adm-btn--primary">Add</button>
  </div>
</form>
<div id="couponsList" style="margin-bottom:12px"></div>
<h3>Banners</h3>
<form id="newBannerForm" class="adm-grid adm-grid-banners" style="margin-bottom:8px">
  <div><input id="bannerFile" class="adm-file" type="file" accept="image/*" /></div>
  <div><input id="bannerTitle" class="adm-input" placeholder="Title (optional)" /></div>
  <div class="adm-muted">—</div>
  <div class="adm-muted">—</div>
  <div><strong style="color:#16a34a">Active</strong></div>
  <div class="adm-actions">
    <button type="submit" class="adm-btn adm-btn--primary">Upload</button>
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
        const lim      = (p.usageLimit ?? "∞");
        const chan     = (p.channel === "dining") ? "Dining" : "Delivery";

        rows.push(`
          <div class="adm-grid adm-grid-coupons">
            <div><span class="adm-pill ${p.channel === "dining" ? "adm-pill--dining" : "adm-pill--delivery"}">${p.code || d.id}</span></div>
            <div>${chan}</div>
            <div class="adm-muted">${valueTxt}</div>
            <div class="adm-muted"><strong>${lim}</strong></div>
            <div>${statusPill(p.active !== false)}</div>
            <div class="adm-actions">
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
      const channel = chanInput?.value || "delivery";
      const type = typeInput?.value || "percent";
      const value = Number(valInput?.value || 0);
      const limInput = document.getElementById("couponUsageLimit");
      const usageLimit = limInput?.value ? Number(limInput.value) : null;

      if (!code || !(value > 0)) return alert("Enter code and positive value");
      if (usageLimit !== null && !(usageLimit > 0)) return alert("Usage limit must be a positive number.");

      const id = crypto.randomUUID();
      await setDoc(doc(db, "promotions", id), {
        kind: "coupon",
        code, channel, type, value,
        usageLimit: usageLimit ?? null,
        usedCount: 0,
        active: true,
        createdAt: serverTimestamp(),
      });
      newCouponForm.reset();
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
              <button class="adm-btn jsLinkCoupons" data-id="${d.id}">Link Coupons</button>
              <button class="adm-btn jsPublish" data-id="${d.id}">Publish</button>
              <button class="adm-btn jsToggleBanner" data-id="${d.id}" data-active="${p.active !== false}">${(p.active !== false) ? "Disable" : "Enable"}</button>
              <button class="adm-btn jsDelBanner" data-id="${d.id}">Delete</button>
            </div>
          </div>
        `);
      });

      bannersList.innerHTML = rows.length
        ? (headerB + rows.join(""))
        : (headerB + `<div class="adm-muted" style="padding:8px">No banners</div>`);


      // Delete (kept)
      bannersList.querySelectorAll(".jsDelBanner").forEach(btn => {
        btn.onclick = async () => {
          if (!confirm("Delete this banner?")) return;
          btn.disabled = true;
          try { await deleteDoc(doc(db, "promotions", btn.dataset.id)); }
          finally { btn.disabled = false; }
        };
      });

      // Enable/Disable (kept)
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

      // Link Coupons popover (active + not-exhausted) — kept
      bannersList.querySelectorAll(".jsLinkCoupons").forEach(btn => {
        btn.onclick = async (e) => {
          e.preventDefault();
          const id = btn.dataset.id;
          const pop = document.createElement("div");
          pop.className = "adm-pop";
          pop.innerHTML = `
            <div style="font-weight:600;margin-bottom:6px">Link Coupons</div>
            <div class="list" style="max-height:40vh;overflow:auto;min-width:260px"></div>
            <div class="actions">
              <button class="adm-btn adm-btn--primary jsSave">Save</button>
              <button class="adm-btn jsCancel">Cancel</button>
            </div>
          `;
          const listEl = pop.querySelector(".list");
          const btnSave = pop.querySelector(".jsSave");
          const btnCancel = pop.querySelector(".jsCancel");

          // One-shot fetch of coupons (active & not exhausted)
          const snapAll = await getDocs(query(collection(db, "promotions")));
          const rowsC = [];
          snapAll.forEach(docu => {
            const v = docu.data() || {};
            if (v.kind !== "coupon") return;
            const limit = v.usageLimit ?? null;
            const used = v.usedCount ?? 0;
            const exhausted = limit !== null && used >= limit;
            const active = v.active !== false;
            if (!active || exhausted) return;
            const title = v.type === "percent" ? `${v.value}% off` : `₹${v.value} off`;
            rowsC.push({ id: docu.id, label: `${v.code || docu.id} • ${title} • ${(v.channel === "dining") ? "Dining" : "Delivery"}` });
          });
          listEl.innerHTML = rowsC.length
            ? rowsC.map(r => `<label class="row"><input type="checkbox" value="${r.id}"> <span>${r.label}</span></label>`).join("")
            : `<div class="adm-muted">(No active coupons available)</div>`;

          btnCancel.onclick = () => pop.classList.remove("show");
          btnSave.onclick = async () => {
            const ids = Array.from(listEl.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
            try { await updateDoc(doc(db, "promotions", id), { linkedCouponIds: ids, updatedAt: serverTimestamp() }); }
            catch (err){ console.error(err); alert("Failed to link coupons."); }
            pop.classList.remove("show");
          };

          toggleAttachedPopover(pop, btn);
        };
      });

      // Publish popover (Delivery/Dining) — kept
      bannersList.querySelectorAll(".jsPublish").forEach(btn => {
        btn.onclick = async (e) => {
          e.preventDefault();
          const id = btn.dataset.id;
          const pop = document.createElement("div");
          pop.className = "adm-pop";
          pop.innerHTML = `
            <div style="font-weight:600;margin-bottom:6px">Publish Banner To</div>
            <label class="row"><input type="checkbox" value="delivery" class="jsTarget"> <span>Delivery Menu</span></label>
            <label class="row"><input type="checkbox" value="dining" class="jsTarget"> <span>Dining Menu</span></label>
            <div class="actions">
              <button class="adm-btn adm-btn--primary jsSave">Save</button>
              <button class="adm-btn jsCancel">Cancel</button>
            </div>
          `;
          const btnSave = pop.querySelector(".jsSave");
          const btnCancel = pop.querySelector(".jsCancel");

          btnCancel.onclick = () => pop.classList.remove("show");
          btnSave.onclick = async () => {
            const checked = Array.from(pop.querySelectorAll(".jsTarget:checked")).map(i => i.value);
            const targets = { delivery: checked.includes("delivery"), dining: checked.includes("dining") };
            try { await updateDoc(doc(db, "promotions", id), { targets, updatedAt: serverTimestamp() }); }
            catch (err){ console.error(err); alert("Failed to publish banner."); }
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
        linkedCouponIds: [],
        targets: { delivery: false, dining: false },
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
