// Parsers por formato de documento. Para soportar un proveedor nuevo: añadir un objeto
// { id, name, matches(lines), parse(lines, pages) } a SUPPLIER_PARSERS.
import { ExtractionError } from "./pdftext.js";
import { toCents, toQty } from "./num.js";

const PAGE = /^\f@@PAGE(\d+)$/;
const newDoc = (kind, parser, extra = {}) => ({
  kind, parser, supplierName: "", number: "", relatedPo: "", date: "", currency: "",
  declaredTotal: null, documentTotal: null, extraCharges: [], lines: [], unparsed: [], pages: 0, ...extra,
});
const line = (o) => ({ id: 0, lineNo: 0, reference: "", description: "", quantity: null, unitPrice: null,
  discountPct: null, discountAmount: null, total: null, deliveryDate: "", note: "", raw: "", page: 1, edited: false, ...o });

// ---------- Orden de compra Polco (ERP) ----------
const PO_LINE = /^(\S+)\s+(.*?)\s+([A-Za-z]{2,4})\s+([\d.]*\d,\d+)\s+([A-Z]{3})([\d.]*\d,\d+)\s+[A-Z]{3}([\d.]*\d,\d+)\s+[A-Z]{3}([\d.]*\d,\d+)$/;
const PO_SKIP = /^(POLCO|NIT:|CR \d|Tel:|Medell|No\. COC|Proveedor|Direcci|Ciudad|Tel[eé]fono|Comprador|Notas|Totales|Elaborado|spelaez|ORIGINAL|REIMPRESO|P[aá]gina|\d+$)/i;
export const poPolco = {
  id: "polco_oc", name: "Orden de compra Polco",
  matches: (L) => { const h = L.slice(0, 40).join("\n").toUpperCase(); return h.includes("ORDEN DE COMPRA") && h.includes("POLCO"); },
  parse(L, pages) {
    if (!this.matches(L)) throw new ExtractionError("El archivo no parece una Orden de Compra de Polco (no se encontró «ORDEN DE COMPRA»).");
    const d = newDoc("po", this.id, { pages });
    let page = 1, inTable = false, n = 0, m;
    for (const raw of L) {
      if ((m = raw.match(PAGE))) { page = +m[1] + 1; inTable = false; continue; }
      const s = raw.trim(); if (!s) continue;
      if (!d.number && (m = s.match(/No\.\s*(COC-\d+)/))) d.number = m[1];
      if (!d.supplierName && (m = s.match(/^Proveedor:\s*(.+?)(\s+Fecha:|$)/))) d.supplierName = m[1].trim();
      if (!d.date && (m = s.match(/Fecha:\s*(?:Fecha:\s*)?(\d{2}\/\d{2}\/\d{4})/))) d.date = m[1];
      if (/^Referencia\s+Descripci/i.test(s)) { inTable = true; continue; }
      if ((m = s.match(/^(Total bruto|Subtotal|Total)\s+([A-Z]{3})([\d.]*\d,\d+)$/))) {
        const v = toCents(m[3], ","); d.currency ||= m[2];
        if (m[1] === "Total bruto") d.declaredTotal = v; else if (m[1] === "Total") d.documentTotal = v;
        inTable = false; continue;
      }
      if (!inTable) continue;
      if ((m = s.match(PO_LINE))) {
        d.currency ||= m[5];
        d.lines.push(line({ lineNo: ++n, reference: m[1], description: m[2].trim(), quantity: toQty(m[4], ","),
          unitPrice: toCents(m[6], ","), discountAmount: toCents(m[7], ","), total: toCents(m[8], ","), raw: s, page }));
      } else if (!PO_SKIP.test(s)) d.unparsed.push({ page, text: s });
    }
    if (d.declaredTotal == null) d.declaredTotal = d.documentTotal;
    return d;
  },
};

