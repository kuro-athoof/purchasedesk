import './style.css';
import { auth } from './firebase.js';
import { initAuth, setUserDisplay } from './auth.js';
import { setUser, listenCollection, seedCountries } from './db.js';
import { S } from './state.js';
import { renderSbCountries, renderCountries, clearCrForm, editCountryRow,
         saveCountry, deleteCountry, onCountriesLoaded, populateAllCtrDrops,
         updateCrFormulaPreview } from './countries.js';
import { renderInvoiceList, openNewInvoice, editInvoice, editCurrentInvoice,
         saveInvoice, viewInvoice, deleteInvoice, deleteCurrentInvoice,
         onCountrySelect, addItemRow, removeRow, rowChanged, rowFinalChanged,
         updateTotals, updateFooterTotals } from './invoices.js';
import { renderAllItems, renderSuppliers, openAddSupplier, saveSupplier,
         deleteSupplier } from './itemsSuppliers.js';
import { renderPlanList, openNewPlan, editPlan, savePlan, deletePlan, viewPlan,
         viewComparison, addPlanItemRow, updatePlanTotals, exportComparison,
         printComparison } from './plans.js';
import { renderTripList, openNewTrip, editTrip, saveTrip, deleteTrip,
         viewTrip } from './trips/trips.js';
import { initStaffManager, destroyStaffManager, renderStaffTable, createStaff,
         toggleStaff, removeStaff, showPasswordNote } from './staff.js';
import { fmv, fmt, getUomList, saveUomList, DEFAULT_UOM_LIST, toast } from './utils.js';

let _unsubs  = [];
let _profile = null;

// ── AUTH ──────────────────────────────────────────────────
initAuth(
  (user, profile) => {
    _profile = profile;
    setUserDisplay(user, profile);
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-shell').style.display    = 'flex';
    const adminNav = document.getElementById('nav-admin');
    if (adminNav) adminNav.style.display = profile.role==='owner' ? '' : 'none';
    startListeners();
    showView('dashboard');
  },
  () => {
    _profile = null;
    _unsubs.forEach(u=>u()); _unsubs=[];
    destroyStaffManager();
    S.countries=[]; S.invoices=[]; S.suppliers=[]; S.plans=[]; S.trips=[];
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-shell').style.display    = 'none';
  }
);

function startListeners() {
  let countriesFirst = true;
  _unsubs.push(listenCollection('countries', data => {
    S.countries = data;
    if (countriesFirst) { onCountriesLoaded(data,true); countriesFirst=false; }
    renderSbCountries();
    // Fix: populate ALL country dropdowns every time countries update
    populateAllCtrDrops();
    renderCountries();
  }));
  _unsubs.push(listenCollection('invoices', data => {
    S.invoices = data.sort((a,b)=>(b.savedAt||'').localeCompare(a.savedAt||''));
    renderInvoiceList(); renderDashboard();
  }));
  _unsubs.push(listenCollection('suppliers', data=>{S.suppliers=data;}));
  _unsubs.push(listenCollection('plans', data=>{
    S.plans=data; renderPlanList(); renderDashboard();
  }));
  _unsubs.push(listenCollection('trips', data=>{
    S.trips=data.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
    renderTripList(); renderDashboard();
  }));
  if (_profile?.role==='owner') initStaffManager();
}

// ── YEAR SELECTOR ─────────────────────────────────────────
function renderYearSelector() {
  const el = document.getElementById('year-selector'); if (!el) return;
  const cur = S.dashYear||new Date().getFullYear();
  const years = [];
  for (let y=cur+1; y>=2023; y--) years.push(y);
  el.innerHTML = years.map(y=>
    `<option value="${y}"${y===cur?' selected':''}>${y}</option>`
  ).join('');
  el.onchange = () => {
    S.dashYear = parseInt(el.value);
    renderDashboard(); renderTripList();
  };
}

