const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

/**
 * Esencia por presentación.
 *
 * Los perfumes se fabrican a pedido con su fórmula (presentación: 30 ml, 50 ml, 100 ml...).
 * Cada presentación se revisa por separado: está SIN ESENCIA si su esencia ("ESC. INSP. ...")
 * no alcanza para fabricar una unidad. Solo se revisa la esencia: el fijador y el alcohol
 * se asumen disponibles.
 *
 * El stock de la esencia es lo disponible (físico - comprometido) en los almacenes de
 * materia prima.
 *
 * Ejemplo: con 32 g de esencia, si el de 100 ml pide 40 g, el de 50 ml 20 g y el de 30 ml 12 g,
 * solo el de 100 ml queda sin esencia; el perfume sigue disponible en 30 y 50 ml.
 */

// Fórmulas activas sin esencia suficiente para una unidad.
// Devuelve [{ formula_id, producto_id }].
async function getFormulasSinEsencia(productIds, sqlClient = sql) {
  const ids = Array.from(new Set((productIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0)));
  if (ids.length === 0) return [];
  const rows = await sqlClient`
    WITH esencia_disponible AS (
      SELECT i.producto_id, SUM(i.stock_fisico - i.stock_comprometido) AS disponible
      FROM inventario i
      JOIN almacenes a ON a.id = i.almacen_id
      WHERE a.es_materia_prima IS TRUE
      GROUP BY i.producto_id
    )
    SELECT DISTINCT f.id AS formula_id, f.producto_terminado_id AS producto_id
    FROM formulas f
    JOIN formula_componentes fc ON fc.formula_id = f.id
    JOIN productos mp ON mp.id = fc.materia_prima_id
    LEFT JOIN esencia_disponible ed ON ed.producto_id = mp.id
    WHERE f.producto_terminado_id = ANY(${ids})
      AND f.activo = TRUE
      AND mp.nombre ILIKE 'ESC.%INSP%'
      AND COALESCE(ed.disponible, 0) < fc.cantidad
  `;
  return (rows || []).map((r) => ({ formula_id: Number(r.formula_id), producto_id: Number(r.producto_id) }));
}

// Ids de las fórmulas (presentaciones) que no se pueden preparar. Set de formula_id.
async function getFormulaIdsSinEsencia(productIds, sqlClient = sql) {
  return new Set((await getFormulasSinEsencia(productIds, sqlClient)).map((r) => r.formula_id));
}

/**
 * Productos AGOTADOS: ninguna de sus presentaciones activas se puede preparar.
 * (Antes bastaba con que faltara esencia para una sola presentación.)
 * Si el perfume tiene al menos una presentación que alcanza, no está agotado.
 *
 * Devuelve un Set con los ids de producto agotados.
 */
async function getAgotadoProductIds(productIds, sqlClient = sql) {
  const ids = Array.from(new Set((productIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0)));
  if (ids.length === 0) return new Set();
  const sinEsencia = await getFormulasSinEsencia(ids, sqlClient);
  if (sinEsencia.length === 0) return new Set();
  const faltantes = new Set(sinEsencia.map((r) => r.formula_id));
  const conProblema = Array.from(new Set(sinEsencia.map((r) => r.producto_id)));
  const activas = await sqlClient`
    SELECT id, producto_terminado_id AS producto_id FROM formulas
    WHERE producto_terminado_id = ANY(${conProblema}) AND activo = TRUE
  `;
  const porProducto = new Map();
  (activas || []).forEach((r) => {
    const p = Number(r.producto_id);
    if (!porProducto.has(p)) porProducto.set(p, []);
    porProducto.get(p).push(Number(r.id));
  });
  return new Set(conProblema.filter((p) => (porProducto.get(p) || []).every((fid) => faltantes.has(fid))));
}

/**
 * "Quedan pocos": la esencia disponible alcanza para preparar `frascos` (por defecto 3) o menos
 * frascos de 100 ml (con 3 ya sale). Se mide con la presentación activa de 100 ml del perfume (el tamaño se
 * lee del nombre de la fórmula, p. ej. "... Presentación 100 ml"). Si el perfume no tiene
 * presentación de 100 ml no se marca. La tienda no lo muestra si además está agotado.
 *
 * Devuelve un Set con los ids de producto.
 */
async function getQuedanPocosProductIds(productIds, frascos = 3, sqlClient = sql) {
  const ids = Array.from(new Set((productIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0)));
  if (ids.length === 0) return new Set();
  const rows = await sqlClient`
    WITH esencia_disponible AS (
      SELECT i.producto_id, SUM(i.stock_fisico - i.stock_comprometido) AS disponible
      FROM inventario i
      JOIN almacenes a ON a.id = i.almacen_id
      WHERE a.es_materia_prima IS TRUE
      GROUP BY i.producto_id
    )
    SELECT DISTINCT f.producto_terminado_id AS producto_id
    FROM formulas f
    JOIN formula_componentes fc ON fc.formula_id = f.id
    JOIN productos mp ON mp.id = fc.materia_prima_id
    LEFT JOIN esencia_disponible ed ON ed.producto_id = mp.id
    WHERE f.producto_terminado_id = ANY(${ids})
      AND f.activo = TRUE
      AND f.nombre ~* '(^|[^0-9])100\s*ml'
      AND mp.nombre ILIKE 'ESC.%INSP%'
      AND fc.cantidad > 0
      AND FLOOR(COALESCE(ed.disponible, 0) / fc.cantidad) <= ${frascos}
  `;
  return new Set((rows || []).map((r) => Number(r.producto_id)));
}

module.exports = { getAgotadoProductIds, getFormulaIdsSinEsencia, getQuedanPocosProductIds };
