import { S } from '../state.js';
import { fsSet, fsDel } from '../db.js';
import { fmv, fmt, uid, toast } from '../utils.js';
import { populateCtrDrop } from '../countries.js';

const TRIP_STATUSES = ['Draft','Submitted','Office Review','Approved','Purchasing','Receiving','Pricing','Closed'];
const STATUS_BADGE  = {
  Draft:'badge-partial', Submitted:'badge-pending', 'Office Review':'badge-pending',
  Approved:'badge-received', Purchasing:'badge-received', Receiving:'badge-received',
  Pricing:'badge-received', Closed:'badge-pending'
};

// ── TRIP LIST ─────────────────────────────────────────────
export function renderTripList() {
  const year  = S.dashYear || new Date().getFullYear();
  const tbody = document.getElementById('trip-tbody'); if (!tbody) return;
  const count = document.getElementById('trip-count');

  let trips = [...S.trips].filter(t => !t.year || t.year == year)
    .sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));

  if (count) count.textContent = trips.length + ' trip' + (trips.length!==1?'s':'');

  if (!trips.length) {
    tbody.innerHTML=`<tr><td colspan="9"><div class="empty-state">
      <div class="empty-icon">✈️</div>
      <div class="empty-title">No trips for ${year}</div>
      <div class="empty-sub">Click "+ New Trip" to create a buying trip</div>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = trips.map(t => {
    const invs = S.invoices.filter(i => i.tripId === t.id);
    const actualMvr = invs.reduce((s,i)=>s+(i.tot?.invMvr||0),0);
    const budgetMvr = t.approvedBudgetMvr || 0;
    const over = Math.max(0, actualMvr - budgetMvr);
    const sc = STATUS_BADGE[t.status]||'badge-partial';
    return `<tr class="clickable" onclick="window.viewTrip('${t.id}')">
      <td class="fw6">${t.tripName||'—'}</td>
      <td class="t-muted fs12">${t.country||'—'}</td>
      <td class="t-muted fs12">${t.manager||'—'}</td>
      <td class="t-mono">${t.approvedBudgetUsd ? '$'+fmt(t.approvedBudgetUsd,0) : '—'}</td>
      <td class="t-mono">${fmv(budgetMvr)}</td>
      <td class="t-mono fw6">${fmv(actualMvr)}</td>
      <td class="t-mono ${over>0?'t-red':'t-green'}">${over>0?'▲'+fmv(over):'✓ OK'}</td>
      <td><span class="badge ${sc}">${t.status||'Draft'}</span></td>
      <td onclick="event.stopPropagation()" style="text-align:center">
        <button class="btn btn-ghost btn-xs" onclick="window.editTrip('${t.id}')">✏</button>
        <button class="btn btn-danger btn-xs" onclick="window.deleteTrip('${t.id}')">🗑</button>
      </td>
    </tr>`;
  }).join('');
}

// ── OPEN FORMS ────────────────────────────────────────────
export function openNewTrip() {
  S.editingTripId = null;
  document.getElementById('trip-modal-title').textContent = 'New Trip';
  clearTripForm();
  document.getElementById('trip-year').value = S.dashYear || new Date().getFullYear();
  populateCtrDrop('trip-country');
  document.getElementById('trip-modal')?.classList.add('open');
}

export function editTrip(id) {
  const t = S.trips.find(x=>x.id===id); if (!t) return;
  S.editingTripId = id;
  document.getElementById('trip-modal-title').textContent = 'Edit Trip';
  populateCtrDrop('trip-country');
  document.getElementById('trip-year').value         = t.year||'';
  document.getElementById('trip-name').value         = t.tripName||'';
  document.getElementById('trip-country').value      = t.countryId||'';
  document.getElementById('trip-manager').value      = t.manager||'';
  document.getElementById('trip-date-from').value    = t.dateFrom||'';
  document.getElementById('trip-date-to').value      = t.dateTo||'';
  document.getElementById('trip-budget-usd').value   = t.approvedBudgetUsd||'';
  document.getElementById('trip-budget-mvr').value   = t.approvedBudgetMvr||'';
  document.getElementById('trip-status').value       = t.status||'Draft';
  document.getElementById('trip-notes').value        = t.notes||'';
  document.getElementById('trip-modal')?.classList.add('open');
}

function clearTripForm() {
  ['trip-year','trip-name','trip-manager','trip-date-from','trip-date-to',
   'trip-budget-usd','trip-budget-mvr','trip-notes'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  const s=document.getElementById('trip-status'); if(s) s.value='Draft';
  const c=document.getElementById('trip-country'); if(c) c.value='';
}

export async function saveTrip() {
  const tripName = document.getElementById('trip-name').value.trim();
  if (!tripName) return alert('Trip name is required');
  const countryId = document.getElementById('trip-country').value;
  const country   = S.countries.find(x=>x.id===countryId);
  const id = S.editingTripId || uid();
  const trip = {
    id,
    year:             parseInt(document.getElementById('trip-year').value)||new Date().getFullYear(),
    tripName,
    countryId,
    country:          country?.name||'',
    countryCode:      country?.code||'',
    manager:          document.getElementById('trip-manager').value.trim(),
    dateFrom:         document.getElementById('trip-date-from').value,
    dateTo:           document.getElementById('trip-date-to').value,
    approvedBudgetUsd:parseFloat(document.getElementById('trip-budget-usd').value)||0,
    approvedBudgetMvr:parseFloat(document.getElementById('trip-budget-mvr').value)||0,
    status:           document.getElementById('trip-status').value||'Draft',
    notes:            document.getElementById('trip-notes').value,
    createdAt:        new Date().toISOString(),
  };
  const btn = document.getElementById('save-trip-btn');
  btn.disabled=true; btn.textContent='Saving…';
  await fsSet('trips', id, trip);
  toast(S.editingTripId?'Trip updated ✓':'Trip saved ✓');
  btn.disabled=false; btn.textContent='💾 Save Trip';
  document.getElementById('trip-modal')?.classList.remove('open');
}

export async function deleteTrip(id) {
  if (!confirm('Delete this trip?')) return;
  await fsDel('trips', id);
  toast('Trip deleted');
}

// ── TRIP DETAIL VIEW ──────────────────────────────────────
export function viewTrip(id) {
  const t = S.trips.find(x=>x.id===id); if (!t) return;
  S.viewingTripId = id;
  const invs   = S.invoices.filter(i=>i.tripId===id);
  const totMvr = invs.reduce((s,i)=>s+(i.tot?.invMvr||0),0);
  const totCP  = invs.reduce((s,i)=>s+(i.tot?.totalCP||0),0);
  const totRP  = invs.reduce((s,i)=>s+(i.tot?.totalRP||0),0);
  const budMvr = t.approvedBudgetMvr||0;
  const over   = Math.max(0, totMvr-budMvr);
  const sc     = STATUS_BADGE[t.status]||'badge-partial';

  const el = document.getElementById('trip-detail-body'); if (!el) return;
  el.innerHTML = `
    <div class="detail-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">
      <div class="d-box"><div class="d-lbl">Trip</div><div class="d-val">${t.tripName}</div></div>
      <div class="d-box"><div class="d-lbl">Country</div><div class="d-val">${t.country||'—'}</div></div>
      <div class="d-box"><div class="d-lbl">Manager</div><div class="d-val">${t.manager||'—'}</div></div>
      <div class="d-box"><div class="d-lbl">Status</div><div class="d-val"><span class="badge ${sc}">${t.status}</span></div></div>
      <div class="d-box"><div class="d-lbl">Approved Budget USD</div><div class="d-val t-teal">$${fmt(t.approvedBudgetUsd||0,2)}</div></div>
      <div class="d-box"><div class="d-lbl">Approved Budget MVR</div><div class="d-val t-teal">${fmv(budMvr)}</div></div>
      <div class="d-box"><div class="d-lbl">Total Purchased</div><div class="d-val fw6">${fmv(totMvr)}</div></div>
      <div class="d-box"><div class="d-lbl">${over>0?'Over Budget':'Under Budget'}</div><div class="d-val ${over>0?'t-red':'t-green'}">${fmv(Math.abs(budMvr-totMvr))}</div></div>
      <div class="d-box"><div class="d-lbl">Total Cost</div><div class="d-val">${fmv(totCP)}</div></div>
      <div class="d-box"><div class="d-lbl">Expected Revenue</div><div class="d-val t-green">${fmv(totRP)}</div></div>
      <div class="d-box"><div class="d-lbl">Travel Dates</div><div class="d-val fs12">${t.dateFrom||'—'} → ${t.dateTo||'—'}</div></div>
      <div class="d-box"><div class="d-lbl">Invoices</div><div class="d-val">${invs.length}</div></div>
    </div>
    ${invs.length ? `
    <div class="section-title" style="margin-bottom:10px">Invoices under this Trip</div>
    <div class="table-card" style="overflow:auto">
      <table><thead><tr><th>Invoice</th><th>Supplier</th><th>Date</th><th>Items</th><th>Invoice MVR</th><th>Status</th></tr></thead>
      <tbody>${invs.map(i=>{
        const sc2={received:'badge-received',pending:'badge-pending',partial:'badge-partial'};
        return `<tr class="clickable" onclick="window.viewInvoice('${i.id}')">
          <td class="t-mono fw6">${i.number||'—'}</td><td>${i.supplier||'—'}</td>
          <td class="fs12">${i.receivedDate||'—'}</td><td><span class="pill">${i.items?.length||0}</span></td>
          <td class="t-mono fw6">${fmv(i.tot?.invMvr||0)}</td>
          <td><span class="badge ${sc2[i.status]||'badge-pending'}">${i.status||'pending'}</span></td>
        </tr>`;}).join('')}
      </tbody></table>
    </div>` : '<div class="empty-state" style="padding:32px"><div class="empty-sub">No invoices under this trip yet</div></div>'}`;

  window._tripViewId = id;
  document.getElementById('trip-detail-modal')?.classList.add('open');
}
