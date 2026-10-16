# Cruce de orden de compra vs. confirmación del proveedor (Polco)

Aplicación web **100 % en el navegador** (sin servidor, sin base de datos, sin dependencias en la nube).
Recibe una **orden de compra de Polco** y la **confirmación de pedido del proveedor** (PDF), cruza referencias,
cantidades y valores, valida la lectura, permite corregir líneas mal leídas y entrega un **Excel consolidado** y un
**JSON con esquema fijo**. El histórico se guarda en el propio navegador.

> Los PDF se leen con pdf.js dentro de la página. La política de seguridad (CSP) del sitio **no permite conexiones a
> otros orígenes**, así que ningún dato sale del equipo del usuario.

## Probar en local
```bash
npm ci
npm test                     # lectura, cruce, esquema JSON y Excel
python3 -m http.server 8080  # o: npx serve .   → abrir http://localhost:8080
```
Las pruebas que leen PDF reales (`tests/fixtures/`: `po_888_metrohm`, `sup_metrohm`, `po_904_buchi`, `sup_buchi`, `sup_erweka`, `sup_elementar`, `sup_stakpure`, todos `.pdf`) se
**omiten** si esos archivos no están: son documentos comerciales y por eso no se suben al repositorio (`.gitignore`).
Copie los 7 PDF a `tests/fixtures/` para correr la suite completa en su equipo.

(No abra `index.html` con doble clic: los módulos JS requieren http.)

## Publicar
**GitHub Pages** (incluido): en el repo → *Settings → Pages → Source: GitHub Actions*. Cada push a `main` ejecuta las
pruebas y publica (`.github/workflows/pages.yml`). La URL queda `https://<usuario>.github.io/<repo>/`.

**Vercel** (como la herramienta de inventario): importar el repo, *Framework Preset: Other*, sin comando de build,
directorio de salida vacío (raíz). `vercel.json` ya añade las cabeceras de seguridad.

## Flujo
1. **Cargar archivos**: OC y confirmación (arrastrar o buscar).
2. **Revisar el cruce**: estadísticas, diferencias y validación de la lectura. Si algo no cuadra queda **marcado para
   revisión humana**; las pestañas *Orden de compra* / *Proveedor* permiten editar, agregar o eliminar líneas y el total
   declarado, y el cruce se recalcula al instante. Los **errores** bloquean la confirmación; los **avisos** exigen aceptarlos.
3. **Descargar**: Excel (Resumen, Cruce, Diferencias, Líneas OC, Líneas proveedor, Incidencias) y JSON.

## Reglas del cruce
* Referencia de la OC = 2 caracteres de marca + código (`ME62842020` → marca `ME`, ref. `62842020`). El proveedor no trae
  marca. Sin la marca, la referencia debe **coincidir completa** (solo se ignoran espacios y mayúsculas): `400` ≠ `4001`.
  Si hay una casi igual, se muestra como *sugerencia*; nunca se cruza sola.
* Referencias repetidas dentro de un documento se **suman** (Metrohm consolida las líneas repetidas de la OC).
* Cantidad: igualdad exacta. Valor total de línea: tolerancia de 0,01. Importes en centavos enteros (sin errores de coma flotante).
* Se compara el **total de línea** (Metrohm lista precio de lista con −40 %; su total ya lo incluye). Cargos fuera de
  las líneas (p. ej. *Packing charges*) se informan, no entran al cruce.
* Estados: `match`, `qty_diff`, `value_diff`, `qty_value_diff`, `only_po`, `only_supplier`.

## Validación de la lectura
Por línea: referencia, descripción, cantidad (>0) y total presentes; cantidad × precio (− descuento) = total; prefijo de
marca válido. Por documento: **suma de líneas = total declarado en el PDF** (detecta líneas omitidas o mal leídas), texto
con aspecto de línea que no se pudo interpretar, varias marcas en una OC, nº de OC citado por el proveedor ≠ OC cargada,
monedas distintas. PDFs escaneados (sin texto) no se leen: no hay OCR.

## Salida JSON
Esquema fijo en [`schema/cruce-1.0.schema.json`](schema/cruce-1.0.schema.json) (`schema_version: "1.0"`); las pruebas
validan cada salida contra él. Bloques: `purchase_order`, `supplier_confirmation` (metadatos, totales, `needs_review`,
`issues`, `lines`), `cross_checks`, `statistics` e `items[]` (`reference`, `brand`, `status`, `po`, `supplier`, `diff`).

## Datos sensibles: qué protege esta arquitectura y qué no
* **Protege**: los PDF y sus datos nunca viajan a un servidor; no hay base de datos centralizada que filtrar.
  El histórico vive en IndexedDB del navegador; los PDF solo se guardan si el usuario marca *Guardar copia de los PDF*
  (por defecto no).
* **No hay usuarios ni permisos dentro de la app** (una app estática no puede imponerlos). El histórico es por
  navegador/equipo; en equipos compartidos use perfiles distintos o no guarde PDF. Para restringir **quién puede abrir
  la herramienta**, póngala detrás del control de acceso de la plataforma: Vercel (*Deployment Protection / Password*),
  Cloudflare Access, o GitHub Pages privado (requiere GitHub Enterprise Cloud). Si necesitan histórico compartido y
  roles por usuario, hace falta un backend (la versión con servidor fue entregada aparte).
* Sin CDNs: pdf.js y ExcelJS están versionados en `vendor/` (ver `scripts/vendor.mjs`).

## Proveedores soportados
| Proveedor | Formato | Particularidades |
|---|---|---|
| Metrohm AG | *Order Confirmation* | Total de línea ya con descuento (−40 %); consolida líneas repetidas de la OC; cargo de embalaje fuera de líneas; avisos de retraso de entrega |
| BÜCHI Labortechnik AG | *Order confirmation* | Descripción en varias líneas; líneas *Carry Forward* entre páginas |
| ERWEKA GmbH | *Order confirmation* | EUR; fecha *Ready for dispatch* como fecha de entrega |
| Elementar Analysensysteme GmbH | *Order* | Un bloque por ítem (`Material:`); precio «por 1 PC»; cargos extra (embalaje, mercancía peligrosa) fuera de líneas; términos legales en páginas 2-3 se ignoran |
| Stakpure | *Order confirmation* | Decimales con coma; descuento «less 40,00 %» en línea aparte; descripción en varias líneas |

El nº de OC que cita el proveedor se compara contra la OC cargada aunque venga en otro formato (`COC 888`, `COC-895`, `COC-00000865`).

## Agregar un proveedor nuevo
En `js/parsers.js`, crear un objeto `{ id, name, matches(lines), parse(lines, pages) }` (ver `metrohm`/`buchi`) y añadirlo a
`SUPPLIER_PARSERS`. Mientras tanto, un formato desconocido no se rechaza: se abre el cruce con un error de lectura y se
pueden digitar las líneas en la revisión manual. Agregue el PDF de ejemplo a `tests/fixtures/` y una prueba.

## Logo
`assets/logo.svg` es un marcador de posición: reemplácelo por el logo oficial de Polco (mismo nombre de archivo).
