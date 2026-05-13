import { S } from './state.js';
import { fsSet, fsDel } from './db.js';
import { costRate, calcRow, fmv, fmt, uid, toast } from './utils.js';
import { populateCtrDrop } from './countries.js';

// ── INVOICE LIST ─────────────────────────────────────────
export function renderInvoiceList() {
  updateSupFilters();
  const q   = (document.getElementById('search-input')?.value || '').toLowerCase();
  const fs  = document.getElementById('filter-status')?.value  || '';
  const fsp = document.getElementById('filter-supplier')?.value || '';

  let invs = [...S.invoices];
  if (q)   invs = invs.filter(i => (i.number + i.supplier + i.ctrName + i.notes).toLowerCase().includes(q));
  if (fs)  invs = invs.filter(i => i.status === fs);
  if (fsp) invs = invs.filter(i => i.supplier === fsp);

  document.getElementById('inv-count').textContent =
    invs.length + ' invoice' + (invs.length !== 1 ? 's' : '');

  const tbody = document.getElementById('invoice-tbody');
  if (!invs.length) {
    tbody.innerHTML = `<tr><td colspan="11">
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-title">No invoices yet</div>
        <div class="empty-sub">Click "+ New Invoice" to record your first purchase</div>
      </div></td></tr>`;
    return;
  }

  const sc = { received:'badge-received', pending:'badge-pending', partial:'badge-partial' };
  tbody.innerHTML = invs.map((inv, i) => {
    const t  = inv.tot || {};
    const mc = (t.avgMgn || 0) >= 50 ? 't-green' : (t.avgMgn || 0) >= 25 ? 't-amber' : 't-red';
    const sym = inv.ctrSym || inv.ctrCode || '';
    return `<tr class="clickable" onclick="window.viewInvoice('${inv.id}')">
      <td class="t-muted fs12">${i + 1}</td>
      <td class="t-mono fw6">${inv.number || '—'}</td>
      <td>
        <div class="fw6">${inv.supplier || '—'}</div>
        ${inv.payment ? `<div class="t-muted fs11">${inv.payment}</div>` : ''}
      </td>
      <td>
        <div class="fs12">${inv.ctrName || '—'}</div>
        <div class="t-mono t-muted fs11">${inv.ctrCode || ''}</div>
      </td>
      <td class="fs12">${inv.receivedDate || '—'}</td>
      <td><span class="pill">${inv.items?.length || 0}</span></td>
      <td class="t-mono t-teal">${sym} ${fmt(t.fobTotal || 0, 2)}</td>
      <td class="t-mono fw6">${fmv(t.invMvr || 0)}</td>
      <td class="${mc} fw6 t-mono">${fmt(t.avgMgn || 0, 1)}%</td>
      <td><span class="badge ${sc[inv.status] || 'badge-pending'}">${inv.status || 'pending'}</span></td>
      <td onclick="event.stopPropagation()" style="text-align:center">
        <button class="btn btn-ghost btn-xs" onclick="window.editInvoice('${inv.id}')">✏</button>
        <button class="btn btn-danger btn-xs" onclick="window.deleteInvoice('${inv.id}')">🗑</button>
      </td>
    </tr>`;
  }).join('');
}

export function updateSupFilters() {
  const sups = [...new Set(S.invoices.map(i => i.supplier).filter(Boolean))].sort();
  ['filter-supplier', 'item-filter-supplier'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const v = el.value;
    el.innerHTML = '<option value="">All Suppliers</option>' +
      sups.map(s => `<option value="${s}"${s === v ? ' selected' : ''}>${s}</option>`).join('');
  });
}