// ---------- Metrohm AG: "Order Confirmation" (números 1,934.40; total ya con descuento) ----------
const MNUM = "-?[\\d,]*\\d\\.\\d{2}";
const MET_LINE = new RegExp(`^(\\d\\S*)\\s+(${MNUM})\\s*([A-Za-z]+)\\s+(${MNUM})(?:\\s+(-?[\\d.]+)%)?\\s+(${MNUM})$`);
const MET_SKIP = /^(Order Confirmation|Date\s|Item No|Description|CHF|Page\s|Metrohm AG|Ionenstrasse|9100|Switzerland|Phone|E-mail|Web|Vat-No|Polco|Carrera|050022|Colombia|Customer No|Our reference|Extension|Purch)/i;
export const metrohm = {
  id: "metrohm", name: "Metrohm AG",
  matches: (L) => { const h = L.slice(0, 30).join("\n"); return h.includes("Metrohm AG") && h.includes("Order Confirmation"); },
  parse(L, pages) {
    const d = newDoc("supplier", this.id, { supplierName: "Metrohm AG", currency: "CHF", pages });
    let page = 1, cur = null, n = 0, done = false, m;
    for (const raw of L) {
      if ((m = raw.match(PAGE))) { page = +m[1] + 1; continue; }
      const s = raw.trim(); if (!s) continue;
      if (!d.number && (m = s.match(/^Order Confirmation\s+(\S+)/))) d.number = m[1];
      if ((m = s.match(/Your purch\. order\s+(.+?)\s*$/))) d.relatedPo = m[1].trim();
      if (!d.date && (m = s.match(/^Date\s+(\d{2}\.\d{2}\.\d{4})/))) d.date = m[1];
      if ((m = s.match(new RegExp(`^Goods value\\s+(${MNUM})$`)))) { d.declaredTotal = toCents(m[1], "."); done = true; cur = null; continue; }
      if ((m = s.match(new RegExp(`^(Packing charges.*?|Freight.*?|Shipping charges.*?|Insurance.*?)\\s+(${MNUM})$`)))) { d.extraCharges.push({ label: m[1].trim(), amount: toCents(m[2], ".") }); continue; }
      if ((m = s.match(new RegExp(`^Order value\\s+(${MNUM})$`)))) { d.documentTotal = toCents(m[1], "."); continue; }
      if (done) continue;
      if ((m = s.match(MET_LINE))) {
        cur = line({ lineNo: ++n, reference: m[1], quantity: toQty(m[2], "."), unitPrice: toCents(m[4], "."),
          discountPct: m[5] ? Math.abs(parseFloat(m[5])) : null, total: toCents(m[6], "."), raw: s, page });
        d.lines.push(cur); continue;
      }
      if (cur) {
        if ((m = s.match(/^Delivery date change:\s*(.+)$/))) { cur.note = m[1].trim(); continue; }
        if ((m = s.match(/^Delivery date\s+(\d{2}\.\d{2}\.\d{4})/))) { cur.deliveryDate = m[1]; continue; }
        if (MET_SKIP.test(s)) continue;
        if (!cur.description) { cur.description = s; continue; }
      }
      if (!MET_SKIP.test(s) && /\d+\.\d{2}\s+-?\d+\.\d{2}%/.test(s)) d.unparsed.push({ page, text: s });
    }
    return d;
  },
};

