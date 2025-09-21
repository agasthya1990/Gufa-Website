// /admin/promotions.js  (rewrite to match your Firestore fields)
import { db } from "./firebase.js";
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// Use default bucket for this project (fixes earlier bucket mismatch)
const storage = getStorage(gs://gufa-restaurant.firebasestorage.app);

/* =========================
   Banner resize parameters
   ========================= */
const BANNER_W = 1600;
const BANNER_H = 600;
const BANNER_MIME = "image/jpeg";
const BANNER_QUALITY = 0.85;
const MAX_UPLOAD_MB = 10;

/* ============ Helpers ============ */
function isImage(file) {
  return file && /^image\//i.test(file.type);
}
function fileTooLarge(file) {
  return file && file.size > MAX_UPLOAD_MB * 1024 * 1024;
}
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = e => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = e.target.result;
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
/** Cover-crops to BANNER_W×BANNER_H and returns a JPEG Blob. */
async function resizeToBannerBlob(file) {
  const img = await fileToImage(file);
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const targetRatio = BANNER_W / BANNER_H;
  const srcRatio = sw / sh;

  let sx, sy, sWidth, sHeight;
  if (srcRatio > targetRatio) { // wider -> crop sides
    sHeight = sh;
    sWidth = Math.round(sh * targetRatio);
    sx = Math.round((sw - sWidth) / 2);
    sy = 0;
  } else { // taller/narrower -> crop top/bottom
    sWidth = sw;
    sHeight = Math.round(sw / targetRatio);
    sx = 0;
    sy = Math.round((sh - sHeight) / 2);
  }

  const canvas = document.createElement("canvas");
  canvas.width = BANNER_W;
  canvas.height = BANNER_H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, BANNER_W, BANNER_H);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error("Failed to generate banner blob"))),
      BANNER_MIME,
      BANNER_QUALITY
    );
  });
}

