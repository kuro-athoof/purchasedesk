import { S } from './state.js';
import { fsSet, fsDel, seedCountries } from './db.js';
import { calculateFormulaRate as costRate } from './calculations/pricing.js';
import { fmt, uid, toast } from './utils.js';

// ── SIDEBAR ───────────────────────────────────────────────
export function renderSbCountries() {
  const el = document.getElementById('sb-countries'); if (!el) return;
  if (!S.countries.length) { el.innerHTML='<div class="sb-rate"><span class="t-muted">No rates yet</span></div>'; return; }
  el.innerHTML = S.countries.map(c => {
    const fur = c.finalUsedRate || costRate(c.cpy, c.mvr, c.cof);
    return `<div class="sb-rate">
      <span class="sb-rate-name">${c.code} — ${c.name.split(' ')[0]}</span>
      <span class="sb-rate-val">×${fmt(fur, 2)}</span>
    </div>`;
  }).join('');
}

// ── COUNTRY TABLE ─────────────────────────────────────────
export function renderCountries() {
  const tbody = document.getElementById('countries-tbody'); if (!tbody) return;
  if (!S.countries.length) {
    tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state" style="padding:28px"><div class="empty-title">No countries yet</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = S.countries.map(c => {
    const fr  = costRate(c.cpy, c.mvr, c.cof);
    const fur = c.finalUsedRate || fr;
    const diff = fur - fr;
    const diffTxt = Math.abs(diff) < 0.001 ? '—' : (diff > 0 ? '+' : '') + fmt(diff, 4);
    const diffCol = Math.abs(diff) < 0.001 ? 'var(--muted)' : diff > 0 ? 'var(--red)' : 'var(--green)';
    return `<tr>
      <td class="fw6">${c.name}</td>
      <td class="t-mono t-teal fw6">${c.code}</td>
      <td>${c.sym||'—'}</td>
      <td class="t-mono">${fmt(c.cpy,4)}</td>
      <td class="t-mono">${fmt(c.mvr,4)}</td>
      <td class="t-mono">${c.cof}%</td>
      <td class="t-mono">${c.mup}%</td>
      <td class="t-mono">${c.gst}%</td>
      <td class="t-mono t-muted" style="font-style:italic">×${fmt(fr,4)}</td>
      <td class="t-mono fw6 t-teal">×${fmt(fur,4)} <span style="font-size:10px;color:${diffCol}">${diffTxt}</span></td>
      <td style="text-align:center">
        <div style="display:flex;gap:5px;justify-content:center">
          <button class="btn btn-ghost btn-xs" onclick="window.editCountryRow('${c.id}')">✏ Edit</button>
          <button class="btn btn-danger btn-xs" onclick="window.deleteCountry('${c.id}')">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── COUNTRY FORM ──────────────────────────────────────────
export function openSettings() {
  S.editingCountryId = null; clearCrForm(); renderCountries();
  document.getElementById('settings-modal')?.classList.add('open');
}

export function clearCrForm() {
  ['cr-name','cr-code','cr-sym','cr-cpy','cr-mvr','cr-cof','cr-mup','cr-gst','cr-fur']
    .forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  S.editingCountryId = null;
  const sb = document.getElementById('cr-save-btn');
  const cb = document.getElementById('cr-cancel-btn');
  const lb = document.getElementById('cr-form-label');
  if (sb) sb.textContent = 'Add Country';
  if (cb) cb.style.display = 'none';
  if (lb) lb.textContent  = 'Add New Country';
  updateCrFormulaPreview();
}

export function editCountryRow(id) {
  const c = S.countries.find(x=>x.id===id);
  if (!c) { toast('Country not found','error'); return; }
  S.editingCountryId = id;
  document.getElementById('cr-name').value = c.name;
  document.getElementById('cr-code').value = c.code;
  document.getElementById('cr-sym').value  = c.sym||'';
  document.getElementById('cr-cpy').value  = c.cpy;
  document.getElementById('cr-mvr').value  = c.mvr;
  document.getElementById('cr-cof').value  = c.cof;
  document.getElementById('cr-mup').value  = c.mup;
  document.getElementById('cr-gst').value  = c.gst;
  // Final Used Rate — show stored value or formula
  const fur = c.finalUsedRate || costRate(c.cpy, c.mvr, c.cof);
  document.getElementById('cr-fur').value  = fmt(fur, 4);
  document.getElementById('cr-save-btn').textContent     = 'Update Country';
  document.getElementById('cr-cancel-btn').style.display = '';
  document.getElementById('cr-form-label').textContent   = 'Edit Country — ' + c.name;
  updateCrFormulaPreview();
  document.getElementById('cr-name').focus();
}

// Called when any formula input changes to update the preview
export function updateCrFormulaPreview() {
  const cpy = parseFloat(document.getElementById('cr-cpy')?.value)||0;
  const mvr = parseFloat(document.getElementById('cr-mvr')?.value)||0;
  const cof = parseFloat(document.getElementById('cr-cof')?.value)||0;
  const fr  = (cpy > 0 && mvr > 0) ? costRate(cpy, mvr, cof) : 0;
  const el  = document.getElementById('cr-formula-preview');
  if (el) el.textContent = fr > 0 ? '×' + fmt(fr, 6) : '—';
  // Auto-fill Final Used Rate if it's empty or hasn't been manually set
  const furEl = document.getElementById('cr-fur');
  if (furEl && (!furEl.value || furEl.dataset.autoFilled === 'true') && fr > 0) {
    furEl.value = fmt(fr, 4);
    furEl.dataset.autoFilled = 'true';
  }
}

export async function saveCountry() {
  const name = document.getElementById('cr-name').value.trim();
  const code = document.getElementById('cr-code').value.trim().toUpperCase();
  const sym  = document.getElementById('cr-sym').value.trim();
  const cpy  = parseFloat(document.getElementById('cr-cpy').value);
  const mvr  = parseFloat(document.getElementById('cr-mvr').value);
  const cof  = parseFloat(document.getElementById('cr-cof').value)||0;
  const mup  = parseFloat(document.getElementById('cr-mup').value)||100;
  const gst  = parseFloat(document.getElementById('cr-gst').value)||8;
  const fur  = parseFloat(document.getElementById('cr-fur').value) || costRate(cpy, mvr, cof);
  if (!name||!code||!cpy||!mvr) { alert('Country Name, Code, Currency/USD and MVR/USD are required.'); return; }
  const id = S.editingCountryId || uid();
  await fsSet('countries', id, { id, name, code, sym, cpy, mvr, cof, mup, gst, finalUsedRate: fur });
  toast(S.editingCountryId?'Country updated ✓':'Country added ✓');
  clearCrForm();
}

export async function deleteCountry(id) {
  if (!confirm('Delete this country rate?')) return;
  await fsDel('countries', id);
  toast('Country deleted');
}

export function onCountriesLoaded(countries, isFirst) {
  if (isFirst && countries.length===0) seedCountries();
}

// ── POPULATE DROPDOWNS ───────────────────────────────────
// Used by invoice form and trip form
export function populateCtrDrop(selId = 'h-country') {
  const sel = document.getElementById(selId); if (!sel) return;
  const v   = sel.value;
  sel.innerHTML = '<option value="">— Select Country —</option>' +
    S.countries.map(c =>
      `<option value="${c.id}"${c.id===v?' selected':''}>${c.name} (${c.code})</option>`
    ).join('');
}

// Populate all country dropdowns on the page at once
export function populateAllCtrDrops() {
  ['h-country','trip-country','plan-country'].forEach(id => populateCtrDrop(id));
}

// Get a country's finalUsedRate (the rate to use in pricing)
export function getCountryRate(countryId) {
  const c = S.countries.find(x=>x.id===countryId);
  if (!c) return 0;
  return c.finalUsedRate || costRate(c.cpy, c.mvr, c.cof);
}

// Get full country settings for invoice use
export function getCountrySettings(countryId) {
  const c = S.countries.find(x=>x.id===countryId);
  if (!c) return null;
  return {
    ...c,
    finalUsedRate: c.finalUsedRate || costRate(c.cpy, c.mvr, c.cof),
    formulaRate:   costRate(c.cpy, c.mvr, c.cof),
  };
}