// ── INVOICE FORM ─────────────────────────────────────────
export function openNewInvoice() {
  S.editingInvoiceId = null;
  document.getElementById('modal-title').textContent = 'New Invoice';
  clearInvForm();
  document.getElementById('inv-received-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('items-rows').innerHTML = '';
  addItemRow(); addItemRow(); addItemRow();
  updateTotals();
  populateCtrDrop();
  openModal('invoice-modal');
}

export function editInvoice(id) {
  const inv = S.invoices.find(i => i.id === id);
  if (!inv) { toast('Invoice not found', 'error'); return; }
  S.editingInvoiceId = id;
  document.getElementById('modal-title').textContent = 'Edit Invoice';
  populateCtrDrop();
  document.getElementById('inv-number').value          = inv.number        || '';
  document.getElementById('inv-supplier').value        = inv.supplier      || '';
  document.getElementById('inv-status').value          = inv.status        || 'received';
  document.getElementById('inv-country-origin').value  = inv.ctrId         || '';
  document.getElementById('inv-order-date').value      = inv.orderDate     || '';
  document.getElementById('inv-received-date').value   = inv.receivedDate  || '';
  document.getElementById('inv-payment').value         = inv.payment       || '';
  document.getElementById('inv-freight').value         = inv.freight       || 0;
  document.getElementById('inv-notes').value           = inv.notes         || '';
  onCountrySelect();
  document.getElementById('items-rows').innerHTML = '';
  (inv.items || []).forEach(it => addItemRow(it));
  updateTotals();
  openModal('invoice-modal');
}

export function editCurrentInvoice() {
  closeModal('view-modal');
  editInvoice(S.viewingInvoiceId);
}

function clearInvForm() {
  ['inv-number','inv-supplier','inv-order-date','inv-payment','inv-notes']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('inv-status').value         = 'received';
  document.getElementById('inv-country-origin').value = '';
  document.getElementById('inv-freight').value        = 0;
  document.getElementById('rate-display').style.display  = 'none';
  document.getElementById('country-note').style.display  = 'none';
}

// ── COUNTRY SELECT → RATE PANEL ──────────────────────────
export function onCountrySelect() {
  const id = document.getElementById('inv-country-origin').value;
  const c  = S.countries.find(x => x.id === id);
  const display = document.getElementById('rate-display');
  const note    = document.getElementById('country-note');

  if (!c) {
    display.style.display = 'none';
    note.style.display    = 'none';
    recalcAllRows();
    updateTotals();
    return;
  }

  const r = costRate(c.cpy, c.mvr, c.cof);
  document.getElementById('rp-title').textContent    = c.name.toUpperCase() + ' — RATE DETAILS';
  document.getElementById('rp-rate').textContent     = '×' + fmt(r, 4);
  document.getElementById('rp-currency').textContent = c.code + (c.sym ? ` (${c.sym})` : '');
  document.getElementById('rp-cpy').textContent      = fmt(c.cpy, 4);
  document.getElementById('rp-mvr').textContent      = fmt(c.mvr, 4);
  document.getElementById('rp-cof').textContent      = c.cof + '%';
  document.getElementById('rp-mup').textContent      = c.mup + '%';
  document.getElementById('rp-gst').textContent      = c.gst + '%';
  display.style.display = 'block';
  note.style.display    = 'block';
  recalcAllRows();
  updateTotals();
}

function getActiveRates() {
  const id = document.getElementById('inv-country-origin')?.value || '';
  const c  = S.countries.find(x => x.id === id) || { cpy:1, mvr:1, cof:0, mup:0, gst:0 };
  return { ...c, rate: costRate(c.cpy, c.mvr, c.cof) };
}

// ── ROW MANAGEMENT ───────────────────────────────────────
let rowId = 0;

export function addItemRow(data = {}) {
  rowId++;
  const rid = 'r' + rowId;
  const tr  = document.createElement('tr');
  tr.id     = rid;
  tr.innerHTML = `
    <td><input type="text" placeholder="SYS001"  value="${data.code   || ''}" oninput="window.rowChanged('${rid}')"></td>
    <td><input type="text" placeholder="ITM-001" value="${data.itemNo || ''}" oninput="window.rowChanged('${rid}')"></td>
    <td><input type="text" placeholder="Item name" style="min-width:130px" value="${data.name || ''}" oninput="window.rowChanged('${rid}')"></td>
    <td>
      <select onchange="window.rowChanged('${rid}')" style="width:66px">
        ${['PCS','SET','DOZ','PKT','CTN','KG','MTR','YD'].map(u =>
          `<option${(data.uom || 'PCS') === u ? ' selected' : ''}>${u}</option>`).join('')}
      </select>
    </td>
    <td><input type="number" value="${data.pcs || 1}" min="1" oninput="window.rowChanged('${rid}')" style="width:50px"></td>
    <td><input type="number" value="${data.qty || ''}" min="0" step="0.01" oninput="window.rowChanged('${rid}')" style="width:60px"></td>
    <td><input type="number" class="calc" readonly id="${rid}_tq" value="${data.tq || 0}" style="width:60px"></td>
    <td><input type="number" placeholder="0.00" value="${data.fob || ''}" min="0" step="0.01" oninput="window.rowChanged('${rid}')" style="width:76px"></td>
    <td><input type="number" class="calc" readonly id="${rid}_cp" value="${fmt(data.cp || 0, 2)}" style="width:84px"></td>
    <td><input type="number" class="calc" readonly id="${rid}_sp" value="${fmt(data.sp || 0, 2)}" style="width:84px"></td>
    <td><input type="number" class="calc" readonly id="${rid}_fp" value="${fmt(data.fp || 0, 2)}" style="width:84px"></td>
    <td><input type="text"   class="calc" readonly id="${rid}_mg" value="${fmt(data.mg || 0, 1)}%" style="width:60px"></td>
    <td><button class="del-row" onclick="window.removeRow('${rid}')">✕</button></td>`;
  document.getElementById('items-rows').appendChild(tr);
}

export function removeRow(rid) {
  document.getElementById(rid)?.remove();
  updateTotals();
}

export function rowChanged(rid) {
  const tr = document.getElementById(rid);
  if (!tr) return;
  const inp = tr.querySelectorAll('input,select');
  const pcs = parseFloat(inp[4].value) || 1;
  const qty = parseFloat(inp[5].value) || 0;
  const fob = parseFloat(inp[7].value) || 0;
  const { rate, mup, gst } = getActiveRates();
  const c = calcRow(fob, pcs, qty, rate, mup, gst);
  document.getElementById(`${rid}_tq`).value = c.tq;
  document.getElementById(`${rid}_cp`).value = fmt(c.cp, 2);
  document.getElementById(`${rid}_sp`).value = fmt(c.sp, 2);
  document.getElementById(`${rid}_fp`).value = fmt(c.fp, 2);
  document.getElementById(`${rid}_mg`).value = fmt(c.mg, 1) + '%';
  updateTotals();
}

function recalcAllRows() {
  document.querySelectorAll('#items-rows tr').forEach(tr => {
    if (tr.id) rowChanged(tr.id);
  });
}

export function updateTotals() {
  const { rate, mup, gst, cpy, mvr } = getActiveRates();
  const frt = parseFloat(document.getElementById('inv-freight')?.value) || 0;
  let fobTotal = 0, totalCP = 0, totalRP = 0, margins = [];

  document.querySelectorAll('#items-rows tr').forEach(tr => {
    const inp = tr.querySelectorAll('input,select');
    if (!inp.length) return;
    const pcs = parseFloat(inp[4]?.value) || 1;
    const qty = parseFloat(inp[5]?.value) || 0;
    const fob = parseFloat(inp[7]?.value) || 0;
    const c   = calcRow(fob, pcs, qty, rate, mup, gst);
    fobTotal += fob * qty;
    totalCP  += c.tcp;
    totalRP  += c.trp;
    if (c.mg) margins.push(c.mg);
  });

  const invMvr  = fobTotal * (mvr / cpy) + frt;
  const avgMgn  = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;
  const id = document.getElementById('inv-country-origin')?.value;
  const ct = S.countries.find(x => x.id === id);
  const sym = ct?.sym || ct?.code || '';

  const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.textContent = v; };
  set('sum-fob', `${sym} ${fmt(fobTotal, 2)}`);
  set('sum-inv', fmv(invMvr));
  set('sum-cp',  fmv(totalCP));
  set('sum-rp',  fmv(totalRP));
  set('sum-mgn', fmt(avgMgn, 1) + '%');
}

