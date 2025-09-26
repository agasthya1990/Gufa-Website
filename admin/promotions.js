// /admin/promotions.js — Channel-aware (Dining | Delivery), friendlier UI
import { db, storage } from "./firebase.js";
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";


// ===== Banners: resize params =====
const BANNER_W = 1600, BANNER_H = 600, BANNER_MIME = "image/jpeg", BANNER_QUALITY = 0.85, MAX_UPLOAD_MB = 10;

function isImage(file){ return file && /^image\//i.test(file.type); }
function fileTooLarge(file){ return file && file.size > MAX_UPLOAD_MB * 1024 * 1024; }
function fileToImage(file){
  return new Promise((res,rej)=>{
    const fr=new FileReader();
    fr.onload=e=>{ const img=new Image(); img.onload=()=>res(img); img.onerror=rej; img.src=e.target.result; };
    fr.onerror=rej; fr.readAsDataURL(file);
  });
}
async function resizeToBannerBlob(file){
  const img = await fileToImage(file);
  const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
  const target = BANNER_W / BANNER_H, src = sw / sh;
  let sx, sy, sWidth, sHeight;
  if (src > target){ sHeight = sh; sWidth = Math.round(sh * target); sx = Math.round((sw - sWidth)/2); sy = 0; }
  else { sWidth = sw; sHeight = Math.round(sw / target); sx = 0; sy = Math.round((sh - sHeight)/2); }
  const canvas = document.createElement("canvas"); canvas.width = BANNER_W; canvas.height = BANNER_H;
  const ctx = canvas.getContext("2d"); ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, BANNER_W, BANNER_H);
  return new Promise((res,rej)=> canvas.toBlob(b=> b?res(b):rej(new Error("Failed to generate banner blob")), BANNER_MIME, BANNER_QUALITY));
}

