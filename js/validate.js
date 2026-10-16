// Validación de la extracción. Opera sobre las líneas ya normalizadas, por lo que se vuelve a
// evaluar tras cada corrección manual.
//   error   -> bloquea la confirmación
//   warning -> marca el documento para revisión humana; exige aceptación explícita
//   info    -> solo informativo
import { fmtMoney } from "./num.js";

const TOL = 2;                       // centavos
const BRAND_RE = /^[A-Za-z]{2}\S+$/;
const iss = (severity, code, message, lineId = null) => ({ severity, code, message, lineId });

export function validateDocument(doc) {
  const out = [], L = doc.lines;
  if (!L.length) out.push(iss("error", "NO_LINES", "No se extrajo ninguna línea del documento."));
  if (doc.extractionError) out.unshift(iss("error", "EXTRACTION_FAILED", doc.extractionError));
  for (const l of L) {
    const tag = `Línea ${l.lineNo}`, ref = (l.reference || "").trim();
    if (!ref) out.push(iss("error", "MISSING_REFERENCE", `${tag}: falta la referencia.`, l.id));
    if (!(l.description || "").trim()) out.push(iss("error", "MISSING_DESCRIPTION", `${tag}: falta la descripción.`, l.id));
    if (l.quantity == null) out.push(iss("error", "MISSING_QUANTITY", `${tag}: falta la cantidad.`, l.id));
    else if (l.quantity <= 0) out.push(iss("error", "INVALID_QUANTITY", `${tag}: la cantidad debe ser mayor que cero.`, l.id));
    if (l.total == null) out.push(iss("error", "MISSING_TOTAL", `${tag}: falta el valor total.`, l.id));
    if (l.quantity != null && l.total != null && l.unitPrice != null) {
      let exp = l.quantity * l.unitPrice;
      if (l.discountPct) exp = exp * (100 - l.discountPct) / 100;
      if (l.discountAmount) exp -= l.discountAmount;
      if (Math.abs(exp - l.total) > Math.max(TOL, Math.abs(l.total) * 0.0005))
        out.push(iss("warning", "LINE_MATH", `${tag} (${ref}): cantidad × precio = ${fmtMoney(Math.round(exp))} pero el total es ${fmtMoney(l.total)}.`, l.id));
    }
    if (doc.kind === "po" && ref && !BRAND_RE.test(ref))
      out.push(iss("warning", "BRAND_PREFIX", `${tag}: la referencia «${ref}» debería iniciar con 2 letras de marca seguidas del código.`, l.id));
  }
  if (doc.kind === "po") {
    const brands = {};
    for (const l of L) if (BRAND_RE.test(l.reference || "")) { const b = l.reference.slice(0, 2).toUpperCase(); brands[b] = (brands[b] || 0) + 1; }
    if (Object.keys(brands).length > 1)
      out.push(iss("warning", "MIXED_BRANDS", "La orden contiene varias marcas (" + Object.entries(brands).map(([b, n]) => `${b}: ${n}`).join(", ") + ")."));
  }
  const cnt = {};
  for (const l of L) { const k = (l.reference || "").replace(/\s/g, "").toUpperCase(); if (k) cnt[k] = (cnt[k] || 0) + 1; }
  const dups = Object.keys(cnt).filter(k => cnt[k] > 1);
  if (dups.length) out.push(iss("info", "DUP_REFERENCE", `${dups.length} referencia(s) repetida(s) en el documento; se sumarán al cruzar: ${dups.slice(0, 8).join(", ")}`));
  // control más fuerte: suma de líneas vs total declarado en el PDF
  if (doc.declaredTotal != null && L.length) {
    const sum = L.reduce((a, l) => a + (l.total || 0), 0);
    if (Math.abs(sum - doc.declaredTotal) > TOL)
      out.push(iss("warning", "TOTAL_MISMATCH", `La suma de las líneas (${fmtMoney(sum)}) no coincide con el total declarado (${fmtMoney(doc.declaredTotal)}); diferencia ${fmtMoney(sum - doc.declaredTotal)}. Puede faltar una línea o haber un valor mal leído.`));
  } else if (doc.declaredTotal == null && L.length) {
    out.push(iss("warning", "NO_DECLARED_TOTAL", "No se pudo leer el total del documento para verificar la extracción."));
  }
  for (const u of doc.unparsed || []) out.push(iss("warning", "UNPARSED_TEXT", `Texto no interpretado (pág. ${u.page}): «${u.text}»`));
  return out;
}

export const summarize = (issues) => {
  const errors = issues.filter(i => i.severity === "error").length, warnings = issues.filter(i => i.severity === "warning").length;
  return { errors, warnings, needsReview: errors + warnings > 0 };
};

export const normPoNumber = (s) => {
  const m = String(s || "").match(/^\s*([A-Za-z]*)[\s-]*0*(\d+)\s*$/);
  return m ? m[1].toUpperCase() + m[2] : String(s || "").trim().toUpperCase();
};
