// Copia las librerías de terceros desde node_modules a vendor/ (se versionan para que el sitio funcione sin CDN).
// Se usa el build "legacy" de pdf.js: el build moderno trunca texto en algunos navegadores.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("vendor", { recursive: true });
const files = [
  ["node_modules/pdfjs-dist/legacy/build/pdf.min.mjs", "vendor/pdf.min.mjs"],
  ["node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", "vendor/pdf.worker.min.mjs"],
  ["node_modules/pdfjs-dist/LICENSE", "vendor/LICENSE-pdfjs.txt"],
  ["node_modules/exceljs/dist/exceljs.min.js", "vendor/exceljs.min.js"],
  ["node_modules/exceljs/LICENSE", "vendor/LICENSE-exceljs.txt"],
];
for (const [a, b] of files) { copyFileSync(a, b); console.log("✓", b); }