// ── DASHBOARD ─────────────────────────────────────────────
function renderDashboard() {
  renderYearSelector();
  const year  = S.dashYear||new Date().getFullYear();
  const inv   = S.invoices;
  const plans = S.plans;
  const trips = S.trips.filter(t=>!t.year||t.year==year);

  const tMvr = inv.reduce((s,i)=>s+(i.tot?.invMvr||0),0);
  const tPrf = inv.reduce((s,i)=>s+(i.tot?.profit||0),0);
  const tItm = inv.reduce((s,i)=>s+(i.items?.length||0),0);
  const avm  = inv.length?inv.reduce((s,i)=>s+(i.tot?.avgMgn||0),0)/inv.length:0;
  const totBudget = trips.reduce((s,t)=>s+(t.approvedBudgetMvr||0),0);
  const totPurchased = trips.reduce((s,t)=>{
    const invs = inv.filter(i=>i.tripId===t.id);
    return s+invs.reduce((ss,i)=>ss+(i.tot?.invMvr||0),0);
  },0);

  const el=document.getElementById('dashboard-body'); if(!el)return;
  el.innerHTML=`
    <div class="stats-bar" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-card stat-accent"><div class="stat-lbl">Trips (${year})</div><div class="stat-val v-teal">${trips.length}</div><div class="stat-sub">${trips.filter(t=>t.status==='Approved').length} approved</div></div>
      <div class="stat-card"><div class="stat-lbl">Approved Budget</div><div class="stat-val v-teal">${fmv(totBudget)}</div><div class="stat-sub">All trips ${year}</div></div>
      <div class="stat-card"><div class="stat-lbl">Total Purchased</div><div class="stat-val">${fmv(totPurchased)}</div><div class="stat-sub">Invoice value MVR</div></div>
      <div class="stat-card"><div class="stat-lbl">${totPurchased>totBudget?'Over Budget':'Remaining'}</div><div class="stat-val ${totPurchased>totBudget?'v-red':'v-green'}">${fmv(Math.abs(totBudget-totPurchased))}</div></div>
    </div>
    <div class="stats-bar" style="grid-template-columns:repeat(4,1fr);margin-top:0">
      <div class="stat-card"><div class="stat-lbl">Total Invoices</div><div class="stat-val">${inv.length}</div><div class="stat-sub">${tItm} line items</div></div>
      <div class="stat-card"><div class="stat-lbl">Projected Profit</div><div class="stat-val v-green">${fmv(tPrf)}</div></div>
      <div class="stat-card"><div class="stat-lbl">Countries</div><div class="stat-val">${S.countries.length}</div></div>
      <div class="stat-card"><div class="stat-lbl">Avg Margin</div><div class="stat-val ${avm>=50?'v-green':avm>=25?'v-amber':'v-red'}">${fmt(avm,2)}</div></div>
    </div>
    ${trips.length?`
    <div class="section-header" style="margin-top:8px">
      <span class="section-title">Trips — ${year}</span>
      <button class="btn btn-ghost btn-sm" onclick="window.showView('trips')">View All →</button>
    </div>
    <div class="table-card" style="overflow:auto">
      <table><thead><tr><th>Trip</th><th>Country</th><th>Manager</th><th>Budget MVR</th><th>Purchased</th><th>Status</th></tr></thead>
      <tbody>${trips.slice(0,5).map(t=>{
        const invs=inv.filter(i=>i.tripId===t.id);
        const act=invs.reduce((s,i)=>s+(i.tot?.invMvr||0),0);
        const sc={Draft:'badge-partial',Approved:'badge-received',Closed:'badge-pending'};
        return `<tr class="clickable" onclick="window.viewTrip('${t.id}')">
          <td class="fw6">${t.tripName}</td><td class="fs12">${t.country||'—'}</td>
          <td class="fs12">${t.manager||'—'}</td>
          <td class="t-mono">${fmv(t.approvedBudgetMvr||0)}</td>
          <td class="t-mono ${act>(t.approvedBudgetMvr||0)?'t-red':'t-green'}">${fmv(act)}</td>
          <td><span class="badge ${sc[t.status]||'badge-partial'}">${t.status}</span></td>
        </tr>`;}).join('')}
      </tbody></table>
    </div>`:
    `<div class="empty-state" style="margin-top:24px"><div class="empty-icon">✈️</div>
     <div class="empty-title">No trips for ${year}</div>
     <div class="empty-sub"><button class="btn btn-primary btn-sm" onclick="window.openNewTrip()">Create First Trip</button></div></div>`}
    <div class="section-header" style="margin-top:20px">
      <span class="section-title">Recent Invoices</span>
      <button class="btn btn-ghost btn-sm" onclick="window.showView('invoices')">View All →</button>
    </div>
    <div class="table-card" style="overflow:auto">
      <table><thead><tr><th>Invoice</th><th>Supplier</th><th>Country</th><th>Date</th><th>Items</th><th>Invoice MVR</th><th>Margin</th><th>Status</th></tr></thead>
      <tbody>${inv.slice(0,5).map(i=>{
        const t=i.tot||{};
        const mc=(t.avgMgn||0)>=50?'t-green':(t.avgMgn||0)>=25?'t-amber':'t-red';
        const sc={received:'badge-received',pending:'badge-pending',partial:'badge-partial'};
        return `<tr class="clickable" onclick="window.viewInvoice('${i.id}')">
          <td class="t-mono fw6">${i.number||'—'}</td><td>${i.supplier||'—'}</td>
          <td class="fs12">${i.ctrName||'—'}</td><td class="fs12">${i.receivedDate||'—'}</td>
          <td><span class="pill">${i.items?.length||0}</span></td>
          <td class="t-mono fw6">${fmv(t.invMvr||0)}</td>
          <td class="${mc} fw6 t-mono">${fmt(t.avgMgn||0,1)}%</td>
          <td><span class="badge ${sc[i.status]||'badge-pending'}">${i.status||'pending'}</span></td>
        </tr>`;}).join('')||'<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)">No invoices yet</td></tr>'}
      </tbody></table>
    </div>`;
}

