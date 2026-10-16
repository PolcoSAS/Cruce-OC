import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { load, fx } from "./helpers.mjs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readPdfLines, ExtractionError } from "../js/pdftext.js";
import { parseDocument } from "../js/parsers.js";
import { compare, aggregate } from "../js/match.js";
import { validateDocument, summarize, normPoNumber } from "../js/validate.js";
import { buildOutput } from "../js/output.js";
import { parseUserNumber, toCents } from "../js/num.js";

// Los PDF de ejemplo son documentos comerciales reales: no se versionan. Sin ellos, esas pruebas se omiten.
const HAS = existsSync(new URL("./fixtures/po_888_metrohm.pdf", import.meta.url)) && existsSync(new URL("./fixtures/sup_buchi.pdf", import.meta.url));
const SKIP = HAS ? false : "faltan los PDF de ejemplo en tests/fixtures/";
const schema = JSON.parse(readFileSync(new URL("../schema/cruce-1.0.schema.json", import.meta.url)));
const validateSchema = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
const PAIRS = { metrohm: ["po_888_metrohm.pdf", "sup_metrohm.pdf", 59, 55, 8956980], buchi: ["po_904_buchi.pdf", "sup_buchi.pdf", 18, 18, 66954] };

for (const [name, [po, sup, nPo, nSup, total]] of Object.entries(PAIRS)) {
  test(`${name}: extracción completa y totales cuadran`, { skip: SKIP }, async () => {
    const P = await load(po, "po"), S = await load(sup, "supplier");
    assert.equal(P.lines.length, nPo); assert.equal(S.lines.length, nSup);
    assert.equal(P.lines.reduce((a, l) => a + l.total, 0), total); assert.equal(P.declaredTotal, total);
    assert.equal(S.lines.reduce((a, l) => a + l.total, 0), total); assert.equal(S.declaredTotal, total);
    assert.equal(P.unparsed.length + S.unparsed.length, 0);
    for (const d of [P, S]) {
      assert.ok(d.lines.every(l => l.reference && l.description && l.quantity > 0 && l.total != null), "registro incompleto");
      assert.equal(summarize(validateDocument(d)).errors, 0);
    }
  });
  test(`${name}: el cruce real coincide al 100 %`, { skip: SKIP }, async () => {
    const r = compare((await load(po, "po")).lines, (await load(sup, "supplier")).lines).statistics;
    assert.equal(r.onlyInPo + r.onlyInSupplier + r.withDifferences, 0);
    assert.equal(r.matched, r.poUniqueReferences); assert.equal(r.totalDifference, 0);
  });
  test(`${name}: la salida cumple el esquema JSON fijo`, { skip: SKIP }, async () => {
    const out = buildOutput({ po: await load(po, "po"), sup: await load(sup, "supplier") });
    assert.ok(validateSchema(out), JSON.stringify(validateSchema.errors?.slice(0, 3)));
  });
}

test("Metrohm: líneas repetidas de la OC se suman y se captura embalaje y retrasos", { skip: SKIP }, async () => {
  const P = await load("po_888_metrohm.pdf", "po"), S = await load("sup_metrohm.pdf", "supplier");
  const r = compare(P.lines, S.lines), it = r.items.find(i => i.reference === "60228000");
  assert.equal(it.po.aggregatedLines, 2); assert.equal(it.po.quantity, 24); assert.equal(it.supplier.quantity, 24); assert.equal(r.statistics.poAggregatedReferences, 4);
  assert.deepEqual(S.extraCharges, [{ label: "Packing charges (TP)", amount: 134354 }]);
  assert.deepEqual(S.lines.filter(l => l.note).map(l => l.reference).sort(), ["605330010", "61826390"]);
  assert.ok(S.lines.filter(l => l.note).every(l => l.deliveryDate === "13.11.2026"));
});

const mk = (ref, q, t, n = 1) => ({ id: n, lineNo: n, reference: ref, description: "x", quantity: q, total: t });
test("diferencias de cantidad/valor, faltantes y regla de marca", () => {
  const po = [mk("ME100", 2, 2000, 1), mk("ME200", 1, 1000, 2), mk("ME300", 1, 500, 3), mk("ME4001", 1, 900, 4)];
  const sup = [mk("100", 2, 2000, 1), mk("200", 3, 1000, 2), mk("300", 1, 650, 3), mk("4001", 1, 900, 4), mk("999", 1, 100, 5), mk("ME100", 1, 100, 6)];
  const st = Object.fromEntries(compare(po, sup).items.map(i => [i.reference, i.status]));
  assert.deepEqual([st["100"], st["200"], st["300"], st["4001"], st["999"], st["ME100"]], ["match", "qty_diff", "value_diff", "match", "only_supplier", "only_supplier"]);
  const r2 = compare([mk("ME400", 1, 900)], [mk("4001", 1, 900)]);     // coincidencia COMPLETA: 400 ≠ 4001
  assert.deepEqual(r2.items.map(i => i.status).sort(), ["only_po", "only_supplier"]);
  assert.equal(r2.items[0].suggestion, "4001");
});
test("agregación sin errores de coma flotante", () => {
  const ls = Array.from({ length: 10 }, (_, i) => mk("ME1", 0.1, 10, i + 1));
  const a = aggregate(ls, true).get("1"); assert.equal(a.quantity, 1); assert.equal(a.total, 100);
});
test("la validación marca registros incompletos y totales que no cuadran", () => {
  const d = { kind: "po", lines: [mk("ME1", 1, 1000), { id: 2, lineNo: 2, reference: "", description: "", quantity: null, total: null }], declaredTotal: 1000, unparsed: [] };
  const codes = validateDocument(d).map(i => i.code);
  for (const c of ["MISSING_REFERENCE", "MISSING_DESCRIPTION", "MISSING_QUANTITY", "MISSING_TOTAL"]) assert.ok(codes.includes(c), c);
  const w = validateDocument({ kind: "po", lines: [mk("ME1", 1, 1000)], declaredTotal: 9900, unparsed: [] });
  assert.ok(w.some(i => i.code === "TOTAL_MISMATCH") && summarize(w).needsReview);
  assert.equal(normPoNumber("COC 888"), normPoNumber("COC-00000888"));
});
test("archivos invertidos o no soportados se rechazan con mensaje útil", { skip: SKIP }, async () => {
  const { lines, pages } = await readPdfLines(pdfjs, fx("sup_buchi.pdf"));
  assert.throws(() => parseDocument(lines, pages, "po"), (e) => e instanceof ExtractionError && /al revés/.test(e.message));
  const o = await readPdfLines(pdfjs, fx("po_904_buchi.pdf"));
  assert.throws(() => parseDocument(o.lines, o.pages, "supplier"), /al revés/);
  assert.throws(() => parseDocument(["Otra cosa"], 1, "supplier"), /no reconocido/);
});
test("PDF corrupto produce ExtractionError", async () => {
  await assert.rejects(readPdfLines(pdfjs, Buffer.from("%PDF-1.4 basura")), ExtractionError);
});
test("números: formatos de entrada del usuario y de los PDF", () => {
  assert.equal(parseUserNumber("1.934,40"), 1934.4); assert.equal(parseUserNumber("1,934.40"), 1934.4);
  assert.equal(parseUserNumber("25,2"), 25.2); assert.equal(parseUserNumber("CHF 1934.40"), 1934.4); assert.ok(Number.isNaN(parseUserNumber("abc")));
  assert.equal(toCents("CHF1.934,40", ","), 193440); assert.equal(toCents("17,288.40", "."), 1728840);
});
