// /admin/promotions.js
// Promotions Admin: Coupons (Dining|Delivery) + Banners (100x100) + Link Coupon(s)
//
// - Coupons: channel-aware (dining | delivery), create/list/toggle/delete
// - Banners: upload square 100x100 JPEG to promoBanners/, create/list/toggle/delete
// - Link Coupon(s): comic popover to attach multiple coupon doc IDs to a banner (couponIds: [])
//
// Requires:
//   - style.admin.css includes .adm-* classes and .adm-popover (comic style)
//   - firebase.js exports { db, storage }

import { db, storage } from "./firebase.js";
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// ===== Config =====
const BANNER_W = 100;
const BANNER_H = 100;
const BANNER_MIME = "image/jpeg";
const BANNER_QUALITY = 0.85;
const MAX_UPLOAD_MB = 10;
const BANNERS_DIR = "promoBanners";

// ===== Helpers =====
function isImageType(file) {
  return file && /^image\/(png|jpe?g|webp)$/i.test(file.type);
}
function fileTooLarge(file) {
  return file && file.size > MAX_UPLOAD_MB * 1024 * 1024;
}
function fileToImage(file) {
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
async function resizeToSquareBannerBlob(file) {
  const img = await fileToImage(file);
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  // cover-crop to square
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
const withTimeout = (p, ms, label) =>
  Promise.race([
    p,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(label + " timed out")), ms)
    ),
  ]);

