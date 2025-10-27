// customer/app.cart.js
// Checkout UI that CONSUMES the menu/store output (single key gufa_cart flat)
;(function () {
  // ---- money helpers ----
  const INR = (v) => "₹" + Math.round(Number(v) || 0).toLocaleString("en-IN");
  const SERVICE_TAX_RATE  = 0.05;
  const SERVICE_TAX_LABEL = "Service Tax";
  const taxOn = (amount) => Math.max(0, (Number(amount) || 0) * SERVICE_TAX_RATE);

  // ---- mode + coupon helpers ----
  function activeMode() {
    const api = window?.GUFA?.serviceMode?.get;
    if (typeof api === "function") return api() === "dining" ? "dining" : "delivery";
    const raw = localStorage.getItem("gufa:serviceMode") ?? localStorage.getItem("gufa_mode") ?? "delivery";
    const m = String(raw).toLowerCase();
    return m === "dining" ? "dining" : "delivery";
  }

  function couponValidForCurrentMode(locked) {
    try {
      const mode = activeMode(); // 'delivery' | 'dining'
      const v = locked?.valid;
      if (v && typeof v === "object" && (mode in v)) return !!v[mode];
      const cid = String(locked?.scope?.couponId || "");
      const meta = (window.COUPONS instanceof Map) ? window.COUPONS.get(cid) : null;
      if (meta && meta.targets && (mode in meta.targets)) return !!meta.targets[mode];
      return true;
    } catch { return true; }
  }

  function displayCodeFromLock(locked){
    try {
      const raw = String(locked?.code || "").toUpperCase();
      const cid = String(locked?.scope?.couponId || "");
      const looksLikeUuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(raw);
      if (raw && !looksLikeUuid) return raw;

      const meta = (window.COUPONS instanceof Map) ? window.COUPONS.get(cid) : null;
      if (meta?.code) return String(meta.code).toUpperCase();

      fetchCouponCodeAndBackfill(cid, locked); // async backfill if needed
      return raw || cid.toUpperCase();
    } catch {
      return String(locked?.code || "").toUpperCase();
    }
  }

  function resolveDisplayCode(locked) {
    try { return Promise.resolve(displayCodeFromLock(locked)); }
    catch { return Promise.resolve(String(locked?.code || "").toUpperCase()); }
  }

  async function fetchCouponCodeAndBackfill(cid, locked) {
    try {
      if (!window.db || !cid) return;
      const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const snap = await getDoc(doc(window.db, "promotions", cid));
      if (snap.exists()) {
        const code = String(snap.data()?.code || cid).toUpperCase();
        localStorage.setItem("gufa_coupon", JSON.stringify({ ...(locked || {}), code }));
        window.dispatchEvent(new CustomEvent("cart:update"));
      }
    } catch {}
  }

  // ---- data access (live → flat localStorage fallback) ----
  function entries() {
    try {
      const live = window?.Cart?.get?.();
      if (live && typeof live === "object" && Object.keys(live).length) {
        return Object.entries(live);
      }
      const raw = localStorage.getItem("gufa_cart");
      if (raw) {
        const parsed = JSON.parse(raw);
        const items = (parsed && typeof parsed === "object")
          ? (parsed.items && typeof parsed.items === "object" ? parsed.items : parsed)
          : {};
        return Object.entries(items);
      }
      return [];
    } catch { return []; }
  }
  const count    = () => entries().reduce((n, [, it]) => n + (Number(it.qty) || 0), 0);
  const subtotal = () => entries().reduce((s, [, it]) => s + (Number(it.price)||0)*(Number(it.qty)||0), 0);

  // ----- PROMO HELPERS -----
  function getLockedCoupon() {
    try { return JSON.parse(localStorage.getItem("gufa_coupon") || "null"); } catch { return null; }
  }
  function computeSplits() {
    let baseSubtotal = 0, addonSubtotal = 0;
    for (const [key, it] of entries()) {
      const isAddon = String(key).split(":").length >= 3;
      const line = (Number(it.price)||0) * (Number(it.qty)||0);
      if (isAddon) addonSubtotal += line; else baseSubtotal += line;
    }
    return { baseSubtotal, addonSubtotal };
  }
  
  function computeDiscount(lock, baseSubtotal, mode) {
  if (!lock) return { discount:0, reason:null };

  // min order on BASE only
  const minOrder = Number(lock.minOrder || 0);
  if (minOrder > 0 && baseSubtotal < minOrder) return { discount:0, reason:"min" };

  // mode validity
  if (!couponValidForCurrentMode(lock)) return { discount:0, reason:"mode" };

  // eligible set (BASE only) — strict to coupon.scope.eligibleItemIds
  let eligibleBase = baseSubtotal;
  const ids = lock?.scope?.eligibleItemIds;
  if (Array.isArray(ids) && ids.length) {
    const set = new Set(ids.map(String));
    eligibleBase = 0;
    for (const [key, it] of entries()) {
      const isAddon = String(key).split(":").length >= 3;
      if (isAddon) continue;
      // Fallback to key prefix when it.id is missing: "ITEMID:variant:..."
      const itemId = String(it?.id ?? key.split(":")[0]);
      if (!set.has(itemId)) continue;
      eligibleBase += (Number(it.price)||0) * (Number(it.qty)||0);
    }
    if (eligibleBase <= 0) return { discount:0, reason:"scope" };
  } else {
    // If no eligible list is provided, treat as "no eligible items configured"
    // so discount doesn't apply accidentally.
    return { discount:0, reason:"scope" };
  }

  const t = String(lock.type||"").toLowerCase();
  const v = Number(lock.value||0);
  if (t === "percent") return { discount: Math.round(eligibleBase * (v/100)), reason:null };
  if (t === "flat")    return { discount: Math.min(v, eligibleBase), reason:null };
  return { discount:0, reason:null };
}


  // ---- layout resolution ----
  let mode = null; // 'list' | 'table'
  let R = {};
  let $countTop = null;

  function resolveLayout() {
    const CFG = window.CART_UI || {};
    $countTop = document.querySelector('#cart-count');

    const listCfg = CFG.list || {
      items:'#cart-items',
      empty:'#cart-empty',
      count:'#cart-items-count',
      addonsNote:'#addons-note',
      subtotal:'#subtotal-amt',
      servicetax:'#servicetax-amt',
      total:'#total-amt',
      proceed:'#proceed-btn'
    };
    const tableCfg = CFG.table || { body:'#cartBody', total:'#cartTotal' };

    const listEls = {
      items:      document.querySelector(listCfg.items),
      empty:      document.querySelector(listCfg.empty || null),
      count:      document.querySelector(listCfg.count || null),
      addonsNote: document.querySelector(listCfg.addonsNote || null),
      subtotal:   document.querySelector(listCfg.subtotal || null),
      servicetax: document.querySelector(listCfg.servicetax || null),
      total:      document.querySelector(listCfg.total || null),
      proceed:    document.querySelector(listCfg.proceed || null),
    };
    const listOK = !!listEls.items;
    if (listOK) { mode = 'list'; R = listEls; return true; }

    const tableEls = {
      body: document.querySelector(tableCfg.body),
      total: document.querySelector(tableCfg.total)
    };
    const tableOK = !!(tableEls.body && tableEls.total);
    if (tableOK) { mode = 'table'; R = tableEls; return true; }

    mode = null;
    R = {};
    console.warn("[cart] No usable layout found. Make sure window.CART_UI is set and IDs exist in checkout.html.");
    return false;
  }

  // ---- add-on grouping ----
  function buildGroups() {
    const bag = entries(); // [key,it][]
    const groups = new Map();
    for (const [key, it] of bag) {
      const parts = String(key).split(":");
      const baseKey = parts.slice(0, 2).join(":"); // itemId:variant
      const addonName = parts[2];                  // undefined for base

      if (!groups.has(baseKey)) groups.set(baseKey, { base: null, addons: [] });

      if (addonName) {
        const name = (it?.addons?.[0]?.name) || addonName;
        groups.get(baseKey).addons.push({ key, it, name });
      } else {
        groups.get(baseKey).base = { key, it };
      }
    }
    return groups;
  }

  function addonRow(baseKey, addon) {
    const { key, it, name } = addon;
    const row = document.createElement("div");
    row.className = "addon-row";

    const label = document.createElement("div");
    label.className = "addon-label muted";
    label.textContent = `+ ${name}`;

    const stepper = document.createElement("div");
    stepper.className = "stepper sm";
    const minus = document.createElement("button"); minus.textContent = "–";
    const out   = document.createElement("output");  out.textContent = String(it.qty || 0);
    const plus  = document.createElement("button");  plus.textContent = "+";
    stepper.append(minus, out, plus);

    const lineSub = document.createElement("div");
    lineSub.className = "line-subtotal";
    lineSub.textContent = INR((Number(it.price)||0) * (Number(it.qty)||0));

    plus.addEventListener("click", () => {
      const next = (Number(window.Cart.get()?.[key]?.qty) || 0) + 1;
      window.Cart.setQty(key, next, it);
    });
    minus.addEventListener("click", () => {
      const prev = Number(window.Cart.get()?.[key]?.qty) || 0;
      const next = Math.max(0, prev - 1);
      window.Cart.setQty(key, next, it);
    });

    row.append(label, stepper, lineSub);
    return row;
  }

  function lineItem(key, it) {
    const li = document.createElement("li");
    li.className = "cart-row";
    li.dataset.key = key;

    const img = document.createElement("img");
    img.className = "card-thumb";
    img.alt = it.name || "";
    img.loading = "lazy";
    img.src = it.thumb || "";
    img.onerror = () => { img.src = ""; };

    const mid = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "cart-title";
    title.textContent = it.name || "";
    const sub = document.createElement("p");
    sub.className = "cart-sub";
    sub.textContent = `${it.variant || ""} • ${INR(Number(it.price) || 0)}`;

    const right = document.createElement("div");
    right.className = "row-right";

    const stepper = document.createElement("div");
    stepper.className = "stepper";
    const minus = document.createElement("button"); minus.textContent = "–";
    const out   = document.createElement("output");  out.textContent = String(it.qty || 0);
    const plus  = document.createElement("button");  plus.textContent = "+";
    stepper.append(minus, out, plus);

    const lineSub = document.createElement("div");
    lineSub.className = "line-subtotal";
    lineSub.textContent = INR((Number(it?.price) || 0) * (Number(it?.qty) || 0));

    const remove = document.createElement("button");
    remove.className = "remove-link";
    remove.textContent = "Remove";

    plus.addEventListener("click", () => {
      const next = (Number(window.Cart.get()?.[key]?.qty) || 0) + 1;
      window.Cart.setQty(key, next, it);
    });
    minus.addEventListener("click", () => {
      const prev = Number(window.Cart.get()?.[key]?.qty) || 0;
      const next = Math.max(0, prev - 1);
      window.Cart.setQty(key, next, it);
    });
    remove.addEventListener("click", () => {
      window.Cart.setQty(key, 0);
    });

    mid.append(title, sub);
    right.append(stepper, lineSub, remove);
    li.append(img, mid, right);
    return li;
  }

  function renderGroup(g) {
    const wrap = document.createElement("li");
    wrap.className = "cart-row grouped";

    const { key: bKey, it: bIt } = g.base || {};
    const base = lineItem(bKey, bIt);
    wrap.appendChild(base);

    if (g.addons.length) {
      const list = document.createElement("div");
      list.className = "addon-list";
      g.addons.sort((a,b) => a.name.localeCompare(b.name));
      g.addons.forEach(a => list.appendChild(addonRow(bKey, a)));
      wrap.appendChild(list);
    }
    return wrap;
  }

  // ---- renderers ----
  function renderList() {
    const es = entries();
    const n = count();

    if ($countTop) $countTop.textContent = String(n);
    if (R.count)   R.count.textContent   = `(${n} ${n === 1 ? "item" : "items"})`;
    if (R.proceed) R.proceed.disabled    = n === 0;
    if (R.addonsNote) R.addonsNote.style.display = n > 0 ? "block" : "none";
    if (R.empty)   R.empty.hidden = n > 0;
    if (R.items)   R.items.hidden = n === 0;

    if (R.items) {
      R.items.innerHTML = "";
      const groups = buildGroups();
      for (const [, g] of groups) {
        const hasBase = !!g.base;
        if (!hasBase && g.addons.length) {
          const first = g.addons[0];
          g.base = { key: first.key.split(":").slice(0,2).join(":"), it: { ...(first.it || {}) } };
        }
        R.items.appendChild(renderGroup(g));
      }
    }

    // --- PROMOTION & TAX (Base-only discount; add-ons excluded) ---
    const { baseSubtotal, addonSubtotal } = computeSplits();
    const locked = getLockedCoupon();
    const modeNow = activeMode();
    const { discount, reason } = computeDiscount(locked, baseSubtotal, modeNow);

    const preTax = Math.max(0, baseSubtotal + addonSubtotal - discount);
    const tax = taxOn(preTax);
    const grand = preTax + tax;

    if (R.subtotal)   R.subtotal.textContent   = INR(baseSubtotal + addonSubtotal);
    if (R.servicetax) R.servicetax.textContent = INR(tax);
    if (R.total)      R.total.textContent      = INR(grand);

    // proceed guard: respect coupon minOrder on BASE subtotal
    (function guardProceed(){
      let minOk = true;
      const minOrder = Number(locked?.minOrder || 0);
      if (minOrder > 0) minOk = baseSubtotal >= minOrder;
      if (R.proceed) R.proceed.disabled = (n === 0) || !minOk;
    })();

    // promo row (with async code fill)
    const totalsWrap = R.subtotal?.closest?.(".totals") || R.subtotal?.parentElement || null;
    if (totalsWrap) {
      let promoRow = totalsWrap.querySelector(".total-row.promo-row");
      if (!promoRow) {
        promoRow = document.createElement("div");
        promoRow.className = "total-row promo-row";
        promoRow.innerHTML = `<span id="promo-label" class="muted">Promotion</span><span id="promo-amt"></span>`;
        const first = totalsWrap.firstElementChild;
        if (first) first.insertAdjacentElement("afterend", promoRow);
        else totalsWrap.prepend(promoRow);
      }

      const labelEl = promoRow.querySelector("#promo-label");
      const amtEl   = promoRow.querySelector("#promo-amt");

      // set label/amount based on reason
      if (!locked) {
        promoRow.style.display = "none";
      } else {
        promoRow.style.display = "";

        // default code text (will be refined async if needed)
        let codeText = displayCodeFromLock(locked);

        // label + amount
        if (reason === "mode") {
          if (labelEl) labelEl.textContent = `Promotion (${codeText}) — Not valid for ${modeNow === "dining" ? "Dining" : "Delivery"}`;
          if (amtEl)   amtEl.textContent   = "− " + INR(0);
        } else if (reason === "min") {
          if (labelEl) labelEl.textContent = `Promotion (${codeText}) — Min order not met`;
          if (amtEl)   amtEl.textContent   = "− " + INR(0);
        } else if (reason === "scope") {
          if (labelEl) labelEl.textContent = `Promotion (${codeText}) — No eligible items`;
          if (amtEl)   amtEl.textContent   = "− " + INR(0);
        } else {
          if (labelEl) labelEl.textContent = `Promotion (${codeText})`;
          if (amtEl)   amtEl.textContent   = "− " + INR(discount);
        }

        // async refine code if we initially had a uuid-ish code
        resolveDisplayCode(locked).then(code => {
          if (code && labelEl) {
            const baseText = labelEl.textContent.replace(/\(.*?\)/, `(${code})`);
            labelEl.textContent = baseText;
          }
        }).catch(() => {});
      }
    }

    // left-column mini invoice text
    if (R.addonsNote) {
      const hasLock = !!locked;
      const modeLabel = (modeNow === "dining") ? "Dining" : "Delivery";

const codeText = hasLock ? displayCodeFromLock(locked) : "";
const promoHtml = hasLock
  ? `<div class="promo-line"><span class="plabel">Promotion${codeText ? ` (${codeText})` : ""}${reason ? ` — ${reason==="mode" ? `Not valid for ${modeLabel}`: reason==="min" ? "Min order not met" : "No eligible items"}` : ""}</span>: <strong style="color:#b00020;">−${INR(reason?0:discount)}</strong></div>`
  : "";


      const baseHtml = `
        <div class="muted" style="display:grid;row-gap:4px;">
          <div><span>Base Items:</span> <strong>${INR(baseSubtotal)}</strong></div>
          <div><span>Add-ons:</span> <strong>${INR(addonSubtotal)}</strong></div>
          ${promoHtml}
          <div><span>${SERVICE_TAX_LABEL} (${(SERVICE_TAX_RATE*100).toFixed(0)}%):</span> <strong>${INR(tax)}</strong></div>
        </div>
      `;
      R.addonsNote.innerHTML = baseHtml;

      if (hasLock) {
        resolveDisplayCode(locked).then(code => {
          const labelSpot = R.addonsNote?.querySelector?.(".promo-line .plabel");
          if (labelSpot && code) {
            // keep any suffix like "— Not valid for …"
            const suffix = labelSpot.textContent.includes("—")
              ? " — " + labelSpot.textContent.split("—").slice(1).join("—").trim()
              : "";
            labelSpot.textContent = `Promotion (${code})${suffix ? "" : ""}${suffix}`;
          }
        }).catch(() => {});
      }
    }
  }

  function rowB(key, it) {
    const tr = document.createElement("tr");
    const tdImg = document.createElement("td");
    tdImg.innerHTML = it.thumb ? `<img src="${it.thumb}" alt="${it.name || ""}" class="thumb" loading="lazy"/>` : "";
    const tdName = document.createElement("td");
    tdName.innerHTML = `<div class="name">${it.name || ""}</div><div class="sub">${it.variant || ""}</div>`;
    const tdQty = document.createElement("td");  tdQty.textContent = String(it.qty || 0);
    const tdPrice = document.createElement("td"); tdPrice.textContent = INR(Number(it.price) || 0);
    const tdSub = document.createElement("td");   tdSub.textContent = INR((Number(it.price)||0)*(Number(it.qty)||0));
    tr.append(tdImg, tdName, tdQty, tdPrice, tdSub);
    return tr;
  }

  function renderTable() {
    const es = entries();
    if (R.body) {
      if (!es.length) {
        R.body.innerHTML = `<tr><td colspan="5" class="empty">Your cart is empty</td></tr>`;
      } else {
        R.body.innerHTML = "";
        for (const [key, it] of es) R.body.appendChild(rowB(key, it));
      }
    }
    if (R.total) R.total.textContent = INR(subtotal());
    const n = count();
    const badge = document.querySelector('#cart-count');
    if (badge) badge.textContent = String(n);
  }

  // ---- unified render + rehydrate ----
  function render() {
    if (!mode && !resolveLayout()) return;
    if (mode === 'list') renderList();
    else if (mode === 'table') renderTable();
  }
  function rehydrateIfEmpty() {
    if (entries().length > 0) return;
    setTimeout(() => { if (entries().length === 0) render(); }, 80);
    setTimeout(() => { if (entries().length === 0) render(); }, 220);
    setTimeout(() => { if (entries().length === 0) render(); }, 480);
  }

  // ---- boot + reactive subscriptions ----
  function boot() {
    resolveLayout();
    render();
    rehydrateIfEmpty();

    window.addEventListener('cart:update', render, false);
    window.addEventListener('mode:change', render, false);
    window.addEventListener('serviceMode:changed', render, false);
    window.addEventListener('storage', (e) => {
      if (!e) return;
      if (e.key === 'gufa_cart' || e.key === 'gufa_coupon') render();
    }, false);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { render(); rehydrateIfEmpty(); }
    }, false);
    window.addEventListener('pageshow', (ev) => {
      if (ev && ev.persisted) { render(); rehydrateIfEmpty(); }
    }, false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
