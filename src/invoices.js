/**
 * invoices.js — Clean rebuild using data-field attributes.
 * NO querySelectorAll index positions anywhere in this file.
 *
 * Formulas:
 *   totalQty    = unit × qty
 *   invoiceTotal= fob × qty
 *   costPrice   = (invoiceTotal ÷ totalQty) × finalUsedRate
 *   totalCost   = costPrice × totalQty
 *   sellIncGst  = costPrice × (1 + markup/100)
 *   finalPrice  = editable, defaults to sellIncGst
 *   regularPrice= finalPrice ÷ (1 + gst/100)
 *   gstAmount   = finalPrice − regularPrice
 *   margin      = regularPrice − costPrice
 */

import { S } from './state.js';
import { fsSet, fsDel } from './db.js';
import { fmv, fmt, uid, toast, getUomList } from './utils.js';
import { getCountrySettings } from './countries.js';

// ── Active country settings (loaded silently on country select) ──
let _cs = null;   // { finalUsedRate, gst, mup, name, code, sym, … }

// ════════════════════════════════════════════════════════════════
//  PURE FORMULA FUNCTIONS  — single source of truth
//  All computed at full float precision internally.
//  Only display values are rounded to 2dp.
// ════════════════════════════════════════════════════════════════
function calcTotalQty(unit, qty)          { return unit * qty; }
function calcInvoiceTotal(fob, qty)       { return fob * qty; }
function calcCostPrice(invTotal, tq, fur) {
  if (!tq || !fur) return 0;
  return (invTotal / tq) * fur;
}
function calcTotalCost(cp, tq)            { return cp * tq; }
// Sell Inc GST = Cost × (1 + Markup/100) × (1 + GST/100)
function calcSellIncGst(cp, markup, gst)  { return cp * (1 + markup / 100) * (1 + gst / 100); }

// Regular Price = (100 × finalPrice) / (100 + gst)
// Exact formula — avoids floating-point drift from division chains
function calcRegularPrice(fp, gst) {
  if (!fp) return 0;
  return (100 * fp) / (100 + gst);
}

// GST Amount = finalPrice − regularPrice  (kept internally for saving)
function calcGstAmount(fp, rp)            { return fp - rp; }

// Margin % = (regularPrice − costPrice) / regularPrice × 100
function calcMarginPct(rp, cp) {
  if (!rp) return 0;
  return ((rp - cp) / rp) * 100;
}

// Round to nearest MVR 0.50
function roundHalf(n) { return Math.round(n * 2) / 2; }

// ── Read a named field from a row ────────────────────────────────
function fieldVal(row, name) {
  const el = row.querySelector(`[data-field="${name}"]`);
  return el ? el.value : '';
}
function fieldNum(row, name, fallback = 0) {
  const v = parseFloat(fieldVal(row, name));
  return isNaN(v) ? fallback : v;
}
function setField(row, name, value) {
  const el = row.querySelector(`[data-field="${name}"]`);
  if (el) el.value = value;
}
// Read the GST applicable checkbox (default true if missing)
function fieldGstOn(row) {
  const el = row.querySelector('[data-field="gstApplicable"]');
  return el ? el.checked : true;
}