// ===== UI Bootstrap =====
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
      <form id="couponForm" class="adm-form-grid full">
        <div class="adm-form-grid">
          <div class="adm-row" style="gap:8px; flex-wrap:wrap;">
            <input id="cCode" class="adm-input" placeholder="CODE (e.g., WELCOME10)" data-size="sm" />
            <select id="cChannel" class="adm-select" data-size="sm" aria-label="Channel">
              <option value="delivery">Delivery</option>
              <option value="dining">Dining</option>
            </select>
            <select id="cType" class="adm-select" data-size="sm" aria-label="Type">
              <option value="percent">% off</option>
              <option value="flat">Flat ₹</option>
            </select>
            <input id="cValue" type="number" class="adm-input" placeholder="Value" data-size="xs"/>
            <input id="cMin" type="number" class="adm-input" placeholder="Min ₹ (optional)" data-size="xs"/>
            <input id="cUsage" type="number" class="adm-input" placeholder="Usage limit" data-size="xs"/>
            <input id="cUserLimit" type="number" class="adm-input" placeholder="Per-user limit" data-size="xs"/>
            <label class="adm-row" style="margin-left:auto;"><input id="cActive" type="checkbox" checked/> Active</label>
            <button id="cSave" type="submit" class="adm-btn adm-btn--primary">Save Coupon</button>
          </div>
          <p id="couponMsg" class="adm-muted full" style="margin:6px 0 0"></p>
        </div>
      </form>
    </div>

    <div class="adm-card" style="margin:12px 0">
      <table class="adm-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Channel</th>
            <th>Type</th>
            <th>Value</th>
            <th>Min</th>
            <th>Usage</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="couponsBody"></tbody>
      </table>
    </div>

    <div class="adm-card" style="margin:12px 0">
      <h3 style="margin:0 0 8px">Banners</h3>
      <div class="adm-muted" style="margin:-6px 0 8px">Auto-resizes to <strong>${BANNER_W}×${BANNER_H}</strong> JPEG (max ${MAX_UPLOAD_MB}MB input).</div>
      <form id="bannerForm" class="adm-form-grid full">
        <div class="adm-form-grid">
          <div class="adm-row" style="gap:8px; flex-wrap:wrap;">
            <select id="bChannel" class="adm-select" data-size="sm" aria-label="Channel">
              <option value="delivery">Delivery</option>
              <option value="dining">Dining</option>
            </select>
            <input id="bTitle" class="adm-input" placeholder="Banner title" data-size="md" />
            <input id="bFile" type="file" accept="image/png,image/jpeg,image/webp" class="adm-file" />
            <label class="adm-row" style="margin-left:auto;"><input id="bActive" type="checkbox" checked/> Active</label>
            <button id="bSave" type="submit" class="adm-btn adm-btn--primary">Save Banner</button>
          </div>
          <p id="bannerMsg" class="adm-muted full" style="margin:6px 0 0"></p>
        </div>
      </form>
    </div>

    <div class="adm-card" style="margin:12px 0">
      <table class="adm-table">
        <thead>
          <tr>
            <th>Preview</th>
            <th>Title</th>
            <th>Channel</th>
            <th>Linked Coupons</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="bannersBody"></tbody>
      </table>
    </div>
  `;

  // === COUPONS: save ===
  const couponForm = root.querySelector("#couponForm");
  const couponMsg = root.querySelector("#couponMsg");
  const cSaveBtn = root.querySelector("#cSave");

  couponForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = root.querySelector("#cCode").value.trim().toUpperCase();
    const channel = root.querySelector("#cChannel").value; // 'delivery' | 'dining'
    const type = root.querySelector("#cType").value; // 'percent' | 'flat'
    const value = parseFloat(root.querySelector("#cValue").value);
    const minOrder = parseFloat(root.querySelector("#cMin").value) || 0;
    const usageLimitRaw = root.querySelector("#cUsage").value.trim();
    const perUserLimitRaw = root.querySelector("#cUserLimit").value.trim();
    const usageLimit = usageLimitRaw ? parseInt(usageLimitRaw, 10) : null;
    const perUserLimit = perUserLimitRaw ? parseInt(perUserLimitRaw, 10) : null;
    const active = root.querySelector("#cActive").checked;

    if (!code || isNaN(value) || value <= 0) return alert("Enter valid coupon details");
    if (type === "percent" && value > 95 && !confirm("Percent looks high. Continue?")) return;

    try {
      cSaveBtn.disabled = true;
      cSaveBtn.textContent = "Saving…";
      const promoRef = doc(collection(db, "promotions"));
      await setDoc(promoRef, {
        kind: "coupon",
        channel, // 'delivery' | 'dining'
        code,
        type,
        value,
        minOrder,
        usageLimit,
        perUserLimit,
        active,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      couponForm.reset();
      root.querySelector("#cActive").checked = true;
      couponMsg.textContent = "Saved ✓";
      setTimeout(() => (couponMsg.textContent = ""), 1400);
    } catch (err) {
      console.error(err);
      alert("Failed to save coupon: " + (err?.message || err));
    } finally {
      cSaveBtn.disabled = false;
      cSaveBtn.textContent = "Save Coupon";
    }
  });

  // === BANNERS: save ===
  const bannerForm = root.querySelector("#bannerForm");
  const bannerMsg = root.querySelector("#bannerMsg");
  const bSaveBtn = root.querySelector("#bSave");

  bannerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const channel = root.querySelector("#bChannel").value; // 'delivery' | 'dining'
    const title = root.querySelector("#bTitle").value.trim();
    const file = root.querySelector("#bFile").files[0];
    const active = root.querySelector("#bActive").checked;

    if (!title) return alert("Enter a banner title");
    if (!file) return alert("Select an image");
    if (!isImageType(file)) return alert("Please choose PNG/JPEG/WEBP");
    if (fileTooLarge(file)) return alert(`Image too large (max ${MAX_UPLOAD_MB}MB)`);

    try {
      bSaveBtn.disabled = true;
      bSaveBtn.textContent = "Resizing…";
      bannerMsg.textContent = "Resizing image…";

      // 1) Resize to 100×100 JPEG
      const blob = await withTimeout(resizeToSquareBannerBlob(file), 15000, "Resize");

      // 2) Upload (resumable) to promoBanners/
      bSaveBtn.textContent = "Uploading…";
      const safeName = `${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
      const path = `${BANNERS_DIR}/${safeName}`;
      const sref = storageRef(storage, path);
      const metadata = { contentType: BANNER_MIME, cacheControl: "public, max-age=31536000, immutable" };

      const task = uploadBytesResumable(sref, blob, metadata);
      await withTimeout(
        new Promise((resolve, reject) => {
          task.on(
            "state_changed",
            (snap) => {
              const pct = snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0;
              bSaveBtn.textContent = `Uploading ${pct}%`;
              bannerMsg.textContent = `Uploading… ${pct}%`;
            },
            (err) => reject(err),
            () => resolve()
          );
        }),
        120000,
        "Upload"
      );

      // 3) Get public URL
      bSaveBtn.textContent = "Finalizing…";
      bannerMsg.textContent = "Fetching URL…";
      const imageUrl = await withTimeout(getDownloadURL(sref), 15000, "GetDownloadURL");

      // 4) Save banner doc (no linkUrl; start with empty couponIds)
      const bannerRef = doc(collection(db, "promotions"));
      await withTimeout(
        setDoc(bannerRef, {
          kind: "banner",
          channel, // 'delivery' | 'dining'
          title,
          imageUrl,
          active,
          couponIds: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
        15000,
        "Firestore write"
      );

      bannerForm.reset();
      root.querySelector("#bActive").checked = true;
      bannerMsg.textContent = "Saved ✓";
      setTimeout(() => (bannerMsg.textContent = ""), 1400);
    } catch (err) {
      console.error(err);
      alert("Failed to save banner: " + (err?.code || err?.message || err));
      bannerMsg.textContent = "Failed.";
    } finally {
      bSaveBtn.disabled = false;
      bSaveBtn.textContent = "Save Banner";
    }
  });

  // === LISTS (one snapshot, split by kind) ===
  const couponsBody = root.querySelector("#couponsBody");
  const bannersBody = root.querySelector("#bannersBody");

  onSnapshot(query(collection(db, "promotions"), orderBy("createdAt", "desc")), (snap) => {
    const coupons = [];
    const banners = [];
    const couponMap = {};
    snap.forEach((d) => {
      const p = d.data();
      if (p?.kind === "coupon") {
        coupons.push({ id: d.id, p });
        couponMap[d.id] = p;
      } else if (p?.kind === "banner") {
        banners.push({ id: d.id, p });
      }
    });

    // Render coupons
    couponsBody.innerHTML = "";
    coupons.forEach(({ id, p }) => {
      const tr = document.createElement("tr");
      const channelPill = `<span class="adm-pill ${p.channel === "dining" ? "adm-pill--dining" : "adm-pill--delivery"}">${p.channel}</span>`;
      const status = p.active
        ? `<span class="adm-badge adm-badge--ok">active</span>`
        : `<span class="adm-badge adm-badge--muted">inactive</span>`;
      tr.innerHTML = `
        <td><strong>${p.code || "(no code)"}</strong></td>
        <td>${channelPill}</td>
        <td>${p.type}</td>
        <td>${p.value}</td>
        <td>${p.minOrder || 0}</td>
        <td>${p.usageLimit ?? "-"}/${p.perUserLimit ?? "-"}</td>
        <td>${status}</td>
        <td class="adm-row" style="justify-content:flex-end; gap:6px;">
          <button class="adm-btn cToggle" data-id="${id}" data-active="${p.active ? "1" : "0"}">${p.active ? "Disable" : "Enable"}</button>
          <button class="adm-btn adm-btn--danger cDelete" data-id="${id}">Delete</button>
        </td>
      `;
      couponsBody.appendChild(tr);
    });

    couponsBody.querySelectorAll(".cToggle").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const isActive = btn.dataset.active === "1";
        await updateDoc(doc(collection(db, "promotions"), id), {
          active: !isActive,
          updatedAt: serverTimestamp(),
        });
      };
    });
    couponsBody.querySelectorAll(".cDelete").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("Delete this coupon?")) return;
        await deleteDoc(doc(collection(db, "promotions"), btn.dataset.id));
      };
    });

    // Render banners
    bannersBody.innerHTML = "";
    banners.forEach(({ id, p }) => {
      const tr = document.createElement("tr");
      const channelPill = `<span class="adm-pill ${p.channel === "dining" ? "adm-pill--dining" : "adm-pill--delivery"}">${p.channel}</span>`;
      const status = p.active
        ? `<span class="adm-badge adm-badge--ok">active</span>`
        : `<span class="adm-badge adm-badge--muted">inactive</span>`;

      const ids = Array.isArray(p.couponIds) ? p.couponIds : [];
      const chips = ids
        .map((cid) => {
          const cp = couponMap[cid];
          if (!cp) return `<span class="adm-pill">${cid.slice(0, 5)}…</span>`;
          const cls = cp.channel === "dining" ? "adm-pill--dining" : "adm-pill--delivery";
          return `<span class="adm-pill ${cls}" title="${cp.type === "percent" ? cp.value + "% off" : "₹" + cp.value + " off"}">${cp.code || cid}</span>`;
        })
        .join(" ");

      tr.innerHTML = `
        <td><img src="${p.imageUrl}" alt="" style="width:72px;height:72px;border-radius:8px;border:1px solid #eee;object-fit:cover"/></td>
        <td>${p.title}</td>
        <td>${channelPill}</td>
        <td>${chips || '<span class="adm-muted">—</span>'}</td>
        <td>${status}</td>
        <td class="adm-row" style="justify-content:flex-end; gap:6px;">
          <button class="adm-btn bLink" data-id="${id}">Link Coupon(s)</button>
          <button class="adm-btn bToggle" data-id="${id}" data-active="${p.active ? "1" : "0"}">${p.active ? "Disable" : "Enable"}</button>
          <button class="adm-btn adm-btn--danger bDelete" data-id="${id}">Delete</button>
        </td>
      `;
      bannersBody.appendChild(tr);
    });

    // Wire banner actions
    bannersBody.querySelectorAll(".bToggle").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const isActive = btn.dataset.active === "1";
        await updateDoc(doc(collection(db, "promotions"), id), {
          active: !isActive,
          updatedAt: serverTimestamp(),
        });
      };
    });
    bannersBody.querySelectorAll(".bDelete").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("Delete this banner?")) return;
        await deleteDoc(doc(collection(db, "promotions"), btn.dataset.id));
      };
    });
    bannersBody.querySelectorAll(".bLink").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const banner = banners.find((b) => b.id === id)?.p;
        openLinkCouponsPopover(btn, id, Array.isArray(banner?.couponIds) ? banner.couponIds : [], coupons);
      };
    });
  });
}