// ===== UI bootstrap =====
export function initPromotions(){
  let root = document.getElementById("promotionsRoot");
  if (!root){ root = document.createElement("section"); root.id = "promotionsRoot"; document.body.appendChild(root); }

  root.innerHTML = `
    <div class="adm-card" style="margin:12px 0">
      <h3 style="margin:0 0 8px">Coupons</h3>
      <form id="couponForm" class="adm-form-grid full">
        <div class="adm-form-grid">
          <div class="adm-row">
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
        <thead><tr><th>Code</th><th>Channel</th><th>Type</th><th>Value</th><th>Min</th><th>Usage</th><th>Status</th><th></th></tr></thead>
        <tbody id="couponsBody"></tbody>
      </table>
    </div>

    <div class="adm-card" style="margin:12px 0">
      <h3 style="margin:0 0 8px">Banners</h3>
      <div class="adm-muted" style="margin:-6px 0 8px">Recommended size <strong>${BANNER_W}×${BANNER_H}</strong> (auto-crop & resize).</div>
      <form id="bannerForm" class="adm-form-grid full">
        <div class="adm-form-grid">
          <div class="adm-row">
            <select id="bChannel" class="adm-select" data-size="sm" aria-label="Channel">
              <option value="delivery">Delivery</option>
              <option value="dining">Dining</option>
            </select>
            <input id="bTitle" class="adm-input" placeholder="Banner title" />
            <input id="bLink" class="adm-input" placeholder="Link URL (optional)" />
            <input id="bFile" type="file" class="adm-file" accept="image/png,image/jpeg,image/webp" required />
            <label class="adm-row" style="margin-left:auto;"><input id="bActive" type="checkbox" checked/> Active</label>
            <button id="bSave" type="submit" class="adm-btn adm-btn--primary">Save Banner</button>
          </div>
          <p id="bannerMsg" class="adm-muted full" style="margin:6px 0 0"></p>
        </div>
      </form>
    </div>

    <div class="adm-card">
      <table class="adm-table">
        <thead><tr><th>Preview</th><th>Title</th><th>Channel</th><th>Link</th><th>Status</th><th></th></tr></thead>
        <tbody id="bannersBody"></tbody>
      </table>
    </div>
  `;

  // ===== Save coupon =====
  const couponForm = root.querySelector("#couponForm");
  const cSaveBtn   = root.querySelector("#cSave");
  const couponMsg  = root.querySelector("#couponMsg");

  couponForm.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const code = root.querySelector("#cCode").value.trim().toUpperCase();
    const channel = root.querySelector("#cChannel").value; // 'delivery' | 'dining'
    const type = root.querySelector("#cType").value;       // 'percent' | 'flat'
    const value = parseFloat(root.querySelector("#cValue").value);
    const minOrder = parseFloat(root.querySelector("#cMin").value) || 0;
    const usageLimitRaw = root.querySelector("#cUsage").value.trim();
    const perUserLimitRaw = root.querySelector("#cUserLimit").value.trim();
    const usageLimit = usageLimitRaw ? parseInt(usageLimitRaw,10) : null;
    const perUserLimit = perUserLimitRaw ? parseInt(perUserLimitRaw,10) : null;
    const active = root.querySelector("#cActive").checked;

    if (!code || isNaN(value) || value <= 0) return alert("Enter valid coupon details");
    if (type === "percent" && value > 95 && !confirm("Percent looks high. Continue?")) return;

    try {
      cSaveBtn.disabled = true; cSaveBtn.textContent = "Saving…";
      const promoRef = doc(collection(db, "promotions"));
      await setDoc(promoRef, {
        kind: "coupon",
        channel, // REQUIRED: 'delivery' or 'dining' (no 'both')
        code, type, value, minOrder, usageLimit, perUserLimit, active,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      couponForm.reset(); root.querySelector("#cActive").checked = true;
      couponMsg.textContent = "Saved ✓"; setTimeout(()=> couponMsg.textContent="", 1400);
    } catch(err){
      console.error(err); alert("Failed to save coupon: " + (err?.message || err));
    } finally { cSaveBtn.disabled = false; cSaveBtn.textContent = "Save Coupon"; }
  });

  // ===== Coupons list =====
  const couponsBody = root.querySelector("#couponsBody");
  onSnapshot(query(collection(db,"promotions"), orderBy("createdAt","desc")), (snap)=>{
    const rows = [];
    snap.forEach(d=>{
      const p = d.data();
      if (p.kind !== "coupon") return;
      rows.push({ id:d.id, p });
    });
    couponsBody.innerHTML = "";
    rows.forEach(({id,p})=>{
      const tr = document.createElement("tr");
      const channelPill = `<span class="adm-pill ${p.channel==='dining'?'adm-pill--dining':'adm-pill--delivery'}">${p.channel}</span>`;
      const status = p.active ? `<span class="adm-badge adm-badge--ok">active</span>` : `<span class="adm-badge adm-badge--muted">inactive</span>`;
      tr.innerHTML = `
        <td><strong>${p.code}</strong></td>
        <td>${channelPill}</td>
        <td>${p.type}</td>
        <td>${p.value}</td>
        <td>${p.minOrder||0}</td>
        <td>${p.usageLimit ?? "-"}/${p.perUserLimit ?? "-"}</td>
        <td>${status}</td>
        <td class="adm-row" style="justify-content:flex-end; gap:6px;">
          <button class="adm-btn cToggle" data-id="${id}" data-active="${p.active?'1':'0'}">${p.active?'Disable':'Enable'}</button>
          <button class="adm-btn adm-btn--danger cDelete" data-id="${id}">Delete</button>
        </td>
      `;
      couponsBody.appendChild(tr);
    });

    couponsBody.querySelectorAll(".cToggle").forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.dataset.id; const isActive = btn.dataset.active === "1";
        await updateDoc(doc(collection(db,"promotions"), id), { active: !isActive, updatedAt: serverTimestamp() });
      };
    });
    couponsBody.querySelectorAll(".cDelete").forEach(btn=>{
      btn.onclick = async ()=>{
        if (!confirm("Delete this coupon?")) return;
        await deleteDoc(doc(collection(db,"promotions"), btn.dataset.id));
      };
    });
  });

  // ===== Save banner =====
  const bannerForm = root.querySelector("#bannerForm");
  const bSaveBtn   = root.querySelector("#bSave");
  const bannerMsg  = root.querySelector("#bannerMsg");
  const bannersBody = root.querySelector("#bannersBody");

  // ==== Sumbit Banner ====

  bannerForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const channel = root.querySelector("#bChannel").value; // 'delivery' | 'dining'
  const title   = root.querySelector("#bTitle").value.trim();
  const linkUrl = root.querySelector("#bLink").value.trim();
  const file    = root.querySelector("#bFile").files[0];
  const active  = root.querySelector("#bActive").checked;

  if (!title) { alert("Enter a banner title"); return; }
  if (!file)  { alert("Select an image"); return; }
  // Stricter type check (prevents odd formats that can hang during resize)
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) { alert("Please choose PNG/JPEG/WEBP"); return; }
  if (fileTooLarge(file)) { alert("Image too large (max 10MB)"); return; }

  // Helper to avoid silent hangs
  const withTimeout = (p, ms, label) =>
    Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error(label + " timed out")), ms))
    ]);

  try {
    bSaveBtn.disabled = true;
    bSaveBtn.textContent = "Resizing…";
    bannerMsg.textContent = "Resizing image…";

    // 1) Resize to 1600×600 JPEG
    const blob = await withTimeout(resizeToBannerBlob(file), 15000, "Resize");

    // 2) Upload to Storage (promoBanners/)
    bSaveBtn.textContent = "Uploading…";
    bannerMsg.textContent = "Uploading to storage…";
    const path = `promoBanners/${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
    const ref  = storageRef(storage, path);
    await withTimeout(
      uploadBytes(ref, blob, { contentType: BANNER_MIME, cacheControl: "public, max-age=31536000, immutable" }),
      30000,
      "Upload"
    );

    // 3) Get public URL
    bSaveBtn.textContent = "Finalizing…";
    bannerMsg.textContent = "Fetching public URL…";
    const imageUrl = await withTimeout(getDownloadURL(ref), 15000, "GetDownloadURL");

    // 4) Write Firestore doc
    bannerMsg.textContent = "Saving banner…";
    const promoRef = doc(collection(db, "promotions")); // auto-id
    await withTimeout(setDoc(promoRef, {
      kind: "banner",
      channel,
      title,
      linkUrl: linkUrl || null,
      imageUrl,
      active,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }), 15000, "Firestore write");

    bannerForm.reset();
    root.querySelector("#bActive").checked = true;
    bannerMsg.textContent = "Saved ✓";
    setTimeout(() => (bannerMsg.textContent = ""), 1400);
  } catch (err) {
    console.error(err);
    alert("Failed to save banner: " + (err?.message || err));
    bannerMsg.textContent = "Failed.";
  } finally {
    bSaveBtn.disabled = false;
    bSaveBtn.textContent = "Save Banner";
  }
});


  // ===== Banners list =====
  onSnapshot(query(collection(db,"promotions"), orderBy("createdAt","desc")), (snap)=>{
    const rows = [];
    snap.forEach(d=>{
      const p = d.data();
      if (p.kind !== "banner") return;
      rows.push({ id:d.id, p });
    });
    bannersBody.innerHTML = "";
    rows.forEach(({id,p})=>{
      const channelPill = `<span class="adm-pill ${p.channel==='dining'?'adm-pill--dining':'adm-pill--delivery'}">${p.channel}</span>`;
      const status = p.active ? `<span class="adm-badge adm-badge--ok">active</span>` : `<span class="adm-badge adm-badge--muted">inactive</span>`;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><img src="${p.imageUrl}" alt="" style="width:120px;height:auto;border-radius:8px;border:1px solid #eee"/></td>
        <td>${p.title}</td>
        <td>${channelPill}</td>
        <td>${p.linkUrl ? `<a href="${p.linkUrl}" target="_blank" rel="noopener">link</a>` : "-"}</td>
        <td>${status}</td>
        <td class="adm-row" style="justify-content:flex-end; gap:6px;">
          <button class="adm-btn bToggle" data-id="${id}" data-active="${p.active?'1':'0'}">${p.active?'Disable':'Enable'}</button>
          <button class="adm-btn adm-btn--danger bDelete" data-id="${id}">Delete</button>
        </td>
      `;
      bannersBody.appendChild(tr);
    });

    bannersBody.querySelectorAll(".bToggle").forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.dataset.id; const isActive = btn.dataset.active === "1";
        await updateDoc(doc(collection(db,"promotions"), id), { active: !isActive, updatedAt: serverTimestamp() });
      };
    });
    bannersBody.querySelectorAll(".bDelete").forEach(btn=>{
      btn.onclick = async ()=>{
        if (!confirm("Delete this banner?")) return;
        await deleteDoc(doc(collection(db,"promotions"), btn.dataset.id));
      };
    });
  });
}