// ---------- BÜCHI Labortechnik AG: "Order confirmation" ----------
const BNUM = "[\\d,]*\\d\\.\\d{2}";
const BU_LINE = new RegExp(`^(\\d+)\\s+([\\d,]*\\d\\.\\d+)\\s*([A-Za-z]+)\\s+(\\S+)\\s+(${BNUM})\\s+(${BNUM})$`);
export const buchi = {
  id: "buchi", name: "BÜCHI Labortechnik AG",
  matches: (L) => { const h = L.slice(0, 30).join("\n").toUpperCase(); return (h.includes("BÜCHI") || h.includes("BUCHI")) && h.includes("ORDER CONFIRMATION"); },
  parse(L, pages) {
    const d = newDoc("supplier", this.id, { supplierName: "BÜCHI Labortechnik AG", currency: "CHF", pages });
    let page = 1, cur = null, n = 0, descOpen = false, totalNext = false, m;
    for (const raw of L) {
      if ((m = raw.match(PAGE))) { page = +m[1] + 1; cur = null; continue; }
      const s = raw.trim(); if (!s) continue;
      if ((m = s.match(/^Order confirmation\s+(\d{6,})\s+.*?(\d{4}-\d{2}-\d{2})/i))) { d.number = m[1]; d.date = m[2]; }
      if ((m = s.match(/^Cust Order\s*:\s*(\S+)/))) d.relatedPo = m[1];
      if (totalNext) { const nums = s.match(new RegExp(BNUM, "g")); if (nums) { d.declaredTotal = d.documentTotal = toCents(nums[0], "."); totalNext = false; } continue; }
      if (/^T\s*O\s*T\s*A\s*L\s+Net Amount/.test(s)) { totalNext = true; continue; }
      if ((m = s.match(BU_LINE))) {
        cur = line({ lineNo: ++n, reference: m[4], quantity: toQty(m[2], "."), unitPrice: toCents(m[5], "."), total: toCents(m[6], "."), raw: s, page });
        d.lines.push(cur); descOpen = true; continue;
      }
      if (/^(Carry Forward|Position\s+Quantity|Page\s+\d|Order confirmation)/.test(s)) continue;
      if (/^\d+\s+\d[\d.,]*\s*[A-Za-z]+\s+\S+\s+[\d.,]+/.test(s)) { d.unparsed.push({ page, text: s }); continue; }
      if (cur && descOpen) {
        if (s.startsWith("Country of Origin")) descOpen = false; else cur.description = (cur.description + " " + s).trim();
      }
    }
    return d;
  },
};


// ---------- ERWEKA GmbH: "Order confirmation" (EUR, números 1,234.50) ----------
const ENUM = "\\d[\\d,]*\\.\\d{2}";
const ER_LINE = new RegExp(`^(?:(\\d{1,3})\\s+)?(\\S+)\\s+(\\d[\\d,]*(?:\\.\\d+)?)\\s+(${ENUM})\\s+(${ENUM})$`);
export const erweka = {
  id: "erweka", name: "ERWEKA GmbH",
  matches: (L) => { const h = L.slice(0, 30).join("\n"); return /ERWEKA GmbH/i.test(h) && /Order confirmation/i.test(h); },
  parse(L, pages) {
    const d = newDoc("supplier", this.id, { supplierName: "ERWEKA GmbH", pages });
    let page = 1, inTable = false, cur = null, n = 0, dispatch = "", m;
    for (const raw of L) {
      if ((m = raw.match(PAGE))) { page = +m[1] + 1; continue; }
      const s = raw.trim(); if (!s) continue;
      if (!d.number && (m = s.match(/^Order confirmation\s+(\d+)/i))) d.number = m[1];
      if (!d.date && (m = s.match(/^Date\s+(\d{2}\/\d{2}\/\d{4})/))) d.date = m[1];
      if ((m = s.match(/Purchase order number\s+(\S+)/i))) d.relatedPo = m[1];
      if ((m = s.match(/^Ready for dispatch:\s*(\d{2}\/\d{2}\/\d{4})/i))) { dispatch = m[1]; d.lines.forEach(l => { l.deliveryDate = dispatch; }); continue; }
      if (/^Item\s+Article\s+Qty\s+Unit price/i.test(s)) { inTable = true; continue; }
      if (!inTable) continue;
      if ((m = s.match(/^([A-Z]{3})\s+\1$/))) { d.currency = m[1]; continue; }
      if ((m = s.match(new RegExp(`^Total\\s+(${ENUM})$`, "i")))) { d.declaredTotal = d.documentTotal = toCents(m[1], "."); inTable = false; cur = null; continue; }
      if ((m = s.match(ER_LINE))) {
        cur = line({ lineNo: ++n, reference: m[2], quantity: toQty(m[3], "."), unitPrice: toCents(m[4], "."), total: toCents(m[5], "."), raw: s, page, deliveryDate: dispatch });
        d.lines.push(cur); continue;
      }
      if (cur) { cur.description = (cur.description + " " + s).trim(); continue; }
      if (new RegExp(`${ENUM}\\s+${ENUM}$`).test(s)) d.unparsed.push({ page, text: s });
    }
    return d;
  },
};

