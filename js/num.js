// Aritmética monetaria exacta: los valores se manejan en centavos (enteros) y las cantidades como
// números con hasta 4 decimales. Evita errores de coma flotante al sumar cientos de líneas.
export const toCents = (s, dec) => {
  if (s == null) return null;
  let t = String(s).replace(/[A-Za-z\s']/g, "");
  if (!t) return null;
  const thousands = dec === "," ? "." : ",";
  t = t.split(thousands).join("");
  if (dec === ",") t = t.replace(",", ".");
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
};
export const toQty = (s, dec) => {
  if (s == null) return null;
  let t = String(s).replace(/[A-Za-z\s']/g, "");
  t = t.split(dec === "," ? "." : ",").join("");
  if (dec === ",") t = t.replace(",", ".");
  const n = parseFloat(t);
  return Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : null;
};
// entrada de usuario (formulario): acepta "1.934,40", "1,934.40", "1934.40", "25,2"
export const parseUserNumber = (s) => {
  const raw = String(s ?? "").trim();
  let t = raw.replace(/[\sA-Za-z$€']/g, "");
  if (!raw) return null;
  if (!t) return NaN;                      // solo letras/símbolos: entrada inválida
  if (t.includes(",") && t.includes(".")) {
    t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (/^-?\d+,\d{1,2}$/.test(t)) t = t.replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
export const centsOf = (n) => (n == null ? null : Math.round(n * 100));
export const fmtMoney = (c, cur = "") => c == null ? "—" : (c / 100).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur ? " " + cur : "");
export const fmtQty = (q) => q == null ? "—" : q.toLocaleString("es-CO", { maximumFractionDigits: 4 });
export const signed = (v, f) => (v > 0 ? "+" : "") + f(v);