// ════════════════════════════════════════════════════════════════
//  ROW CALCULATION  — called on any input change
// ════════════════════════════════════════════════════════════════
function calcRow(row, finalIsManual) {
  const unit      = fieldNum(row, 'unit',   1);
  const qty       = fieldNum(row, 'qty',    0);
  const fob       = fieldNum(row, 'fob',    0);
  const markup    = fieldNum(row, 'markup', _cs?.mup ?? 100);
  const gst       = _cs?.gst ?? 8;
  const fur       = _cs?.finalUsedRate ?? 0;
  const gstOn     = fieldGstOn(row);   // true = GST applicable

  // 1. Total Qty = unit × qty
  const tq = calcTotalQty(unit, qty);
  setField(row, 'totalQty', tq || '');

  // 2. Invoice Total = FOB × qty
  const invTotal = calcInvoiceTotal(fob, qty);
  setField(row, 'invoiceTotal', invTotal ? fmt(invTotal, 2) : '');

  // 3. Cost Price = (InvTotal ÷ TotalQty) × rate
  const cp = calcCostPrice(invTotal, tq, fur);
  setField(row, 'costPrice', cp ? fmt(cp, 2) : '');

  // 4. Total Cost
  const tcp = calcTotalCost(cp, tq);
  setField(row, 'totalCost', tcp ? fmt(tcp, 2) : '');

  // 5. Sell Inc GST — branches on gstApplicable
  const sell = gstOn
    ? calcSellIncGst(cp, markup, gst)       // cost × (1+markup%) × (1+gst%)
    : cp * (1 + markup / 100);              // cost × (1+markup%)  — no GST
  setField(row, 'sellIncGst', sell ? fmt(sell, 2) : '');

  // 6. Final Price — editable; default = sell rounded to 0.50
  const fpEl = row.querySelector('[data-field="finalPrice"]');
  let fp;
  if (finalIsManual && fpEl && fpEl.value !== '') {
    fp = parseFloat(fpEl.value) || 0;
  } else {
    fp = sell > 0 ? roundHalf(sell) : 0;
    if (fpEl && !fpEl.dataset.userEdited) {
      fpEl.value = fp > 0 ? fmt(fp, 2) : '';
    }
  }

  // 7. Regular Price & GST Amount — branches on gstApplicable
  let rp, gstAmt;
  if (gstOn) {
    rp     = calcRegularPrice(fp, gst);    // (100×fp)/(100+gst)
    gstAmt = calcGstAmount(fp, rp);        // fp − rp
  } else {
    rp     = fp;                            // no GST — regular = final
    gstAmt = 0;
  }
  setField(row, 'nonTaxPrice', fp > 0 ? fmt(rp, 2) : '');
  setField(row, 'gstAmount',   fp > 0 ? fmt(gstAmt, 2) : '');

  // 8. Total Regular = rp × tq
  const trp = rp * tq;
  setField(row, 'totalRegular', trp > 0 ? fmt(trp, 2) : '');

  // 9. Margin % = (rp − cp) / rp × 100
  const mgPct = calcMarginPct(rp, cp);
  const mgEl  = row.querySelector('[data-field="margin"]');
  if (mgEl) {
    mgEl.value = cp > 0 ? fmt(mgPct, 2) + '%' : '';
    mgEl.style.color      = mgPct >= 0 ? 'var(--green)' : 'var(--red)';
    mgEl.style.fontWeight = '600';
  }

  updateFooterTotals();
}

// ════════════════════════════════════════════════════════════════
//  FOOTER TOTALS
// ════════════════════════════════════════════════════════════════
export function updateFooterTotals() {
  const fur = _cs?.finalUsedRate ?? 0;
  const gst = _cs?.gst ?? 8;
  const frt = parseFloat(document.getElementById('h-freight')?.value) || 0;
  const sym = _cs?.sym || _cs?.code || '';

  let totFob=0, totInv=0, totQty=0, totCP=0, totRP=0;
  let markups=[], margins=[], rowCount=0;

  document.querySelectorAll('#items-rows tr[data-row]').forEach(row => {
    const unit   = fieldNum(row, 'unit', 1);
    const qty    = fieldNum(row, 'qty',  0);
    const fob    = fieldNum(row, 'fob',  0);
    const markup = fieldNum(row, 'markup', _cs?.mup ?? 100);
    if (!fob && !qty) return;
    rowCount++;

    const tq       = calcTotalQty(unit, qty);
    const invTotal = calcInvoiceTotal(fob, qty);
    const cp       = calcCostPrice(invTotal, tq, fur);
    const tcp      = calcTotalCost(cp, tq);
    const gstOn    = fieldGstOn(row);
    const sell     = gstOn ? calcSellIncGst(cp, markup, gst) : cp * (1 + markup / 100);
    const fpEl     = row.querySelector('[data-field="finalPrice"]');
    const fp       = (fpEl?.value) ? (parseFloat(fpEl.value)||0) : roundHalf(sell);
    const rp       = gstOn ? calcRegularPrice(fp, gst) : fp;
    const mgPct    = calcMarginPct(rp, cp);

    totFob += fob * qty;
    totInv += invTotal;
    totQty += tq;
    totCP  += tcp;
    totRP  += rp * tq;
    if (markup) markups.push(markup);
    if (cp > 0) margins.push(mgPct);
  });

  const invMvr = totFob * (fur || 1) + frt;
  const profit = totRP - totCP;
  const avgMup = markups.length ? markups.reduce((a,b)=>a+b,0)/markups.length : 0;
  const avgMgn = margins.length ? margins.reduce((a,b)=>a+b,0)/margins.length : 0;

  const s = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  s('ft-fob',     `${sym} ${fmt(totFob,2)}`);
  s('ft-inv',     fmv(invMvr));
  s('ft-qty',     totQty || 0);
  s('ft-cp',      fmv(totCP));
  s('ft-rp',      fmv(totRP));
  s('ft-profit',  fmv(profit));
  s('ft-avg-mup', fmt(avgMup,1)+'%');
  s('ft-avg-mgn', fmt(avgMgn,2)+'%');
  s('ft-items',   rowCount);

  const pe = document.getElementById('ft-profit');
  if (pe) pe.style.color = profit >= 0 ? 'var(--green)' : 'var(--red)';
}