// ---------- Elementar Analysensysteme GmbH: "Order" (bloques por ítem; números 1,234.50) ----------
const EL_MONEY = "-?\\d[\\d,]*\\.\\d{2}";
export const elementar = {
  id: "elementar", name: "Elementar Analysensysteme GmbH",
  matches: (L) => { const h = L.slice(0, 40).join("\n"); return /Elementar Analysensysteme/i.test(h) && /Reference Number/i.test(h); },
  parse(L, pages) {
    const d = newDoc("supplier", this.id, { supplierName: "Elementar Analysensysteme GmbH", pages });
    let page = 1, cur = null, n = 0, inCharges = false, done = false, m;
    for (const raw of L) {
      if ((m = raw.match(PAGE))) { page = +m[1] + 1; continue; }
      const s = raw.trim(); if (!s || done) continue;
      if (!d.number && (m = s.match(/^Number\s+(\d+)/))) d.number = m[1];
      if (!d.date && (m = s.match(/(?:^|\s)Date\s+([A-Z][a-z]{2} \d{1,2}, \d{4})/))) d.date = m[1];
      if ((m = s.match(/^Reference Number\s+(\S+)/))) d.relatedPo = m[1];
      if ((m = s.match(new RegExp(`^Sum of positions\\s+(${EL_MONEY})\\s+([A-Z]{3})$`)))) { d.declaredTotal = toCents(m[1], "."); d.currency = m[2]; cur = null; inCharges = true; continue; }
      if ((m = s.match(new RegExp(`^(Net Value|Final amount)\\s+(${EL_MONEY})\\s+[A-Z]{3}$`)))) { d.documentTotal = toCents(m[2], "."); inCharges = false; if (m[1] === "Final amount") done = true; continue; }
      if (inCharges && (m = s.match(new RegExp(`^(.+?)\\s+(${EL_MONEY})\\s+[A-Z]{3}$`)))) { d.extraCharges.push({ label: m[1].trim(), amount: toCents(m[2], ".") }); continue; }
      if ((m = s.match(/^(\d+)\s+Material:\s*(\S+)\s*(.*)$/))) {
        cur = line({ lineNo: ++n, reference: m[2], description: m[3].trim(), raw: s, page });
        d.lines.push(cur); continue;
      }
      if (!cur) continue;
      if ((m = s.match(/^Quantity:\s*([\d.,]+)\s*([A-Za-z]+)/))) { cur.quantity = toQty(m[1], "."); continue; }
      if ((m = s.match(new RegExp(`^Item Value\\s+(${EL_MONEY})\\s+([A-Z]{3})\\s+pro\\s+([\\d.,]+)\\s*[A-Za-z]*\\s+(${EL_MONEY})\\s+[A-Z]{3}$`)))) {
        d.currency ||= m[2]; cur.unitPrice = Math.round(toCents(m[1], ".") / (parseFloat(m[3]) || 1)); cur.total = toCents(m[4], "."); cur.raw += " | " + s; continue;
      }
      if (/^(HS Code|Price:)/.test(s)) continue;
      if (/^(Discount|Surcharge|Rebate|Freight|Condition)/i.test(s)) { d.unparsed.push({ page, text: s }); continue; }   // condición de precio no contemplada
      cur.description = (cur.description + " " + s).trim();
    }
    return d;
  },
};

