// Aplicación en el navegador. El texto de los PDFs es contenido no confiable: el DOM se construye siempre con
// textContent (helper h), nunca con innerHTML.
import * as pdfjs from "../vendor/pdf.min.mjs";
import { readPdfLines, ExtractionError } from "./pdftext.js";
import { parseDocument } from "./parsers.js";
import { validateDocument, summarize } from "./validate.js";
import { crossChecks } from "./match.js";
import { buildOutput } from "./output.js";
import { buildWorkbook } from "./excel.js";
import { fmtMoney, fmtQty, signed, parseUserNumber, centsOf } from "./num.js";
import * as store from "./store.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdf.worker.min.mjs", import.meta.url).href;
const MAX_BYTES = 15 * 1024 * 1024;
const $app = document.getElementById("app");

// ---------- utilidades ----------
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v; else if (k === "checked") e.checked = !!v; else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const svg = (d) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); s.append(p); return s; };
const ICON = { doc: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6", truck: "M1 6h13v10H1z M14 9h4l3 3v4h-7z M5.5 19a1.5 1.5 0 1 0 0-.01 M17.5 19a1.5 1.5 0 1 0 0-.01", up: "M12 16V4 M7 9l5-5 5 5 M4 20h16", check: "M5 13l4 4L19 7" };
const toast = (msg) => { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 4200); };
const dt = (s) => s ? new Date(s).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : "—";
const m = (v) => v == null ? "—" : fmtMoney(Math.round(v * 100));      // salida JSON está en unidades de moneda
const money = (v) => m(v);
const sha256 = async (buf) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map(b => b.toString(16).padStart(2, "0")).join("");
const STATUS = { match: "Coincide", qty_diff: "Dif. cantidad", value_diff: "Dif. valor", qty_value_diff: "Dif. cant. y valor", only_po: "Solo en OC", only_supplier: "Solo en proveedor" };
const SEV = { error: "Error", warning: "Aviso", info: "Info" };
function download(blob, name) { const a = h("a", { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
const safe = (s) => String(s || "cruce").replace(/[^\w.-]+/g, "_");

// ---------- estado ----------
let S = null;   // sesión de cruce en curso
const fresh = () => ({ step: 1, files: { po: null, sup: null }, po: null, sup: null, tab: "cruce", filter: "diff", ack: false, notes: "", keepPdfs: false, busy: false, error: "", output: null, savedId: null });
let nextId = 1;

// ---------- navegación ----------
document.getElementById("btnHistory").addEventListener("click", () => { location.hash = "#/history"; });
window.addEventListener("hashchange", route);
function route() {
  if (location.hash === "#/history") return viewHistory();
  if (location.hash.startsWith("#/saved/")) return viewSaved(+location.hash.split("/")[2]);
  if (!S) S = fresh();
  render();
}
function render() { ({ 1: viewUpload, 2: viewReview, 3: viewDone })[S.step](); window.scrollTo(0, 0); }

function stepper(n) {
  const items = ["Cargar archivos", "Revisar el cruce", "Descargar"], out = [];
  items.forEach((t, i) => { if (i) out.push(h("span", { class: "bar" })); out.push(h("div", { class: "step" + (n === i + 1 ? " on" : n > i + 1 ? " done" : "") }, h("i", {}, n > i + 1 ? "✓" : i + 1), t)); });
  return h("div", { class: "steps" }, out);
}
const hero = () => [h("h1", {}, "Cruce de orden de compra ", h("em", {}, "vs. Proveedor")),
  h("p", { class: "lead" }, "Carga la orden de compra de Polco y la confirmación de pedido del proveedor. La herramienta compara referencias, cantidades y valores, valida la lectura y genera el consolidado en Excel."),
  h("span", { class: "pill" }, "🔒 Los archivos se procesan en tu navegador y no se suben a ningún servidor.")];

// ---------- paso 1: cargar ----------
function dropzone(kind, title, sub, icon) {
  const input = h("input", { type: "file", accept: "application/pdf,.pdf" });
  const label = h("div", {}, h("div", {}, "Arrastra el archivo aquí o ", h("a", { href: "#", onclick: (e) => e.preventDefault() }, "búscalo en tu equipo")), h("div", { class: "muted" }, "PDF · máx. 15 MB"));
  const box = h("div", { class: "drop" + (S.files[kind] ? " has" : ""), tabindex: "0", role: "button" }, h("div", { class: "up" }, svg(ICON.up)), label, input);
  const show = () => { if (S.files[kind]) { box.classList.add("has"); label.replaceChildren(h("div", { class: "fname" }, "✓ " + S.files[kind].name), h("div", { class: "muted" }, (S.files[kind].size / 1024).toFixed(0) + " KB · clic para cambiar")); } };
  const set = (f) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") return toast("Solo se aceptan archivos PDF.");
    if (f.size > MAX_BYTES) return toast("El archivo supera 15 MB.");
    S.files[kind] = f; show(); box.dispatchEvent(new CustomEvent("picked", { bubbles: true }));
  };
  box.addEventListener("click", () => input.click());
  box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("change", () => set(input.files[0]));
  box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("over"); });
  box.addEventListener("dragleave", () => box.classList.remove("over"));
  box.addEventListener("drop", (e) => { e.preventDefault(); box.classList.remove("over"); set(e.dataTransfer.files[0]); });
  show();
  return h("div", { class: "card" }, h("div", { class: "cardhead" }, h("div", { class: "ico" }, svg(ICON[icon])), h("div", {}, h("h2", { style: null }, title), h("div", { class: "muted" }, sub))), box);
}

