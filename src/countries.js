import { S } from './state.js';
import { fsSet, fsDel, seedCountries } from './db.js';
import { costRate, fmt, uid, toast } from './utils.js';

// ── SIDEBAR ──────────────────────────────────────────────
export function renderSbCountries() {
  const el = document.getElementById('sb-countries');
  if (!el) return;
  if (!S.countries.length) {
    el.innerHTML = '<div class="sb-rate"><span class="t-muted">No rates yet</span></div>';
    return;
  }
  el.innerHTML = S.countries.map(c => {
    const r = costRate(c.cpy, c.mvr, c.cof);
    return `<div class="sb-rate">
      <span class="sb-rate-name">${c.code} — ${c.name.split(' ')[0]}</span>
      <span class="sb-rate-val">×${fmt(r, 4)}</span>
    </div>`;
  }).join('');
}

// ── COUNTRY TABLE ────────────────────────────────────────
export function renderCountries() {
  const tbody = document.getElementById('countries-tbody');
  if (!tbody) return;
  if (!S.countries.length) {
    tbody.innerHTML = `<tr><td colspan="10">
      <div class="empty-state" style="padding:28px">
        <div class="empty-title">No countries yet</div>
      </div></td></tr>`;
    return;
  }
  tbody.innerHTML = S.countries.map(c => {
    const r = costRate(c.cpy, c.mvr, c.cof);
    return `<tr>
      <td class="fw6">${c.name}</td>
      <td class="t-mono t-teal fw6">${c.code}</td>
      <td>${c.sym || '—'}</td>
      <td class="t-mono">${fmt(c.cpy, 4)}</td>
      <td class="t-mono">${fmt(c.mvr, 4)}</td>
      <td class="t-mono">${c.cof}%</td>
      <td class="t-mono">${c.mup}%</td>
      <td class="t-mono">${c.gst}%</td>
      <td class="t-mono fw6 t-teal">×${fmt(r, 4)}</td>
      <td style="text-align:center">
        <div style="display:flex;gap:5px;justify-content:center">
          <button class="btn btn-ghost btn-xs" onclick="window.editCountryRow('${c.id}')">✏ Edit</button>
          <button class="btn btn-danger btn-xs" onclick="window.deleteCountry('${c.id}')">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── COUNTRY FORM ─────────────────────────────────────────
export function openSettings() {
  S.editingCountryId = null;
  clearCrForm();
  renderCountries();
  openModal('settings-modal');
}

export function clearCrForm() {
  ['cr-name','cr-code','cr-sym','cr-cpy','cr-mvr','cr-cof','cr-mup','cr-gst']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  S.editingCountryId = null;
  const saveBtn   = document.getElementById('cr-save-btn');
  const cancelBtn = document.getElementById('cr-cancel-btn');
  const label     = document.getElementById('cr-form-label');
  if (saveBtn)   saveBtn.textContent   = 'Add Country';
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (label)     label.textContent     = 'Add New Country';
}

export function editCountryRow(id) {
  const c = S.countries.find(x => x.id === id);
  if (!c) { toast('Country not found', 'error'); return; }
  S.editingCountryId = id;
  document.getElementById('cr-name').value = c.name;
  document.getElementById('cr-code').value = c.code;
  document.getElementById('cr-sym').value  = c.sym || '';
  document.getElementById('cr-cpy').value  = c.cpy;
  document.getElementById('cr-mvr').value  = c.mvr;
  document.getElementById('cr-cof').value  = c.cof;
  document.getElementById('cr-mup').value  = c.mup;
  document.getElementById('cr-gst').value  = c.gst;
  document.getElementById('cr-save-btn').textContent      = 'Update Country';
  document.getElementById('cr-cancel-btn').style.display  = '';
  document.getElementById('cr-form-label').textContent    = 'Edit Country — ' + c.name;
  document.getElementById('cr-name').focus();
}

export async function saveCountry() {
  const name = document.getElementById('cr-name').value.trim();
  const code = document.getElementById('cr-code').value.trim().toUpperCase();
  const sym  = document.getElementById('cr-sym').value.trim();
  const cpy  = parseFloat(document.getElementById('cr-cpy').value);
  const mvr  = parseFloat(document.getElementById('cr-mvr').value);
  const cof  = parseFloat(document.getElementById('cr-cof').value) || 0;
  const mup  = parseFloat(document.getElementById('cr-mup').value) || 100;
  const gst  = parseFloat(document.getElementById('cr-gst').value) || 8;
  if (!name || !code || !cpy || !mvr) {
    alert('Country Name, Code, Currency/USD and MVR/USD are required.');
    return;
  }
  const id = S.editingCountryId || uid();
  await fsSet('countries', id, { id, name, code, sym, cpy, mvr, cof, mup, gst });
  toast(S.editingCountryId ? 'Country updated ✓' : 'Country added ✓');
  clearCrForm();
}

export async function deleteCountry(id) {
  if (!confirm('Delete this country rate?')) return;
  await fsDel('countries', id);
  toast('Country deleted');
}

export function onCountriesLoaded(countries, isFirst) {
  if (isFirst && countries.length === 0) seedCountries();
}

// Populate country dropdown in invoice form
export function populateCtrDrop() {
  const sel = document.getElementById('inv-country-origin');
  if (!sel) return;
  const v = sel.value;
  sel.innerHTML = '<option value="">— Select Country —</option>' +
    S.countries.map(c =>
      `<option value="${c.id}"${c.id === v ? ' selected' : ''}>${c.name} (${c.code})</option>`
    ).join('');
}

function openModal(id) { document.getElementById(id)?.classList.add('open'); }
