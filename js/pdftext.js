// Extrae las líneas de texto de un PDF con pdf.js (en el navegador o en Node para las pruebas).
// Las líneas se reconstruyen agrupando por coordenada Y y ordenando por X.
export class ExtractionError extends Error {}

export async function readPdfLines(pdfjs, data) {
  let doc, task;
  try {
    task = pdfjs.getDocument({ data: new Uint8Array(data).slice(), isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
    doc = await task.promise;
  } catch (e) {
    if (e?.name === "PasswordException") throw new ExtractionError("El PDF está protegido con contraseña.");
    throw new ExtractionError("No se pudo abrir el PDF: " + (e?.message || e));
  }
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str !== undefined && i.str.trim() !== "")
      .map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of items) {
      const r = rows.find(r => Math.abs(r.y - it.y) <= 2.5);
      r ? r.items.push(it) : rows.push({ y: it.y, items: [it] });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      let out = "", prevEnd = null;
      for (const it of r.items) {
        if (prevEnd !== null) out += it.x - prevEnd > 1.2 ? " " : "";
        out += it.s;
        prevEnd = it.x + it.w;
      }
      lines.push(out.replace(/\s+/g, " ").trim());
    }
    lines.push(`\f@@PAGE${p}`);
    page.cleanup();
  }
  const pages = doc.numPages;
  await task.destroy();
  if (!lines.some(l => l && !l.startsWith("\f"))) {
    throw new ExtractionError("El PDF no tiene capa de texto (¿escaneado?). No hay OCR: digite las líneas manualmente en la pantalla de revisión.");
  }
  return { lines, pages };
}
