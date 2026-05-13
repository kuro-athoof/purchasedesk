import './style.css';
import { auth } from './firebase.js';
import { initAuth, setUserDisplay } from './auth.js';
import { setUser, listenCollection, seedCountries } from './db.js';
import { S } from './state.js';
import { renderSbCountries, renderCountries, openSettings, clearCrForm, editCountryRow, saveCountry, deleteCountry, onCountriesLoaded, populateCtrDrop } from './countries.js';
import { renderInvoiceList, openNewInvoice, editInvoice, editCurrentInvoice, saveInvoice, viewInvoice, deleteInvoice, deleteCurrentInvoice, onCountrySelect, addItemRow, removeRow, rowChanged, updateTotals } from './invoices.js';
import { renderAllItems, renderSuppliers, openAddSupplier, saveSupplier, deleteSupplier } from './itemsSuppliers.js';
import { renderPlanList, openNewPlan, editPlan, savePlan, deletePlan, viewPlan, viewComparison, addPlanItemRow, updatePlanTotals, exportComparison, printComparison } from './plans.js';
import { initStaffManager, destroyStaffManager, renderStaffTable, createStaff, toggleStaff, removeStaff, showPasswordNote } from './staff.js';
import { fmv, fmt } from './utils.js';

let _unsubs   = [];
let _profile  = null;    // current user's profile { role, name, active }

// ── AUTH ──────────────────────────────────────────────────
initAuth(
  (user, profile) => {
    _profile = profile;
    setUserDisplay(user, profile);
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-shell').style.display    = 'flex';
    // Show/hide admin nav
    const adminNav = document.getElementById('nav-admin');
    if (adminNav) adminNav.style.display = profile.role === 'owner' ? '' : 'none';
    startListeners();
    showView('dashboard');
  },
  () => {
    _profile = null;
    _unsubs.forEach(u => u()); _unsubs = [];
    destroyStaffManager();
    S.countries=[]; S.invoices=[]; S.suppliers=[]; S.plans=[];
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-shell').style.display    = 'none';
  }
);

function startListeners() {
  let countriesFirst = true;
  _unsubs.push(listenCollection('countries', data => {
    S.countries = data;
    if (countriesFirst) { onCountriesLoaded(data, true); countriesFirst = false; }
    renderSbCountries(); populateCtrDrop(); renderCountries();
  }));
  _unsubs.push(listenCollection('invoices', data => {
    S.invoices = data.sort((a,b)=>(b.savedAt||'').localeCompare(a.savedAt||''));
    renderInvoiceList(); renderDashboard();
  }));
  _unsubs.push(listenCollection('suppliers', data => { S.suppliers = data; }));
  _unsubs.push(listenCollection('plans', data => {
    S.plans = data;
    renderPlanList(); renderDashboard();
  }));
  // Staff manager only for owner
  if (_profile?.role === 'owner') initStaffManager();
}