function viewUpload() {
  const btn = h("button", { class: "primary", disabled: true }, svg(ICON.check), "Generar cruce");
  const err = h("div", { class: "err", role: "alert" }, S.error);
  const note = h("p", {}, "Carga los dos archivos para continuar. Puedes arrastrar uno en cada recuadro.");
  const po = dropzone("po", "Orden de compra · Polco", "PDF generado por el ERP (Referencia, Descripción, Cantidad, Valor total).", "doc");
  const sp = dropzone("sup", "Confirmación del proveedor", "PDF de confirmación de pedido (Order Confirmation / Acknowledgement).", "truck");
  const grid = h("div", { class: "grid2" }, po, sp);
  const upd = () => { btn.disabled = !(S.files.po && S.files.sup) || S.busy; };
  grid.addEventListener("picked", upd);
  btn.addEventListener("click", async () => {
    S.busy = true; S.error = ""; err.textContent = ""; btn.disabled = true; btn.replaceChildren(h("span", { class: "spin" }), " Leyendo documentos…");
    try { await generate(); S.step = 2; S.tab = "cruce"; S.filter = "diff"; render(); }
    catch (e) { S.error = e instanceof ExtractionError ? e.message : "Error inesperado: " + (e?.message || e); err.textContent = S.error; btn.replaceChildren(svg(ICON.check), "Generar cruce"); }
    finally { S.busy = false; upd(); }
  });
  $app.replaceChildren(...hero(), stepper(1), grid, h("div", { class: "cta" }, btn, err, note));
  upd();
}

async function readDoc(file, kind) {
  const data = await file.arrayBuffer();
  const head = new Uint8Array(data.slice(0, 5)); if (String.fromCharCode(...head) !== "%PDF-") throw new ExtractionError(`«${file.name}» no es un PDF válido.`);
  const hash = await sha256(data);
  let doc;
  try {
    const { lines, pages } = await readPdfLines(pdfjs, data);
    doc = parseDocument(lines, pages, kind);
  } catch (e) {
    if (!(e instanceof ExtractionError) || kind === "po") throw e;        // OC no reconocida: se rechaza; proveedor desconocido: revisión manual
    doc = { kind, parser: "manual", supplierName: "", number: "", relatedPo: "", date: "", currency: "", declaredTotal: null, documentTotal: null, extraCharges: [], lines: [], unparsed: [], pages: 0, extractionError: e.message };
  }
  doc.lines.forEach(l => { l.id = nextId++; });
  Object.assign(doc, { fileName: file.name, sha256: hash });
  return doc;
}
async function generate() { const [po, sup] = await Promise.all([readDoc(S.files.po, "po"), readDoc(S.files.sup, "supplier")]); S.po = po; S.sup = sup; }

