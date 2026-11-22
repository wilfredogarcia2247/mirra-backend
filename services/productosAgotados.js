const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

/**
 * Productos agotados por falta de esencia.
 *
 * Los perfumes se fabrican a pedido con su fórmula (presentación). Un producto
 * se considera AGOTADO si a alguna de sus presentaciones activas le falta
 * esencia ("ESC. INSP. ...") para fabricar una unidad. Solo se revisa la
 * esencia: el fijador y el alcohol se asumen disponibles.
 *
 * El stock de la esencia es lo disponible (físico - comprometido) en los
 * almacenes de materia prima.
 *
 * Devuelve un Set con los ids de producto agotados.
 */
async function getAgotadoProductIds(productIds, sqlClient = sql) {
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
      AND mp.nombre ILIKE 'ESC.%INSP%'
      AND COALESCE(ed.disponible, 0) < fc.cantidad
  `;
  return new Set((rows || []).map((r) => Number(r.producto_id)));
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

module.exports = { getAgotadoProductIds, getQuedanPocosProductIds };