// ── DASHBOARD ─────────────────────────────────────────────
function renderDashboard() {
  const inv   = S.invoices;
  const plans = S.plans;
  const tMvr = inv.reduce((s,i)=>s+(i.tot?.invMvr||0),0);
  const tPrf = inv.reduce((s,i)=>s+(i.tot?.profit||0),0);
  const tItm = inv.reduce((s,i)=>s+(i.items?.length||0),0);
  const avm  = inv.length ? inv.reduce((s,i)=>s+(i.tot?.avgMgn||0),0)/inv.length : 0;
  const totalBudget = plans.reduce((s,p)=>s+(p.approvedBudget||0),0);
  const activePlans = plans.filter(p=>p.status==='approved').length;

  const el = document.getElementById('dashboard-body');
  if (!el) return;
  el.innerHTML = `
    <div class="stats-bar" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-card stat-accent"><div class="stat-lbl">Total Invoices</div><div class="stat-val v-teal">${inv.length}</div><div class="stat-sub">${tItm} line items</div></div>
      <div class="stat-card"><div class="stat-lbl">Total Purchased</div><div class="stat-val">${fmv(tMvr)}</div><div class="stat-sub">Invoice value in MVR</div></div>
      <div class="stat-card"><div class="stat-lbl">Projected Profit</div><div class="stat-val v-green">${fmv(tPrf)}</div><div class="stat-sub">Sell − Cost</div></div>
      <div class="stat-card"><div class="stat-lbl">Avg Margin</div><div class="stat-val ${avm>=50?'v-green':avm>=25?'v-amber':'v-red'}">${fmt(avm,1)}%</div><div class="stat-sub">All invoices</div></div>
    </div>
    <div class="stats-bar" style="grid-template-columns:repeat(4,1fr);margin-top:0">
      <div class="stat-card"><div class="stat-lbl">Purchase Plans</div><div class="stat-val">${plans.length}</div><div class="stat-sub">${activePlans} approved</div></div>
      <div class="stat-card"><div class="stat-lbl">Total Budget</div><div class="stat-val v-teal">${fmv(totalBudget)}</div><div class="stat-sub">Across all plans</div></div>
      <div class="stat-card"><div class="stat-lbl">Countries</div><div class="stat-val">${S.countries.length}</div><div class="stat-sub">Rate masters</div></div>
      <div class="stat-card"><div class="stat-lbl">Suppliers</div><div class="stat-val">${S.suppliers.length}</div><div class="stat-sub">In directory</div></div>
    </div>
    <div class="section-header" style="margin-top:8px">
      <span class="section-title">Recent Invoices</span>
      <button class="btn btn-ghost btn-sm" onclick="window.showView('invoices')">View All →</button>
    </div>
    <div class="table-card" style="overflow:auto">
      <table><thead><tr><th>Invoice</th><th>Supplier</th><th>Country</th><th>Date</th><th>Items</th><th>Invoice MVR</th><th>Margin</th><th>Status</th></tr></thead>
      <tbody>${inv.slice(0,6).map(i => {
        const t=i.tot||{};
        const mc=(t.avgMgn||0)>=50?'t-green':(t.avgMgn||0)>=25?'t-amber':'t-red';
        const sc={received:'badge-received',pending:'badge-pending',partial:'badge-partial'};
        return `<tr class="clickable" onclick="window.viewInvoice('${i.id}')">
          <td class="t-mono fw6">${i.number||'—'}</td><td class="fw6">${i.supplier||'—'}</td>
          <td class="fs12">${i.ctrName||'—'}</td><td class="fs12">${i.receivedDate||'—'}</td>
          <td><span class="pill">${i.items?.length||0}</span></td>
          <td class="t-mono fw6">${fmv(t.invMvr||0)}</td>
          <td class="${mc} fw6 t-mono">${fmt(t.avgMgn||0,1)}%</td>
          <td><span class="badge ${sc[i.status]||'badge-pending'}">${i.status||'pending'}</span></td>
        </tr>`;}).join('') || '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)">No invoices yet</td></tr>'}
      </tbody></table>
    </div>
    ${plans.length ? `
    <div class="section-header" style="margin-top:20px">
      <span class="section-title">Recent Purchase Plans</span>
      <button class="btn btn-ghost btn-sm" onclick="window.showView('plans')">View All →</button>
    </div>
    <div class="table-card" style="overflow:auto">
      <table><thead><tr><th>Plan #</th><th>Trip</th><th>Supplier</th><th>Budget</th><th>Items</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${plans.slice(0,4).map(p => {
        const sc={draft:'badge-partial',approved:'badge-received',closed:'badge-pending'};
        return `<tr>
          <td class="t-mono fw6">${p.planNumber||'—'}</td><td class="fw6">${p.tripName||'—'}</td>
          <td>${p.supplier||'—'}</td><td class="t-mono t-teal">${fmv(p.approvedBudget||0)}</td>
          <td><span class="pill">${p.items?.length||0}</span></td>
          <td><span class="badge ${sc[p.status]||'badge-partial'}">${p.status}</span></td>
          <td><button class="btn btn-ghost btn-xs" onclick="window.viewComparison('${p.id}')">📊 Compare</button></td>
        </tr>`;}).join('')}
      </tbody></table>
    </div>` : ''}`;
}

// ── VIEWS ─────────────────────────────────────────────────
const ALL_VIEWS = ['dashboard','invoices','items','suppliers','plans','comparison','settings-view','staff'];
const VIEW_TITLES = {
  dashboard:'Dashboard', invoices:'Invoices', items:'All Items', suppliers:'Suppliers',
  plans:'Purchase Plans', comparison:'Plan Comparison', 'settings-view':'Country Rates', staff:'Staff Accounts'
};

