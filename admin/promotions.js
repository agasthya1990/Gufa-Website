// /admin/promotions.js
// Promotions Admin: Coupons (Dining|Delivery) + Banners + Link Coupon(s)
// Requires firebase.js exports { db, storage }

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

// ===== Public init (safe: if the promo page elements aren’t present, it no-ops) =====
export function initPromotions() {
  const root = document.getElementById("promotionsRoot");
  if (!root) return; // ✅ guard before using root

  // Build UI once if empty
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

  // ---------- Coupons ----------
  if (couponsList) {
    onSnapshot(query(collection(db, "promotions"), orderBy("createdAt", "desc")), (snap) => {
      const rows = [];
      snap.forEach(d => {
        const p = d.data();
        if (p?.kind !== "coupon") return;
        const label = p.type === "percent" ? `${p.value}% off` : `₹${p.value} off`;
        rows.push(`
          <div class="adm-list-row">
            <span class="adm-pill ${p.channel === "dining" ? "adm-pill--dining":"adm-pill--delivery"}">${p.code || d.id}</span>
            <span class="adm-muted" style="margin-left:8px">${label}</span>
            <span style="flex:1"></span>
            <button data-id="${d.id}" class="adm-btn jsDelCoupon">Delete</button>
          </div>
        `);
      });
      couponsList.innerHTML = rows.join("") || `<div class="adm-muted">(No coupons)</div>`;
      couponsList.querySelectorAll(".jsDelCoupon").forEach(btn => {
        btn.onclick = async () => {
          if (!confirm("Delete this coupon?")) return;
          btn.disabled = true; // ✅ prevent double-click
          try { await deleteDoc(doc(db, "promotions", btn.dataset.id)); }
          finally { btn.disabled = false; }
        };
      });
    });
  }

  if (newCouponForm) {
    newCouponForm.onsubmit = async (e) => {
      e.preventDefault();
      const code = (codeInput?.value || "").trim();
      const channel = chanInput?.value || "delivery";
      const type = typeInput?.value || "percent";
      const value = Number(valInput?.value || 0);
      if (!code || !(value > 0)) return alert("Enter code and positive value");

      const id = crypto.randomUUID();
      await setDoc(doc(db, "promotions", id), {
        kind: "coupon",
        code, channel, type, value,
        createdAt: serverTimestamp(),
        active: true
      });
      newCouponForm.reset();
    };
  }

  // ---------- Banners ----------
  if (bannersList) {
    onSnapshot(query(collection(db, "promotions"), orderBy("createdAt", "desc")), (snap) => {
      const rows = [];
      snap.forEach(d => {
        const p = d.data();
        if (p?.kind !== "banner") return;
        rows.push(`
          <div class="adm-list-row">
            <img src="${p.imageUrl}" alt="" width="80" height="20" style="object-fit:cover;border-radius:6px;border:1px solid #eee"/>
            <span style="margin-left:8px">${p.title || "(untitled)"}</span>
            <span style="flex:1"></span>
            <button data-id="${d.id}" class="adm-btn jsDelBanner">Delete</button>
          </div>
        `);
      });
      bannersList.innerHTML = rows.join("") || `<div class="adm-muted">(No banners)</div>`;
      bannersList.querySelectorAll(".jsDelBanner").forEach(btn => {
        btn.onclick = async () => {
          if (!confirm("Delete this banner?")) return;
          btn.disabled = true; // ✅ prevent double-click
          try { await deleteDoc(doc(db, "promotions", btn.dataset.id)); }
          finally { btn.disabled = false; }
        };
      });
    });
  }

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

      // ✅ one downloadURL call only
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
        createdAt: serverTimestamp(),
        active: true
      });
      newBannerForm.reset();
    };
  }
}

// Boot once (safe)
if (typeof window !== "undefined") {
  if (!window.__PROMOTIONS_BOOTED__) {
    window.__PROMOTIONS_BOOTED__ = true;
    try { initPromotions?.(); } catch (e) { console.error(e); }
  }
}