// ---------- vista de resultados (a partir del JSON de salida) ----------
const stat = (label, n, cls, sub) => h("div", { class: "stat " + (cls || "") }, h("div", { class: "n" }, n), h("div", { class: "l" }, label), sub ? h("div", { class: "s" }, sub) : null);
const issuesList = (list) => list.length ? h("ul", { class: "issues" }, list.map(i => h("li", { class: i.severity }, h("b", {}, SEV[i.severity]), h("span", {}, i.message)))) : h("p", { class: "muted" }, "Sin observaciones.");

function statsBlock(o) {
  const s = o.statistics, cur = o.purchase_order.currency || o.supplier_confirmation.currency;
  return h("div", { class: "stats" },
    stat("Referencias leídas · OC", s.po_unique_references, "", `${s.po_lines} líneas` + (s.po_aggregated_references ? ` · ${s.po_aggregated_references} repetidas, sumadas` : "")),
    stat("Referencias leídas · Proveedor", s.supplier_unique_references, "", `${s.supplier_lines} líneas` + (s.supplier_aggregated_references ? ` · ${s.supplier_aggregated_references} sumadas` : "")),
    stat("Coinciden", s.matched, "ok"),
    stat("Con diferencias", s.with_differences, s.with_differences ? "warn" : "", `${s.quantity_differences} en cantidad · ${s.value_differences} en valor`),
    stat("Solo en OC", s.only_in_po, s.only_in_po ? "bad" : "", s.only_in_po ? money(s.value_only_in_po) + " " + cur : null),
    stat("Solo en proveedor", s.only_in_supplier, s.only_in_supplier ? "bad" : "", s.only_in_supplier ? money(s.value_only_in_supplier) + " " + cur : null),
    stat("Total líneas OC", money(s.po_total), "", cur), stat("Total líneas proveedor", money(s.supplier_total), "", cur),
    stat("Diferencia (prov. − OC)", signed(s.total_difference, money), Math.abs(s.total_difference) > 0.005 ? "warn" : "ok", cur));
}

