// Salida JSON con esquema fijo (schema/cruce-1.0.schema.json). Los importes salen en unidades de moneda (no centavos).
import { compare, crossChecks } from "./match.js";
import { validateDocument } from "./validate.js";

export const SCHEMA_VERSION = "1.0";
const m = (c) => (c == null ? null : c / 100);

export function buildOutput({ po, sup, status = "draft", confirmedAt = null, notes = "" }) {
  const result = compare(po.lines, sup.lines), cross = crossChecks(po, sup);
  const doc = (d) => {
    const issues = validateDocument(d), no = (id) => d.lines.find(l => l.id === id)?.lineNo ?? null;
    return {
      file_name: d.fileName || "", sha256: d.sha256 || "", parser: d.parser || "", number: d.number || "", supplier_name: d.supplierName || "",
      date: d.date || "", currency: d.currency || "", line_count: d.lines.length, lines_total: m(d.lines.reduce((a, l) => a + (l.total || 0), 0)),
      declared_total: m(d.declaredTotal), extra_charges: (d.extraCharges || []).map(c => ({ label: c.label, amount: m(c.amount) })),
      needs_review: issues.some(i => i.severity !== "info"), manually_edited_lines: d.lines.filter(l => l.edited).length,
      issues: issues.map(i => ({ severity: i.severity, code: i.code, message: i.message, line_number: i.lineId ? no(i.lineId) : null })),
      lines: d.lines.map(l => ({ line_no: l.lineNo, reference: l.reference, description: l.description, quantity: l.quantity, unit_price: m(l.unitPrice), total: m(l.total), edited: !!l.edited })),
    };
  };
  const sd = (s) => s && ({ description: s.description, quantity: s.quantity, unit_price: m(s.unitPrice), total: m(s.total), line_numbers: s.lineNumbers,
    aggregated_lines: s.aggregatedLines, delivery_dates: s.deliveryDates, notes: s.notes });
  const st = result.statistics;
  return {
    schema_version: SCHEMA_VERSION, generated_at: new Date().toISOString(), status, confirmed_at: confirmedAt, notes,
    purchase_order: doc(po), supplier_confirmation: doc(sup),
    cross_checks: cross.map(c => ({ ...c, line_number: null })),
    statistics: {
      po_lines: st.poLines, supplier_lines: st.supplierLines, po_unique_references: st.poUniqueReferences, supplier_unique_references: st.supplierUniqueReferences,
      po_aggregated_references: st.poAggregatedReferences, supplier_aggregated_references: st.supplierAggregatedReferences, references_in_both: st.referencesInBoth,
      matched: st.matched, with_differences: st.withDifferences, quantity_differences: st.quantityDifferences, value_differences: st.valueDifferences,
      only_in_po: st.onlyInPo, only_in_supplier: st.onlyInSupplier, po_total: m(st.poTotal), supplier_total: m(st.supplierTotal), total_difference: m(st.totalDifference),
      value_only_in_po: m(st.valueOnlyInPo), value_only_in_supplier: m(st.valueOnlyInSupplier), value_difference_on_matched_references: m(st.valueDifferenceOnMatchedReferences),
    },
    items: result.items.map(i => ({ reference: i.reference, brand: i.brand, po_reference: i.poReference, status: i.status, po: sd(i.po), supplier: sd(i.supplier),
      diff: i.diff && { quantity: i.diff.quantity, total: m(i.diff.total), unit_price: m(i.diff.unitPrice) }, suggestion: i.suggestion })),
  };
}