window.showView = function(v) {
  // Guard: staff view only for owner
  if (v === 'staff' && _profile?.role !== 'owner') return;

  ALL_VIEWS.forEach(id => {
    const el = document.getElementById('view-'+id);
    if (el) el.style.display = id===v ? 'block' : 'none';
  });
  document.getElementById('view-title').textContent  = VIEW_TITLES[v]||v;
  document.getElementById('view-crumb').textContent  = {
    dashboard:'Overview', invoices:'All records', items:'Across all invoices',
    suppliers:'Directory', plans:'Purchase planning', comparison:'Plan vs Actual',
    'settings-view':'Rate configuration', staff:'Owner only'
  }[v]||'';
  document.querySelectorAll('.nav-item[data-view]').forEach(el =>
    el.classList.toggle('active', el.dataset.view===v)
  );
  const btn = document.getElementById('main-action-btn');
  const btnMap = { invoices:['＋ New Invoice',openNewInvoice], suppliers:['＋ Add Supplier',openAddSupplier], plans:['＋ New Plan',openNewPlan] };
  if (btnMap[v]) { btn.style.display=''; btn.textContent=btnMap[v][0]; btn.onclick=btnMap[v][1]; }
  else btn.style.display='none';

  if (v==='dashboard')     renderDashboard();
  if (v==='invoices')      renderInvoiceList();
  if (v==='items')         renderAllItems();
  if (v==='suppliers')     renderSuppliers();
  if (v==='plans')         renderPlanList();
  if (v==='settings-view') renderCountries();
  if (v==='staff')         renderStaffTable();
  closeSidebar();
};

// ── SIDEBAR TOGGLE ────────────────────────────────────────
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sb-overlay')?.classList.remove('show');
}
window.toggleSidebar   = () => {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('sb-overlay')?.classList.toggle('show');
};
window.collapseSidebar = () => {
  document.getElementById('sidebar')?.classList.toggle('collapsed');
  document.getElementById('app-shell')?.classList.toggle('sidebar-collapsed');
};
document.getElementById('sb-overlay')?.addEventListener('click', closeSidebar);

// ── MODALS ────────────────────────────────────────────────
window.openModal  = id => document.getElementById(id)?.classList.add('open');
window.closeModal = id => document.getElementById(id)?.classList.remove('open');
document.querySelectorAll('.modal-overlay').forEach(el =>
  el.addEventListener('click', e => { if(e.target===el) el.classList.remove('open'); })
);

// ── EXPORT ────────────────────────────────────────────────
window.exportData = () => {
  const blob = new Blob([JSON.stringify({invoices:S.invoices,suppliers:S.suppliers,countries:S.countries,plans:S.plans},null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `purchasedesk_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
};
window.printInvoice = () => window.print();

// ── ALL HANDLERS ──────────────────────────────────────────
window.openSettings         = openSettings;
window.clearCrForm          = clearCrForm;
window.editCountryRow       = editCountryRow;
window.saveCountry          = saveCountry;
window.deleteCountry        = deleteCountry;
window.openNewInvoice       = openNewInvoice;
window.editInvoice          = editInvoice;
window.editCurrentInvoice   = editCurrentInvoice;
window.saveInvoice          = saveInvoice;
window.viewInvoice          = viewInvoice;
window.deleteInvoice        = deleteInvoice;
window.deleteCurrentInvoice = deleteCurrentInvoice;
window.onCountrySelect      = onCountrySelect;
window.addItemRow           = addItemRow;
window.removeRow            = removeRow;
window.rowChanged           = rowChanged;
window.updateTotals         = updateTotals;
window.openAddSupplier      = openAddSupplier;
window.saveSupplier         = saveSupplier;
window.deleteSupplier       = deleteSupplier;
window.openNewPlan          = openNewPlan;
window.editPlan             = editPlan;
window.savePlan             = savePlan;
window.deletePlan           = deletePlan;
window.viewPlan             = viewPlan;
window.viewComparison       = viewComparison;
window.addPlanItemRow       = addPlanItemRow;
window.updatePlanTotals     = updatePlanTotals;
window.exportComparison     = exportComparison;
window.printComparison      = printComparison;
window.renderPlanList       = renderPlanList;
// Staff handlers
window.createStaff      = createStaff;
window.toggleStaff      = toggleStaff;
window.removeStaff      = removeStaff;
window.showPasswordNote = showPasswordNote;

window._doCompareFromView = () => { const id=S.viewingPlanId||''; window.closeModal('view-plan-modal'); if(id) window.viewComparison(id); };
window._doEditFromView    = () => { const id=S.viewingPlanId||''; window.closeModal('view-plan-modal'); if(id) window.editPlan(id); };

// Supplier autocomplete
document.getElementById('invoice-modal')?.addEventListener('mouseenter', () => {
  const dl = document.getElementById('supplier-list');
  if (!dl) return;
  const names = [...new Set([...S.suppliers.map(s=>s.name),...S.invoices.map(i=>i.supplier).filter(Boolean)])];
  dl.innerHTML = names.map(n=>`<option value="${n}">`).join('');
});

document.getElementById('search-input')?.addEventListener('input', renderInvoiceList);
document.getElementById('filter-status')?.addEventListener('change', renderInvoiceList);
document.getElementById('filter-supplier')?.addEventListener('change', renderInvoiceList);
document.getElementById('item-search')?.addEventListener('input', renderAllItems);
document.getElementById('item-filter-supplier')?.addEventListener('change', renderAllItems);