function resultTable(o, state) {
  const diffN = o.items.filter(i => i.status !== "match").length;
  if (state.filter === undefined) state.filter = diffN ? "diff" : "all";
  const F = [["diff", "Diferencias", i => i.status !== "match"], ["all", "Todas", () => true], ["match", "Coinciden", i => i.status === "match"], ["only_po", "Solo en OC", i => i.status === "only_po"], ["only_supplier", "Solo en proveedor", i => i.status === "only_supplier"]];
  const body = h("tbody"), tabs = h("div", { class: "tabs" });
  const paint = () => {
    tabs.replaceChildren(...F.map(([k, t, fn]) => h("button", { class: (state.filter === "diff" && !diffN ? "all" : state.filter) === k ? "on" : "", onclick: () => { state.filter = k; paint(); } }, `${t} (${o.items.filter(fn).length})`)));
    const eff = state.filter === "diff" && !diffN ? "all" : state.filter;        // sin diferencias: mostrar todas
    const items = o.items.filter(F.find(x => x[0] === eff)[2]);
    body.replaceChildren(...(items.length ? items.map(i => {
      const p = i.po, s = i.supplier, d = i.diff, side = p || s;
      const note = s?.notes?.length ? h("div", { class: "dpos" }, "⚠ " + s.notes.join("; ") + (s.delivery_dates.length ? ` (${s.delivery_dates.join(", ")})` : "")) : null;
      return h("tr", {}, h("td", {}, h("span", { class: "chip " + i.status }, STATUS[i.status])),
        h("td", { class: "mono nowrap", title: i.po_reference ? `En la OC: ${i.po_reference} (marca ${i.brand})` : "" }, i.reference, i.suggestion ? h("div", { class: "muted" }, "¿" + i.suggestion + "?") : null),
        h("td", {}, side.description, p?.aggregated_lines > 1 ? h("span", { class: "badge" }, `Σ ${p.aggregated_lines} líneas OC`) : null, s?.aggregated_lines > 1 ? h("span", { class: "badge" }, `Σ ${s.aggregated_lines} líneas prov.`) : null, note),
        h("td", { class: "num" }, p ? fmtQty(p.quantity) : "—"), h("td", { class: "num" }, s ? fmtQty(s.quantity) : "—"),
        h("td", { class: "num" }, d && d.quantity ? h("span", { class: "dneg" }, signed(d.quantity, fmtQty)) : d ? "" : "—"),
        h("td", { class: "num" }, money(p?.total)), h("td", { class: "num" }, money(s?.total)),
        h("td", { class: "num" }, d && Math.abs(d.total) > 0.005 ? h("span", { class: "dneg" }, signed(d.total, money)) : d ? "" : "—"));
    }) : [h("tr", {}, h("td", { colspan: 9, class: "muted center" }, "Nada para mostrar con este filtro."))]));
  };
  paint();
  return h("div", {}, h("h2", {}, "Resultado por referencia"), tabs,
    h("div", { class: "tw" }, h("table", {}, h("thead", {}, h("tr", {}, ["Estado", "Referencia", "Descripción", "Cant. OC", "Cant. Prov.", "Δ Cant.", "Total OC", "Total Prov.", "Δ Valor"].map((t, i) => h("th", { class: i > 2 ? "num" : "" }, t)))), body)));
}

// ---------- paso 2: revisión ----------
function snapshot() {
  const pi = validateDocument(S.po), si = validateDocument(S.sup), cross = crossChecks(S.po, S.sup);
  const all = [...pi, ...si, ...cross];
  return { pi, si, cross, errors: all.filter(i => i.severity === "error").length, warnings: all.filter(i => i.severity === "warning").length, output: buildOutput({ po: S.po, sup: S.sup }) };
}
const pdfLink = (file, label) => h("button", { class: "sm", onclick: () => window.open(URL.createObjectURL(file), "_blank", "noopener") }, label);

