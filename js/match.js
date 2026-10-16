// Cruce OC vs proveedor.
// - La referencia de la OC trae 2 caracteres de marca (p. ej. ME, BU) que el proveedor no usa: se separan y el
//   resto debe coincidir EXACTAMENTE (solo se ignoran espacios y mayúsculas/minúsculas).
// - Referencias repetidas dentro de un documento se suman (Metrohm consolida las líneas repetidas de la OC).
// - Cantidad: igualdad exacta. Valor: tolerancia de 1 centavo.
import { normPoNumber } from "./validate.js";

export const BRAND_LEN = 2, VALUE_TOL = 1;
const norm = (r) => String(r || "").replace(/\s+/g, "").toUpperCase();
const r4 = (x) => Math.round(x * 1e4) / 1e4;

export function aggregate(lines, stripBrand) {
  const map = new Map();
  for (const l of lines) {
    const full = norm(l.reference); if (!full) continue;
    const key = stripBrand ? full.slice(BRAND_LEN) : full;
    let e = map.get(key);
    if (!e) map.set(key, e = { reference: key, brand: stripBrand ? full.slice(0, BRAND_LEN) : "", fullReference: full, description: "", quantity: 0, total: 0, lineNumbers: [], deliveryDates: [], notes: [] });
    e.quantity = r4(e.quantity + (l.quantity || 0)); e.total += l.total || 0; e.lineNumbers.push(l.lineNo);
    e.description ||= l.description || "";
    if (l.deliveryDate && !e.deliveryDates.includes(l.deliveryDate)) e.deliveryDates.push(l.deliveryDate);
    if (l.note) e.notes.push(l.note);
  }
  for (const e of map.values()) e.unitPrice = e.quantity ? Math.round(e.total / e.quantity) : null;
  return map;
}
const side = (e) => e && ({ description: e.description, quantity: e.quantity, unitPrice: e.unitPrice, total: e.total,
  lineNumbers: e.lineNumbers, aggregatedLines: e.lineNumbers.length, deliveryDates: e.deliveryDates, notes: e.notes });

function similar(a, b) {      // sugerencia por distancia de edición (Levenshtein normalizada)
  const m = a.length, n = b.length; if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return 1 - prev[n] / Math.max(m, n);
}

export function compare(poLines, supLines) {
  const po = aggregate(poLines, true), sup = aggregate(supLines, false), items = [];
  for (const [key, p] of po) {
    const s = sup.get(key);
    const it = { reference: key, brand: p.brand, poReference: p.fullReference, po: side(p), supplier: side(s), status: "only_po", diff: null, suggestion: null };
    if (s) {
      const dq = r4(s.quantity - p.quantity), dv = s.total - p.total, qOk = dq === 0, vOk = Math.abs(dv) <= VALUE_TOL;
      it.status = qOk && vOk ? "match" : !qOk && vOk ? "qty_diff" : qOk ? "value_diff" : "qty_value_diff";
      it.diff = { quantity: dq, total: dv, unitPrice: s.unitPrice != null && p.unitPrice != null ? s.unitPrice - p.unitPrice : null };
    }
    items.push(it);
  }
  for (const [key, s] of sup) if (!po.has(key)) items.push({ reference: key, brand: null, poReference: null, po: null, supplier: side(s), status: "only_supplier", diff: null, suggestion: null });
  const orphPo = items.filter(i => i.status === "only_po"), orphSup = items.filter(i => i.status === "only_supplier");
  for (const [grp, pool] of [[orphPo, orphSup], [orphSup, orphPo]])
    for (const i of grp) { let best = null, bs = 0.75; for (const j of pool) { const sc = similar(i.reference, j.reference); if (sc >= bs) { bs = sc; best = j.reference; } } i.suggestion = best; }
  const c = (st) => items.filter(i => i.status === st).length, sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const poTotal = sum([...po.values()], e => e.total), supTotal = sum([...sup.values()], e => e.total);
  return {
    items,
    statistics: {
      poLines: poLines.length, supplierLines: supLines.length, poUniqueReferences: po.size, supplierUniqueReferences: sup.size,
      poAggregatedReferences: [...po.values()].filter(e => e.lineNumbers.length > 1).length,
      supplierAggregatedReferences: [...sup.values()].filter(e => e.lineNumbers.length > 1).length,
      referencesInBoth: items.filter(i => i.po && i.supplier).length, matched: c("match"),
      withDifferences: c("qty_diff") + c("value_diff") + c("qty_value_diff"),
      quantityDifferences: c("qty_diff") + c("qty_value_diff"), valueDifferences: c("value_diff") + c("qty_value_diff"),
      onlyInPo: c("only_po"), onlyInSupplier: c("only_supplier"),
      poTotal, supplierTotal: supTotal, totalDifference: supTotal - poTotal,
      valueOnlyInPo: sum(orphPo, i => i.po.total), valueOnlyInSupplier: sum(orphSup, i => i.supplier.total),
      valueDifferenceOnMatchedReferences: sum(items.filter(i => i.diff), i => i.diff.total),
    },
  };
}

export function crossChecks(po, sup) {
  const out = [];
  if (sup.relatedPo && po.number && normPoNumber(sup.relatedPo) !== normPoNumber(po.number))
    out.push({ severity: "warning", code: "PO_NUMBER_MISMATCH", message: `La confirmación cita la orden «${sup.relatedPo}» pero la OC cargada es «${po.number}».` });
  if (po.currency && sup.currency && po.currency !== sup.currency)
    out.push({ severity: "error", code: "CURRENCY_MISMATCH", message: `Monedas distintas: OC ${po.currency} vs proveedor ${sup.currency}.` });
  const ex = (sup.extraCharges || []).reduce((a, c) => a + c.amount, 0);
  if (ex) out.push({ severity: "info", code: "SUPPLIER_EXTRA_CHARGES",
    message: "El proveedor añade cargos fuera de las líneas (" + sup.extraCharges.map(c => `${c.label}: ${(c.amount / 100).toLocaleString("es-CO", { minimumFractionDigits: 2 })}`).join(", ") + "); no se incluyen en el cruce de líneas." });
  return out;
}
