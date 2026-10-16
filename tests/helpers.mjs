import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { readPdfLines } from "../js/pdftext.js";
import { parseDocument } from "../js/parsers.js";

export const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
export async function load(name, kind) {
  const { lines, pages } = await readPdfLines(pdfjs, fx(name));
  const d = parseDocument(lines, pages, kind);
  d.lines.forEach((l, i) => (l.id = i + 1));
  d.fileName = name;
  return d;
}