function viewReview() {
  const sn = snapshot(), o = sn.output, needs = sn.errors + sn.warnings > 0;
  const head = h("div", { class: "row between" }, h("div", {}, h("h2", {}, `Revisar el cruce · ${S.po.number || "OC"}`),
    h("div", { class: "muted" }, `${S.sup.supplierName || S.po.supplierName || "Proveedor"} · confirmación ${S.sup.number || "—"}`)),
    h("div", { class: "pdfbtns" }, pdfLink(S.files.po, "Ver PDF OC"), pdfLink(S.files.sup, "Ver PDF proveedor")));
  const banner = h("div", { class: "banner " + (sn.errors ? "bad" : needs ? "warn" : "ok") },
    h("span", {}, sn.errors ? `${sn.errors} error(es) de lectura: corrígelos para poder confirmar.` : needs ? `Marcado para revisión humana: ${sn.warnings} aviso(s). Revísalos y corrige si hace falta.` : "La lectura pasó todas las validaciones. Puedes confirmar el cruce."));
  const TABS = [["cruce", "Resultado del cruce"], ["po", `Orden de compra (${S.po.lines.length})`], ["sup", `Proveedor (${S.sup.lines.length})`]];
  const tabs = h("div", { class: "tabs" }, TABS.map(([k, t]) => h("button", { class: S.tab === k ? "on" : "", onclick: () => { S.tab = k; viewReview(); } }, t)));
  let body;
  if (S.tab === "cruce") {
    body = [statsBlock(o), sn.cross.length ? h("div", { class: "card" }, h("h3", {}, "Verificaciones entre documentos"), issuesList(sn.cross)) : null, resultTable(o, S),
      h("div", { class: "card", style: null }, h("div", { class: "grid2" }, h("div", {}, h("h3", {}, "Validación · Orden de compra"), issuesList(sn.pi)), h("div", {}, h("h3", {}, "Validación · Proveedor"), issuesList(sn.si))))];
  } else body = editor(S.tab === "po" ? S.po : S.sup, S.tab === "po" ? sn.pi : sn.si);

  const ack = h("input", { type: "checkbox", id: "ack", checked: S.ack }), notes = h("input", { type: "text", placeholder: "Notas (opcional)", maxlength: 500, value: S.notes, class: "grow" });
  const keep = h("input", { type: "checkbox", id: "keep", checked: S.keepPdfs });
  const btn = h("button", { class: "primary", disabled: sn.errors > 0 || (sn.warnings > 0 && !S.ack) }, "Confirmar cruce");
  ack.addEventListener("change", () => { S.ack = ack.checked; btn.disabled = sn.errors > 0 || (sn.warnings > 0 && !ack.checked); });
  notes.addEventListener("input", () => { S.notes = notes.value; }); keep.addEventListener("change", () => { S.keepPdfs = keep.checked; });
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const out = buildOutput({ po: S.po, sup: S.sup, status: "confirmed", confirmedAt: new Date().toISOString(), notes: S.notes });
      const pdfs = S.keepPdfs ? [{ kind: "po", name: S.files.po.name, blob: S.files.po }, { kind: "supplier", name: S.files.sup.name, blob: S.files.sup }] : [];
      S.savedId = await store.saveCruce(out, pdfs).catch(() => { toast("No se pudo guardar en el histórico del navegador (¿modo privado?). Descargue el Excel/JSON igualmente."); return null; });
      S.output = out; S.step = 3; render();
    } catch (e) { toast("No se pudo confirmar: " + e.message); btn.disabled = false; }
  });
  $app.replaceChildren(stepper(2), h("div", { class: "card" }, head), banner, tabs, ...[body].flat().filter(Boolean),
    h("div", { class: "sticky" }, h("div", { class: "row" }, h("button", { onclick: () => { S.step = 1; render(); } }, "← Cambiar archivos"),
      sn.warnings && !sn.errors ? h("label", { class: "row" }, ack, "Revisé los avisos y los acepto") : null, notes,
      h("label", { class: "row muted", title: "Si no se marca, solo se guardan los datos extraídos, no los PDF." }, keep, "Guardar copia de los PDF en este navegador"), btn)));
}