/* ============ UI bootstrap ============ */
export function initPromotions() {
  let root = document.getElementById("promotionsRoot");
  if (!root) {
    root = document.createElement("section");
    root.id = "promotionsRoot";
    document.body.appendChild(root);
  }
  root.innerHTML = `
    <div class="adm-card" style="margin:12px 0">
      <h3 style="margin:0 0 8px">Coupons</h3>
      <div class="adm-form-grid">
        <form id="couponForm" class="full">
          <div class="adm-form-grid">
            <input id="cCode" name="code" class="adm-input" placeholder="CODE (e.g., WELCOME10)" />
            <select id="cType" name="type" class="adm-select">
              <option value="percent">% off</option>
              <option value="flat">Flat ₹</option>
            </select>
            <input id="cValue" name="value" type="number" class="adm-input" placeholder="Value" />
            <input id="cMin" name="minOrder" type="number" class="adm-input" placeholder="Min Order (₹)" />
            <input id="cUsage" name="usageLimit" type="number" class="adm-input" placeholder="Usage Limit (optional)" />
            <input id="cUserLimit" name="perUserLimit" type="number" class="adm-input" placeholder="Per-user Limit (optional)" />
            <div class="full adm-row" style="justify-content:flex-end; gap:12px;">
              <label class="adm-row"><input id="cActive" name="active" type="checkbox" checked /> Active</label>
              <button id="cSave" type="submit" class="adm-btn adm-btn--primary">Save Coupon</button>
            </div>
            <p id="couponMsg" class="adm-muted full" style="margin:6px 0 0"></p>
          </div>
        </form>
      </div>
    </div>

    <div class="adm-card" style="margin:12px 0">
      <table class="adm-table">
        <thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Min</th><th>Usage</th><th>Status</th><th></th></tr></thead>
        <tbody id="couponsBody"></tbody>
      </table>
    </div>

    <div class="adm-card" style="margin:12px 0">
      <h3 style="margin:0 0 8px">Banners</h3>
      <div class="adm-muted" style="margin:-6px 0 8px">
        Recommended size <strong>${BANNER_W}×${BANNER_H}</strong> (we'll auto-crop & resize).
      </div>
      <div class="adm-form-grid">
        <form id="bannerForm" class="full">
          <div class="adm-form-grid">
            <input id="bTitle" name="title" class="adm-input full" placeholder="Banner title" />
            <input id="bLink" name="linkUrl" class="adm-input full" placeholder="Link URL (optional)" />
            <input id="bFile" name="file" type="file" accept="image/*" class="adm-file full" />
            <div class="full adm-row" style="justify-content:flex-end; gap:12px;">
              <label class="adm-row"><input id="bActive" name="active" type="checkbox" checked /> Active</label>
              <button id="bSave" type="submit" class="adm-btn adm-btn--primary">Save Banner</button>
            </div>
            <p id="bannerMsg" class="adm-muted full" style="margin:6px 0 0"></p>
          </div>
        </form>
      </div>
    </div>

    <div class="adm-card">
      <table class="adm-table">
        <thead><tr><th>Preview</th><th>Title</th><th>Link</th><th>Status</th><th></th></tr></thead>
        <tbody id="bannersBody"></tbody>
      </table>
    </div>
  `;

  /* ---------- Save coupon ---------- */
  const couponForm = root.querySelector("#couponForm");
  const cSaveBtn = root.querySelector("#cSave");
  const couponMsg = root.querySelector("#couponMsg");

  couponForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = root.querySelector("#cCode").value.trim().toUpperCase();
    const type = root.querySelector("#cType").value;
    const value = parseFloat(root.querySelector("#cValue").value);
    const minOrder = parseFloat(root.querySelector("#cMin").value) || 0;
    const usageLimitRaw = root.querySelector("#cUsage").value.trim();
    const perUserLimitRaw = root.querySelector("#cUserLimit").value.trim();
    const usageLimit = usageLimitRaw ? parseInt(usageLimitRaw, 10) : 1 * 0 || null; // keep null when blank
    const perUserLimit = perUserLimitRaw ? parseInt(perUserLimitRaw, 10) : 1 * 0 || null;
    const active = root.querySelector("#cActive").checked;

    if (!code || isNaN(value) || value <= 0) return alert("Enter valid coupon details");
    if (type === "percent" && value > 95 && !confirm("Percent looks high. Continue?")) return;

    try {
      cSaveBtn.disabled = true; cSaveBtn.textContent = "Saving…";
      const promoRef = doc(collection(db, "promotions"));
      await setDoc(promoRef, {
        kind: "coupon",
        code, type, value, minOrder, usageLimit, perUserLimit, active,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // Safe reset (works even if the node isn't a <form> for some reason)
      if (couponForm && typeof couponForm.reset === "function") couponForm.reset();
      root.querySelector("#cActive").checked = true;
      couponMsg.textContent = "Saved ✓"; setTimeout(() => couponMsg.textContent = "", 1400);
    } catch (e2) {
      console.error(e2);
      alert("Failed to save coupon: " + (e2?.message || e2));
    } finally {
      cSaveBtn.disabled = false; cSaveBtn.textContent = "Save Coupon";
    }
  });

  /* ---------- Save banner (with resize) ---------- */
  const bannerForm = root.querySelector("#bannerForm");
  const bSaveBtn = root.querySelector("#bSave");
  const bannerMsg = root.querySelector("#bannerMsg");

  bannerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = root.querySelector("#bTitle").value.trim();
    const linkUrl = root.querySelector("#bLink").value.trim();
    const file = root.querySelector("#bFile").files[0];
    const active = root.querySelector("#bActive").checked;

    if (!title || !file) return alert("Title & image required");
    if (!isImage(file)) return alert("Please choose an image file");
    if (fileTooLarge(file)) return alert(`Image is too large (>${MAX_UPLOAD_MB} MB). Choose a smaller file.`);

    try {
      bSaveBtn.disabled = true; bSaveBtn.textContent = "Uploading…";

      // Resize and upload
      const bannerBlob = await resizeToBannerBlob(file);
      // Keep your existing folder name. If your Storage rules use bannerImages/, change this path accordingly.
      const path = `promoBanners/${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
      const imgRef = storageRef(storage, path);
      await uploadBytes(imgRef, bannerBlob, {
        contentType: BANNER_MIME,
        cacheControl: "public, max-age=31536000, immutable"
      });
      const imageUrl = await getDownloadURL(imgRef);

      const promoRef = doc(collection(db, "promotions"));
      await setDoc(promoRef, {
        kind: "banner",
        title, linkUrl, imageUrl, active,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      if (bannerForm && typeof bannerForm.reset === "function") bannerForm.reset();
      root.querySelector("#bActive").checked = true;
      bannerMsg.textContent = "Saved ✓"; setTimeout(() => bannerMsg.textContent = "", 1400);
    } catch (e2) {
      console.error(e2);
      alert("Failed to save banner: " + (e2?.message || e2));
    } finally {
      bSaveBtn.disabled = false; bSaveBtn.textContent = "Save Banner";
    }
  });

  /* ---------- Live lists (coupons & banners) ---------- */
  const bodyC = root.querySelector("#couponsBody");
  const bodyB = root.querySelector("#bannersBody");
  const qAll = query(collection(db, "promotions"), orderBy("createdAt", "desc"));

  onSnapshot(qAll, (snap) => {
    bodyC.innerHTML = "";
    bodyB.innerHTML = "";
    snap.forEach(d => {
      const p = d.data();
      if (p.kind === "coupon") {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${p.code}</td>
          <td>${p.type}</td>
          <td>${p.type === "percent" ? p.value + "%" : "₹" + p.value}</td>
          <td>${p.minOrder || 0}</td>
          <td>${p.usageLimit ?? "-"} / ${p.perUserLimit ?? "-"}</td>
          <td>${p.active
            ? '<span class="adm-badge adm-badge--ok">Active</span>'
            : '<span class="adm-badge adm-badge--muted">Disabled</span>'}</td>
          <td>
            <button class="adm-btn toggle" data-id="${d.id}" data-active="${p.active}">${p.active ? "Disable" : "Enable"}</button>
            <button class="adm-btn adm-btn--danger del" data-id="${d.id}">Delete</button>
          </td>
        `;
        bodyC.appendChild(tr);
      } else if (p.kind === "banner") {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><img src="${p.imageUrl}" style="width:180px;height:auto;border-radius:8px;border:1px solid #eee"/></td>
          <td>${p.title}</td>
          <td>${p.linkUrl ? `<a href="${p.linkUrl}" target="_blank" rel="noopener">Link</a>` : "-"}</td>
          <td>${p.active
            ? '<span class="adm-badge adm-badge--ok">Active</span>'
            : '<span class="adm-badge adm-badge--muted">Disabled</span>'}</td>
          <td>
            <button class="adm-btn toggle" data-id="${d.id}" data-active="${p.active}">${p.active ? "Disable" : "Enable"}</button>
            <button class="adm-btn adm-btn--danger del" data-id="${d.id}">Delete</button>
          </td>
        `;
        bodyB.appendChild(tr);
      }
    });

    // Toggle active
    root.querySelectorAll(".toggle").forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const next = btn.dataset.active !== "true";
        try {
          btn.disabled = true;
          await updateDoc(doc(db, "promotions", id), {
            active: next,
            updatedAt: serverTimestamp()
          });
        } catch (e) {
          console.error(e);
          alert("Failed to toggle: " + (e?.message || e));
        } finally {
          btn.disabled = false;
        }
      };
    });

    // Delete
    root.querySelectorAll(".del").forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        if (!confirm("Delete this promotion?")) return;
        try {
          btn.disabled = true;
          await deleteDoc(doc(db, "promotions", id));
        } catch (e) {
          console.error(e);
          alert("Failed to delete: " + (e?.message || e));
        } finally {
          btn.disabled = false;
        }
      };
    });
  });
}

/* Auto-init if container exists */
(function () {
  if (document.getElementById("promotionsRoot")) initPromotions();
})();