// ---------- Stakpure: "Order confirmation" (números 1.234,50; "less 40,00 %" en línea aparte) ----------
const ST_LINE = /^(\d+)\s+(\S+)\s+(.*?)\s*(\d{2}\.\d{2}\.\d{4})\s+([\d.]*\d(?:,\d+)?)\s*([A-Za-z]+)\s+([\d.]*\d,\d{2})\s+([\d.]*\d,\d{2})$/;
export const stakpure = {
  id: "stakpure", name: "Stakpure GmbH",
  matches: (L) => { const h = L.slice(0, 30).join("\n"); return /stakpure/i.test(h) && /Order confirmation/i.test(h) && /Article no\./i.test(h); },
  parse(L, pages) {
    const d = newDoc("supplier", this.id, { supplierName: "Stakpure GmbH", pages });
    let page = 1, cur = null, n = 0, inTable = false, done = false, m;
    for (const raw of L) {
      if ((m = raw.match(PAGE))) { page = +m[1] + 1; continue; }
      const s = raw.trim(); if (!s || done) continue;
      if (!d.number && (m = s.match(/^Document number\s+(\S+)/))) d.number = m[1];
      if (!d.date && (m = s.match(/(?:^|\s)Date\s+(\d{2}\.\d{2}\.\d{4})$/))) d.date = m[1];
      if ((m = s.match(/Your receipt\s+(\S+)/))) d.relatedPo = m[1];
      if (/^Pos\.\s+Article no\./i.test(s)) { inTable = true; continue; }
      if ((m = s.match(/^Sub-total\s+([A-Z]{3})\s+([\d.]*\d,\d{2})$/))) { d.currency = m[1]; d.declaredTotal = toCents(m[2], ","); inTable = false; cur = null; continue; }
      if ((m = s.match(/^Total\s+([A-Z]{3})\s+([\d.]*\d,\d{2})$/))) { d.documentTotal = toCents(m[2], ","); done = true; continue; }
      if (!inTable) continue;
      let disc = s.match(/(?:^|\s)less\s+([\d.,]+)\s*%$/);
      let body = disc ? s.slice(0, disc.index).trim() : s;
      if (disc && cur) cur.discountPct = parseFloat(disc[1].replace(",", "."));
      if ((m = body.match(ST_LINE))) {
        cur = line({ lineNo: ++n, reference: m[2], description: m[3].trim(), quantity: toQty(m[5], ","), unitPrice: toCents(m[7], ","), total: toCents(m[8], ","), deliveryDate: m[4], raw: s, page });
        d.lines.push(cur); continue;
      }
      if (!cur || /^Weight:/i.test(body)) continue;
      if (body) cur.description = (cur.description + " " + body).trim();     // descripción que continúa en varias líneas
    }
    return d;
  },
};

export const SUPPLIER_PARSERS = [metrohm, buchi, erweka, elementar, stakpure];

export function parseDocument(lines, pages, kind) {
  if (kind === "po") {
    if (poPolco.matches(lines)) return poPolco.parse(lines, pages);
    const swapped = SUPPLIER_PARSERS.some(p => p.matches(lines));
    throw new ExtractionError(swapped
      ? "Este archivo parece una confirmación de proveedor, no una Orden de Compra. ¿Subió los archivos al revés?"
      : "El archivo no parece una Orden de Compra de Polco (no se encontró «ORDEN DE COMPRA»).");
  }
  for (const p of SUPPLIER_PARSERS) if (p.matches(lines)) return p.parse(lines, pages);
  if (poPolco.matches(lines)) throw new ExtractionError("Este archivo parece una Orden de Compra, no una confirmación de proveedor. ¿Subió los archivos al revés?");
  throw new ExtractionError("Formato de proveedor no reconocido. Soportados: " + SUPPLIER_PARSERS.map(p => p.name).join(", ") + ". Puede digitar las líneas manualmente.");
}
