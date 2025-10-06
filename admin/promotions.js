# Create a clean, JavaScript-only promotions.js file that matches the user's import pattern
from pathlib import Path

js = r"""// /admin/promotions.js — FULL, CLEAN REWRITE (JS-only)
// Promotions Admin: Coupons (Dining|Delivery) + Banners + Link Coupons + Publish targets
// Preserves earlier flows (add/delete/list + banner resize/upload) and adds:
// - Coupon usageLimit & usedCount, Status + Enable/Disable, Usage Limit column
// - Banner Link Coupons popover, Publish (Delivery/Dining) popover, Published To column
// - Banner Enable/Disable
// - Filters hide inactive/exhausted coupons in selectors
//
// Requires firebase.js to export: db, storage, auth
// DOM contract (admin.html):
//   #promotionsRoot
//   Coupon form:   #newCouponForm with inputs #couponCode #couponChannel #couponType #couponValue
//                  (script adds #couponUsageLimit if missing)
//   Coupon list:   #couponsList
//   Banner form:   #newBannerForm with inputs #bannerTitle #bannerFile
//   Banner list:   #bannersList

import { db, storage } from "./firebase.js";
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp, query, orderBy
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
const $ = (id) => document.getElementById(id);
const isImageType = (file) => file && /^image\/(png|jpe?g|webp)$/i.test(file.type);
const fileTooLarge = (file) => file && file.size > MAX_UPLOAD_MB * 1024 * 1024;

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

function ensurePopoverStyles(){
  if (document.getElementById("promo-popover-css")) return;
  const css = `
    .adm-pop { position:absolute; z-index:9999; background:#fff; border:2px solid #111;
      border-radius:10px; box-shadow:4px 4px 0 #111; padding:10px; display:none; }
    .adm-pop.show { display:block; animation: popIn 160ms ease-out both; }
    @keyframes popIn { from {opacity:0; transform: translateY(6px) scale(.98);} to {opacity:1; transform:none;} }
    .adm-pill { display:inline-block; padding:2px 6px; border:2px solid #222; border-radius:999px; font-size:12px; }
    .adm-list-row { display:flex; align-items:center; gap:8px; padding:6px 8px; border-bottom:1px dashed #eee; }
    .adm-btn { border:2px solid #111; background:#fff; padding:4px 8px; border-radius:8px; cursor:pointer; }
    .adm-btn[disabled] { opacity:.6; cursor:not-allowed; }
    .adm-input { border:2px solid #111; border-radius:8px; padding:4px 8px; }
    .adm-select { border:2px solid #111; border-radius:8px; padding:4px 8px; }
    .adm-muted { opacity:.7; }
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

const pill = (txt, color) => `<span class="adm-pill" style="border-color:${color};">${txt}</span>`;
const statusPill = (active) => active
  ? `<strong style="color:#16a34a">Active</strong>`
  : `<strong style="color:#dc2626">Inactive</strong>`;

// ===== Main =====
export function initPromotions(){
  const root = $("promotionsRoot");
  if (!root) return; // guard

  ensurePopoverStyles();

  // Build the shell once if needed
  if (!root.dataset.wired){
    root.dataset.wired = "1";
    root.innerHTML = `
      <h3>Coupons</h3>
      <div id="couponsList" style="margin-bottom:8px"></div>
      <form id="newCouponForm" class="adm-row" style="gap:8px">
        <input id="couponCode" class="adm-input" placeholder="Code" autocomplete="off"/>
        <select id="couponChannel" class="adm-select">
          <option value="delivery">Delivery</option>
          <option value="dining">Dining</option>
        </select>
        <select id="couponType" class="adm-select">
          <option value="percent">Percent</option>
          <option value="flat">Flat</option>
        </select>
        <input id="couponValue" class="adm-input" type="number" placeholder="Value" style="width:120px" />
        <!-- usage limit inserted by script if not present -->
        <button type="submit" class="adm-btn">Add</button>
      </form>

      <h3 style="margin-top:16px">Banners</h3>
      <div id="bannersList" style="margin-bottom:8px"></div>
      <form id="newBannerForm" class="adm-row" style="gap:8px">
        <input id="bannerTitle" class="adm-input" placeholder="Title (optional)" />
        <input id="bannerFile" class="adm-file" type="file" accept="image/*" />
        <button type="submit" class="adm-btn">Upload</button>
      </form>
    `;
  }

  // Elements
  const newCouponForm = $("newCouponForm");
  const couponsList = $("couponsList");

  const newBannerForm = $("newBannerForm");
  const bannersList = $("bannersList");

  // 1) Ensure Usage Limit input exists
  (function ensureUsageLimitField(){
    if (!newCouponForm) return;
    if (!$("#couponUsageLimit")){
      const lim = document.createElement("input");
      lim.id = "couponUsageLimit";
      lim.type = "number";
      lim.min = "1";
      lim.placeholder = "Usage limit (optional)";
      lim.className = "adm-input";
      lim.style.width = "180px";
      const submit = newCouponForm.querySelector('button[type="submit"], input[type="submit"]');
      newCouponForm.insertBefore(lim, submit || null);
    }
  })();

  // 2) Create coupon
  if (newCouponForm){
    const codeInput = $("couponCode");
    const chanInput = $("couponChannel");
    const typeInput = $("couponType");
    const valInput  = $("couponValue");
    const limInput  = $("couponUsageLimit");

    newCouponForm.onsubmit = async (e) => {
      e.preventDefault();
      const code = (codeInput?.value || "").trim();
      const channel = chanInput?.value || "delivery";
      const type = typeInput?.value || "percent";
      const value = Number(valInput?.value || 0);
      const usageLimit = limInput?.value ? Number(limInput.value) : null;

      if (!code) return alert("Enter a coupon code.");
      if (!(value > 0)) return alert("Enter a positive discount value.");
      if (usageLimit !== null && !(usageLimit > 0)) return alert("Usage limit must be positive.");

      const id = crypto.randomUUID();
      const payload = {
        kind: "coupon",
        code, channel, type, value,
        usageLimit: usageLimit ?? null,
        usedCount: 0,
        active: true,
        createdAt: serverTimestamp(),
      };
      newCouponForm.querySelectorAll("button, input[type=submit]").forEach(b => b.disabled = true);
      try {
        await setDoc(doc(db, "promotions"), payload).then(() => {});
        // use doc with random ID via add: but we want our UUID — mimic by setDoc with explicit id:
      } catch (_) {}
      try {
        await setDoc(doc(db, "promotions", id), payload);
        newCouponForm.reset();
      } catch (err){
        console.error(err);
        alert("Failed to save coupon.");
      } finally {
        newCouponForm.querySelectorAll("button, input[type=submit]").forEach(b => b.disabled = false);
      }
    };
  }

  // 3) Coupons list
  if (couponsList){
    onSnapshot(query(collection(db, "promotions"), orderBy("createdAt","desc")), (snap) => {
      const rows = [];
      snap.forEach(d => {
        const p = d.data();
        if (p?.kind !== "coupon") return;
        const label = p.type === "percent" ? `${p.value}% off` : `₹${p.value} off`;
        const lim = (p.usageLimit ?? "∞");
        rows.push(`
          <div class="adm-list-row">
            ${pill(p.channel === "dining" ? "Dining" : "Delivery", p.channel === "dining" ? "#bde0bd" : "#bed2ff")}
            <span class="_name" style="margin-left:6px">${p.code || d.id}</span>
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

      couponsList.querySelectorAll(".jsDelCoupon").forEach(btn => {
        btn.onclick = async () => {
          if (!confirm("Delete this coupon?")) return;
          btn.disabled = true;
          try { await deleteDoc(doc(db, "promotions", btn.dataset.id)); }
          catch(e){ console.error(e); alert("Delete failed."); }
          finally { btn.disabled = false; }
        };
      });
    });
  }

  // 4) Create banner
  if (newBannerForm){
    const titleInput = $("bannerTitle");
    const fileInput  = $("bannerFile");

    newBannerForm.onsubmit = async (e) => {
      e.preventDefault();
      const title = (titleInput?.value || "").trim();
      const file = fileInput?.files?.[0];

      if (!file || !isImageType(file)) return alert("Choose a PNG/JPG/WEBP image.");
      if (fileTooLarge(file)) return alert(`Max file size ${MAX_UPLOAD_MB} MB.`);

      newBannerForm.querySelectorAll("button, input[type=submit]").forEach(b => b.disabled = true);
      try{
        const blob = await resizeToBannerBlob(file);
        const path = `${BANNERS_DIR}/${Date.now()}_${file.name}`;
        const ref = storageRef(storage, path);
        await uploadBytesResumable(ref, blob);
        const imageUrl = await getDownloadURL(ref);

        const id = crypto.randomUUID();
        await setDoc(doc(db, "promotions", id), {
          kind: "banner",
          title: title || file.name,
          imageUrl,
          linkedCouponIds: [],
          targets: { delivery:false, dining:false },
          active: true,
          createdAt: serverTimestamp(),
        });
        newBannerForm.reset();
      } catch (err){
        console.error(err);
        alert("Failed to upload banner.");
      } finally {
        newBannerForm.querySelectorAll("button, input[type=submit]").forEach(b => b.disabled = false);
      }
    };
  }

  // 5) Banners list
  if (bannersList){
    onSnapshot(query(collection(db, "promotions"), orderBy("createdAt","desc")), (snap) => {
      const rows = [];
      snap.forEach(d => {
        const p = d.data();
        if (p?.kind !== "banner") return;

        const targets = p.targets || { delivery:false, dining:false };
        const pubTo = [
          targets.delivery ? "Delivery" : null,
          targets.dining ? "Dining" : null
        ].filter(Boolean).join(", ") || "—";

        rows.push(`
          <div class="adm-list-row" data-id="${d.id}">
            <img src="${p.imageUrl}" alt="" width="80" height="20" style="object-fit:cover;border-radius:6px;border:1px solid #eee"/>
            <span style="margin-left:8px" class="_name">${p.title || "(untitled)"}</span>
            <span style="margin-left:12px">Published To: <strong>${pubTo}</strong></span>
            <span style="flex:1"></span>
            <button class="adm-btn jsLinkCoupons">Link Coupons</button>
            <button class="adm-btn jsPublish">Publish</button>
            <button class="adm-btn jsToggleBanner" data-active="${p.active !== false}">${(p.active !== false) ? "Disable" : "Enable"}</button>
            <button class="adm-btn jsDelBanner">Delete</button>
          </div>
        `);
      });
      bannersList.innerHTML = rows.join("") || `<div class="adm-muted">(No banners)</div>`;

      // Delete
      bannersList.querySelectorAll(".jsDelBanner").forEach(btn => {
        btn.onclick = async () => {
          if (!confirm("Delete this banner?")) return;
          btn.disabled = true;
          try { await deleteDoc(doc(db, "promotions", btn.closest(".adm-list-row").dataset.id)); }
          catch(e){ console.error(e); alert("Delete failed."); }
          finally { btn.disabled = false; }
        };
      });

      // Enable/Disable
      bannersList.querySelectorAll(".jsToggleBanner").forEach(btn => {
        btn.onclick = async () => {
          const row = btn.closest(".adm-list-row");
          const id = row.dataset.id;
          const active = btn.dataset.active === "true";
          btn.disabled = true;
          try { await updateDoc(doc(db, "promotions", id), { active: !active, updatedAt: serverTimestamp() }); }
          catch(e){ console.error(e); alert("Failed to update status."); }
          finally { btn.disabled = false; }
        };
      });

      // Link Coupons (active + not exhausted)
      bannersList.querySelectorAll(".jsLinkCoupons").forEach(btn => {
        btn.onclick = async () => {
          const row = btn.closest(".adm-list-row");
          const bannerId = row.dataset.id;
          const panel = document.createElement("div");
          panel.className = "adm-pop";
          panel.innerHTML = `
            <div style="max-height:40vh; overflow:auto; min-width:300px">
              <strong>Link Coupons</strong>
              <div id="cpList" style="margin:8px 0"></div>
              <div style="display:flex; gap:8px; justify-content:flex-end">
                <button class="adm-btn jsCpSave">Save</button>
                <button class="adm-btn jsCpCancel">Cancel</button>
              </div>
            </div>
          `;
          toggleAttachedPopover(panel, btn);

          // Build coupons checklist
          const cpList = panel.querySelector("#cpList");
          const actives = [];
          await new Promise((resolve, reject) => {
            const unsub = onSnapshot(query(collection(db, "promotions"), orderBy("createdAt","desc")), (ss) => {
              ss.forEach(docu => {
                const v = docu.data();
                if (v?.kind === "coupon" && v.active !== false) {
                  if (typeof v.usageLimit === "number" && typeof v.usedCount === "number" && v.usedCount >= v.usageLimit) {
                    return; // skip exhausted
                  }
                  const label = `${v.code} • ${(v.type==="percent")?v.value+"%":("₹"+v.value)} • ${v.channel}`;
                  actives.push({ id: docu.id, label });
                }
              });
              unsub();
              resolve();
            }, reject);
          });

          cpList.innerHTML = actives.length
            ? actives.map(c => `<label class="adm-list-row"><input type="checkbox" value="${c.id}"/> <span>${c.label}</span></label>`).join("")
            : `<div class="adm-muted">(No active coupons)</div>`;

          panel.querySelector(".jsCpCancel").onclick = () => panel.remove();
          panel.querySelector(".jsCpSave").onclick = async () => {
            const ids = Array.from(panel.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
            try {
              panel.querySelector(".jsCpSave").disabled = true;
              await updateDoc(doc(db, "promotions", bannerId), { linkedCouponIds: ids, updatedAt: serverTimestamp() });
              panel.remove();
            } catch(e){ console.error(e); alert("Failed to save links."); }
            finally { panel.querySelector(".jsCpSave").disabled = false; }
          };
        };
      });

      // Publish (choose Delivery/Dining)
      bannersList.querySelectorAll(".jsPublish").forEach(btn => {
        btn.onclick = async () => {
          const row = btn.closest(".adm-list-row");
          const bannerId = row.dataset.id;
          const panel = document.createElement("div");
          panel.className = "adm-pop";
          panel.innerHTML = `
            <div style="min-width:260px">
              <strong>Publish To</strong>
              <label class="adm-list-row"><input type="checkbox" id="pubDelivery"/> <span>Delivery</span></label>
              <label class="adm-list-row"><input type="checkbox" id="pubDining"/> <span>Dining</span></label>
              <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:8px">
                <button class="adm-btn jsPubSave">Save</button>
                <button class="adm-btn jsPubCancel">Cancel</button>
              </div>
            </div>
          `;
          toggleAttachedPopover(panel, btn);

          panel.querySelector(".jsPubCancel").onclick = () => panel.remove();
          panel.querySelector(".jsPubSave").onclick = async () => {
            const delivery = panel.querySelector("#pubDelivery").checked;
            const dining   = panel.querySelector("#pubDining").checked;
            try {
              panel.querySelector(".jsPubSave").disabled = true;
              await updateDoc(doc(db, "promotions", bannerId), {
                targets: { delivery, dining }, updatedAt: serverTimestamp()
              });
              panel.remove();
            } catch(e){ console.error(e); alert("Failed to publish."); }
            finally { panel.querySelector(".jsPubSave").disabled = false; }
          };
        };
      });
    });
  }
}

// Boot once (auth-gated like your previous version)
import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
if (typeof window !== "undefined"){
  if (!window.__PROMOTIONS_BOOTED__){
    window.__PROMOTIONS_BOOTED__ = true;
    onAuthStateChanged(auth, (user) => {
      if (user) { try { initPromotions?.(); } catch (e) { console.error(e); } }
    });
  }
}
"""

Path("/mnt/data/promotions.fixed.js").write_text(js, encoding="utf-8")
print("Wrote /mnt/data/promotions.fixed.js")
