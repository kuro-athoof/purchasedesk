/**
 * purchasePlan.js  — Purchase Planning System v2
 *
 * Architecture:
 *   Firestore collection: purchasePlans  (same as before, backwards-compatible)
 *   S.purchasePlans[]  — array synced by main.js listener
 *
 * Structure:
 *   Country selector → Plan workspace
 *   Tabs: Budget Approval | Purchase Lists | Purpose Split | Approval History
 */

import { S }            from '../state.js';
import { fsSet, fsDel } from '../db.js';
import { fmt, uid, toast } from '../utils.js';
import * as XLSX from 'xlsx';

// ══════════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════════
const DEFAULT_COUNTRIES = ['Dubai','Bangkok','Malaysia','India'];

const PURPOSE_OPTS = [
  'Restocking','New Item','Trial Item','Seasonal',
  'Wedding Collection','Replacement','Urgent','Market Trend'
];
const OFFICE_DEC_OPTS = [
  'Approved','Reduce Budget','Rejected','Hold','Review Later','Conditional Approval'
];
const REVIEW_STATUS_OPTS = [
  'Draft','Up for Review','Approved','Approved with Reduction',
  'Approved with Conditions','Rejected','Hold / Review Later'
];

// Row decision → row style
const DEC_ROW_CLASS = {
  'Approved':        'pp2-row-approved',
  'Rejected':        'pp2-row-rejected',
  'Reduce Budget':   'pp2-row-reduce',
  'Conditional Approval': 'pp2-row-cond',
};