// ── VIEWS ─────────────────────────────────────────────────
const ALL_VIEWS=['dashboard','invoices','items','suppliers','plans','comparison',
                 'settings-view','staff','trips'];
const VIEW_TITLES={
  dashboard:'Dashboard', invoices:'Invoices', items:'All Items', suppliers:'Suppliers',
  plans:'Purchase Plans', comparison:'Plan Comparison', 'settings-view':'Country Rates',
  staff:'Staff Accounts', trips:'Trips'
};

window.showView = function(v) {
  if (v==='staff' && _profile?.role!=='owner') return;
  ALL_VIEWS.forEach(id=>{
    const el=document.getElementById('view-'+id);
    if(el) el.style.display=id===v?'block':'none';
  });
  document.getElementById('view-title').textContent=VIEW_TITLES[v]||v;
  document.getElementById('view-crumb').textContent={
    dashboard:'Overview', invoices:'All records', trips:'Buying trips by year',
    items:'All purchased items', suppliers:'Directory', plans:'Purchase planning',
    comparison:'Plan vs Actual', 'settings-view':'Rate configuration', staff:'Owner only'
  }[v]||'';
  document.querySelectorAll('.nav-item[data-view]').forEach(el=>
    el.classList.toggle('active',el.dataset.view===v)
  );
  const btn=document.getElementById('main-action-btn');
  const btnMap={
    invoices:['＋ New Invoice',openNewInvoice],
    suppliers:['＋ Add Supplier',openAddSupplier],
    plans:['＋ New Plan',openNewPlan],
    trips:['＋ New Trip',openNewTrip],
  };
  if(btnMap[v]){btn.style.display='';btn.textContent=btnMap[v][0];btn.onclick=btnMap[v][1];}
  else btn.style.display='none';

  if(v==='dashboard')    {renderYearSelector();renderDashboard();}
  if(v==='invoices')      renderInvoiceList();
  if(v==='items')         renderAllItems();
  if(v==='suppliers')     renderSuppliers();
  if(v==='plans')         renderPlanList();
  if(v==='settings-view'){renderCountries();window.renderUomSettings();}
  if(v==='staff')         renderStaffTable();
  if(v==='trips')        {renderYearSelector();renderTripList();}
  closeSidebar();
};

// ── SIDEBAR ───────────────────────────────────────────────
function closeSidebar(){
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sb-overlay')?.classList.remove('show');
}
window.toggleSidebar=()=>{
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('sb-overlay')?.classList.toggle('show');
};
window.collapseSidebar=()=>{
  document.getElementById('sidebar')?.classList.toggle('collapsed');
  document.getElementById('app-shell')?.classList.toggle('sidebar-collapsed');
};
document.getElementById('sb-overlay')?.addEventListener('click',closeSidebar);