// editor de líneas (corrección manual de lo mal leído)
function editor(doc, issues) {
  const sev = {}; for (const i of issues) if (i.lineId) { if (!sev[i.lineId] || i.severity === "error") sev[i.lineId] = i.severity; }
  const apply = (l, f) => {
    const q = f.qty.value.trim() === "" ? null : parseUserNumber(f.qty.value), u = f.unit.value.trim() === "" ? null : parseUserNumber(f.unit.value), t = f.tot.value.trim() === "" ? null : parseUserNumber(f.tot.value);
    if ([q, u, t].some(Number.isNaN)) return toast("Hay un valor numérico inválido. Use números, p. ej. 1934,40 o 1934.40.");
    l.original ||= { reference: l.reference, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, total: l.total };
    Object.assign(l, { reference: f.ref.value.trim(), description: f.desc.value.trim(), quantity: q, unitPrice: centsOf(u), total: centsOf(t), edited: true });
    viewReview();
  };
  const rowFor = (l) => {
    let cur = null; const mount = (tr) => { cur ? cur.replaceWith(tr) : 0; cur = tr; return tr; };
    const view = () => h("tr", { class: (sev[l.id] === "error" ? "rowerr" : sev[l.id] === "warning" ? "rowwarn" : "") + (l.edited ? " edited" : "") },
      h("td", { class: "muted" }, l.lineNo), h("td", { class: "mono" }, l.reference || "—", h("span", { class: "raw" }, l.raw)),
      h("td", {}, l.description || "—", l.edited ? h("span", { class: "badge", title: l.original ? `Original: ${l.original.reference} · ${l.original.quantity} · ${fmtMoney(l.original.total)}` : "Agregada" }, "editada") : null),
      h("td", { class: "num" }, fmtQty(l.quantity)), h("td", { class: "num" }, fmtMoney(l.unitPrice)), h("td", { class: "num" }, fmtMoney(l.total)),
      h("td", { class: "nowrap" }, h("button", { class: "sm", onclick: () => mount(edit()) }, "Editar"), " ",
        h("button", { class: "sm danger", "aria-label": "Eliminar línea", onclick: () => { if (confirm(`¿Eliminar la línea ${l.lineNo}?`)) { doc.lines = doc.lines.filter(x => x !== l); renumber(doc); viewReview(); } } }, "✕")));
    const edit = () => {
      const inp = (v, label) => h("input", { type: "text", value: v ?? "", "aria-label": label, inputmode: "decimal" });
      const f = { ref: inp(l.reference, "Referencia"), desc: inp(l.description, "Descripción"), qty: inp(l.quantity, "Cantidad"), unit: inp(l.unitPrice == null ? "" : (l.unitPrice / 100).toFixed(2), "Precio unitario"), tot: inp(l.total == null ? "" : (l.total / 100).toFixed(2), "Valor total") };
      setTimeout(() => f.ref.focus());
      return h("tr", { class: "edited" }, h("td", { class: "muted" }, l.lineNo), h("td", {}, f.ref, h("span", { class: "raw" }, l.raw)), h("td", {}, f.desc), h("td", {}, f.qty), h("td", {}, f.unit), h("td", {}, f.tot),
        h("td", { class: "nowrap" }, h("button", { class: "sm primary", onclick: () => apply(l, f) }, "Guardar"), " ", h("button", { class: "sm", onclick: () => mount(view()) }, "Cancelar")));
    };
    return mount(view());
  };
  const tbody = h("tbody", {}, doc.lines.map(rowFor));
  const a = { ref: h("input", { type: "text", placeholder: doc.kind === "po" ? "Ref. con marca (ME123456)" : "Referencia" }), desc: h("input", { type: "text", placeholder: "Descripción" }), qty: h("input", { type: "text", placeholder: "Cant." }), unit: h("input", { type: "text", placeholder: "Precio u." }), tot: h("input", { type: "text", placeholder: "Valor total" }) };
  tbody.append(h("tr", {}, h("td", {}, "+"), h("td", {}, a.ref), h("td", {}, a.desc), h("td", {}, a.qty), h("td", {}, a.unit), h("td", {}, a.tot),
    h("td", {}, h("button", { class: "sm", onclick: () => {
      const q = parseUserNumber(a.qty.value), u = parseUserNumber(a.unit.value), t = parseUserNumber(a.tot.value);
      if ([q, u, t].some(Number.isNaN)) return toast("Hay un valor numérico inválido.");
      doc.lines.push({ id: nextId++, lineNo: doc.lines.length + 1, reference: a.ref.value.trim(), description: a.desc.value.trim(), quantity: q, unitPrice: centsOf(u), total: centsOf(t), discountPct: null, discountAmount: null, deliveryDate: "", note: "", raw: "(agregada manualmente)", page: 0, edited: true });
      viewReview();
    } }, "Agregar"))));
  const declared = h("input", { type: "text", value: doc.declaredTotal == null ? "" : (doc.declaredTotal / 100).toFixed(2), "aria-label": "Total declarado" });
  const sum = doc.lines.reduce((x, l) => x + (l.total || 0), 0), general = issues.filter(i => !i.lineId), byLine = issues.filter(i => i.lineId);
  return h("div", {}, h("div", { class: "card" }, h("div", { class: "row between" }, h("h2", {}, (doc.kind === "po" ? "Orden de compra" : "Confirmación del proveedor") + " · " + (doc.number || doc.fileName)),
    h("div", { class: "row" }, h("span", { class: "muted" }, `Suma de líneas: ${fmtMoney(sum)} · Total declarado en el PDF:`), declared,
      h("button", { class: "sm", onclick: () => { const v = declared.value.trim() === "" ? null : parseUserNumber(declared.value); if (Number.isNaN(v)) return toast("Valor inválido."); doc.declaredTotal = centsOf(v); viewReview(); } }, "Actualizar"))),
    h("p", { class: "muted" }, "Compara cada línea con el PDF original («Ver PDF»). Las líneas con error o aviso están resaltadas; corrige la lectura y guarda. El cruce se recalcula al instante."),
    general.length ? issuesList(general) : null),
    h("div", { class: "tw" }, h("table", {}, h("thead", {}, h("tr", {}, ["#", "Referencia", "Descripción", "Cantidad", "Precio unit.", "Valor total", ""].map((t, i) => h("th", { class: [3, 4, 5].includes(i) ? "num" : "" }, t)))), tbody)),
    byLine.length ? h("div", { class: "card", style: null }, h("h3", {}, "Observaciones por línea"), issuesList(byLine)) : null);
}
const renumber = (doc) => doc.lines.forEach((l, i) => { l.lineNo = i + 1; });

