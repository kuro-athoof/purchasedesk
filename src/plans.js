import { S } from './state.js';
import { fsSet, fsDel } from './db.js';
import { costRate, calcRow, fmv, fmt, uid, toast } from './utils.js';
import * as XLSX from 'xlsx';

// ── PLAN LIST ────────────────────────────────────────────
export function renderPlanList() {
  const tbody = document.getElementById('plan-tbody');
  if (!tbody) return;
  const plans = [...S.plans].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  document.getElementById('plan-count').textContent = plans.length + ' plan' + (plans.length!==1?'s':'');
  if (!plans.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📋</div>
      <div class="empty-title">No purchase plans yet</div>
      <div class="empty-sub">Click "+ New Plan" to create your first buying plan</div>
      </div></td></tr>`;
    return;
  }
  const sc = { draft:'badge-partial', approved:'badge-received', closed:'badge-pending' };
  tbody.innerHTML = plans.map(p => {
    const actual = getActualForPlan(p);
    const pct = p.approvedBudget > 0 ? Math.round((actual.totalCost/p.approvedBudget)*100) : 0;
    const budgetColor = pct > 100 ? 't-red' : pct > 85 ? 't-amber' : 't-green';
    return `<tr class="clickable" onclick="window.viewPlan('${p.id}')">
      <td class="t-mono fw6">${p.planNumber||'—'}</td>
      <td><div class="fw6">${p.tripName||'—'}</div><div class="t-muted fs11">${p.country||''}</div></td>
      <td>${p.supplier||'—'}</td>
      <td>${p.department||'—'}</td>
      <td class="t-mono">${fmv(p.approvedBudget||0)}</td>
      <td class="t-mono ${budgetColor}">${fmv(actual.totalCost)} <span class="fs11">(${pct}%)</span></td>
      <td>${p.approvedBy||'—'}</td>
      <td><span class="badge ${sc[p.status]||'badge-partial'}">${p.status||'draft'}</span></td>
      <td onclick="event.stopPropagation()" style="text-align:center">
        <button class="btn btn-ghost btn-xs" onclick="window.editPlan('${p.id}')">✏</button>
        <button class="btn btn-ghost btn-xs" onclick="window.viewComparison('${p.id}')">📊</button>
        <button class="btn btn-danger btn-xs" onclick="window.deletePlan('${p.id}')">🗑</button>
      </td>
    </tr>`;
  }).join('');
}

// ── PLAN FORM ─────────────────────────────────────────────
let planRowId = 0;

export function openNewPlan() {
  S.editingPlanId = null;
  document.getElementById('plan-modal-title').textContent = 'New Purchase Plan';
  clearPlanForm();
  document.getElementById('plan-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('plan-items-rows').innerHTML = '';
  addPlanItemRow(); addPlanItemRow(); addPlanItemRow();
  updatePlanTotals();
  openModal('plan-modal');
}

export function editPlan(id) {
  const p = S.plans.find(x=>x.id===id);
  if (!p) { toast('Plan not found','error'); return; }
  S.editingPlanId = id;
  document.getElementById('plan-modal-title').textContent = 'Edit Purchase Plan';
  document.getElementById('plan-number').value     = p.planNumber||'';
  document.getElementById('plan-trip').value       = p.tripName||'';
  document.getElementById('plan-country').value    = p.country||'';
  document.getElementById('plan-supplier').value   = p.supplier||'';
  document.getElementById('plan-dept').value       = p.department||'';
  document.getElementById('plan-budget').value     = p.approvedBudget||'';
  document.getElementById('plan-approved-by').value= p.approvedBy||'';
  document.getElementById('plan-date').value       = p.date||'';
  document.getElementById('plan-status-sel').value = p.status||'draft';
  document.getElementById('plan-notes').value      = p.notes||'';
  document.getElementById('plan-items-rows').innerHTML = '';
  (p.items||[]).forEach(it => addPlanItemRow(it));
  updatePlanTotals();
  openModal('plan-modal');
}

export function clearPlanForm() {
  ['plan-number','plan-trip','plan-country','plan-supplier','plan-dept',
   'plan-budget','plan-approved-by','plan-notes'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });
  const ss = document.getElementById('plan-status-sel');
  if(ss) ss.value = 'draft';
}

export function addPlanItemRow(data={}) {
  planRowId++;
  const rid = 'pr'+planRowId;
  const tr = document.createElement('tr');
  tr.id = rid;
  const priorities = ['Must Buy','Optional','Trial'];
  const statuses   = ['Approved','Hold','Rejected'];
  tr.innerHTML = `
    <td><input type="text" placeholder="CODE" value="${data.code||''}" style="width:80px"></td>
    <td><input type="text" placeholder="Item name" value="${data.name||''}" style="min-width:130px" oninput="window.updatePlanTotals()"></td>
    <td><input type="text" placeholder="Category" value="${data.category||''}" style="width:90px"></td>
    <td><select style="width:62px">
      ${['PCS','SET','DOZ','PKT','CTN','KG','MTR'].map(u=>`<option${(data.uom||'PCS')===u?' selected':''}>${u}</option>`).join('')}
    </select></td>
    <td><input type="number" placeholder="0" value="${data.approvedQty||''}" min="0" step="1" oninput="window.updatePlanTotals()" style="width:62px"></td>
    <td><input type="number" placeholder="0.00" value="${data.approvedFob||''}" min="0" step="0.01" oninput="window.updatePlanTotals()" style="width:74px"></td>
    <td><input type="number" placeholder="0.0000" value="${data.approvedCostRate||''}" min="0" step="0.0001" oninput="window.updatePlanTotals()" style="width:82px"></td>
    <td><input type="number" class="calc" readonly id="${rid}_cv" value="${fmt(data.approvedCostValue||0,2)}" style="width:88px"></td>
    <td><input type="number" placeholder="0.00" value="${data.approvedSell||''}" min="0" step="0.01" style="width:82px"></td>
    <td><select style="width:90px">
      ${priorities.map(pr=>`<option${(data.priority||'Must Buy')===pr?' selected':''}>${pr}</option>`).join('')}
    </select></td>
    <td><select style="width:82px">
      ${statuses.map(st=>`<option${(data.itemStatus||'Approved')===st?' selected':''}>${st}</option>`).join('')}
    </select></td>
    <td><button class="del-row" onclick="this.closest('tr').remove();window.updatePlanTotals()">✕</button></td>`;
  document.getElementById('plan-items-rows').appendChild(tr);
}

export function updatePlanTotals() {
  let totalQty=0, totalCost=0;
  document.querySelectorAll('#plan-items-rows tr').forEach(tr => {
    const inp = tr.querySelectorAll('input,select');
    if(!inp.length) return;
    const qty  = parseFloat(inp[4]?.value)||0;
    const fob  = parseFloat(inp[5]?.value)||0;
    const rate = parseFloat(inp[6]?.value)||0;
    const cv   = fob * rate * qty;
    const cvEl = tr.querySelector('[id$="_cv"]');
    if(cvEl) cvEl.value = fmt(cv,2);
    totalQty  += qty;
    totalCost += cv;
  });
  const budget = parseFloat(document.getElementById('plan-budget')?.value)||0;
  const rem = budget - totalCost;
  const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  set('plan-sum-items', document.querySelectorAll('#plan-items-rows tr').length);
  set('plan-sum-qty',   totalQty);
  set('plan-sum-cost',  fmv(totalCost));
  set('plan-sum-budget',fmv(budget));
  set('plan-sum-rem',   fmv(rem));
  const remEl = document.getElementById('plan-sum-rem');
  if(remEl) remEl.className = 'sum-val ' + (rem < 0 ? 'v-red' : 'v-green');
}

function collectPlanItems() {
  const items = [];
  document.querySelectorAll('#plan-items-rows tr').forEach(tr => {
    const inp = tr.querySelectorAll('input,select');
    if(!inp.length) return;
    const code = inp[0]?.value.trim();
    const name = inp[1]?.value.trim();
    if(!code && !name) return;
    const approvedQty      = parseFloat(inp[4]?.value)||0;
    const approvedFob      = parseFloat(inp[5]?.value)||0;
    const approvedCostRate = parseFloat(inp[6]?.value)||0;
    const approvedCostValue= approvedFob * approvedCostRate * approvedQty;
    const approvedSell     = parseFloat(inp[8]?.value)||0;
    items.push({
      code, name,
      category:     inp[2]?.value.trim(),
      uom:          inp[3]?.value,
      approvedQty, approvedFob, approvedCostRate, approvedCostValue, approvedSell,
      priority:     inp[9]?.value,
      itemStatus:   inp[10]?.value,
    });
  });
  return items;
}

export async function savePlan() {
  const planNumber = document.getElementById('plan-number').value.trim();
  const tripName   = document.getElementById('plan-trip').value.trim();
  if(!tripName) return alert('Trip name is required');
  const items  = collectPlanItems();
  const budget = parseFloat(document.getElementById('plan-budget').value)||0;
  const totalPlanCost = items.reduce((s,i)=>s+i.approvedCostValue,0);
  const id = S.editingPlanId || uid();
  const plan = {
    id,
    planNumber:     planNumber||'PLAN-'+Date.now(),
    tripName,
    country:        document.getElementById('plan-country').value,
    supplier:       document.getElementById('plan-supplier').value,
    department:     document.getElementById('plan-dept').value,
    approvedBudget: budget,
    approvedBy:     document.getElementById('plan-approved-by').value,
    date:           document.getElementById('plan-date').value,
    status:         document.getElementById('plan-status-sel').value,
    notes:          document.getElementById('plan-notes').value,
    items,
    totalPlanCost,
    createdAt:      new Date().toISOString(),
  };
  const btn = document.getElementById('save-plan-btn');
  btn.disabled=true; btn.textContent='Saving…';
  await fsSet('plans', id, plan);
  toast(S.editingPlanId ? 'Plan updated ✓' : 'Plan saved ✓');
  btn.disabled=false; btn.textContent='💾 Save Plan';
  closeModal('plan-modal');
}

export async function deletePlan(id) {
  if(!confirm('Delete this purchase plan?')) return;
  await fsDel('plans', id);
  toast('Plan deleted');
}

// ── VIEW PLAN DETAIL ─────────────────────────────────────
export function viewPlan(id) {
  const p = S.plans.find(x=>x.id===id);
  if(!p) return;
  S.viewingPlanId = id;
  document.getElementById('vp-title').textContent = p.planNumber + ' — ' + p.tripName;
  document.getElementById('vp-sub').innerHTML =
    `${p.country||''} &bull; ${p.supplier||''} &bull; Approved by: <strong>${p.approvedBy||'—'}</strong> &bull; ${p.date||''}
     &bull; <span class="badge ${p.status==='approved'?'badge-received':p.status==='closed'?'badge-pending':'badge-partial'}">${p.status}</span>`;
  const sc = {Approved:'badge-received',Hold:'badge-pending',Rejected:'badge-partial'};
  const pc = {'Must Buy':'t-red','Optional':'t-teal','Trial':'t-muted'};
  document.getElementById('vp-body').innerHTML = `
    <div class="detail-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">
      <div class="d-box"><div class="d-lbl">Approved Budget</div><div class="d-val t-teal">${fmv(p.approvedBudget)}</div></div>
      <div class="d-box"><div class="d-lbl">Planned Cost</div><div class="d-val">${fmv(p.totalPlanCost)}</div></div>
      <div class="d-box"><div class="d-lbl">Remaining</div><div class="d-val ${(p.approvedBudget-p.totalPlanCost)<0?'t-red':'t-green'}">${fmv(p.approvedBudget-p.totalPlanCost)}</div></div>
      <div class="d-box"><div class="d-lbl">Total Items</div><div class="d-val">${p.items?.length||0}</div></div>
    </div>
    ${p.notes?`<div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px">📝 ${p.notes}</div>`:''}
    <div class="table-card">
      <table>
        <thead><tr>
          <th>#</th><th>Code</th><th>Name</th><th>Category</th><th>UOM</th>
          <th>Appr. Qty</th><th>Appr. FOB</th><th>Cost Rate</th>
          <th>Appr. Cost</th><th>Appr. Sell</th><th>Priority</th><th>Status</th>
        </tr></thead>
        <tbody>
        ${(p.items||[]).map((it,i)=>`<tr>
          <td class="t-muted fs11">${i+1}</td>
          <td class="t-mono fs11">${it.code||'—'}</td>
          <td class="fw6">${it.name||'—'}</td>
          <td>${it.category||'—'}</td><td>${it.uom||'—'}</td>
          <td class="t-mono">${it.approvedQty||0}</td>
          <td class="t-mono t-teal">${fmt(it.approvedFob,2)}</td>
          <td class="t-mono t-muted fs11">×${fmt(it.approvedCostRate,4)}</td>
          <td class="t-mono">${fmv(it.approvedCostValue)}</td>
          <td class="t-mono">${fmv(it.approvedSell)}</td>
          <td class="${pc[it.priority]||''} fw6 fs11">${it.priority||'—'}</td>
          <td><span class="badge ${sc[it.itemStatus]||'badge-partial'} fs11">${it.itemStatus||'—'}</span></td>
        </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  openModal('view-plan-modal');
}

// ── COMPARISON ENGINE ────────────────────────────────────
function getActualForPlan(plan) {
  // Collect all actual items from invoices linked to same supplier+country or all invoices
  const allActualItems = [];
  S.invoices.forEach(inv => {
    (inv.items||[]).forEach(it => allActualItems.push({ ...it, invNumber:inv.number, supplier:inv.supplier }));
  });
  const totalCost = allActualItems.reduce((s,it)=>s+(it.tcp||0),0);
  return { items: allActualItems, totalCost };
}

function matchItems(planItems, actualItems) {
  const rows = [];
  const usedActual = new Set();

  // For each plan item, find best match in actuals
  planItems.forEach(pi => {
    let match = null;
    let matchIdx = -1;

    // 1. Exact code match
    actualItems.forEach((ai,idx) => {
      if(!usedActual.has(idx) && ai.code && pi.code && ai.code.trim().toLowerCase() === pi.code.trim().toLowerCase()) {
        match = ai; matchIdx = idx;
      }
    });
    // 2. Name match (fuzzy - contains)
    if(!match) {
      actualItems.forEach((ai,idx) => {
        if(!usedActual.has(idx) && ai.name && pi.name &&
           ai.name.trim().toLowerCase() === pi.name.trim().toLowerCase()) {
          match = ai; matchIdx = idx;
        }
      });
    }

    if(match) {
      usedActual.add(matchIdx);
      const qtyDiff  = (match.qty||0) - (pi.approvedQty||0);
      const fobDiff  = (match.fob||0) - (pi.approvedFob||0);
      const costDiff = (match.cp||0)  - ((pi.approvedFob||0)*(pi.approvedCostRate||0));
      const sellDiff = (match.sp||0)  - (pi.approvedSell||0);

      let status = 'Matched';
      const flags = [];
      if(Math.abs(qtyDiff) > 0) flags.push(qtyDiff > 0 ? 'Qty Increased' : 'Qty Reduced');
      if(fobDiff > 0.01)  flags.push('Price Increased');
      if(fobDiff < -0.01) flags.push('Price Reduced');
      const apprCost = (pi.approvedFob||0)*(pi.approvedCostRate||0)*(pi.approvedQty||0);
      const actCost  = (match.tcp||0);
      if(actCost > apprCost * 1.001) flags.push('Over Budget');
      else if(actCost < apprCost * 0.999) flags.push('Under Budget');
      if(flags.length) status = flags[0];

      rows.push({
        type:'matched', planItem:pi, actualItem:match,
        approvedQty: pi.approvedQty||0,  actualQty: match.qty||0,   qtyDiff,
        approvedFob: pi.approvedFob||0,  actualFob: match.fob||0,   fobDiff,
        approvedCost:(pi.approvedFob||0)*(pi.approvedCostRate||0), actualCost: match.cp||0, costDiff,
        approvedSell: pi.approvedSell||0, actualSell: match.sp||0,  sellDiff,
        approvedTotal: apprCost, actualTotal: actCost,
        status, flags,
      });
    } else {
      rows.push({
        type:'missing', planItem:pi, actualItem:null,
        approvedQty: pi.approvedQty||0, actualQty:0, qtyDiff:-(pi.approvedQty||0),
        approvedFob: pi.approvedFob||0, actualFob:0, fobDiff:-(pi.approvedFob||0),
        approvedCost:(pi.approvedFob||0)*(pi.approvedCostRate||0), actualCost:0,
        costDiff: -((pi.approvedFob||0)*(pi.approvedCostRate||0)),
        approvedSell: pi.approvedSell||0, actualSell:0, sellDiff:-(pi.approvedSell||0),
        approvedTotal:(pi.approvedFob||0)*(pi.approvedCostRate||0)*(pi.approvedQty||0), actualTotal:0,
        status:'Missing Item', flags:['Missing Item'],
      });
    }
  });

  // Extra items not in plan
  actualItems.forEach((ai,idx) => {
    if(!usedActual.has(idx) && (ai.name||ai.code)) {
      rows.push({
        type:'extra', planItem:null, actualItem:ai,
        approvedQty:0, actualQty:ai.qty||0, qtyDiff:ai.qty||0,
        approvedFob:0, actualFob:ai.fob||0, fobDiff:ai.fob||0,
        approvedCost:0, actualCost:ai.cp||0, costDiff:ai.cp||0,
        approvedSell:0, actualSell:ai.sp||0, sellDiff:ai.sp||0,
        approvedTotal:0, actualTotal:ai.tcp||0,
        status:'Extra Item (Not Approved)', flags:['Extra Item'],
      });
    }
  });

  return rows;
}

// ── COMPARISON VIEW ──────────────────────────────────────
export function viewComparison(planId) {
  const plan = S.plans.find(x=>x.id===planId);
  if(!plan) return;
  S.viewingPlanId = planId;

  // Collect actual items — from all invoices (user links by plan scope)
  const allActual = [];
  S.invoices.forEach(inv => {
    // Filter invoices linked to this plan's supplier/country if set, else all
    const match = (!plan.supplier || inv.supplier === plan.supplier) &&
                  (!plan.country  || inv.ctrName === plan.country || inv.ctrCode === plan.country);
    if(match) {
      (inv.items||[]).forEach(it => allActual.push({...it, invNumber:inv.number}));
    }
  });

  const rows = matchItems(plan.items||[], allActual);

  // Dashboard numbers
  const approvedBudget  = plan.approvedBudget||0;
  const totalPlanCost   = rows.filter(r=>r.type!=='extra').reduce((s,r)=>s+r.approvedTotal,0);
  const totalActualCost = rows.reduce((s,r)=>s+r.actualTotal,0);
  const overBudget      = Math.max(0, totalActualCost - approvedBudget);
  const remaining       = approvedBudget - totalActualCost;
  const matched         = rows.filter(r=>r.type==='matched');
  const missing         = rows.filter(r=>r.type==='missing');
  const extras          = rows.filter(r=>r.type==='extra');
  const qtyIncreased    = matched.filter(r=>r.qtyDiff>0);
  const qtyReduced      = matched.filter(r=>r.qtyDiff<0);
  const priceIncreased  = matched.filter(r=>r.fobDiff>0.01);
  const priceReduced    = matched.filter(r=>r.fobDiff<-0.01);
  const overBudgetItems = matched.filter(r=>r.flags.includes('Over Budget'));

  const el = document.getElementById('comparison-body');
  if(!el) return;

  el.innerHTML = `
    <!-- Header -->
    <div style="margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:6px">
        <div>
          <div style="font-family:var(--font-head);font-size:18px;font-weight:800">${plan.planNumber} — ${plan.tripName}</div>
          <div class="t-muted fs12">${plan.country||''} &bull; ${plan.supplier||''} &bull; Approved by ${plan.approvedBy||'—'}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="window.exportComparison('${planId}')">📥 Excel Export</button>
          <button class="btn btn-ghost btn-sm" onclick="window.printComparison()">🖨 Print</button>
        </div>
      </div>
    </div>

    <!-- Dashboard Cards -->
    <div class="comp-cards">
      <div class="comp-card"><div class="comp-card-lbl">Approved Budget</div><div class="comp-card-val t-teal">${fmv(approvedBudget)}</div></div>
      <div class="comp-card"><div class="comp-card-lbl">Actual Purchased</div><div class="comp-card-val">${fmv(totalActualCost)}</div></div>
      <div class="comp-card"><div class="comp-card-lbl">Over Budget</div><div class="comp-card-val ${overBudget>0?'t-red':'t-green'}">${fmv(overBudget)}</div></div>
      <div class="comp-card"><div class="comp-card-lbl">Remaining Budget</div><div class="comp-card-val ${remaining<0?'t-red':'t-green'}">${fmv(remaining)}</div></div>
      <div class="comp-card"><div class="comp-card-lbl">Matched Items</div><div class="comp-card-val t-teal">${matched.length}</div></div>
      <div class="comp-card"><div class="comp-card-lbl">Missing Items</div><div class="comp-card-val ${missing.length?'t-red':'t-green'}">${missing.length}</div></div>
      <div class="comp-card"><div class="comp-card-lbl">Extra Items</div><div class="comp-card-val ${extras.length?'t-amber':''}">${extras.length}</div></div>
      <div class="comp-card"><div class="comp-card-lbl">Qty Changed</div><div class="comp-card-val">${qtyIncreased.length+qtyReduced.length}</div></div>
      <div class="comp-card"><div class="comp-card-lbl">Price Increased</div><div class="comp-card-val ${priceIncreased.length?'t-red':''}">${priceIncreased.length}</div></div>
    </div>

    <!-- 1. All Items Table -->
    ${compTable('All Items Comparison', '1', rows, true)}

    <!-- 2. Over Budget -->
    ${compTable('Over Budget Items', '2', overBudgetItems)}

    <!-- 3. Extra / Unapproved -->
    ${compTable('Extra / Unapproved Items', '3', extras)}

    <!-- 4. Missing Items -->
    ${compTable('Missing Approved Items', '4', missing)}

    <!-- 5. Qty Adjusted -->
    ${compTable('Quantity Adjusted Items', '5', [...qtyIncreased,...qtyReduced])}

    <!-- 6. Price Adjusted -->
    ${compTable('Price Adjusted Items', '6', [...priceIncreased,...priceReduced])}
  `;

  // Store rows for export
  window._lastCompRows = rows;
  window._lastCompPlan = plan;

  showView('comparison');
}

function compTable(title, num, rows, showAll=false) {
  if(!rows.length) return `
    <div style="margin-bottom:24px">
      <div class="comp-section-title">${num}. ${title}</div>
      <div class="table-card"><div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">No items in this category</div></div>
    </div>`;

  const statusColors = {
    'Matched':'t-green','Missing Item':'t-red','Extra Item (Not Approved)':'t-amber',
    'Qty Increased':'t-blue','Qty Reduced':'t-amber','Price Increased':'t-red',
    'Price Reduced':'t-green','Over Budget':'t-red','Under Budget':'t-green',
  };

  return `
    <div style="margin-bottom:24px">
      <div class="comp-section-title">${num}. ${title} <span class="pill" style="font-size:11px">${rows.length}</span></div>
      <div class="table-card" style="overflow:auto">
        <table>
          <thead><tr>
            <th>Code</th><th>Name</th><th>Category</th>
            <th>Appr.Qty</th><th>Act.Qty</th><th>Qty Diff</th>
            <th>Appr.FOB</th><th>Act.FOB</th><th>FOB Diff</th>
            <th>Appr.Cost</th><th>Act.Cost</th><th>Cost Diff</th>
            <th>Appr.Sell</th><th>Act.Sell</th>
            <th>Appr.Total</th><th>Act.Total</th>
            <th>Status</th>
          </tr></thead>
          <tbody>
          ${rows.map(r => {
            const pi = r.planItem||{}; const ai = r.actualItem||{};
            const sc = statusColors[r.status]||'';
            const diffCell = (v,inv=false) => {
              const cl = v===0?'t-muted':((inv?v<0:v>0)?'t-red':'t-green');
              return `<td class="${cl} t-mono fw6">${v>0?'+':''}${fmt(v,2)}</td>`;
            };
            const diffCellI = (v) => diffCell(v,true);
            return `<tr>
              <td class="t-mono fs11">${pi.code||ai.code||'—'}</td>
              <td class="fw6">${pi.name||ai.name||'—'}</td>
              <td class="fs12">${pi.category||ai.category||'—'}</td>
              <td class="t-mono">${r.approvedQty||'—'}</td>
              <td class="t-mono">${r.actualQty||'—'}</td>
              ${diffCell(r.qtyDiff)}
              <td class="t-mono">${r.approvedFob?fmt(r.approvedFob,2):'—'}</td>
              <td class="t-mono">${r.actualFob?fmt(r.actualFob,2):'—'}</td>
              ${diffCell(r.fobDiff)}
              <td class="t-mono">${r.approvedCost?fmv(r.approvedCost):'—'}</td>
              <td class="t-mono">${r.actualCost?fmv(r.actualCost):'—'}</td>
              ${diffCellI(r.costDiff)}
              <td class="t-mono">${r.approvedSell?fmv(r.approvedSell):'—'}</td>
              <td class="t-mono">${r.actualSell?fmv(r.actualSell):'—'}</td>
              <td class="t-mono">${fmv(r.approvedTotal)}</td>
              <td class="t-mono">${fmv(r.actualTotal)}</td>
              <td class="${sc} fw6 fs11">${r.status}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── EXCEL EXPORT ─────────────────────────────────────────
export function exportComparison(planId) {
  const rows = window._lastCompRows;
  const plan = window._lastCompPlan;
  if(!rows||!plan) return;

  const wb = XLSX.utils.book_new();

  // Sheet 1: Full comparison
  const data = [
    ['Plan vs Actual Comparison Report'],
    [`Plan: ${plan.planNumber} — ${plan.tripName}`],
    [`Country: ${plan.country||''}  |  Supplier: ${plan.supplier||''}  |  Approved By: ${plan.approvedBy||''}`],
    [`Approved Budget: ${fmv(plan.approvedBudget)}`],
    [],
    ['Code','Name','Category','Appr.Qty','Act.Qty','Qty Diff','Appr.FOB','Act.FOB','FOB Diff','Appr.Cost','Act.Cost','Cost Diff','Appr.Sell','Act.Sell','Appr.Total','Act.Total','Status'],
    ...rows.map(r=>([
      r.planItem?.code||r.actualItem?.code||'',
      r.planItem?.name||r.actualItem?.name||'',
      r.planItem?.category||r.actualItem?.category||'',
      r.approvedQty, r.actualQty, r.qtyDiff,
      r.approvedFob, r.actualFob, r.fobDiff,
      r.approvedCost, r.actualCost, r.costDiff,
      r.approvedSell, r.actualSell,
      r.approvedTotal, r.actualTotal,
      r.status,
    ]))
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'Full Comparison');

  // Sheet 2-6: Filtered sheets
  const subsets = [
    ['Missing Items',    rows.filter(r=>r.type==='missing')],
    ['Extra Items',      rows.filter(r=>r.type==='extra')],
    ['Over Budget',      rows.filter(r=>r.flags?.includes('Over Budget'))],
    ['Qty Adjusted',     rows.filter(r=>Math.abs(r.qtyDiff)>0 && r.type==='matched')],
    ['Price Adjusted',   rows.filter(r=>Math.abs(r.fobDiff)>0.01 && r.type==='matched')],
  ];
  const hdr = ['Code','Name','Appr.Qty','Act.Qty','Qty Diff','Appr.FOB','Act.FOB','FOB Diff','Appr.Total','Act.Total','Status'];
  subsets.forEach(([name,subset]) => {
    if(!subset.length) return;
    const sdata = [hdr, ...subset.map(r=>([
      r.planItem?.code||r.actualItem?.code||'',
      r.planItem?.name||r.actualItem?.name||'',
      r.approvedQty,r.actualQty,r.qtyDiff,
      r.approvedFob,r.actualFob,r.fobDiff,
      r.approvedTotal,r.actualTotal,r.status,
    ]))];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sdata), name);
  });

  XLSX.writeFile(wb, `PlanComparison_${plan.planNumber}_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('Excel exported ✓');
}

export function printComparison() { window.print(); }

function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

// Re-export showView reference (set from main.js)
export function showView(v) { window.showView(v); }
