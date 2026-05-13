import { S } from './state.js';
import { fsSet, fsDel } from './db.js';
import { fmv, fmt, uid, toast } from './utils.js';
import { updateSupFilters } from './invoices.js';

// ══════════════════════════════════════════════════════════
//  ALL ITEMS VIEW
// ══════════════════════════════════════════════════════════
export function renderAllItems() {
  updateSupFilters();
  const q   = (document.getElementById('item-search')?.value || '').toLowerCase();
  const fsp = document.getElementById('item-filter-supplier')?.value || '';

  let rows = [];
  S.invoices.forEach(inv =>
    (inv.items || []).forEach(it =>
      rows.push({ ...it, supplier: inv.supplier, invNo: inv.number,
                  date: inv.receivedDate, ctrName: inv.ctrName, ctrCode: inv.ctrCode })
    )
  );

  if (q)   rows = rows.filter(r => (r.name + r.code + r.itemNo).toLowerCase().includes(q));
  if (fsp) rows = rows.filter(r => r.supplier === fsp);

  document.getElementById('items-count').textContent =
    rows.length + ' item' + (rows.length !== 1 ? 's' : '');

  const tbody = document.getElementById('items-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="15">
      <div class="empty-state">
        <div class="empty-icon">📦</div>
        <div class="empty-title">No items found</div>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const mc = (r.mg || 0) >= 50 ? 't-green' : (r.mg || 0) >= 25 ? 't-amber' : 't-red';
    return `<tr>
      <td class="t-mono fs11">${r.code   || '—'}</td>
      <td class="t-mono fs11">${r.itemNo || '—'}</td>
      <td class="fw6">${r.name     || '—'}</td>
      <td class="t-muted">${r.supplier || '—'}</td>
      <td class="t-mono t-muted fs11">${r.invNo   || '—'}</td>
      <td class="fs12">${r.ctrName  || '—'}</td>
      <td>${r.uom    || '—'}</td>
      <td class="t-mono">${r.qty    || 0}</td>
      <td class="t-mono t-teal">${fmt(r.fob || 0, 2)}</td>
      <td class="t-mono t-muted fs11">×${fmt(r.rate || 0, 4)}</td>
      <td class="t-mono">${fmv(r.cp  || 0)}</td>
      <td class="t-mono">${fmv(r.sp  || 0)}</td>
      <td class="t-mono fw6">${fmv(r.fp  || 0)}</td>
      <td class="${mc} fw6 t-mono">${fmt(r.mg || 0, 1)}%</td>
      <td class="t-muted fs11">${r.date  || '—'}</td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
//  SUPPLIERS
// ══════════════════════════════════════════════════════════
export function renderSuppliers() {
  const tbody = document.getElementById('suppliers-tbody');
  const fromInv = [...new Set(S.invoices.map(i => i.supplier).filter(Boolean))];
  const all = [...new Set([...S.suppliers.map(s => s.name), ...fromInv])].sort();

  if (!all.length) {
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state">
        <div class="empty-icon">🏪</div>
        <div class="empty-title">No suppliers yet</div>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = all.map(name => {
    const sup  = S.suppliers.find(s => s.name === name) || {};
    const invs = S.invoices.filter(i => i.supplier === name);
    const tot  = invs.reduce((s, i) => s + (i.tot?.invMvr || 0), 0);
    return `<tr>
      <td class="fw6">${name}</td>
      <td>${sup.country || invs[0]?.ctrName || '—'}</td>
      <td>${sup.contact || '—'}</td>
      <td class="t-muted">${sup.email || '—'}</td>
      <td><span class="pill">${invs.length}</span></td>
      <td class="t-green fw6 t-mono">${fmv(tot)}</td>
      <td>
        <button class="btn btn-danger btn-xs" onclick="window.deleteSupplier('${name}')">Remove</button>
      </td>
    </tr>`;
  }).join('');
}

export function openAddSupplier() {
  document.getElementById('supplier-modal')?.classList.add('open');
}

export async function saveSupplier() {
  const name = document.getElementById('sup-name').value.trim();
  if (!name) { alert('Supplier name required'); return; }
  const id   = uid();
  const data = {
    id, name,
    country: document.getElementById('sup-country').value,
    contact: document.getElementById('sup-contact').value,
    phone:   document.getElementById('sup-phone').value,
    email:   document.getElementById('sup-email').value,
    notes:   document.getElementById('sup-notes').value,
  };
  await fsSet('suppliers', id, data);
  toast('Supplier saved ✓');
  document.getElementById('supplier-modal')?.classList.remove('open');
  ['sup-name','sup-country','sup-contact','sup-phone','sup-email','sup-notes']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

export async function deleteSupplier(name) {
  if (!confirm(`Remove supplier "${name}"?`)) return;
  const sup = S.suppliers.find(s => s.name === name);
  if (sup) await fsDel('suppliers', sup.id);
  toast('Supplier removed');
}
