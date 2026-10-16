import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { load, fx } from "./helpers.mjs";
import { readPdfLines } from "../js/pdftext.js";
import { SUPPLIER_PARSERS } from "../js/parsers.js";
import { validateDocument, summarize, normPoNumber } from "../js/validate.js";
import { compare, crossChecks } from "../js/match.js";
import { buildOutput } from "../js/output.js";

// Los PDF son documentos comerciales reales: no se versionan; sin ellos estas pruebas se omiten.
const has = (f) => existsSync(new URL(`./fixtures/${f}`, import.meta.url));
const schema = JSON.parse(readFileSync(new URL("../schema/cruce-1.0.schema.json", import.meta.url)));
const validateSchema = new Ajv2020({ strict: false, allErrors: true }).compile(schema);

// archivo, parser esperado, nº documento, OC citada, moneda, nº líneas, total declarado (centavos), cargos extra (centavos)
const CASES = [
  ["sup_metrohm.pdf", "metrohm", "001-1238164-1", "COC 888", "CHF", 55, 8956980, 134354],
  ["sup_buchi.pdf", "buchi", "111526424", "COC-00000904", "CHF", 18, 66954, 0],
  ["sup_erweka.pdf", "erweka", "234388", "COC-00000903", "EUR", 1, 37260, 0],
  ["sup_elementar.pdf", "elementar", "62583", "COC-00000865", "EUR", 3, 26701, 21000],
  ["sup_stakpure.pdf", "stakpure", "2026-43539", "COC-895", "EUR", 5, 391920, 0],
];

for (const [file, parser, num, po, cur, n, total, extras] of CASES) {
  test(`${parser}: se reconoce solo con su parser y extrae todo`, { skip: has(file) ? false : "falta " + file }, async () => {
    const { lines } = await readPdfLines(pdfjs, fx(file));
    assert.deepEqual(SUPPLIER_PARSERS.filter(p => p.matches(lines)).map(p => p.id), [parser], "debe reconocerlo exactamente un parser");
    const d = await load(file, "supplier");
    assert.equal(d.parser, parser); assert.equal(d.number, num); assert.equal(d.relatedPo, po); assert.equal(d.currency, cur);
    assert.equal(d.lines.length, n); assert.equal(d.declaredTotal, total);
    assert.equal(d.lines.reduce((a, l) => a + l.total, 0), total, "la suma de las líneas debe igualar el total declarado");
    assert.equal(d.extraCharges.reduce((a, c) => a + c.amount, 0), extras);
    assert.equal(d.unparsed.length, 0);
    assert.ok(d.lines.every(l => l.reference && l.description && l.quantity > 0 && l.total != null && l.unitPrice != null));
    const iss = validateDocument(d); assert.equal(summarize(iss).errors, 0); assert.ok(!iss.some(i => i.code === "LINE_MATH" || i.code === "TOTAL_MISMATCH"), JSON.stringify(iss));
    assert.equal(normPoNumber(d.relatedPo).replace(/\D/g, "") > "", true);
  });
}

test("Stakpure: descuento 40 % aplicado y descripción multilínea", { skip: has("sup_stakpure.pdf") ? false : "falta PDF" }, async () => {
  const d = await load("sup_stakpure.pdf", "supplier"), l4 = d.lines[3];
  assert.ok(d.lines.every(l => l.discountPct === 40));
  assert.equal(l4.reference, "19200055"); assert.match(l4.description, /UV lamp for Omnia 185\/254 nm 20 4C S 15\/330/);
  assert.equal(d.lines[1].total, 151500);                              // 5 × 505,00 × 0,6 = 1.515,00
});
test("Elementar: precio unitario «por 1 PC», cargos extra y descripción de dos líneas", { skip: has("sup_elementar.pdf") ? false : "falta PDF" }, async () => {
  const d = await load("sup_elementar.pdf", "supplier");
  assert.deepEqual(d.extraCharges.map(c => c.label), ["Packing charges", "Danger. Goods Surch."]);
  assert.equal(d.documentTotal, 47701); assert.match(d.lines[0].description, /^EAS WETSORBER® S Ready for use water absorber/);
  const ck = crossChecks({ number: "COC-00000865", currency: "EUR" }, d);
  assert.ok(ck.some(c => c.code === "SUPPLIER_EXTRA_CHARGES") && !ck.some(c => c.severity !== "info"));
});

// Cruce con una OC sintética construida a partir de cada proveedor (el prefijo de marca "XX" simula el de la OC).
for (const [file, parser] of CASES.slice(2)) {
  test(`${parser}: cruce completo contra una OC equivalente y detección de diferencias`, { skip: has(file) ? false : "falta " + file }, async () => {
    const S = await load(file, "supplier");
    const po = S.lines.map(l => ({ ...l, reference: "XX" + l.reference }));
    assert.equal(compare(po, S.lines).statistics.matched, S.lines.length);
    const s0 = S.lines.map(l => ({ ...l })); s0[0].quantity += 1; s0[0].total += 500;                    // proveedor cambia cantidad y valor
    const st = compare(po, s0).statistics;
    assert.equal(st.withDifferences, 1); assert.equal(st.quantityDifferences, 1); assert.equal(st.valueDifferences, 1);
    const out = buildOutput({ po: { kind: "po", lines: po, number: "COC-00000001", currency: S.currency, declaredTotal: po.reduce((a, l) => a + l.total, 0), extraCharges: [], unparsed: [], fileName: "oc" }, sup: S });
    assert.ok(validateSchema(out), JSON.stringify(validateSchema.errors?.slice(0, 2)));
  });
}
