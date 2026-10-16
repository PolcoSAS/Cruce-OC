// Consolidado en Excel (ExcelJS). Se recibe la salida JSON ya construida, de modo que el Excel,
// el JSON y la pantalla muestran siempre las mismas cifras.
const STATUS = { match: "Coincide", qty_diff: "Dif. cantidad", value_diff: "Dif. valor", qty_value_diff: "Dif. cantidad y valor", only_po: "Solo en OC", only_supplier: "Solo en proveedor" };
const FILL = { match: "FFE3F5EC", qty_diff: "FFFFF2D9", value_diff: "FFFFF2D9", qty_value_diff: "FFFFF2D9", only_po: "FFFDE8E6", only_supplier: "FFFDE8E6" };
const HEAD = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3FB8" } };
const MONEY = "#,##0.00;[Red]-#,##0.00", QTY = "#,##0.####";

function header(ws, cols) {
  ws.columns = cols.map(([header, key, width, fmt]) => ({ header, key, width, style: fmt ? { numFmt: fmt } : {} }));
  const r = ws.getRow(1); r.font = { bold: true, color: { argb: "FFFFFFFF" } }; r.fill = HEAD; r.alignment = { vertical: "middle", wrapText: true }; r.height = 30;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

export function buildWorkbook(ExcelJS, out) {
  const wb = new ExcelJS.Workbook(); wb.creator = "Cruce OC ↔ Proveedor"; wb.created = new Date();
  const po = out.purchase_order, sp = out.supplier_confirmation, st = out.statistics, cur = po.currency || sp.currency;

  // ---- Resumen
  const rs = wb.addWorksheet("Resumen", { properties: { tabColor: { argb: "FF0B3FB8" } } });
  rs.columns = [{ width: 44 }, { width: 22 }, { width: 22 }];
  rs.addRow(["Cruce de orden de compra vs. confirmación del proveedor"]).font = { bold: true, size: 14 };
  rs.addRow([`Estado: ${out.status === "confirmed" ? "Confirmado el " + new Date(out.confirmed_at).toLocaleString("es-CO") : "Borrador"}`]);
  rs.addRow([]);
  const meta = (l, a, b) => rs.addRow([l, a, b]);
  const h1 = rs.addRow(["Documento", "Orden de compra", "Proveedor"]); h1.font = { bold: true }; h1.fill = HEAD; h1.font = { bold: true, color: { argb: "FFFFFFFF" } };
  meta("Archivo", po.file_name, sp.file_name); meta("Número", po.number, sp.number); meta("Proveedor", po.supplier_name, sp.supplier_name); meta("Fecha", po.date, sp.date); meta("Moneda", po.currency, sp.currency);
  meta("Líneas leídas", po.line_count, sp.line_count); meta("Suma de líneas", po.lines_total, sp.lines_total); meta("Total declarado en el PDF", po.declared_total, sp.declared_total);
  meta("Requirió revisión", po.needs_review ? "Sí" : "No", sp.needs_review ? "Sí" : "No"); meta("Líneas corregidas manualmente", po.manually_edited_lines, sp.manually_edited_lines);
  rs.addRow([]);
  const h2 = rs.addRow(["Resultado del cruce", "Valor"]); h2.font = { bold: true, color: { argb: "FFFFFFFF" } }; h2.fill = HEAD;
  for (const [l, v] of [["Referencias únicas · OC", st.po_unique_references], ["Referencias únicas · Proveedor", st.supplier_unique_references], ["Referencias que coinciden", st.matched],
    ["Referencias con diferencias", st.with_differences], ["   · en cantidad", st.quantity_differences], ["   · en valor", st.value_differences], ["Solo en OC", st.only_in_po], ["Solo en proveedor", st.only_in_supplier],
    [`Total líneas OC (${cur})`, st.po_total], [`Total líneas proveedor (${cur})`, st.supplier_total], [`Diferencia proveedor − OC (${cur})`, st.total_difference],
    [`Valor solo en OC (${cur})`, st.value_only_in_po], [`Valor solo en proveedor (${cur})`, st.value_only_in_supplier]]) rs.addRow([l, v]);
  rs.eachRow(r => r.eachCell(c => { if (typeof c.value === "number" && !Number.isInteger(c.value)) c.numFmt = MONEY; }));
  for (const c of sp.extra_charges) rs.addRow([`Cargo del proveedor fuera de líneas: ${c.label}`, c.amount]).getCell(2).numFmt = MONEY;
  if (out.notes) { rs.addRow([]); rs.addRow(["Notas de confirmación", out.notes]); }

  // ---- Cruce y Diferencias
  const cols = [["Estado", "estado", 20], ["Referencia (sin marca)", "ref", 18], ["Ref. en OC (con marca)", "poref", 18], ["Descripción", "desc", 46], ["Cant. OC", "qpo", 11, QTY], ["Cant. proveedor", "qsp", 14, QTY], ["Δ Cantidad", "dq", 12, QTY],
    [`Total OC (${cur})`, "tpo", 16, MONEY], [`Total proveedor (${cur})`, "tsp", 18, MONEY], ["Δ Valor", "dt", 14, MONEY], ["Observaciones", "obs", 50]];
  const rows = out.items.map(i => {
    const obs = [];
    if (i.po?.aggregated_lines > 1) obs.push(`OC: ${i.po.aggregated_lines} líneas sumadas`);
    if (i.supplier?.aggregated_lines > 1) obs.push(`Proveedor: ${i.supplier.aggregated_lines} líneas sumadas`);
    if (i.supplier?.notes?.length) obs.push(i.supplier.notes.join("; ") + (i.supplier.delivery_dates.length ? ` (${i.supplier.delivery_dates.join(", ")})` : ""));
    if (i.suggestion) obs.push(`¿Será ${i.suggestion}? (no cruzado automáticamente)`);
    return { s: i.status, estado: STATUS[i.status], ref: i.reference, poref: i.po_reference || "", desc: (i.po || i.supplier).description,
      qpo: i.po?.quantity ?? null, qsp: i.supplier?.quantity ?? null, dq: i.diff?.quantity ?? null, tpo: i.po?.total ?? null, tsp: i.supplier?.total ?? null, dt: i.diff?.total ?? null, obs: obs.join(" · ") };
  });
  for (const [name, list] of [["Cruce", rows], ["Diferencias", rows.filter(r => r.s !== "match")]]) {
    const ws = wb.addWorksheet(name); header(ws, cols);
    for (const r of list) { const row = ws.addRow(r); row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[r.s] } }; if (r.dq) row.getCell(7).font = { bold: true, color: { argb: "FFB3261E" } }; if (r.dt && Math.abs(r.dt) > 0.005) row.getCell(10).font = { bold: true, color: { argb: "FFB3261E" } }; }
    ws.autoFilter = { from: "A1", to: { row: 1, column: cols.length } };
    const tot = ws.addRow({ estado: "TOTAL", tpo: list.reduce((a, r) => a + (r.tpo || 0), 0), tsp: list.reduce((a, r) => a + (r.tsp || 0), 0), dt: list.reduce((a, r) => a + (r.dt || 0), 0) });
    tot.font = { bold: true }; tot.border = { top: { style: "thin" } };
  }

  // ---- Líneas originales leídas
  for (const [name, d] of [["Líneas OC", po], ["Líneas proveedor", sp]]) {
    const ws = wb.addWorksheet(name); header(ws, [["#", "n", 6], ["Referencia", "ref", 18], ["Descripción", "desc", 52], ["Cantidad", "q", 11, QTY], ["Precio unitario", "u", 16, MONEY], ["Valor total", "t", 16, MONEY], ["Corregida a mano", "e", 16]]);
    for (const l of d.lines) { const r = ws.addRow({ n: l.line_no, ref: l.reference, desc: l.description, q: l.quantity, u: l.unit_price, t: l.total, e: l.edited ? "Sí" : "" }); if (l.edited) r.eachCell(c => c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6EEFB" } }); }
  }

  // ---- Incidencias
  const all = [...po.issues.map(i => ({ doc: "Orden de compra", ...i })), ...sp.issues.map(i => ({ doc: "Proveedor", ...i })), ...out.cross_checks.map(i => ({ doc: "Entre documentos", ...i }))];
  const wi = wb.addWorksheet("Incidencias"); header(wi, [["Documento", "doc", 20], ["Severidad", "sev", 12], ["Código", "code", 22], ["Línea", "ln", 8], ["Mensaje", "msg", 110]]);
  for (const i of all) wi.addRow({ doc: i.doc, sev: { error: "Error", warning: "Aviso", info: "Info" }[i.severity], code: i.code, ln: i.line_number, msg: i.message });
  if (!all.length) wi.addRow({ doc: "—", msg: "Sin observaciones." });
  return wb;
}