// ---------- paso 3: descargar ----------
async function downloadExcel(out) { const wb = buildWorkbook(window.ExcelJS, out); download(new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `cruce_${safe(out.purchase_order.number)}.xlsx`); }
const downloadJson = (out) => download(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }), `cruce_${safe(out.purchase_order.number)}.json`);

function viewDone() {
  const o = S.output, s = o.statistics;
  $app.replaceChildren(stepper(3), h("div", { class: "card done" }, h("div", { class: "big" }, "✓"), h("h2", {}, "Cruce confirmado"),
    h("p", { class: "muted" }, `${o.purchase_order.number} · ${o.supplier_confirmation.supplier_name || o.purchase_order.supplier_name} · ${s.matched} coinciden, ${s.with_differences} con diferencias, ${s.only_in_po + s.only_in_supplier} sin pareja.`),
    S.savedId ? h("p", { class: "muted" }, "Guardado en el histórico de este navegador.") : null,
    h("div", { class: "row" }, h("button", { class: "primary", onclick: () => downloadExcel(o).catch(e => toast(e.message)) }, "Descargar Excel"), h("button", { onclick: () => downloadJson(o) }, "Descargar JSON"),
      h("button", { onclick: () => { S = fresh(); render(); } }, "Nuevo cruce"), h("button", { class: "ghost", onclick: () => { location.hash = "#/history"; } }, "Ver histórico"))),
    statsBlock(o), resultTable(o, S));
}

