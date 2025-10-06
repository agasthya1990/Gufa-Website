# Write the additive, JS-only promotions file that preserves existing structure
# and adds the requested features "on top".
content = r"""// /admin/promotions.js
// Promotions Admin: Coupons (Dining|Delivery) + Banners + Link Coupon(s) + Publish targets
// Additive rewrite: keeps existing structure & imports, adds the requested features.
// Requires firebase.js exports { db, storage, auth }

import { db, storage } from "./firebase.js";
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp, query, orderBy, getDocs, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  ref as storageRef, uploadBytesResumable, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ===== Config =====
const BANNER_W = 200;
const BANNER_H = 50;
const BANNER_MIME = "image/jpeg";
const BANNER_QUALITY = 0.85;
const MAX_UPLOAD_MB = 10;
const BANNERS_DIR = "promoBanners";

// ===== Helpers =====
function $(id){ return document.getElementById(id); }
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

// ===== Tiny UI helpers for popover "genie" animation =====
function ensurePopoverStyles(){
  if (document.getElementById("promo-popover-css")) return;
  const css = `
  .adm-pop { position:absolute; z-index:9999; background:#fff; border:2px solid #111; border-radius:10px; box-shadow:4px 4px 0 #111; padding:10px; display:none; }
  .adm-pop.show { display:block; animation: popIn 180ms ease-out both; }
  .adm-pop .row { display:flex; align-items:center; gap:8px; padding:4px 0; }
  .adm-pop .actions { display:flex; gap:8px; justify-content:flex-end; margin-top:8px; }
  .adm-pill { display:inline-block; padding:2px 8px; border-radius:999px; border:1px solid #ddd; font-size:12px; }
  .adm-btn { border:2px solid #111; border-radius:10px; padding:6px 10px; background:#fff; cursor:pointer; box-shadow:3px 3px 0 #111; }
  .adm-btn--primary { background:#111; color:#fff; }
  .adm-muted { color:#666; }
  @keyframes popIn { from { opacity:0; transform: translateY(6px) scale(.98);} to { opacity:1; transform: translateY(0) scale(1);} }
  `;
  const s = document.createElement("style");
  s.id = "promo-popover-css";
  s.textContent = css;
  document.head.appendChild(s);
}
function toggleAttachedPopover(pop, trigger){
  ensurePopoverStyles();
  const open = pop.classList.contains("show");
  document.querySelectorAll(".adm-pop.show").forEach(el => el.classList.remove("show"));
  if (open) return;
  const r = trigger.getBoundingClientRect();
  pop.style.top = `${window.scrollY + r.bottom + 6}px`;
  pop.style.left = `${window.scrollX + r.left}px`;
  document.body.appendChild(pop);
  requestAnimationFrame(() => pop.classList.add("show"));
}

const statusPill = (active) => active
  ? `<strong style="color:#16a34a">Active</strong>`
  : `<strong style="color:#dc2626">Inactive</strong>`;

// ===== Public init (additive: keeps original layout) =====
export function initPromotions() {
  const root = document.getElementById("promotionsRoot");
  if (!root) return; // guard

  // Build UI once if empty (keep original shell)
  if (!root.dataset.wired) {
    root.dataset.wired = "1";
    root.innerHTML = `
      <h3>Coupons</h3>
      <div id="couponsList" style="margin-bottom:8px"></div>
      <form id="newCouponForm" class="adm-row" style="gap:8px">
        <input id="couponCode" class="adm-input" placeholder="Code" />
        <select id="couponChannel" class="adm-select">
          <option value="delivery">Delivery</option>
          <option value="dining">Dining</option>
        </select>
        <select id="couponType" class="adm-select">
          <option value="percent">Percent</option>
          <option value="flat">Flat</option>
        </select>
        <input id="couponValue" class="adm-input" type="number" placeholder="Value" style="width:120px" />
        <!-- usage limit gets injected just before submit -->
        <button type="submit" class="adm-btn adm-btn--primary">Add</button>
      </form>

      <h3 style="margin-top:16px">Banners</h3>
      <div id="bannersList" style="margin-bottom:8px"></div>
      <form id="newBannerForm" class="adm-row" style="gap:8px">
        <input id="bannerTitle" class="adm-input" placeholder="Title (optional)" />
        <input id="bannerFile" class="adm-file" type="file" accept="image/*" />
        <button type="submit" class="adm-btn adm-btn--primary">Upload</button>
      </form>
    `;
  }

  // Sections
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

  // ---------- Coupon form: inject Usage Limit field (optional) ----------
  if (newCouponForm && !document.getElementById("couponUsageLimit")) {
    const lim = document.createElement("input");
    lim.id = "couponUsageLimit";
    lim.className = "adm-input";
    lim.type = "number";
    lim.placeholder = "Usage Limit (optional)";
    lim.min = "1";
    lim.style.width = "160px";
    const submit = newCouponForm.querySelector('button[type="submit"], input[type="submit"]');
    newCouponForm.insertBefore(lim, submit || null);
  }

  // ---------- Coupons: live list + status toggle + usage limit column ----------
  if (couponsList) {
    onSnapshot(query(collection(db, "promotions"), orderBy("createdAt", "desc")), (snap) => {
      const rows = [];
      snap.forEach(d => {
        const p = d.data();
        if (p?.kind !== "coupon") return;
        const label = p.type === "percent" ? `${p.value}% off` : `₹${p.value} off`;
        const lim = (p.usageLimit ?? "∞");
        rows.push(`
          <div class="adm-list-row" style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px dashed #eee">
            <span class="adm-pill ${p.channel === "dining" ? "adm-pill--dining":"adm-pill--delivery"}">${p.code || d.id}</span>
            <span class="adm-muted" style="margin-left:8px">${label}</span>
            <span class="adm-muted" style="margin-left:12px">Usage Limit: <strong>${lim}</strong></span>
            <span style="margin-left:12px">${statusPill(p.active !== false)}</span>
            <span style="flex:1"></span>
            <button data-id="${d.id}" data-active="${p.active !== false}" class="adm-btn jsToggleCoupon">
              ${(p.active !== false) ? "Disable" : "Enable"}
            </button>
            <button data-id="${d.id}" class="adm-btn jsDelCoupon">Delete</button>
          </div>
        `);
      });
      couponsList.innerHTML = rows.join("") || `<div class="adm-muted">(No coupons)</div>`;

      // Toggle status
      couponsList.querySelectorAll(".jsToggleCoupon").forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.id;
          const currentlyActive = btn.dataset.active === "true";
          btn.disabled = true;
          try {
            await updateDoc(doc(db, "promotions", id), { active: !currentlyActive, updatedAt: serverTimestamp() });
          } catch (e){ console.error(e); alert("Failed to update status."); }
          finally { btn.disabled = false; }
        };
      });

      // Delete
      couponsList.querySelectorAll(".jsDelCoupon").forEach(btn => {
        btn.onclick = async () => {
          if (!confirm("Delete this coupon?")) return;
          btn.disabled = true;
          try { await deleteDoc(doc(db, "promotions", btn.dataset.id)); }
          finally { btn.disabled = false; }
        };
      });
    });
  }

  // Create coupon with usage limit + defaults
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

  // ---------- Banners: live list + link coupons + publish targets + status toggle ----------
  if (bannersList) {
    onSnapshot(query(collection(db, "promotions"), orderBy("createdAt", "desc")), (snap) => {
      const rows = [];
      snap.forEach(d => {
        const p = d.data();
        if (p?.kind !== "banner") return;
        const publishedTo = (p.targets && (p.targets.delivery || p.targets.dining))
          ? ["delivery","dining"].filter(k => p.targets?.[k]).map(k => k[0].toUpperCase()+k.slice(1)).join(", ")
          : "<span class='adm-muted'>—</span>";
        rows.push(`
          <div class="adm-list-row" data-id="${d.id}" style="display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px dashed #eee">
            <img src="${p.imageUrl}" alt="" width="80" height="20" style="object-fit:cover;border-radius:6px;border:1px solid #eee"/>
            <span style="margin-left:8px">${p.title || "(untitled)"}</span>
            <span class="adm-muted" style="margin-left:12px">Published To: ${publishedTo}</span>
            <span style="margin-left:12px">${statusPill(p.active !== false)}</span>
            <span style="flex:1"></span>
            <button class="adm-btn jsLinkCoupons" data-id="${d.id}">Link Coupons</button>
            <button class="adm-btn jsPublish" data-id="${d.id}">Publish</button>
            <button class="adm-btn jsToggleBanner" data-id="${d.id}" data-active="${p.active !== false}">${(p.active !== false) ? "Disable" : "Enable"}</button>
            <button class="adm-btn jsDelBanner" data-id="${d.id}">Delete</button>
          </div>
        `);
      });
      bannersList.innerHTML = rows.join("") || `<div class="adm-muted">(No banners)</div>`;

      // Wire deletes
      bannersList.querySelectorAll(".jsDelBanner").forEach(btn => {
        btn.onclick = async () => {
          if (!confirm("Delete this banner?")) return;
          btn.disabled = true;
          try { await deleteDoc(doc(db, "promotions", btn.dataset.id)); }
          finally { btn.disabled = false; }
        };
      });

      // Wire status toggle
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

      // Wire Link Coupons popovers
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

          // Fetch coupons (only Active and not exhausted)
          const qs = query(collection(db, "promotions"));
          const snapAll = await getDocs(qs);
          const rows = [];
          snapAll.forEach(docu => {
            const v = docu.data() || {};
            if (v.kind !== "coupon") return;
            const limit = v.usageLimit ?? null;
            const used = v.usedCount ?? 0;
            const exhausted = limit !== null && used >= limit;
            const active = v.active !== false;
            if (!active || exhausted) return; // hide inactive/exhausted from selection
            const title = v.type === "percent" ? `${v.value}% off` : `₹${v.value} off`;
            rows.push({ id: docu.id, label: `${v.code || docu.id} • ${title} • ${(v.channel === "dining") ? "Dining" : "Delivery"}` });
          });
          if (!rows.length) {
            listEl.innerHTML = `<div class="adm-muted">(No active coupons available)</div>`;
          } else {
            listEl.innerHTML = rows.map(r => `
              <label class="row"><input type="checkbox" value="${r.id}"> <span>${r.label}</span></label>
            `).join("");
          }

          btnCancel.onclick = () => pop.classList.remove("show");
          btnSave.onclick = async () => {
            const ids = Array.from(listEl.querySelectorAll("input[type=checkbox]:checked")).map(i => i.value);
            try { await updateDoc(doc(db, "promotions", id), { linkedCouponIds: ids, updatedAt: serverTimestamp() }); }
            catch (err){ console.error(err); alert("Failed to link coupons."); }
            pop.classList.remove("show");
          };

          toggleAttachedPopover(pop, btn);
        };
      });

      // Wire Publish popovers (Delivery/Dining checkboxes)
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
    });
  }

  // Create banner (include default fields for new features)
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

// Boot once (safe)
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
print(path)
