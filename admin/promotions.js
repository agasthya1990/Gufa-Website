// /admin/promotions.js
import { db } from "./firebase.js";
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp, query, orderBy, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const storage = getStorage(undefined, "gs://gufa-restaurant.firebasestorage.app");

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
      <div class="adm-form-grid" id="couponForm">
        <input id="cCode" class="adm-input" placeholder="CODE (e.g., WELCOME10)" />
        <select id="cType" class="adm-select"><option value="percent">% off</option><option value="flat">Flat ₹</option></select>
        <input id="cValue" type="number" class="adm-input" placeholder="Value" />
        <input id="cMin" type="number" class="adm-input" placeholder="Min Order (₹)" />
        <input id="cUsage" type="number" class="adm-input" placeholder="Usage Limit (optional)" />
        <input id="cUserLimit" type="number" class="adm-input" placeholder="Per-user Limit (optional)" />
        <div class="full adm-row" style="justify-content:flex-end;">
          <label class="adm-row"><input id="cActive" type="checkbox" checked /> Active</label>
          <button id="cSave" class="adm-btn adm-btn--primary">Save Coupon</button>
        </div>
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
      <div class="adm-form-grid" id="bannerForm">
        <input id="bTitle" class="adm-input full" placeholder="Banner title" />
        <input id="bLink" class="adm-input full" placeholder="Link URL (optional)" />
        <input id="bFile" type="file" accept="image/*" class="adm-file full" />
        <div class="full adm-row" style="justify-content:flex-end;">
          <label class="adm-row"><input id="bActive" type="checkbox" checked /> Active</label>
          <button id="bSave" class="adm-btn adm-btn--primary">Save Banner</button>
        </div>
      </div>
    </div>

    <div class="adm-card">
      <table class="adm-table">
        <thead><tr><th>Preview</th><th>Title</th><th>Link</th><th>Status</th><th></th></tr></thead>
        <tbody id="bannersBody"></tbody>
      </table>
    </div>
  `;

  // Save coupon
  root.querySelector("#cSave").onclick = async () => {
    const code = root.querySelector("#cCode").value.trim().toUpperCase();
    const type = root.querySelector("#cType").value;
    const value = parseFloat(root.querySelector("#cValue").value);
    const minOrder = parseFloat(root.querySelector("#cMin").value) || 0;
    const usageLimit = parseInt(root.querySelector("#cUsage").value || "0", 10) || null;
    const perUserLimit = parseInt(root.querySelector("#cUserLimit").value || "0", 10) || null;
    const active = root.querySelector("#cActive").checked;
    if (!code || isNaN(value) || value <= 0) return alert("Enter valid coupon details");

    const ref = doc(collection(db, "promotions"));
    await setDoc(ref, {
      kind: "coupon", code, type, value, minOrder, usageLimit, perUserLimit, active,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    root.querySelectorAll("#couponForm input").forEach(i=> i.value = "");
    root.querySelector("#cActive").checked = true;
  };

  // Save banner
  root.querySelector("#bSave").onclick = async () => {
    const title = root.querySelector("#bTitle").value.trim();
    const linkUrl = root.querySelector("#bLink").value.trim();
    const file = root.querySelector("#bFile").files[0];
    const active = root.querySelector("#bActive").checked;
    if (!title || !file) return alert("Title & image required");
    try {
      const refImg = ref(storage, `promoBanners/${Date.now()}_${file.name}`);
      await uploadBytes(refImg, file);
      const imageUrl = await getDownloadURL(refImg);
      const ref = doc(collection(db, "promotions"));
      await setDoc(ref, {
        kind: "banner", title, linkUrl, imageUrl, active,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      root.querySelectorAll("#bannerForm input").forEach(i=> i.value = "");
      root.querySelector("#bActive").checked = true;
    } catch (e) { alert(e.message); }
  };

  // Live lists
  const bodyC = root.querySelector("#couponsBody");
  const bodyB = root.querySelector("#bannersBody");
  const qAll = query(collection(db,"promotions"), orderBy("createdAt","desc"));
  onSnapshot(qAll, (snap)=>{
    bodyC.innerHTML = ""; bodyB.innerHTML = "";
    snap.forEach(d=>{
      const p = d.data();
      if (p.kind === "coupon") {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${p.code}</td>
          <td>${p.type}</td>
          <td>${p.type==="percent" ? p.value+"%" : "₹"+p.value}</td>
          <td>${p.minOrder || 0}</td>
          <td>${p.usageLimit || "-"}/${p.perUserLimit || "-"}</td>
          <td>${p.active ? '<span class="adm-badge adm-badge--ok">Active</span>' : '<span class="adm-badge adm-badge--muted">Disabled</span>'}</td>
          <td>
            <button class="adm-btn toggle" data-id="${d.id}" data-active="${p.active}">${p.active?"Disable":"Enable"}</button>
            <button class="adm-btn adm-btn--danger del" data-id="${d.id}">Delete</button>
          </td>
        `;
        bodyC.appendChild(tr);
      } else if (p.kind === "banner") {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><img src="${p.imageUrl}" style="width:90px;height:auto;border-radius:8px;border:1px solid #eee"/></td>
          <td>${p.title}</td>
          <td><a href="${p.linkUrl||'#'}" target="_blank">${p.linkUrl||"-"}</a></td>
          <td>${p.active ? '<span class="adm-badge adm-badge--ok">Active</span>' : '<span class="adm-badge adm-badge--muted">Disabled</span>'}</td>
          <td>
            <button class="adm-btn toggle" data-id="${d.id}" data-active="${p.active}">${p.active?"Disable":"Enable"}</button>
            <button class="adm-btn adm-btn--danger del" data-id="${d.id}">Delete</button>
          </td>
        `;
        bodyB.appendChild(tr);
      }
    });

    root.querySelectorAll(".toggle").forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.dataset.id; const next = btn.dataset.active !== "true";
        await updateDoc(doc(db,"promotions",id), { active: next, updatedAt: serverTimestamp() });
      };
    });
    root.querySelectorAll(".del").forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.dataset.id;
        if (confirm("Delete this promotion?")) await deleteDoc(doc(db,"promotions",id));
      };
    });
  });
}

/* Auto-init if container exists */
(function(){ if (document.getElementById("promotionsRoot")) initPromotions(); })();

