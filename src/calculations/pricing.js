// ================================================================
//  PURCHASEDESK — PRICING CALCULATION UTILITIES
// ================================================================

// Formula Cost Rate = (MVR/USD ÷ Currency/USD) × (1 + COF%)
// READ-ONLY reference — never used directly in item costing.
export function calculateFormulaRate(cpyUsd, mvrUsd, cofPct) {
  const cpy = parseFloat(cpyUsd) || 1;
  const mvr = parseFloat(mvrUsd) || 1;
  const cof = (parseFloat(cofPct) || 0) / 100;
  return (mvr / cpy) * (1 + cof);
}

// Final Used Rate defaults to Formula Rate; user can override per country.
export function resolveRate(country) {
  if (!country) return 0;
  // finalUsedRate stored on country; fall back to calculated formula rate
  if (country.finalUsedRate && parseFloat(country.finalUsedRate) > 0) {
    return parseFloat(country.finalUsedRate);
  }
  return calculateFormulaRate(country.cpy, country.mvr, country.cof);
}

// Total Qty = Unit × Qty
export function calculateTotalQty(unit, qty) {
  return (parseFloat(unit) || 0) * (parseFloat(qty) || 0);
}

// Invoice Total = FOB × Total Qty  (Total Qty = unit × qty)
export function calculateInvoiceTotal(fob, totalQty) {
  return (parseFloat(fob) || 0) * (parseFloat(totalQty) || 0);
}

// Cost Price = FOB × Final Used Rate
// FOB is unit FOB price; Final Used Rate comes from country settings.
export function calculateCostPrice(fob, finalUsedRate) {
  return (parseFloat(fob) || 0) * (parseFloat(finalUsedRate) || 0);
}

// Total Cost = Cost Price × Total Qty
export function calculateTotalCost(costPrice, totalQty) {
  return (parseFloat(costPrice) || 0) * (parseFloat(totalQty) || 0);
}

// Sell Price Inc GST = Cost × (1 + Markup/100) × (1 + GST/100)
export function calculateSellPrice(costPrice, markupPct, gstPct) {
  const cp  = parseFloat(costPrice) || 0;
  const mu  = (parseFloat(markupPct) || 0) / 100;
  const gst = (parseFloat(gstPct)    || 8) / 100;
  return cp * (1 + mu) * (1 + gst);
}

// Regular Price (non-tax) = (100 × finalPrice) / (100 + GST%)
// Exact formula — avoids floating-point drift
export function calculateRegularPrice(finalPrice, gstPct) {
  const fp  = parseFloat(finalPrice) || 0;
  const gst = parseFloat(gstPct) || 8;
  return (100 * fp) / (100 + gst);
}

// GST Amount = Final Price − Regular Price
export function calculateGstAmount(finalPrice, regularPrice) {
  return (parseFloat(finalPrice) || 0) - (parseFloat(regularPrice) || 0);
}

// Margin % = (Regular Price − Cost Price) / Regular Price × 100
export function calculateMargin(regularPrice, costPrice) {
  const rp = parseFloat(regularPrice) || 0;
  const cp = parseFloat(costPrice)    || 0;
  if (!rp) return 0;
  return ((rp - cp) / rp) * 100;
}

// Round to nearest 0.50 MVR
export function roundToHalf(price) {
  return Math.round((parseFloat(price) || 0) * 2) / 2;
}

// ── FULL ROW CALCULATION ─────────────────────────────────
// All formulas for one invoice line item.
export function calculateRow({
  fob          = 0,
  unit         = 1,
  qty          = 0,
  finalUsedRate= 0,
  markupPct    = 100,
  gstPct       = 8,
  finalPrice   = null,   // null = auto from formula
}) {
  const tq       = calculateTotalQty(unit, qty);
  const invTotal = calculateInvoiceTotal(fob, tq);
  const cp       = calculateCostPrice(fob, finalUsedRate);
  const tcp      = calculateTotalCost(cp, tq);
  const fsp      = calculateSellPrice(cp, markupPct, gstPct);   // now includes GST

  // Final price: user override or auto-rounded formula
  const fp = (finalPrice !== null && finalPrice !== '' && !isNaN(parseFloat(finalPrice)))
    ? parseFloat(finalPrice)
    : roundToHalf(fsp);

  const rp  = calculateRegularPrice(fp, gstPct);    // (100×fp)/(100+gst)
  const gst = calculateGstAmount(fp, rp);
  const mg  = calculateMargin(rp, cp);              // (rp−cp)/rp × 100

  return { tq, invTotal, cp, tcp, fsp, fp, rp, gst, mg,
           trp: rp * tq,
           diff: fp - fsp,
           diffPct: fsp > 0 ? ((fp - fsp) / fsp) * 100 : 0 };
}

// Backwards compat export used by plans.js
export function calculateFormulaRateCompat(cpy, mvr, cof) {
  return calculateFormulaRate(cpy, mvr, cof);
}
export { calculateFormulaRate as costRate };