const fmt2 = n => (parseFloat(n)||0).toFixed(2);
const fmtUsd = n => '$' + (parseFloat(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

// ══════════════════════════════════════════════════════════════
//  MODULE STATE
// ══════════════════════════════════════════════════════════════
let _activeCountry = null;   // e.g. 'Dubai'
let _activePlan    = null;   // plan object from S.purchasePlans
let _activeTab     = 'budget';
let _editingRowIdx = null;

// ══════════════════════════════════════════════════════════════
//  ENTRY POINT — renderPurchasePlanView
//  Called by main.js when user navigates to 'purchase-plan'
// ══════════════════════════════════════════════════════════════
export function renderPurchasePlanView() {
  const root = document.getElementById('view-purchase-plan');
  if (!root) return;

  if (!_activeCountry) {
    _renderCountrySelector(root);
    return;
  }

  // Find or show plan for this country + current year
  const year = S.dashYear || new Date().getFullYear();
  _activePlan = (S.purchasePlans || []).find(
    p => p.country === _activeCountry && p.year == year
  ) || null;

  _renderWorkspace(root);
}

// ══════════════════════════════════════════════════════════════
//  COUNTRY SELECTOR
// ══════════════════════════════════════════════════════════════
function _renderCountrySelector(root) {
  // Collect custom countries saved in any existing plans
  const existing = (S.purchasePlans || []).map(p => p.country).filter(Boolean);
  const allCountries = [...new Set([...DEFAULT_COUNTRIES, ...existing])];
  const year = S.dashYear || new Date().getFullYear();

  root.innerHTML = `
    <div class="pp2-selector-page">
      <div class="pp2-selector-head">
        <div class="pp2-selector-title">Purchase Planning</div>
        <div class="pp2-selector-sub">Select a destination to open the planning workspace for ${year}</div>
      </div>
      <div class="pp2-country-grid">
        ${allCountries.map(c => {
          const plans = (S.purchasePlans || []).filter(p => p.country === c && p.year == year);
          const totBudget = plans.reduce((s,p) => s + (p.totalBudgetUsd||0), 0);
          const status = plans[0]?.reviewStatus || null;
          const statusCls = _reviewStatusCls(status);
          return `<div class="pp2-country-card" onclick="window.pp2SelectCountry('${c}')">
            <div class="pp2-country-flag">${_countryFlag(c)}</div>
            <div class="pp2-country-name">${c}</div>
            <div class="pp2-country-meta">
              ${plans.length ? `${plans.length} plan${plans.length!==1?'s':''} &bull; ${fmtUsd(totBudget)}` : 'No plans yet'}
            </div>
            ${status ? `<span class="pp2-status-pill ${statusCls}">${status}</span>` : ''}
          </div>`;
        }).join('')}
        <div class="pp2-country-card pp2-country-add" onclick="window.pp2AddCountry()">
          <div class="pp2-country-flag">＋</div>
          <div class="pp2-country-name">Add Country</div>
          <div class="pp2-country-meta">Custom destination</div>
        </div>
      </div>
    </div>`;
}

function _countryFlag(c) {
  const flags = { Dubai:'🇦🇪', Bangkok:'🇹🇭', Malaysia:'🇲🇾', India:'🇮🇳',
                  UAE:'🇦🇪', Thailand:'🇹🇭', China:'🇨🇳', Turkey:'🇹🇷' };
  return flags[c] || '🌍';
}

function _reviewStatusCls(s) {
  if (!s) return '';
  if (s === 'Approved') return 'pp2-pill-green';
  if (s === 'Rejected') return 'pp2-pill-red';
  if (s.includes('Reduction') || s.includes('Conditions')) return 'pp2-pill-amber';
  if (s === 'Up for Review') return 'pp2-pill-blue';
  return 'pp2-pill-grey';
}

window.pp2SelectCountry = function(country) {
  _activeCountry = country;
  _activeTab     = 'budget';
  const root = document.getElementById('view-purchase-plan');
  if (root) { const yr = S.dashYear||new Date().getFullYear();
    _activePlan = (S.purchasePlans||[]).find(p=>p.country===country&&p.year==yr)||null;
    _renderWorkspace(root);
  }
};

window.pp2AddCountry = function() {
  const name = prompt('Enter destination country / city name:');
  if (!name || !name.trim()) return;
  _activeCountry = name.trim();
  _activeTab = 'budget';
  _activePlan = null;
  const root = document.getElementById('view-purchase-plan');
  if (root) _renderWorkspace(root);
};

// ══════════════════════════════════════════════════════════════
//  WORKSPACE SHELL
// ══════════════════════════════════════════════════════════════
function _renderWorkspace(root) {
  const p    = _activePlan;
  const year = S.dashYear || new Date().getFullYear();

  root.innerHTML = `
    <!-- Breadcrumb -->
    <div class="pp2-breadcrumb">
      <span class="pp2-bc-link" onclick="window.pp2Back()">Purchase Planner</span>
      <span class="pp2-bc-sep">›</span>
      <span class="pp2-bc-link">${year}</span>
      <span class="pp2-bc-sep">›</span>
      <span class="pp2-bc-cur">${_activeCountry}</span>
      ${p?.tripName ? `<span class="pp2-bc-sep">›</span><span class="pp2-bc-cur">${p.tripName}</span>` : ''}
    </div>

    <!-- Workspace Header -->
    <div class="pp2-workspace-header">
      <div class="pp2-workspace-left">
        <div class="pp2-workspace-country">${_countryFlag(_activeCountry)} ${_activeCountry}</div>
        <div class="pp2-workspace-meta">
          ${p?.tripName||'No trip set'} &bull; ${year}
          ${p?.reviewStatus ? `&bull; <span class="pp2-status-pill ${_reviewStatusCls(p.reviewStatus)} pp2-pill-inline">${p.reviewStatus}</span>` : ''}
        </div>
      </div>
      <div class="pp2-workspace-actions">
        <button class="pp2-btn pp2-btn-ghost" onclick="window.pp2Export()">📤 Export</button>
        <button class="pp2-btn pp2-btn-ghost" onclick="window.pp2AddBudgetRow()">＋ Budget Row</button>
        <button class="pp2-btn pp2-btn-ghost" onclick="window.pp2OpenListModal()">＋ Purchase List</button>
        <button class="pp2-btn pp2-btn-primary" onclick="window.pp2Save()">💾 Save</button>
      </div>
    </div>

    <!-- Summary Strip -->
    <div class="pp2-summary-strip" id="pp2-strip"></div>

    <!-- Tabs -->
    <div class="pp2-tabs-row">
      <button class="pp2-tab${_activeTab==='budget'?' pp2-tab-active':''}"
        onclick="window.pp2Tab('budget')">📋 Budget Approval</button>
      <button class="pp2-tab${_activeTab==='lists'?' pp2-tab-active':''}"
        onclick="window.pp2Tab('lists')">🗂 Purchase Lists</button>
      <button class="pp2-tab${_activeTab==='purpose'?' pp2-tab-active':''}"
        onclick="window.pp2Tab('purpose')">🎯 Purpose Split</button>
      <button class="pp2-tab${_activeTab==='history'?' pp2-tab-active':''}"
        onclick="window.pp2Tab('history')">🕐 Approval History</button>
    </div>

    <!-- Tab content panels -->
    <div id="pp2-panel-budget"  class="pp2-panel${_activeTab==='budget'?'':' pp2-panel-hidden'}"></div>
    <div id="pp2-panel-lists"   class="pp2-panel${_activeTab==='lists'?'':' pp2-panel-hidden'}"></div>
    <div id="pp2-panel-purpose" class="pp2-panel${_activeTab==='purpose'?'':' pp2-panel-hidden'}"></div>
    <div id="pp2-panel-history" class="pp2-panel${_activeTab==='history'?'':' pp2-panel-hidden'}"></div>`;

  _renderStrip();
  _renderActiveTab();
}

window.pp2Back = function() {
  _activeCountry = null;
  _activePlan    = null;
  const root = document.getElementById('view-purchase-plan');
  if (root) _renderCountrySelector(root);
};

window.pp2Tab = function(tab) {
  _activeTab = tab;
  ['budget','lists','purpose','history'].forEach(t => {
    const el = document.getElementById(`pp2-panel-${t}`);
    if (el) el.classList.toggle('pp2-panel-hidden', t !== tab);
    const btn = document.querySelector(`.pp2-tab[onclick="window.pp2Tab('${t}')"]`);
    if (btn) btn.classList.toggle('pp2-tab-active', t === tab);
  });
  _renderActiveTab();
};

function _renderActiveTab() {
  if (_activeTab === 'budget')  _renderBudgetTab();
  if (_activeTab === 'lists')   _renderListsTab();
  if (_activeTab === 'purpose') _renderPurposeTab();
  if (_activeTab === 'history') _renderHistoryTab();
}

// ══════════════════════════════════════════════════════════════
//  SUMMARY STRIP
// ══════════════════════════════════════════════════════════════
function _renderStrip() {
  const el = document.getElementById('pp2-strip'); if (!el) return;
  const p  = _activePlan;
  const rows = p?.budgetRows || [];
  const totalReq  = rows.reduce((s,r) => s + (parseFloat(r.budgetUsd)||0), 0);
  const totalAppr = rows.reduce((s,r) => s + (parseFloat(r.officeApprUsd)||0), 0);
  const diff = totalAppr - totalReq;
  const lists = (p?.purchaseLists||[]).length;

  el.innerHTML = `
    <div class="pp2-strip-item">
      <div class="pp2-strip-lbl">Requested Budget</div>
      <div class="pp2-strip-val pp2-col-amber">${fmtUsd(totalReq)}</div>
    </div>
    <div class="pp2-strip-div"></div>
    <div class="pp2-strip-item">
      <div class="pp2-strip-lbl">Office Approved</div>
      <div class="pp2-strip-val pp2-col-teal">${fmtUsd(totalAppr)}</div>
    </div>
    <div class="pp2-strip-div"></div>
    <div class="pp2-strip-item">
      <div class="pp2-strip-lbl">Difference</div>
      <div class="pp2-strip-val ${diff < 0 ? 'pp2-col-red' : diff > 0 ? 'pp2-col-green' : 'pp2-col-muted'}">
        ${diff >= 0 ? '+' : ''}${fmtUsd(diff)}
      </div>
    </div>
    <div class="pp2-strip-div"></div>
    <div class="pp2-strip-item">
      <div class="pp2-strip-lbl">Review Status</div>
      <div class="pp2-strip-val">
        <span class="pp2-status-pill ${_reviewStatusCls(p?.reviewStatus)} pp2-pill-inline">
          ${p?.reviewStatus || 'Draft'}
        </span>
      </div>
    </div>
    <div class="pp2-strip-div"></div>
    <div class="pp2-strip-item">
      <div class="pp2-strip-lbl">Budget Rows</div>
      <div class="pp2-strip-val pp2-col-text">${rows.length}</div>
    </div>
    <div class="pp2-strip-div"></div>
    <div class="pp2-strip-item">
      <div class="pp2-strip-lbl">Purchase Lists</div>
      <div class="pp2-strip-val pp2-col-text">${lists}</div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════
//  TAB 1 — BUDGET APPROVAL REQUEST
// ══════════════════════════════════════════════════════════════
function _renderBudgetTab() {
  const el = document.getElementById('pp2-panel-budget'); if (!el) return;
  const p  = _activePlan || {};
  const rows = p.budgetRows || [];
  const year = S.dashYear || new Date().getFullYear();

  const totalReq  = rows.reduce((s,r)=>s+(parseFloat(r.budgetUsd)||0),0);
  const totalAppr = rows.reduce((s,r)=>s+(parseFloat(r.officeApprUsd)||0),0);

  el.innerHTML = `
    <!-- Approval Header Form -->
    <div class="pp2-appr-form">
      <div class="pp2-appr-form-title">Budget Approval Request</div>
      <div class="pp2-appr-grid">
        <div class="pp2-fg">
          <label class="pp2-lbl">Trip Name</label>
          <input type="text" class="pp2-inp" id="pp2-tripName"
            value="${p.tripName||''}" placeholder="e.g. DXB Trip #5 2026"
            oninput="window.pp2HeaderChange()">
        </div>
        <div class="pp2-fg">
          <label class="pp2-lbl">Purchase Manager</label>
          <input type="text" class="pp2-inp" id="pp2-manager"
            value="${p.manager||''}" placeholder="Manager name"
            oninput="window.pp2HeaderChange()">
        </div>
        <div class="pp2-fg">
          <label class="pp2-lbl">Depart Date</label>
          <input type="date" class="pp2-inp" id="pp2-departDate"
            value="${p.departDate||''}"
            oninput="window.pp2HeaderChange()">
        </div>
        <div class="pp2-fg">
          <label class="pp2-lbl">Country / Destination</label>
          <input type="text" class="pp2-inp" value="${_activeCountry}" readonly
            style="background:#f8fafd;color:var(--muted)">
        </div>
      </div>

      <!-- Office Use section -->
      <div class="pp2-office-section">
        <div class="pp2-office-section-title">⚙ Office Use</div>
        <div class="pp2-appr-grid">
          <div class="pp2-fg">
            <label class="pp2-lbl">Total Requested Budget (USD)</label>
            <div class="pp2-calc-val">${fmtUsd(totalReq)}</div>
          </div>
          <div class="pp2-fg">
            <label class="pp2-lbl">Office Approved Budget (USD)</label>
            <div class="pp2-calc-val pp2-col-teal">${fmtUsd(totalAppr)}</div>
          </div>
          <div class="pp2-fg">
            <label class="pp2-lbl">Budget Review Status</label>
            <select class="pp2-inp pp2-sel" id="pp2-reviewStatus"
              onchange="window.pp2HeaderChange()">
              ${REVIEW_STATUS_OPTS.map(s=>
                `<option${s===(p.reviewStatus||'Draft')?' selected':''}>${s}</option>`
              ).join('')}
            </select>
          </div>
          <div class="pp2-fg">
            <label class="pp2-lbl">Approved By</label>
            <input type="text" class="pp2-inp" id="pp2-approvedBy"
              value="${p.approvedBy||''}" placeholder="Name"
              oninput="window.pp2HeaderChange()">
          </div>
          <div class="pp2-fg">
            <label class="pp2-lbl">Approval Date &amp; Time</label>
            <input type="datetime-local" class="pp2-inp" id="pp2-approvalDt"
              value="${p.approvalDt||''}"
              oninput="window.pp2HeaderChange()">
          </div>
          <div class="pp2-fg" style="grid-column:span 2">
            <label class="pp2-lbl">Office Notes</label>
            <textarea class="pp2-inp pp2-textarea" id="pp2-officeNotes"
              placeholder="Overall office remarks, conditions, notes…"
              oninput="window.pp2HeaderChange()">${p.officeNotes||''}</textarea>
          </div>
        </div>
      </div>
    </div>

    <!-- Budget Sheet Table -->
    <div class="pp2-table-section">
      <div class="pp2-table-toolbar">
        <span class="pp2-table-title">Budget Sheet</span>
        <button class="pp2-btn pp2-btn-outline pp2-btn-sm" onclick="window.pp2AddBudgetRow()">＋ Add Row</button>
      </div>
      <div class="pp2-tbl-wrap">
        <table class="pp2-tbl">
          <thead>
            <tr>
              <th class="pp2-th-seq">#</th>
              <th>Department</th>
              <th>Category</th>
              <th>Details</th>
              <th class="pp2-th-num">Budget USD</th>
              <th>Purpose</th>
              <th>Office Decision</th>
              <th class="pp2-th-num">Office Appr. USD</th>
              <th>Office Remarks</th>
              <th>Mgr Notes</th>
              <th class="pp2-th-act"></th>
            </tr>
          </thead>
          <tbody id="pp2-budget-rows">
            ${rows.map((r,i) => _budgetRow(r,i)).join('')}
          </tbody>
          <tfoot>
            <tr class="pp2-tfoot-row">
              <td colspan="4" class="pp2-tfoot-label">TOTAL</td>
              <td class="pp2-tfoot-val pp2-col-amber">${fmtUsd(totalReq)}</td>
              <td></td>
              <td></td>
              <td class="pp2-tfoot-val pp2-col-teal">${fmtUsd(totalAppr)}</td>
              <td colspan="3"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

function _budgetRow(r, i) {
  const decCls = DEC_ROW_CLASS[r.officeDec] || '';
  const reduceHighlight = r.officeDec === 'Reduce Budget' ? 'pp2-reduce-field' : '';
  return `<tr class="pp2-tr ${decCls}" data-row="${i}">
    <td class="pp2-td-seq">${i+1}</td>
    <td><input type="text" class="pp2-cell" value="${r.dept||''}"
      placeholder="Department" style="width:90px"
      onchange="window.pp2UpdateRow(${i},'dept',this.value)"></td>
    <td><input type="text" class="pp2-cell" value="${r.category||''}"
      placeholder="Category" style="width:90px"
      onchange="window.pp2UpdateRow(${i},'category',this.value)"></td>
    <td><input type="text" class="pp2-cell" value="${r.details||''}"
      placeholder="Details" style="min-width:120px"
      onchange="window.pp2UpdateRow(${i},'details',this.value)"></td>
    <td><input type="number" class="pp2-cell pp2-cell-num" value="${r.budgetUsd||''}"
      placeholder="0.00" min="0" step="0.01"
      oninput="window.pp2UpdateRow(${i},'budgetUsd',parseFloat(this.value)||0)"
      onfocus="this.select()"></td>
    <td><select class="pp2-cell pp2-cell-sel"
      onchange="window.pp2UpdateRow(${i},'purpose',this.value)">
      ${PURPOSE_OPTS.map(o=>`<option${o===(r.purpose||'Restocking')?' selected':''}>${o}</option>`).join('')}
    </select></td>
    <td><select class="pp2-cell pp2-cell-sel"
      onchange="window.pp2UpdateRow(${i},'officeDec',this.value)">
      <option value="">—</option>
      ${OFFICE_DEC_OPTS.map(o=>`<option${o===(r.officeDec||'')?' selected':''}>${o}</option>`).join('')}
    </select></td>
    <td><input type="number" class="pp2-cell pp2-cell-num ${reduceHighlight}"
      value="${r.officeApprUsd||''}" placeholder="0.00" min="0" step="0.01"
      oninput="window.pp2UpdateRow(${i},'officeApprUsd',parseFloat(this.value)||0)"
      onfocus="this.select()"></td>
    <td><input type="text" class="pp2-cell" value="${r.officeRemarks||''}"
      placeholder="Office remarks" style="min-width:110px"
      onchange="window.pp2UpdateRow(${i},'officeRemarks',this.value)"></td>
    <td><input type="text" class="pp2-cell" value="${r.mgrNotes||''}"
      placeholder="Manager notes" style="min-width:110px"
      onchange="window.pp2UpdateRow(${i},'mgrNotes',this.value)"></td>
    <td class="pp2-td-act">
      <button class="pp2-del-btn" onclick="window.pp2DeleteRow(${i})">✕</button>
    </td>
  </tr>`;
}

// ── Budget row operations ─────────────────────────────────
window.pp2HeaderChange = function() {
  _ensurePlan();
  const p = _activePlan;
  p.tripName     = document.getElementById('pp2-tripName')?.value || '';
  p.manager      = document.getElementById('pp2-manager')?.value || '';
  p.departDate   = document.getElementById('pp2-departDate')?.value || '';
  p.reviewStatus = document.getElementById('pp2-reviewStatus')?.value || 'Draft';
  p.approvedBy   = document.getElementById('pp2-approvedBy')?.value || '';
  p.approvalDt   = document.getElementById('pp2-approvalDt')?.value || '';
  p.officeNotes  = document.getElementById('pp2-officeNotes')?.value || '';
  _renderStrip();
};

window.pp2UpdateRow = function(i, field, value) {
  _ensurePlan();
  if (!_activePlan.budgetRows[i]) return;
  _activePlan.budgetRows[i][field] = value;
  // Re-render totals in the footer and strip
  _refreshBudgetTotals();
};

window.pp2AddBudgetRow = function() {
  _ensurePlan();
  _activePlan.budgetRows.push({
    dept:'', category:'', details:'', budgetUsd:0,
    purpose:'Restocking', officeDec:'', officeApprUsd:0,
    officeRemarks:'', mgrNotes:'',
  });
  if (_activeTab !== 'budget') { _activeTab = 'budget'; _renderWorkspace(document.getElementById('view-purchase-plan')); }
  else _renderBudgetTab();
};

window.pp2DeleteRow = function(i) {
  if (!_activePlan?.budgetRows?.[i]) return;
  if (!confirm('Remove this budget row?')) return;
  _activePlan.budgetRows.splice(i, 1);
  _renderBudgetTab();
  _renderStrip();
};

function _refreshBudgetTotals() {
  const rows = _activePlan?.budgetRows || [];
  const totalReq  = rows.reduce((s,r)=>s+(parseFloat(r.budgetUsd)||0),0);
  const totalAppr = rows.reduce((s,r)=>s+(parseFloat(r.officeApprUsd)||0),0);
  // Update tfoot
  const tfoot = document.querySelector('#pp2-panel-budget .pp2-tfoot-row');
  if (tfoot) {
    const cells = tfoot.querySelectorAll('.pp2-tfoot-val');
    if (cells[0]) cells[0].textContent = fmtUsd(totalReq);
    if (cells[1]) cells[1].textContent = fmtUsd(totalAppr);
  }
  // Update calc vals in office section
  const calcVals = document.querySelectorAll('#pp2-panel-budget .pp2-calc-val');
  if (calcVals[0]) calcVals[0].textContent = fmtUsd(totalReq);
  if (calcVals[1]) calcVals[1].textContent = fmtUsd(totalAppr);
  _renderStrip();
  // Row colour update
  const rows2 = document.querySelectorAll('#pp2-budget-rows tr[data-row]');
  rows2.forEach((tr, i) => {
    tr.className = 'pp2-tr ' + (DEC_ROW_CLASS[rows[i]?.officeDec]||'');
    const reduceInp = tr.querySelectorAll('.pp2-cell-num')[1];
    if (reduceInp) reduceInp.classList.toggle('pp2-reduce-field', rows[i]?.officeDec === 'Reduce Budget');
  });
}

// ══════════════════════════════════════════════════════════════
//  TAB 2 — PURCHASE LISTS
// ══════════════════════════════════════════════════════════════
function _renderListsTab() {
  const el = document.getElementById('pp2-panel-lists'); if (!el) return;
  const p = _activePlan;
  const lists = p?.purchaseLists || [];

  el.innerHTML = `
    <div class="pp2-lists-head">
      <div>
        <div class="pp2-lists-title">Purchase Lists</div>
        <div class="pp2-lists-sub">Separate lists per vendor or category, all linked to this plan</div>
      </div>
      <button class="pp2-btn pp2-btn-primary" onclick="window.pp2OpenListModal()">＋ New Purchase List</button>
    </div>
    ${!lists.length ? `
      <div class="pp2-empty">
        <div class="pp2-empty-icon">🗂</div>
        <div class="pp2-empty-title">No purchase lists yet</div>
        <div class="pp2-empty-sub">Create separate lists per vendor — e.g. Royal Oasis List, Perfume Vendor List</div>
        <button class="pp2-btn pp2-btn-primary" style="margin-top:14px" onclick="window.pp2OpenListModal()">＋ Create First List</button>
      </div>` :
    `<div class="pp2-list-grid">
      ${lists.map((lst, i) => {
        const statusCls = lst.status === 'Completed' ? 'pp2-pill-green' :
                         lst.status === 'In Progress' ? 'pp2-pill-blue' : 'pp2-pill-grey';
        return `<div class="pp2-list-card">
          <div class="pp2-list-card-top">
            <div class="pp2-list-card-name">${lst.name||'Unnamed List'}</div>
            <span class="pp2-status-pill ${statusCls}">${lst.status||'Planned'}</span>
          </div>
          <div class="pp2-list-card-vendor">${lst.vendor||'No vendor set'}</div>
          <div class="pp2-list-card-meta">
            <span>Created ${lst.createdAt ? lst.createdAt.slice(0,10) : '—'}</span>
            ${lst.budgetUsd ? `<span class="pp2-col-amber">$${fmt2(lst.budgetUsd)} budget</span>` : ''}
          </div>
          ${lst.notes ? `<div class="pp2-list-card-notes">${lst.notes}</div>` : ''}
          <div class="pp2-list-card-actions">
            <button class="pp2-btn pp2-btn-ghost pp2-btn-sm" onclick="window.pp2EditList(${i})">✏ Edit</button>
            <button class="pp2-btn pp2-btn-danger pp2-btn-sm" onclick="window.pp2DeleteList(${i})">🗑</button>
          </div>
        </div>`;
      }).join('')}
    </div>`}`;
}

window.pp2OpenListModal = function(idx) {
  _ensurePlan();
  const lst = idx !== undefined ? _activePlan.purchaseLists[idx] : null;
  const LIST_STATUS = ['Planned','In Progress','Completed','Cancelled'];
  const modal = document.getElementById('pp2-list-modal');
  if (!modal) { _renderListModal(); return window.pp2OpenListModal(idx); }
  document.getElementById('pp2-list-idx').value     = idx !== undefined ? idx : '';
  document.getElementById('pp2-list-name').value    = lst?.name    || '';
  document.getElementById('pp2-list-vendor').value  = lst?.vendor  || '';
  document.getElementById('pp2-list-budget').value  = lst?.budgetUsd || '';
  document.getElementById('pp2-list-status').value  = lst?.status  || 'Planned';
  document.getElementById('pp2-list-notes').value   = lst?.notes   || '';
  modal.classList.add('open');
};

window.pp2EditList = function(i) { window.pp2OpenListModal(i); };

window.pp2SaveList = function() {
  _ensurePlan();
  const idx  = document.getElementById('pp2-list-idx').value;
  const item = {
    name:      document.getElementById('pp2-list-name').value.trim(),
    vendor:    document.getElementById('pp2-list-vendor').value.trim(),
    budgetUsd: parseFloat(document.getElementById('pp2-list-budget').value)||0,
    status:    document.getElementById('pp2-list-status').value,
    notes:     document.getElementById('pp2-list-notes').value.trim(),
    createdAt: idx === '' ? new Date().toISOString() : (_activePlan.purchaseLists[parseInt(idx)]?.createdAt || new Date().toISOString()),
  };
  if (!item.name) return alert('List name required');
  if (idx === '') _activePlan.purchaseLists.push(item);
  else _activePlan.purchaseLists[parseInt(idx)] = item;
  document.getElementById('pp2-list-modal')?.classList.remove('open');
  _renderListsTab();
  _renderStrip();
};

window.pp2DeleteList = function(i) {
  if (!confirm('Remove this purchase list?')) return;
  _activePlan.purchaseLists.splice(i, 1);
  _renderListsTab(); _renderStrip();
};

// ══════════════════════════════════════════════════════════════
//  TAB 3 — PURPOSE SPLIT
// ══════════════════════════════════════════════════════════════
function _renderPurposeTab() {
  const el = document.getElementById('pp2-panel-purpose'); if (!el) return;
  const rows = _activePlan?.budgetRows || [];
  const totalReq  = rows.reduce((s,r)=>s+(parseFloat(r.budgetUsd)||0),0);
  const totalAppr = rows.reduce((s,r)=>s+(parseFloat(r.officeApprUsd)||0),0);
  const diff = totalAppr - totalReq;

  // Aggregate by purpose
  const byPurpose = {};
  rows.forEach(r => {
    const pur = r.purpose || 'Other';
    if (!byPurpose[pur]) byPurpose[pur] = 0;
    byPurpose[pur] += parseFloat(r.budgetUsd)||0;
  });

  const sorted = Object.entries(byPurpose).sort((a,b)=>b[1]-a[1]);
  const purposeColors = {
    'Restocking':'#0d9488','New Item':'#7c3aed','Trial Item':'#b45309',
    'Seasonal':'#1d4ed8','Wedding Collection':'#be185d','Replacement':'#059669',
    'Urgent':'#dc2626','Market Trend':'#0891b2','Other':'#6b7280',
  };

  el.innerHTML = `
    <div class="pp2-purpose-layout">
      <!-- Left: summary cards -->
      <div class="pp2-purpose-summary">
        <div class="pp2-purpose-kpi">
          <div class="pp2-purpose-kpi-lbl">Total Requested</div>
          <div class="pp2-purpose-kpi-val pp2-col-amber">${fmtUsd(totalReq)}</div>
        </div>
        <div class="pp2-purpose-kpi">
          <div class="pp2-purpose-kpi-lbl">Office Approved</div>
          <div class="pp2-purpose-kpi-val pp2-col-teal">${fmtUsd(totalAppr)}</div>
        </div>
        <div class="pp2-purpose-kpi">
          <div class="pp2-purpose-kpi-lbl">Difference</div>
          <div class="pp2-purpose-kpi-val ${diff<0?'pp2-col-red':diff>0?'pp2-col-green':'pp2-col-muted'}">
            ${diff>=0?'+':''}${fmtUsd(diff)}
          </div>
        </div>
        <div class="pp2-purpose-kpi">
          <div class="pp2-purpose-kpi-lbl">Budget Rows</div>
          <div class="pp2-purpose-kpi-val pp2-col-text">${rows.length}</div>
        </div>
      </div>

      <!-- Right: purpose bars -->
      <div class="pp2-purpose-bars">
        <div class="pp2-purpose-bars-title">Budget by Purpose</div>
        ${!sorted.length
          ? `<div class="pp2-empty" style="padding:32px">No data yet. Add budget rows in the Budget Approval tab.</div>`
          : sorted.map(([pur, amt]) => {
              const pct = totalReq > 0 ? (amt/totalReq*100) : 0;
              const color = purposeColors[pur] || '#6b7280';
              return `<div class="pp2-purp-row">
                <div class="pp2-purp-label">
                  <span class="pp2-purp-name">${pur}</span>
                  <span class="pp2-purp-amt">${fmtUsd(amt)}</span>
                  <span class="pp2-purp-pct">${pct.toFixed(1)}%</span>
                </div>
                <div class="pp2-purp-bar-wrap">
                  <div class="pp2-purp-bar" style="--bar-color:${color};--bar-pct:${Math.min(pct,100)}%"></div>
                </div>
              </div>`;
            }).join('')}
      </div>
    </div>

    <!-- By Department table -->
    ${rows.length ? `
    <div class="pp2-table-section" style="margin-top:0">
      <div class="pp2-table-toolbar">
        <span class="pp2-table-title">Budget by Department</span>
      </div>
      <div class="pp2-tbl-wrap" style="max-height:none">
        <table class="pp2-tbl">
          <thead><tr>
            <th>Department</th><th>Category</th><th>Purpose</th>
            <th class="pp2-th-num">Budget USD</th>
            <th class="pp2-th-num">Appr. USD</th>
            <th class="pp2-th-num">Diff</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => {
              const d = (parseFloat(r.officeApprUsd)||0) - (parseFloat(r.budgetUsd)||0);
              const dCls = d < 0 ? 'pp2-col-red' : d > 0 ? 'pp2-col-green' : 'pp2-col-muted';
              return `<tr class="pp2-tr ${DEC_ROW_CLASS[r.officeDec]||''}">
                <td class="fw6">${r.dept||'—'}</td>
                <td>${r.category||'—'}</td>
                <td><span class="pp2-purp-tag" style="background:${purposeColors[r.purpose]||'#6b7280'}20;color:${purposeColors[r.purpose]||'#6b7280'}">${r.purpose||'—'}</span></td>
                <td class="t-mono t-right pp2-col-amber">${fmtUsd(r.budgetUsd||0)}</td>
                <td class="t-mono t-right pp2-col-teal">${fmtUsd(r.officeApprUsd||0)}</td>
                <td class="t-mono t-right ${dCls}">${d>=0?'+':''}${fmtUsd(d)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}`;
}

// ══════════════════════════════════════════════════════════════
//  TAB 4 — APPROVAL HISTORY
// ══════════════════════════════════════════════════════════════
function _renderHistoryTab() {
  const el = document.getElementById('pp2-panel-history'); if (!el) return;
  const history = _activePlan?.history || [];

  el.innerHTML = `
    <div class="pp2-history-head">
      <div class="pp2-lists-title">Approval History</div>
      <button class="pp2-btn pp2-btn-ghost" onclick="window.pp2AddHistoryEntry()">＋ Add Note</button>
    </div>
    <div class="pp2-timeline">
      ${!history.length
        ? `<div class="pp2-empty">
            <div class="pp2-empty-icon">🕐</div>
            <div class="pp2-empty-title">No history yet</div>
            <div class="pp2-empty-sub">Status changes and approval notes appear here automatically when you save.</div>
          </div>`
        : history.slice().reverse().map((h, i) => `
          <div class="pp2-timeline-item">
            <div class="pp2-timeline-dot ${_reviewStatusCls(h.status)}"></div>
            <div class="pp2-timeline-content">
              <div class="pp2-timeline-header">
                <span class="pp2-timeline-status ${_reviewStatusCls(h.status) ? 'pp2-status-pill '+_reviewStatusCls(h.status)+' pp2-pill-inline' : ''}">${h.status||'Note'}</span>
                <span class="pp2-timeline-by">${h.by||'—'}</span>
                <span class="pp2-timeline-dt">${h.dt ? new Date(h.dt).toLocaleString() : '—'}</span>
              </div>
              ${h.note ? `<div class="pp2-timeline-note">${h.note}</div>` : ''}
            </div>
          </div>`).join('')}
    </div>`;
}

window.pp2AddHistoryEntry = function() {
  const note = prompt('Add a note or record a status update:');
  if (!note) return;
  _ensurePlan();
  if (!_activePlan.history) _activePlan.history = [];
  _activePlan.history.push({
    status: _activePlan.reviewStatus || 'Note',
    by:     _activePlan.approvedBy || 'User',
    dt:     new Date().toISOString(),
    note,
  });
  _renderHistoryTab();
};

// ══════════════════════════════════════════════════════════════
//  SAVE
// ══════════════════════════════════════════════════════════════
export async function savePurchasePlan() {
  _ensurePlan();
  const p   = _activePlan;
  const rows = p.budgetRows || [];

  // Sync header fields from DOM if budget tab is active
  if (_activeTab === 'budget') window.pp2HeaderChange?.();

  // Aggregate totals
  p.totalBudgetUsd = rows.reduce((s,r)=>s+(parseFloat(r.budgetUsd)||0),0);
  p.totalApprUsd   = rows.reduce((s,r)=>s+(parseFloat(r.officeApprUsd)||0),0);
  p.updatedAt      = new Date().toISOString();

  // Auto-add history entry on status change
  const prevStatus = (S.purchasePlans||[]).find(x=>x.id===p.id)?.reviewStatus;
  if (p.reviewStatus && p.reviewStatus !== prevStatus) {
    if (!p.history) p.history = [];
    p.history.push({
      status: p.reviewStatus,
      by:     p.approvedBy || 'User',
      dt:     new Date().toISOString(),
      note:   `Status changed to "${p.reviewStatus}"`,
    });
    // Auto-fill approval date if approved
    if (p.reviewStatus === 'Approved' && !p.approvalDt) {
      p.approvalDt = new Date().toISOString().slice(0,16);
    }
  }

  const btn = document.querySelector('.pp2-btn-primary[onclick="window.pp2Save()"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  await fsSet('purchasePlans', p.id, p);
  toast('Purchase plan saved ✓');
  if (btn) { btn.disabled = false; btn.textContent = '💾 Save'; }
  _renderStrip();
}

window.pp2Save = savePurchasePlan;

// ══════════════════════════════════════════════════════════════
//  EXPORT
// ══════════════════════════════════════════════════════════════
window.pp2Export = function() {
  const p = _activePlan;
  if (!p) return toast('No plan to export', 'error');
  const wb = XLSX.utils.book_new();

  // Budget Sheet
  const bh = ['#','Department','Category','Details','Budget USD',
               'Purpose','Office Decision','Office Appr. USD','Office Remarks','Mgr Notes'];
  const brows = (p.budgetRows||[]).map((r,i)=>[
    i+1, r.dept||'', r.category||'', r.details||'',
    r.budgetUsd||0, r.purpose||'', r.officeDec||'',
    r.officeApprUsd||0, r.officeRemarks||'', r.mgrNotes||'',
  ]);
  XLSX.utils.book_append_sheet(wb,
    XLSX.utils.aoa_to_sheet([
      [`Budget Approval — ${p.tripName||_activeCountry} ${p.year||''}`],
      [`Manager: ${p.manager||'—'} | Depart: ${p.departDate||'—'} | Status: ${p.reviewStatus||'Draft'}`],
      [`Approved By: ${p.approvedBy||'—'} | Date: ${p.approvalDt||'—'}`],
      [], bh, ...brows,
      [],
      ['','','','TOTAL',
        (p.budgetRows||[]).reduce((s,r)=>s+(parseFloat(r.budgetUsd)||0),0).toFixed(2),
        '','',
        (p.budgetRows||[]).reduce((s,r)=>s+(parseFloat(r.officeApprUsd)||0),0).toFixed(2),
      ],
    ]),
    'Budget Sheet'
  );

  // Purchase Lists
  const lh = ['#','List Name','Vendor','Budget USD','Status','Notes','Created'];
  const lrows = (p.purchaseLists||[]).map((l,i)=>[
    i+1, l.name||'', l.vendor||'', l.budgetUsd||0,
    l.status||'', l.notes||'', l.createdAt?.slice(0,10)||'',
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([lh,...lrows]), 'Purchase Lists');

  XLSX.writeFile(wb, `PurchasePlan_${_activeCountry}_${p.year||''}.xlsx`);
  toast('Excel exported ✓');
};

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════
function _ensurePlan() {
  if (_activePlan) return;
  const year = S.dashYear || new Date().getFullYear();
  _activePlan = {
    id:             uid(),
    country:        _activeCountry,
    year,
    tripName:       '',
    manager:        '',
    departDate:     '',
    reviewStatus:   'Draft',
    approvedBy:     '',
    approvalDt:     '',
    officeNotes:    '',
    budgetRows:     [],
    purchaseLists:  [],
    history:        [],
    totalBudgetUsd: 0,
    totalApprUsd:   0,
    createdAt:      new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
  };
}

// ── List modal (created on demand) ───────────────────────
function _renderListModal() {
  if (document.getElementById('pp2-list-modal')) return;
  const LIST_STATUS = ['Planned','In Progress','Completed','Cancelled'];
  const div = document.createElement('div');
  div.className = 'modal-overlay';
  div.id        = 'pp2-list-modal';
  div.innerHTML = `
    <div class="modal modal-sm">
      <div class="modal-header">
        <div class="modal-title">Purchase List</div>
        <button class="modal-close" onclick="document.getElementById('pp2-list-modal').classList.remove('open')">✕</button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="pp2-list-idx">
        <div class="grid2">
          <div class="fg full"><label>List Name *</label>
            <input type="text" id="pp2-list-name" placeholder="e.g. Royal Oasis List"></div>
          <div class="fg"><label>Vendor / Section</label>
            <input type="text" id="pp2-list-vendor" placeholder="Vendor name"></div>
          <div class="fg"><label>Planned Budget (USD)</label>
            <input type="number" id="pp2-list-budget" placeholder="0.00" step="0.01" min="0"></div>
          <div class="fg full"><label>Status</label>
            <select id="pp2-list-status">
              ${LIST_STATUS.map(s=>`<option>${s}</option>`).join('')}
            </select></div>
          <div class="fg full"><label>Notes</label>
            <textarea id="pp2-list-notes" placeholder="Notes…" style="min-height:60px"></textarea></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="document.getElementById('pp2-list-modal').classList.remove('open')">Cancel</button>
        <button class="btn btn-primary" onclick="window.pp2SaveList()">Save List</button>
      </div>
    </div>`;
  div.addEventListener('click', e => { if (e.target === div) div.classList.remove('open'); });
  document.body.appendChild(div);
}

// ── Backwards-compat exports (main.js imports these names) ───
export function openNewPurchasePlan(tripId) {
  // Open from trip: find country from trip or prompt
  const trip = (S.trips||[]).find(t=>t.id===tripId);
  _activeCountry = trip?.country || 'Dubai';
  _activeTab     = 'budget';
  const year = trip?.year || (S.dashYear||new Date().getFullYear());
  _activePlan = (S.purchasePlans||[]).find(p=>p.country===_activeCountry&&p.year==year)||null;
  window.showView('purchase-plan');
}

export function openPurchasePlan(planId) {
  const plan = (S.purchasePlans||[]).find(p=>p.id===planId);
  if (!plan) { toast('Plan not found','error'); return; }
  _activePlan    = plan;
  _activeCountry = plan.country || 'Dubai';
  _activeTab     = 'budget';
  window.showView('purchase-plan');
}

export function editPurchasePlanMeta(planId) { openPurchasePlan(planId); }
export function renderPurchasePlanList()     { /* handled inline */ }
export function savePurchasePlanMeta()       { savePurchasePlan(); }
export async function deletePurchasePlan(planId) {
  if (!confirm('Delete this plan?')) return;
  await fsDel('purchasePlans', planId);
  toast('Plan deleted');
  _activePlan    = null;
  _activeCountry = null;
  const root = document.getElementById('view-purchase-plan');
  if (root) _renderCountrySelector(root);
}

export function ppExportExcel()  { window.pp2Export(); }
export function ppImportExcel()  { toast('Use Export to get the template, fill and re-import later','error'); }
