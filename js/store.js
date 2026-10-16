// Histórico local en IndexedDB: vive solo en este navegador/equipo. Nada se envía a ningún servidor.
const DB = "polco-cruce-oc", V = 1;
const open = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, V);
  r.onupgradeneeded = () => {
    const db = r.result;
    db.createObjectStore("cruces", { keyPath: "id", autoIncrement: true }).createIndex("created", "created_at");
    db.createObjectStore("pdfs", { keyPath: "id", autoIncrement: true }).createIndex("cruce", "cruce_id");
  };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error); });

export async function saveCruce(output, pdfs = []) {
  const db = await open(), tx = db.transaction(["cruces", "pdfs"], "readwrite");
  const rec = { created_at: new Date().toISOString(), po_number: output.purchase_order.number, supplier: output.supplier_confirmation.supplier_name || output.purchase_order.supplier_name,
    sup_number: output.supplier_confirmation.number, status: output.status, stats: output.statistics, needs_review: output.purchase_order.needs_review || output.supplier_confirmation.needs_review,
    edited: output.purchase_order.manually_edited_lines + output.supplier_confirmation.manually_edited_lines, output };
  const id = await wrap(tx.objectStore("cruces").add(rec));
  for (const p of pdfs) tx.objectStore("pdfs").add({ cruce_id: id, kind: p.kind, name: p.name, blob: p.blob });
  await done(tx); db.close(); return id;
}
export async function listCruces() {
  const db = await open(), rows = await wrap(db.transaction("cruces").objectStore("cruces").getAll()); db.close();
  return rows.map(({ output, ...r }) => r).sort((a, b) => b.id - a.id);
}
export async function getCruce(id) { const db = await open(), r = await wrap(db.transaction("cruces").objectStore("cruces").get(id)); db.close(); return r; }
export async function getPdfs(id) { const db = await open(), r = await wrap(db.transaction("pdfs").objectStore("pdfs").index("cruce").getAll(id)); db.close(); return r; }
export async function deleteCruce(id) {
  const db = await open(), tx = db.transaction(["cruces", "pdfs"], "readwrite");
  tx.objectStore("cruces").delete(id);
  const idx = tx.objectStore("pdfs").index("cruce");
  idx.openKeyCursor(IDBKeyRange.only(id)).onsuccess = (e) => { const c = e.target.result; if (c) { tx.objectStore("pdfs").delete(c.primaryKey); c.continue(); } };
  await done(tx); db.close();
}
export async function exportBackup() {
  const db = await open(), rows = await wrap(db.transaction("cruces").objectStore("cruces").getAll()); db.close();
  return { app: "polco-cruce-oc", version: 1, exported_at: new Date().toISOString(), cruces: rows.map(({ id, ...r }) => r) };
}
export async function importBackup(obj) {
  if (obj?.app !== "polco-cruce-oc" || !Array.isArray(obj.cruces)) throw new Error("El archivo no es un respaldo válido de esta aplicación.");
  const db = await open(), tx = db.transaction("cruces", "readwrite");
  for (const r of obj.cruces) { if (r?.output?.schema_version !== "1.0") continue; tx.objectStore("cruces").add(r); }
  await done(tx); db.close(); return obj.cruces.length;
}
