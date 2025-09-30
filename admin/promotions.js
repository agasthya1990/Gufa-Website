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

// ===== Public init (safe no-op if elements aren’t present) =====
export function initPromotions() {
  const root = document.getElementById("promotionsRoot");
  if (!root) return;

  // Sections
  const couponsList = document.getElementById("couponsList");
  const couponForm  = document.getElementById("couponForm");
  const bannerForm  = document.getElementById("bannerForm");

  // ===== COUPONS (Kind = coupon only) =====
  onSnapshot(
    query(collection(db, "promotions"), orderBy("createdAt", "desc")),
    (snap) => {
      const rows = [];
      snap.forEach((d) => {
        const p = d.data() || {};
        if (p.kind !== "coupon") return; // ← only coupons
        const typeTxt = p.type === "percent" ? `${p.value}% off` : `₹${p.value} off`;
        const chanTxt = p.channel === "dining" ? "Dining" : "Delivery";
        rows.push(`
          <div class="coupon-row" data-id="${d.id}">
            <div><strong>${p.code || "(no code)"}</strong> — ${chanTxt} — ${typeTxt}</div>
            <div>
              <button data-role="edit">Edit</button>
              <button data-role="delete">Delete</button>
            </div>
          </div>
        `);
      });
      couponsList.innerHTML = rows.join("") || `<div class="muted">(No coupons)</div>`;
    }
  );

  couponForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(couponForm);
    const code    = (fd.get("code") || "").toString().trim();
    const channel = (fd.get("channel") || "delivery").toString();   // 'dining' | 'delivery'
    const type    = (fd.get("type") || "percent").toString();       // 'percent' | 'flat'
    const value   = Number(fd.get("value") || 0);

    if (!code || !Number.isFinite(value) || value <= 0) {
      alert("Enter a code and a positive value."); return;
    }
    const id = crypto.randomUUID();
    await setDoc(doc(db, "promotions", id), {
      kind: "coupon", code, channel, type, value,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    couponForm.reset();
  });

  couponsList?.addEventListener("click", async (e) => {
    const row = e.target.closest(".coupon-row");
    if (!row) return;
    const role = e.target.getAttribute("data-role");
    const id = row.getAttribute("data-id");

    if (role === "delete") {
      if (!confirm("Delete this coupon?")) return;
      await deleteDoc(doc(db, "promotions", id));
    }
    if (role === "edit") {
      const newValue = Number(prompt("New value:"));
      if (!Number.isFinite(newValue) || newValue <= 0) return;
      await updateDoc(doc(db, "promotions", id), { value: newValue, updatedAt: serverTimestamp() });
    }
  });

  // ===== BANNERS (optional tiny banner uploader) =====
  bannerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = bannerForm.querySelector('input[type="file"]')?.files?.[0];
    if (!file) return alert("Pick an image");
    if (!isImageType(file)) return alert("Use png/jpg/webp");
    if (fileTooLarge(file)) return alert(`File must be <= ${MAX_UPLOAD_MB} MB`);

    const blob = await resizeToBannerBlob(file);
    const ref = storageRef(storage, `${BANNERS_DIR}/${Date.now()}_${file.name}`);
    await withTimeout(uploadBytesResumable(ref, blob), 30_000, "upload");
    const url = await withTimeout(getDownloadURL(ref), 10_000, "getDownloadURL");
    alert("Uploaded banner.\nURL:\n" + url);
  });
}
