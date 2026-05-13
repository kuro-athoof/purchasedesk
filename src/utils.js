// ── PRICING FORMULA ──────────────────────────────────────
// Cost Rate  = (MVR/USD ÷ Currency/USD) × (1 + COF%)
// Cost Price = FOB × Cost Rate
// Sell Price = Cost Price × (1 + Markup%)
// Final Price = Sell Price × (1 + GST%)

export function costRate(cpy, mvr, cof) {
  return ((parseFloat(mvr) || 1) / (parseFloat(cpy) || 1)) *
         (1 + (parseFloat(cof) || 0) / 100);
}

export function calcRow(fob, pcs, qty, rate, mup, gst) {
  const f  = parseFloat(fob) || 0;
  const p  = parseFloat(pcs) || 1;
  const q  = parseFloat(qty) || 0;
  const mu = (parseFloat(mup) || 0) / 100;
  const g  = (parseFloat(gst) || 0) / 100;
  const tq = p * q;
  const cp = f * rate;
  const sp = cp * (1 + mu);
  const fp = sp * (1 + g);
  const mg = cp > 0 ? ((sp - cp) / cp) * 100 : 0;
  return { tq, cp, sp, fp, mg, tcp: cp * tq, trp: sp * tq };
}

// ── FORMATTING ────────────────────────────────────────────
export const fmv = n =>
  'MVR ' + (parseFloat(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const fmt = (n, d = 2) => (parseFloat(n) || 0).toFixed(d);

// ── MISC ──────────────────────────────────────────────────
export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2800);
}

export function setSaving(on) {
  document.getElementById('saving-dot')?.classList.toggle('active', on);
  document.getElementById('saving-label')?.classList.toggle('active', on);
}
