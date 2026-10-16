import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import ExcelJS from "exceljs";
import { load } from "./helpers.mjs";
import { buildOutput } from "../js/output.js";
import { buildWorkbook } from "../js/excel.js";

const SKIP = existsSync(new URL("./fixtures/po_888_metrohm.pdf", import.meta.url)) ? false : "faltan los PDF de ejemplo en tests/fixtures/";
test("el Excel se genera, se puede releer y sus cifras coinciden con el JSON", { skip: SKIP }, async () => {
  const P = await load("po_888_metrohm.pdf", "po"), S = await load("sup_metrohm.pdf", "supplier");
  S.lines.find(l => l.reference === "62832000").total = 52620;      // fuerza una diferencia de valor y una advertencia
  const out = buildOutput({ po: P, sup: S });
  const buf = await buildWorkbook(ExcelJS, out).xlsx.writeBuffer();
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  assert.deepEqual(wb.worksheets.map(w => w.name), ["Resumen", "Cruce", "Diferencias", "Líneas OC", "Líneas proveedor", "Incidencias"]);
  assert.equal(wb.getWorksheet("Cruce").rowCount, out.items.length + 2);          // encabezado + ítems + total
  const dif = wb.getWorksheet("Diferencias"); assert.equal(dif.getRow(2).getCell(1).value, "Dif. valor");
  assert.equal(dif.getRow(2).getCell(10).value, -36);
  assert.ok(wb.getWorksheet("Incidencias").rowCount > 2);
});