// ===== Popover: Link Coupon(s) to a Banner =====
function openLinkCouponsPopover(anchorEl, bannerId, currentIds, allCoupons) {
  let pop = document.getElementById("couponLinkPopover");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "couponLinkPopover";
    pop.className = "adm-popover"; // comic style
    pop.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;">Link coupon(s)</div>
      <div id="couponLinkList" style="max-height:220px;overflow:auto;margin-bottom:8px;"></div>
      <div class="adm-row" style="justify-content:flex-end;gap:6px;">
        <button id="couponLinkSave" class="adm-btn adm-btn--primary">Save</button>
        <button id="couponLinkCancel" class="adm-btn">Cancel</button>
      </div>
    `;
    document.body.appendChild(pop);
  }

  // Populate list
  const set = new Set(currentIds);
  const list = pop.querySelector("#couponLinkList");
  list.innerHTML = "";
  allCoupons.forEach(({ id, p }) => {
    const typeTxt = p.type === "percent" ? `${p.value}%` : `₹${p.value}`;
    const chan = p.channel === "dining" ? "Dining" : "Delivery";
    const row = document.createElement("label");
    row.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid #f4f4f4;";
    row.innerHTML = `
      <input type="checkbox" value="${id}" ${set.has(id) ? "checked" : ""}/>
      <div style="display:flex;flex-direction:column;">
        <div><strong>${p.code || "(no code)"}</strong> • <em>${chan}</em></div>
        <div class="adm-muted" style="font-size:12px;">${typeTxt}${
      p.minOrder ? " • Min ₹" + p.minOrder : ""
    }${p.active === false ? " • inactive" : ""}</div>
      </div>
    `;
    list.appendChild(row);
  });

  // Position popover near the button
  const r = anchorEl.getBoundingClientRect();
  pop.style.display = "block";
  pop.style.left = `${Math.round(window.scrollX + r.left)}px`;
  pop.style.top = `${Math.round(window.scrollY + r.bottom + 8)}px`;

  const cancel = () => {
    pop.style.display = "none";
    document.removeEventListener("click", onDocClick);
  };
  const save = async () => {
    const ids = [...list.querySelectorAll('input[type="checkbox"]:checked')].map((i) => i.value);
    try {
      await updateDoc(doc(collection(db, "promotions"), bannerId), {
        couponIds: ids,
        updatedAt: serverTimestamp(),
      });
      cancel();
    } catch (err) {
      console.error(err);
      alert("Failed to link coupons: " + (err?.message || err));
    }
  };
  pop.querySelector("#couponLinkSave").onclick = save;
  pop.querySelector("#couponLinkCancel").onclick = cancel;

  // Click-away closes
  const onDocClick = (e) => {
    if (!pop.contains(e.target) && e.target !== anchorEl) cancel();
  };
  setTimeout(() => document.addEventListener("click", onDocClick), 0);
}