// ---------- histórico (IndexedDB local) ----------
async function viewHistory() {
  const q = h("input", { type: "search", placeholder: "Buscar por nº de OC o proveedor…", class: "grow" });
  const body = h("tbody"), file = h("input", { type: "file", accept: "application/json,.json", hidden: true });
  const load = async () => {
    let rows; try { rows = await store.listCruces(); } catch { rows = []; toast("El navegador no permite guardar datos locales (¿modo privado?)."); }
    const t = q.value.trim().toLowerCase(); rows = rows.filter(r => !t || `${r.po_number} ${r.supplier} ${r.sup_number}`.toLowerCase().includes(t));
    body.replaceChildren(...(rows.length ? rows.map(r => h("tr", { class: "click", tabindex: "0", onclick: () => { location.hash = `#/saved/${r.id}`; } },
      h("td", {}, "#" + r.id), h("td", { class: "nowrap" }, dt(r.created_at)), h("td", {}, r.po_number || "—"), h("td", {}, r.supplier || "—"),
      h("td", { class: "num" }, `${r.stats.po_unique_references} / ${r.stats.supplier_unique_references}`), h("td", { class: "num" }, r.stats.with_differences),
      h("td", { class: "num" }, `${r.stats.only_in_po} / ${r.stats.only_in_supplier}`), h("td", { class: "num" }, Math.abs(r.stats.total_difference) > 0.005 ? h("span", { class: "dpos" }, signed(r.stats.total_difference, money)) : "0,00"),
      h("td", {}, r.needs_review ? h("span", { class: "chip warning" }, "revisado") : h("span", { class: "chip ok" }, "limpio"), r.edited ? h("span", { class: "badge" }, `${r.edited} corr.`) : null))) : [h("tr", {}, h("td", { colspan: 9, class: "muted center" }, "Aún no hay cruces guardados en este navegador."))]));
  };
  q.addEventListener("input", load);
  file.addEventListener("change", async () => { try { const n = await store.importBackup(JSON.parse(await file.files[0].text())); toast(`${n} cruce(s) importado(s).`); load(); } catch (e) { toast(e.message); } });
  $app.replaceChildren(h("div", { class: "row between" }, h("div", {}, h("h1", {}, "Histórico de cruces"),
    h("p", { class: "lead" }, "Se guarda solo en este navegador y equipo. Exporta un respaldo para conservarlo o llevarlo a otro equipo.")),
    h("div", { class: "row" }, h("button", { onclick: () => { location.hash = "#/"; } }, "← Nuevo cruce"),
      h("button", { onclick: async () => download(new Blob([JSON.stringify(await store.exportBackup(), null, 2)], { type: "application/json" }), `respaldo_cruces_${new Date().toISOString().slice(0, 10)}.json`) }, "Exportar respaldo"),
      h("button", { onclick: () => file.click() }, "Importar respaldo"), file)),
    h("div", { class: "row" }, q), h("p", {}),
    h("div", { class: "tw" }, h("table", {}, h("thead", {}, h("tr", {}, ["#", "Fecha", "Orden de compra", "Proveedor", "Refs OC / Prov.", "Con diferencias", "Solo OC / Solo Prov.", "Dif. total", "Lectura"].map((t, i) => h("th", { class: [4, 5, 6, 7].includes(i) ? "num" : "" }, t)))), body)));
  load();
}

async function viewSaved(id) {
  const rec = await store.getCruce(id).catch(() => null);
  if (!rec) { toast("Cruce no encontrado."); location.hash = "#/history"; return; }
  const o = rec.output, pdfs = await store.getPdfs(id).catch(() => []), st = { filter: undefined };
  const pdfBtn = (p) => h("button", { class: "sm", onclick: () => window.open(URL.createObjectURL(p.blob), "_blank", "noopener") }, "Ver PDF " + (p.kind === "po" ? "OC" : "proveedor"));
  $app.replaceChildren(h("div", { class: "row between" }, h("div", {}, h("h1", {}, `Cruce #${id} · ${o.purchase_order.number}`),
    h("p", { class: "lead" }, `${o.supplier_confirmation.supplier_name || ""} · confirmación ${o.supplier_confirmation.number} · confirmado ${dt(o.confirmed_at)}`)),
    h("div", { class: "row" }, h("button", { onclick: () => { location.hash = "#/history"; } }, "← Histórico"), pdfs.map(pdfBtn),
      h("button", { class: "primary", onclick: () => downloadExcel(o).catch(e => toast(e.message)) }, "Excel"), h("button", { onclick: () => downloadJson(o) }, "JSON"),
      h("button", { class: "danger", onclick: async () => { if (confirm("¿Eliminar este cruce del histórico de este navegador?")) { await store.deleteCruce(id); location.hash = "#/history"; } } }, "Eliminar"))),
    o.notes ? h("div", { class: "card" }, h("h3", {}, "Notas de confirmación"), o.notes) : null, statsBlock(o), resultTable(o, st),
    h("p", {}), h("div", { class: "card" }, h("div", { class: "grid2" }, h("div", {}, h("h3", {}, "Validación · Orden de compra"), issuesList(o.purchase_order.issues)), h("div", {}, h("h3", {}, "Validación · Proveedor"), issuesList([...o.supplier_confirmation.issues, ...o.cross_checks])))));
}

route();