export const updateTotals = updateFooterTotals;

// ════════════════════════════════════════════════════════════════
//  ADD ROW
// ════════════════════════════════════════════════════════════════
let _rowSeq = 0;

function _uomOptions(current) {
  const list = getUomList();
  const cur  = current || list[0] || 'yard';
  const all  = list.includes(cur) ? list : [...list, cur];
  return all.map(u => `<option${u===cur?' selected':''}>${u}</option>`).join('');
}

export function addItemRow(data = {}) {
  _rowSeq++;
  const rid    = 'row_' + _rowSeq;
  const markup = data.markup !== undefined ? data.markup : (_cs?.mup ?? 100);
  const unit   = data.unit   !== undefined ? data.unit   : 1;

  const tr = document.createElement('tr');
  tr.id           = rid;
  tr.dataset.row  = '1';   // marker for querySelectorAll

  // Helper: build a readonly calc cell
  const ro = (field, val='', title='') =>
    `<td><input type="text" class="cr t-right" readonly
       data-field="${field}" value="${val}" title="${title}"
       style="width:76px"></td>`;

  // Helper: build an editable number cell
  const ed = (field, val, extra='', style='width:60px') =>
    `<td><input type="number" class="ci t-right" data-field="${field}"
       value="${val}" ${extra}
       style="${style}" onfocus="this.select()"
       oninput="window._invRowChanged('${rid}')"></td>`;

  tr.innerHTML = `
    <td class="col-seq t-center t-muted fs11" style="width:26px">${_rowSeq}</td>
    <td><input type="text" class="ci" data-field="category"
      value="${data.category||''}" placeholder="Category"
      style="width:78px" onfocus="this.select()"></td>
    <td><input type="text" class="ci" data-field="code"
      value="${data.code||''}" placeholder="Code"
      style="width:66px" onfocus="this.select()"
      oninput="window._invRowChanged('${rid}')"></td>
    <td><input type="text" class="ci" data-field="name"
      value="${data.name||''}" placeholder="Item name"
      style="min-width:110px" onfocus="this.select()"
      oninput="window._invRowChanged('${rid}')"></td>
    <td><input type="text" class="ci" data-field="details"
      value="${data.details||''}" placeholder="Details"
      style="min-width:78px" onfocus="this.select()"></td>
    <td><select class="ci" data-field="uom" style="width:70px"
      onchange="window._invRowChanged('${rid}')">${_uomOptions(data.uom)}</select></td>
    ${ed('unit',  unit,   'min="0.001" step="0.001"', 'width:52px')}
    ${ed('qty',   data.qty||'', 'min="0" step="1"', 'width:52px')}
    ${ro('totalQty',     data.tq||'',       'Total Qty = Unit × Qty')}
    <td><input type="text" class="ci ci-opt t-right" data-field="pcsRcv"
      value="${data.pcsRcv||''}" placeholder="—"
      style="width:50px;background:#fffbeb;border-color:#fde68a"
      title="Physical count (optional)" onfocus="this.select()"></td>
    ${ed('fob', data.fob||'', 'min="0" step="0.01"', 'width:70px')}
    ${ro('invoiceTotal',  data.invTotal?fmt(data.invTotal,2):'', 'Invoice Total = FOB × Qty')}
    ${ro('costPrice',     data.cp?fmt(data.cp,2):'',             'Cost = (InvTotal ÷ TotalQty) × Rate')}
    <td><input type="number" class="ci ci-mup t-right" data-field="markup"
      value="${markup}" min="0" step="1" style="width:50px"
      title="Markup %" onfocus="this.select()"
      oninput="window._invRowChanged('${rid}')"></td>
    <td style="text-align:center;padding:0 6px" title="GST Applicable — uncheck for zero-rated items">
      <input type="checkbox" data-field="gstApplicable"
        ${data.gstApplicable === false ? '' : 'checked'}
        style="width:16px;height:16px;cursor:pointer;accent-color:var(--teal)"
        onchange="window._invRowChanged('${rid}')">
    </td>
    ${ro('sellIncGst',   data.fsp?fmt(data.fsp,2):'',   'Sell Inc GST = Cost × (1 + Markup%)')}
    <td><input type="number" class="ci ci-fp t-right" data-field="finalPrice"
      value="${data.fp?fmt(data.fp,2):''}" step="0.50" placeholder="auto"
      style="width:76px;border-color:var(--green);font-weight:700"
      title="Final Price Inc GST — editable" onfocus="this.select()"
      oninput="this.dataset.userEdited='1';window._invFinalChanged('${rid}')"></td>
    ${ro('nonTaxPrice',  data.rp?fmt(data.rp,2):'',  'Regular Price = (100 × Final) ÷ (100 + GST%)')}
    ${ro('margin',       data.mg!==undefined?fmt(data.mg,2)+'%':'', 'Margin = (Regular − Cost) ÷ Regular × 100')}
    ${ro('totalCost',    data.tcp?fmt(data.tcp,2):'',  'Total Cost = Cost Price × Total Qty')}
    ${ro('totalRegular', data.trp?fmt(data.trp,2):'',  'Total Regular = Regular Price × Total Qty')}
    <input type="hidden" data-field="gstAmount"   value="${data.gst?fmt(data.gst,2):''}">
    <input type="hidden" data-field="totalCostHid" value="${data.tcp?fmt(data.tcp,2):''}">
    <td><input type="text" class="ci" data-field="notes"
      value="${data.notes||''}" placeholder="Notes…"
      style="min-width:70px;color:var(--muted)" onfocus="this.select()"></td>
    <td style="text-align:center">
      <button class="del-row" onclick="window._invRemoveRow('${rid}')">✕</button>
    </td>`;

  document.getElementById('items-rows').appendChild(tr);
  _resequence();

  // If editing existing row with data, run calc immediately
  if (data.fob || data.cp) {
    setTimeout(() => calcRow(tr, false), 0);
  }
}