// ── MODALS ────────────────────────────────────────────────
window.openModal =id=>document.getElementById(id)?.classList.add('open');
window.closeModal=id=>document.getElementById(id)?.classList.remove('open');
document.querySelectorAll('.modal-overlay').forEach(el=>
  el.addEventListener('click',e=>{if(e.target===el)el.classList.remove('open');})
);

// ── EXPORT ────────────────────────────────────────────────
window.exportData=()=>{
  const blob=new Blob([JSON.stringify({invoices:S.invoices,suppliers:S.suppliers,
    countries:S.countries,plans:S.plans,trips:S.trips},null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`purchasedesk_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
};
window.printInvoice=()=>window.print();

// ── ALL HANDLERS ──────────────────────────────────────────
// Countries
window.clearCrForm          = clearCrForm;
window.editCountryRow       = editCountryRow;
window.saveCountry          = saveCountry;
window.deleteCountry        = deleteCountry;
window.updateCrFormulaPreview = updateCrFormulaPreview;
// Invoices
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
window.rowFinalChanged      = rowFinalChanged;
window.updateTotals         = updateTotals;
window.updateFooterTotals   = updateFooterTotals;
// Suppliers
window.openAddSupplier      = openAddSupplier;
window.saveSupplier         = saveSupplier;
window.deleteSupplier       = deleteSupplier;
// Plans
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
// Trips
window.openNewTrip          = openNewTrip;
window.editTrip             = editTrip;
window.saveTrip             = saveTrip;
window.deleteTrip           = deleteTrip;
window.viewTrip             = viewTrip;
// Staff
window.createStaff          = createStaff;
window.toggleStaff          = toggleStaff;
window.removeStaff          = removeStaff;
window.showPasswordNote     = showPasswordNote;

window._doCompareFromView=()=>{const id=S.viewingPlanId||'';window.closeModal('view-plan-modal');if(id)window.viewComparison(id);};
window._doEditFromView   =()=>{const id=S.viewingPlanId||'';window.closeModal('view-plan-modal');if(id)window.editPlan(id);};

// UOM Settings
window.renderUomSettings=function(){
  const list=getUomList();
  const el=document.getElementById('uom-list-display');if(!el)return;
  el.innerHTML=list.map((u,i)=>`
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-faint)">
      <span class="t-mono" style="flex:1;font-size:13px">${u}</span>
      <button class="btn btn-danger btn-xs" onclick="window.removeUom(${i})">Remove</button>
    </div>`).join('');
};
window.removeUom=function(idx){
  const list=getUomList();list.splice(idx,1);saveUomList(list);
  window.renderUomSettings();toast('UOM removed ✓');
};
window.addUom=function(){
  const el=document.getElementById('new-uom-input');
  const val=el?.value.trim();if(!val)return alert('Enter a UOM name');
  const list=getUomList();if(list.includes(val))return alert('Already in list');
  list.push(val);saveUomList(list);if(el)el.value='';
  window.renderUomSettings();toast('UOM added ✓');
};
window.resetUomList=function(){
  if(!confirm('Reset to default UOM list?'))return;
  saveUomList([...DEFAULT_UOM_LIST]);window.renderUomSettings();toast('UOM list reset ✓');
};

// Supplier autocomplete
document.getElementById('invoice-modal')?.addEventListener('mouseenter',()=>{
  const dl=document.getElementById('supplier-list');if(!dl)return;
  const names=[...new Set([...S.suppliers.map(s=>s.name),...S.invoices.map(i=>i.supplier).filter(Boolean)])];
  dl.innerHTML=names.map(n=>`<option value="${n}">`).join('');
});

document.getElementById('search-input')?.addEventListener('input',renderInvoiceList);
document.getElementById('filter-status')?.addEventListener('change',renderInvoiceList);
document.getElementById('filter-supplier')?.addEventListener('change',renderInvoiceList);
document.getElementById('item-search')?.addEventListener('input',renderAllItems);
document.getElementById('item-filter-supplier')?.addEventListener('change',renderAllItems);