function collectItems() {
  const { rate, mup, gst } = getActiveRates();
  const items = [];
  document.querySelectorAll('#items-rows tr').forEach(tr => {
    const inp    = tr.querySelectorAll('input,select');
    if (!inp.length) return;
    const code   = inp[0]?.value.trim();
    const itemNo = inp[1]?.value.trim();
    const name   = inp[2]?.value.trim();
    const uom    = inp[3]?.value;
    const pcs    = parseFloat(inp[4]?.value) || 1;
    const qty    = parseFloat(inp[5]?.value) || 0;
    const fob    = parseFloat(inp[7]?.value) || 0;
    if (!fob && !name && !code) return;
    const c = calcRow(fob, pcs, qty, rate, mup, gst);
    items.push({ code, itemNo, name, uom, pcs, qty, fob, rate, ...c });
  });
  return items;
}

// ── SAVE ─────────────────────────────────────────────────
export async function saveInvoice() {
  const supplier     = document.getElementById('inv-supplier').value.trim();
  const receivedDate = document.getElementById('inv-received-date').value;
  const ctrId        = document.getElementById('inv-country-origin').value;
  if (!supplier)     return alert('Supplier name is required');
  if (!receivedDate) return alert('Received date is required');
  if (!ctrId)        return alert('Please select a Country of Origin');

  const ct = S.countries.find(x => x.id === ctrId);
  const { cpy, mvr, cof, mup, gst, rate } = getActiveRates();
  const frt   = parseFloat(document.getElementById('inv-freight').value) || 0;
  const items = collectItems();
  if (!items.length) return alert('Add at least one line item');

  const fobTotal = items.reduce((s, i) => s + i.fob * (i.qty || 0), 0);
  const totalCP  = items.reduce((s, i) => s + (i.tcp || 0), 0);
  const totalRP  = items.reduce((s, i) => s + (i.trp || 0), 0);
  const margins  = items.filter(i => i.mg).map(i => i.mg);
  const avgMgn   = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;
  const invMvr   = fobTotal * (mvr / cpy) + frt;

  const btn = document.getElementById('save-inv-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const id  = S.editingInvoiceId || uid();
  const inv = {
    id,
    number:       document.getElementById('inv-number').value.trim() || 'INV-' + Date.now(),
    supplier,
    ctrId,
    ctrName:      ct?.name  || '',
    ctrCode:      ct?.code  || '',
    ctrSym:       ct?.sym   || '',
    orderDate:    document.getElementById('inv-order-date').value,
    receivedDate,
    status:       document.getElementById('inv-status').value,
    payment:      document.getElementById('inv-payment').value,
    freight:      frt,
    notes:        document.getElementById('inv-notes').value,
    cpy, mvr, cof, mup, gst, rate,
    items,
    tot: { fobTotal, invMvr, totalCP, totalRP, profit: totalRP - totalCP, avgMgn },
    savedAt: new Date().toISOString(),
  };

  await fsSet('invoices', id, inv);
  toast(S.editingInvoiceId ? 'Invoice updated ✓' : 'Invoice saved ✓');
  btn.disabled    = false;
  btn.textContent = '💾 Save Invoice';
  closeModal('invoice-modal');
}

// ── VIEW INVOICE ─────────────────────────────────────────
export function viewInvoice(id) {
  const inv = S.invoices.find(i => i.id === id);
  if (!inv) return;
  S.viewingInvoiceId = id;

  document.getElementById('vi-title').textContent = inv.number;
  const sc = { received:'badge-received', pending:'badge-pending', partial:'badge-partial' };
  document.getElementById('vi-sub').innerHTML =
    `${inv.supplier} &bull; ${inv.ctrName} &bull; ${inv.receivedDate} &bull;
     <span class="badge ${sc[inv.status] || 'badge-pending'}">${inv.status}</span>`;

  const t   = inv.tot || {};
  const mc  = (t.avgMgn || 0) >= 50 ? 't-green' : (t.avgMgn || 0) >= 25 ? 't-amber' : 't-red';
  const sym = inv.ctrSym || inv.ctrCode || '';

  document.getElementById('vi-body').innerHTML = `
    <div class="detail-grid">
      <div class="d-box"><div class="d-lbl">Invoice No.</div><div class="d-val t-mono">${inv.number}</div></div>
      <div class="d-box"><div class="d-lbl">Supplier</div><div class="d-val">${inv.supplier}</div></div>
      <div class="d-box"><div class="d-lbl">Country of Origin</div><div class="d-val">${inv.ctrName} <span class="t-mono t-muted" style="font-size:13px">(${inv.ctrCode})</span></div></div>
      <div class="d-box"><div class="d-lbl">Order Date</div><div class="d-val" style="font-size:14px">${inv.orderDate || '—'}</div></div>
      <div class="d-box"><div class="d-lbl">Received Date</div><div class="d-val" style="font-size:14px">${inv.receivedDate}</div></div>
      <div class="d-box"><div class="d-lbl">Freight (MVR)</div><div class="d-val" style="font-size:14px">${fmv(inv.freight || 0)}</div></div>
    </div>
    <div class="rate-panel-wrap" style="margin-bottom:14px">
      <div class="rate-panel-head">
        <span class="rate-panel-label">${inv.ctrName.toUpperCase()} — RATE DETAILS</span>
        <span class="rate-panel-badge">Cost Rate: ×${fmt(inv.rate, 4)}</span>
      </div>
      <div class="rate-panel-grid">
        <div class="rp-cell"><div class="rp-lbl">Currency</div><div class="rp-val">${inv.ctrCode}${inv.ctrSym ? ` (${inv.ctrSym})` : ''}</div></div>
        <div class="rp-cell"><div class="rp-lbl">Ccy/USD</div><div class="rp-val">${fmt(inv.cpy, 4)}</div></div>
        <div class="rp-cell"><div class="rp-lbl">MVR/USD</div><div class="rp-val">${fmt(inv.mvr, 4)}</div></div>
        <div class="rp-cell"><div class="rp-lbl">COF%</div><div class="rp-val">${inv.cof}%</div></div>
        <div class="rp-cell"><div class="rp-lbl">Markup%</div><div class="rp-val">${inv.mup}%</div></div>
        <div class="rp-cell"><div class="rp-lbl">GST%</div><div class="rp-val">${inv.gst}%</div></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px">
      <div class="d-box"><div class="d-lbl">FOB Total</div><div class="d-val t-teal t-mono" style="font-size:14px">${sym} ${fmt(t.fobTotal, 2)}</div></div>
      <div class="d-box"><div class="d-lbl">Invoice MVR</div><div class="d-val t-mono" style="font-size:14px">${fmv(t.invMvr)}</div></div>
      <div class="d-box"><div class="d-lbl">Cost Base</div><div class="d-val t-mono" style="font-size:14px">${fmv(t.totalCP)}</div></div>
      <div class="d-box"><div class="d-lbl">Proj. Sales</div><div class="d-val t-green t-mono" style="font-size:14px">${fmv(t.totalRP)}</div></div>
      <div class="d-box"><div class="d-lbl">Avg Margin</div><div class="d-val ${mc} t-mono" style="font-size:14px">${fmt(t.avgMgn, 1)}%</div></div>
    </div>
    ${inv.notes ? `<div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#713f12">📝 ${inv.notes}</div>` : ''}
    <div class="table-card">
      <table>
        <thead><tr>
          <th>#</th><th>Code</th><th>Item #</th><th>Name</th><th>UOM</th>
          <th>PCS</th><th>Qty</th><th>Tot.Qty</th><th>FOB</th>
          <th>Rate</th><th>Cost</th><th>Sell</th><th>Final</th>
          <th>Margin</th><th>Tot.Cost</th><th>Tot.Sales</th>
        </tr></thead>
        <tbody>
        ${(inv.items || []).map((it, i) => {
          const mc2 = (it.mg || 0) >= 50 ? 't-green' : (it.mg || 0) >= 25 ? 't-amber' : 't-red';
          return `<tr>
            <td class="t-muted fs11">${i + 1}</td>
            <td class="t-mono fs11">${it.code || '—'}</td>
            <td class="t-mono fs11">${it.itemNo || '—'}</td>
            <td class="fw6">${it.name || '—'}</td>
            <td>${it.uom || '—'}</td>
            <td>${it.pcs || 1}</td><td>${it.qty || 0}</td><td>${it.tq || 0}</td>
            <td class="t-mono t-teal">${sym} ${fmt(it.fob, 2)}</td>
            <td class="t-mono t-muted fs11">×${fmt(it.rate || inv.rate, 4)}</td>
            <td class="t-mono">${fmv(it.cp)}</td>
            <td class="t-mono">${fmv(it.sp)}</td>
            <td class="t-mono fw6">${fmv(it.fp)}</td>
            <td class="${mc2} fw6 t-mono">${fmt(it.mg, 1)}%</td>
            <td class="t-mono">${fmv(it.tcp)}</td>
            <td class="t-mono t-green">${fmv(it.trp)}</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>`;
  openModal('view-modal');
}

export async function deleteCurrentInvoice() {
  if (!confirm('Delete this invoice? This cannot be undone.')) return;
  await fsDel('invoices', S.viewingInvoiceId);
  toast('Invoice deleted');
  closeModal('view-modal');
}

export async function deleteInvoice(id) {
  if (!confirm('Delete this invoice?')) return;
  await fsDel('invoices', id);
  toast('Invoice deleted');
}

function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