function _resequence() {
  let n = 1;
  document.querySelectorAll('#items-rows tr[data-row] .col-seq').forEach(el => {
    el.textContent = n++;
  });
}

// ── Global row event handlers ─────────────────────────────────
window._invRowChanged = function(rid) {
  const row = document.getElementById(rid);
  if (!row) return;
  // Clear user-edited flag on final price when other fields change
  // (so it auto-updates unless user has manually typed it)
  const fpEl = row.querySelector('[data-field="finalPrice"]');
  if (fpEl && !fpEl.dataset.userEdited) fpEl.value = '';
  calcRow(row, false);
};

window._invFinalChanged = function(rid) {
  const row = document.getElementById(rid);
  if (!row) return;
  calcRow(row, true);
};

window._invRemoveRow = function(rid) {
  document.getElementById(rid)?.remove();
  _resequence();
  updateFooterTotals();
};

// Backward-compat aliases used in main.js window assignments
export function rowChanged(rid)      { window._invRowChanged(rid); }
export function rowFinalChanged(rid) { window._invFinalChanged(rid); }
export function removeRow(rid)       { window._invRemoveRow(rid); }

// ════════════════════════════════════════════════════════════════
//  INVOICE LIST
// ════════════════════════════════════════════════════════════════
export function renderInvoiceList() {
  _updateSupFilters();
  const q   = (document.getElementById('search-input')?.value||'').toLowerCase();
  const fs  = document.getElementById('filter-status')?.value||'';
  const fsp = document.getElementById('filter-supplier')?.value||'';
  let invs  = [...S.invoices];
  if (q)   invs = invs.filter(i=>(i.number+i.supplier+i.ctrName+i.notes).toLowerCase().includes(q));
  if (fs)  invs = invs.filter(i=>i.status===fs);
  if (fsp) invs = invs.filter(i=>i.supplier===fsp);

  const countEl = document.getElementById('inv-count');
  if (countEl) countEl.textContent = invs.length+' invoice'+(invs.length!==1?'s':'');

  const tbody = document.getElementById('invoice-tbody');
  if (!tbody) return;

  if (!invs.length) {
    tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state">
      <div class="empty-icon">📭</div>
      <div class="empty-title">No invoices yet</div>
      <div class="empty-sub">Click "+ New Invoice" to get started</div>
    </div></td></tr>`;
    return;
  }

  const badge = { received:'badge-received', pending:'badge-pending', partial:'badge-partial' };
  tbody.innerHTML = invs.map((inv, i) => {
    const t  = inv.tot || {};
    const mc = (t.avgMgn||0)>=50?'t-green':(t.avgMgn||0)>=25?'t-amber':'t-red';
    return `<tr class="clickable" onclick="window.viewInvoice('${inv.id}')">
      <td class="t-muted fs12">${i+1}</td>
      <td class="t-mono fw6">${inv.number||'—'}</td>
      <td><div class="fw6">${inv.supplier||'—'}</div></td>
      <td><div class="fs12">${inv.ctrName||'—'}</div></td>
      <td class="fs12">${inv.receivedDate||'—'}</td>
      <td><span class="pill">${inv.items?.length||0}</span></td>
      <td class="t-mono t-teal">${fmt(t.fobTotal||0,2)}</td>
      <td class="t-mono fw6">${fmv(t.invMvr||0)}</td>
      <td class="${mc} fw6 t-mono">${fmt(t.avgMgn||0,2)}</td>
      <td><span class="badge ${badge[inv.status]||'badge-pending'}">${inv.status||'pending'}</span></td>
      <td onclick="event.stopPropagation()" style="text-align:center">
        <button class="btn btn-ghost btn-xs" onclick="window.editInvoice('${inv.id}')">✏</button>
        <button class="btn btn-danger btn-xs" onclick="window.deleteInvoice('${inv.id}')">🗑</button>
      </td>
    </tr>`;
  }).join('');
}

export function updateSupFilters() { _updateSupFilters(); }
function _updateSupFilters() {
  const sups = [...new Set(S.invoices.map(i=>i.supplier).filter(Boolean))].sort();
  ['filter-supplier','item-filter-supplier'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    const v  = el.value;
    el.innerHTML = '<option value="">All Suppliers</option>' +
      sups.map(s=>`<option value="${s}"${s===v?' selected':''}>${s}</option>`).join('');
  });
}

// ════════════════════════════════════════════════════════════════
//  OPEN / EDIT / CLEAR
// ════════════════════════════════════════════════════════════════
export function openNewInvoice() {
  S.editingInvoiceId = null;
  _cs = null;
  document.getElementById('modal-title').textContent = 'New Invoice';
  _clearForm();
  document.getElementById('h-invoice-date').value = new Date().toISOString().slice(0,10);
  _fillCountryDrop();
  _fillTripDrop();
  document.getElementById('items-rows').innerHTML = '';
  _rowSeq = 0;
  addItemRow(); addItemRow(); addItemRow();
  updateFooterTotals();
  document.getElementById('invoice-modal')?.classList.add('open');
}

export function editInvoice(id) {
  const inv = S.invoices.find(i=>i.id===id);
  if (!inv) { toast('Invoice not found','error'); return; }
  S.editingInvoiceId = id;
  document.getElementById('modal-title').textContent = 'Edit Invoice';
  _fillCountryDrop();
  _fillTripDrop();

  document.getElementById('h-number').value       = inv.number||'';
  document.getElementById('h-supplier').value     = inv.supplier||'';
  document.getElementById('h-country').value      = inv.ctrId||'';
  document.getElementById('h-trip').value         = inv.tripId||'';
  document.getElementById('h-invoice-date').value = inv.receivedDate||'';
  document.getElementById('h-order-date').value   = inv.orderDate||'';
  document.getElementById('h-status').value       = inv.status||'received';
  document.getElementById('h-freight').value      = inv.freight||0;
  document.getElementById('h-notes').value        = inv.notes||'';

  // Load country settings silently
  _cs = getCountrySettings(inv.ctrId) || null;
  // Override with invoice-saved rate in case country changed
  if (_cs && inv.finalUsedRate) _cs = { ..._cs, finalUsedRate: inv.finalUsedRate };

  document.getElementById('items-rows').innerHTML = '';
  _rowSeq = 0;
  (inv.items||[]).forEach(it => addItemRow(it));
  updateFooterTotals();
  document.getElementById('invoice-modal')?.classList.add('open');
}

export function editCurrentInvoice() {
  document.getElementById('view-modal')?.classList.remove('open');
  editInvoice(S.viewingInvoiceId);
}

function _clearForm() {
  ['h-number','h-supplier','h-order-date','h-notes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const st = document.getElementById('h-status');   if (st) st.value = 'received';
  const ct = document.getElementById('h-country');  if (ct) ct.value = '';
  const tr = document.getElementById('h-trip');     if (tr) tr.value = '';
  const fr = document.getElementById('h-freight');  if (fr) fr.value = 0;
}

// ── Country select ─────────────────────────────────────────────
export function onCountrySelect() {
  const id = document.getElementById('h-country').value;
  _cs = id ? (getCountrySettings(id) || null) : null;
  // Recalculate all rows with new rate
  document.querySelectorAll('#items-rows tr[data-row]').forEach(row => {
    const fpEl = row.querySelector('[data-field="finalPrice"]');
    if (fpEl) delete fpEl.dataset.userEdited;  // reset so prices update
    calcRow(row, false);
  });
  updateFooterTotals();
}

// ── Dropdown helpers ───────────────────────────────────────────
function _fillCountryDrop() {
  const sel = document.getElementById('h-country'); if (!sel) return;
  const v   = sel.value;
  sel.innerHTML = '<option value="">— Select Country —</option>' +
    S.countries.map(c =>
      `<option value="${c.id}"${c.id===v?' selected':''}>${c.name} (${c.code})</option>`
    ).join('');
}

function _fillTripDrop() {
  const sel = document.getElementById('h-trip'); if (!sel) return;
  const v   = sel.value;
  const yr  = S.dashYear || new Date().getFullYear();
  const trips = S.trips.filter(t => !t.year || t.year == yr);
  sel.innerHTML = '<option value="">— Optional —</option>' +
    trips.map(t => `<option value="${t.id}"${t.id===v?' selected':''}>${t.tripName}</option>`).join('');
}

// Called from startListeners so dropdowns stay fresh when data loads
export function populateCtrDrop() { _fillCountryDrop(); }

// ════════════════════════════════════════════════════════════════
//  COLLECT ITEMS FROM DOM
// ════════════════════════════════════════════════════════════════
function _collectItems() {
  const fur = _cs?.finalUsedRate ?? 0;
  const gst = _cs?.gst ?? 8;
  const items = [];

  document.querySelectorAll('#items-rows tr[data-row]').forEach(row => {
    const category = fieldVal(row, 'category');
    const code     = fieldVal(row, 'code');
    const name     = fieldVal(row, 'name');
    const details  = fieldVal(row, 'details');
    const uom      = fieldVal(row, 'uom');
    const unit     = fieldNum(row, 'unit', 1);
    const qty      = fieldNum(row, 'qty',  0);
    const pcsRcv   = fieldVal(row, 'pcsRcv') || null;
    const fob      = fieldNum(row, 'fob',  0);
    const markup        = fieldNum(row, 'markup', _cs?.mup ?? 100);
    const gstApplicable = fieldGstOn(row);
    const notes         = fieldVal(row, 'notes') || null;
    const fpVal         = fieldVal(row, 'finalPrice');

    if (!fob && !name && !code) return;

    // All computed at full float precision
    const tq       = calcTotalQty(unit, qty);
    const invTotal = calcInvoiceTotal(fob, qty);
    const cp       = calcCostPrice(invTotal, tq, fur);
    const tcp      = calcTotalCost(cp, tq);
    const sell     = gstApplicable
                       ? calcSellIncGst(cp, markup, gst)
                       : cp * (1 + markup / 100);
    const fp       = fpVal ? (parseFloat(fpVal)||0) : roundHalf(sell);
    const rp       = gstApplicable ? calcRegularPrice(fp, gst) : fp;
    const gstAmt   = gstApplicable ? calcGstAmount(fp, rp) : 0;
    const mgPct    = calcMarginPct(rp, cp);

    items.push({
      category, code, name, details, uom,
      unit, qty, pcsRcv, fob, markup, gstApplicable, notes,
      tq, invTotal, cp, tcp, fsp: sell, fp, rp,
      gst: gstAmt, mg: mgPct, trp: rp * tq,
      finalUsedRate: fur,
    });
  });
  return items;
}

// ════════════════════════════════════════════════════════════════
//  SAVE INVOICE
// ════════════════════════════════════════════════════════════════
export async function saveInvoice() {
  const supplier   = document.getElementById('h-supplier').value.trim();
  const invDate    = document.getElementById('h-invoice-date').value;
  const ctrId      = document.getElementById('h-country').value;
  if (!supplier)   return alert('Supplier name is required');
  if (!invDate)    return alert('Invoice date is required');
  if (!ctrId)      return alert('Please select a Country');

  const ct  = _cs || getCountrySettings(ctrId);
  const fur = ct?.finalUsedRate || 0;
  const frt = parseFloat(document.getElementById('h-freight').value) || 0;
  const items = _collectItems();
  if (!items.length) return alert('Add at least one line item with FOB or name');

  const fobTotal = items.reduce((s,i) => s + i.fob * i.qty, 0);
  const totalCP  = items.reduce((s,i) => s + (i.tcp||0), 0);
  const totalRP  = items.reduce((s,i) => s + (i.trp||0), 0);
  const margins  = items.filter(i=>i.cp>0).map(i=>i.mg);
  const avgMgn   = margins.length ? margins.reduce((a,b)=>a+b,0)/margins.length : 0;
  const invMvr   = fobTotal * (fur||1) + frt;

  const btn = document.getElementById('save-inv-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const id  = S.editingInvoiceId || uid();
  const inv = {
    id,
    number:       document.getElementById('h-number').value.trim() || 'INV-'+Date.now(),
    supplier, ctrId,
    ctrName:      ct?.name||'', ctrCode: ct?.code||'', ctrSym: ct?.sym||'',
    orderDate:    document.getElementById('h-order-date').value,
    receivedDate: invDate,
    status:       document.getElementById('h-status').value,
    tripId:       document.getElementById('h-trip').value || null,
    freight:      frt,
    notes:        document.getElementById('h-notes').value,
    finalUsedRate: fur,
    formulaRate:  ct?.formulaRate||0,
    cpy: ct?.cpy||1, mvr: ct?.mvr||1, cof: ct?.cof||0,
    mup: ct?.mup||100, gst: ct?.gst||8,
    // legacy compat
    adjRate: fur, rate: fur,
    items,
    tot: { fobTotal, invMvr, totalCP, totalRP, profit: totalRP-totalCP, avgMgn },
    savedAt: new Date().toISOString(),
  };

  await fsSet('invoices', id, inv);
  toast(S.editingInvoiceId ? 'Invoice updated ✓' : 'Invoice saved ✓');
  btn.disabled = false; btn.textContent = '💾 Save Invoice';
  document.getElementById('invoice-modal')?.classList.remove('open');
}

// ════════════════════════════════════════════════════════════════
//  VIEW INVOICE (read-only)
// ════════════════════════════════════════════════════════════════
export function viewInvoice(id) {
  const inv = S.invoices.find(i=>i.id===id); if (!inv) return;
  S.viewingInvoiceId = id;
  document.getElementById('vi-title').textContent = inv.number;
  const badge = { received:'badge-received', pending:'badge-pending', partial:'badge-partial' };
  document.getElementById('vi-sub').innerHTML =
    `${inv.supplier} &bull; ${inv.ctrName} &bull; ${inv.receivedDate} &bull;
     <span class="badge ${badge[inv.status]||'badge-pending'}">${inv.status}</span>`;

  const t   = inv.tot || {};
  const mc  = (t.avgMgn||0)>=50?'t-green':(t.avgMgn||0)>=25?'t-amber':'t-red';
  const fur = inv.finalUsedRate||inv.adjRate||inv.rate||0;

  document.getElementById('vi-body').innerHTML = `
    <div class="detail-grid" style="margin-bottom:14px">
      <div class="d-box"><div class="d-lbl">Invoice No.</div><div class="d-val t-mono">${inv.number}</div></div>
      <div class="d-box"><div class="d-lbl">Supplier</div><div class="d-val">${inv.supplier}</div></div>
      <div class="d-box"><div class="d-lbl">Country</div><div class="d-val">${inv.ctrName} <span class="t-mono t-muted fs12">(${inv.ctrCode})</span></div></div>
      <div class="d-box"><div class="d-lbl">Invoice Date</div><div class="d-val">${inv.receivedDate||'—'}</div></div>
      <div class="d-box"><div class="d-lbl">Rate Used</div><div class="d-val t-teal t-mono">×${fmt(fur,4)}</div></div>
      <div class="d-box"><div class="d-lbl">Freight</div><div class="d-val">${fmv(inv.freight||0)}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px">
      <div class="d-box"><div class="d-lbl">FOB Total</div><div class="d-val t-teal t-mono">${fmt(t.fobTotal||0,2)}</div></div>
      <div class="d-box"><div class="d-lbl">Invoice MVR</div><div class="d-val t-mono">${fmv(t.invMvr||0)}</div></div>
      <div class="d-box"><div class="d-lbl">Total Cost</div><div class="d-val t-mono">${fmv(t.totalCP||0)}</div></div>
      <div class="d-box"><div class="d-lbl">Total Revenue</div><div class="d-val t-green t-mono">${fmv(t.totalRP||0)}</div></div>
      <div class="d-box"><div class="d-lbl">Avg Margin</div><div class="d-val ${mc} t-mono">${fmt(t.avgMgn||0,2)}</div></div>
    </div>
    ${inv.notes?`<div class="vi-notes">📝 ${inv.notes}</div>`:''}
    <div style="overflow:auto">
      <table class="vi-table">
        <thead><tr>
          <th>#</th><th>Cat.</th><th>Code</th><th>Name</th><th>Details</th>
          <th>UOM</th><th>Unit</th><th>Qty</th><th>Total Qty</th><th>PCS</th>
          <th>FOB</th><th>Inv.Total</th><th>Cost/Unit</th><th>Total Cost</th>
          <th>Markup%</th><th>Sell Inc GST</th><th>Final Price</th>
          <th>Reg. Price</th><th>GST Amt</th><th>Margin</th><th>Notes</th>
        </tr></thead>
        <tbody>
        ${(inv.items||[]).map((it,i) => {
          const mc2 = (it.mg||0)>=0?'t-green':'t-red';
          const rp  = it.rp || (it.fp ? it.fp/(1+(inv.gst||8)/100) : 0);
          return `<tr>
            <td class="t-muted fs11">${i+1}</td>
            <td class="fs12 t-muted">${it.category||'—'}</td>
            <td class="t-mono fs11">${it.code||'—'}</td>
            <td class="fw6">${it.name||'—'}</td>
            <td class="fs12 t-muted">${it.details||'—'}</td>
            <td>${it.uom||'—'}</td>
            <td class="t-mono t-right">${it.unit||1}</td>
            <td class="t-mono t-right">${it.qty||0}</td>
            <td class="t-mono fw6 t-right">${it.tq||0}</td>
            <td class="t-muted fs11 t-right">${it.pcsRcv||'—'}</td>
            <td class="t-mono t-teal t-right">${fmt(it.fob||0,2)}</td>
            <td class="t-mono t-right">${fmt(it.invTotal||0,2)}</td>
            <td class="t-mono t-right">${fmv(it.cp||0)}</td>
            <td class="t-mono t-right">${fmv(it.tcp||0)}</td>
            <td class="t-mono t-right">${it.markup||100}%</td>
            <td class="t-mono t-muted t-right fs12">${fmv(it.fsp||0)}</td>
            <td class="t-mono fw6 t-right">${fmv(it.fp||0)}</td>
            <td class="t-mono t-right">${fmv(rp)}</td>
            <td class="t-mono t-muted fs11 t-right">${fmv(it.gst||0)}</td>
            <td class="${mc2} fw6 t-mono t-right">${fmt(it.mg||0,2)}</td>
            <td class="t-muted fs11">${it.notes||'—'}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>`;
  document.getElementById('view-modal')?.classList.add('open');
}

export async function deleteCurrentInvoice() {
  if (!confirm('Delete this invoice? Cannot be undone.')) return;
  await fsDel('invoices', S.viewingInvoiceId);
  toast('Invoice deleted');
  document.getElementById('view-modal')?.classList.remove('open');
}

export async function deleteInvoice(id) {
  if (!confirm('Delete this invoice?')) return;
  await fsDel('invoices', id);
  toast('Invoice deleted');
}

// ════════════════════════════════════════════════════════════════
//  ALL ITEMS VIEW
// ════════════════════════════════════════════════════════════════
export function renderAllItems() {
  _updateSupFilters();
  const q   = (document.getElementById('item-search')?.value||'').toLowerCase();
  const fsp = document.getElementById('item-filter-supplier')?.value||'';
  let rows  = [];
  S.invoices.forEach(inv =>
    (inv.items||[]).forEach(it =>
      rows.push({...it, supplier:inv.supplier, invNo:inv.number,
                 date:inv.receivedDate, ctrName:inv.ctrName})
    )
  );
  if (q)   rows = rows.filter(r=>(r.name+r.code+r.category).toLowerCase().includes(q));
  if (fsp) rows = rows.filter(r=>r.supplier===fsp);

  const countEl = document.getElementById('items-count');
  if (countEl) countEl.textContent = rows.length+' item'+(rows.length!==1?'s':'');

  const tbody = document.getElementById('items-tbody');
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="14"><div class="empty-state">
      <div class="empty-icon">📦</div><div class="empty-title">No items found</div>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const mc = (r.mg||0)>=0?'t-green':'t-red';
    return `<tr>
      <td class="t-mono fs11">${r.code||'—'}</td>
      <td class="fw6">${r.name||'—'}</td>
      <td class="t-muted">${r.supplier||'—'}</td>
      <td class="t-mono t-muted fs11">${r.invNo||'—'}</td>
      <td class="fs12">${r.ctrName||'—'}</td>
      <td>${r.uom||'—'}</td>
      <td class="t-mono t-right">${r.qty||0}</td>
      <td class="t-mono t-right">${r.tq||0}</td>
      <td class="t-mono t-teal t-right">${fmt(r.fob||0,2)}</td>
      <td class="t-mono t-right">${fmv(r.cp||0)}</td>
      <td class="t-mono fw6 t-right">${fmv(r.fp||0)}</td>
      <td class="${mc} fw6 t-mono t-right">${fmt(r.mg||0,2)}</td>
      <td class="t-muted fs11">${r.date||'—'}</td>
    </tr>`;
  }).join('');
}
