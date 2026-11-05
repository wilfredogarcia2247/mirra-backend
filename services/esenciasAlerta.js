// Alerta de esencia baja (con rotación).
//
// La esencia se mide en GRAMOS (g); el tamaño del frasco en ml (30 ml, 60 ml...).
// - "Esencia baja": la esencia alcanza para menos de UMBRAL_FRASCOS frascos del tamaño más
//   grande que se vende (fórmula activa; un tamaño desactivado no cuenta) (pero al menos para uno; si no alcanza ni para uno el perfume ya sale AGOTADO).
// - Rotación: perfumes vendidos con esa esencia en los últimos DIAS_ROTACION días (pedidos no cancelados).
//   Alta rotación desde VENTAS_ALTA_ROTACION ventas; con eso estimamos en cuántos días se acaba.
const { neon } = require('@neondatabase/serverless');
const { getAgotadoProductIds } = require('./productosAgotados');

const sqlDefault = neon(process.env.DATABASE_URL);

const UMBRAL_FRASCOS = 3;
const DIAS_ROTACION = 30;
const VENTAS_ALTA_ROTACION = 3;

async function getEstadoEsencias(sql = sqlDefault) {
  const filas = await sql`
    WITH esencias AS (
      SELECT p.id, p.nombre FROM productos p WHERE p.nombre ILIKE 'ESC.%INSP%'
    ),
    disponible AS (
      SELECT i.producto_id, SUM(i.stock_fisico - i.stock_comprometido) AS disp
      FROM inventario i
      JOIN almacenes a ON a.id = i.almacen_id AND a.es_materia_prima IS TRUE
      GROUP BY i.producto_id
    ),
    usos AS (
      -- Cada perfume (fórmula activa) que lleva la esencia y cuántos gramos usa por frasco
      SELECT fc.materia_prima_id AS esencia_id, f.id AS formula_id, f.nombre AS formula_nombre,
             f.producto_terminado_id, fc.cantidad
      FROM formula_componentes fc
      JOIN formulas f ON f.id = fc.formula_id AND f.activo = TRUE
    ),
    mayor AS (
      SELECT DISTINCT ON (esencia_id) esencia_id, cantidad AS g_frasco_grande, formula_nombre AS tamano_grande
      FROM usos
      ORDER BY esencia_id, cantidad DESC
    ),
    perfumes AS (
      SELECT u.esencia_id,
             json_agg(DISTINCT jsonb_build_object('id', p.id, 'nombre', p.nombre)) AS perfumes,
             array_agg(DISTINCT u.producto_terminado_id) AS perfume_ids
      FROM usos u
      JOIN productos p ON p.id = u.producto_terminado_id
      GROUP BY u.esencia_id
    ),
    ventas AS (
      SELECT fc.materia_prima_id AS esencia_id,
             SUM(pvp.cantidad)::int AS vendidos,
             SUM(pvp.cantidad * fc.cantidad) AS consumo
      FROM pedido_venta_productos pvp
      JOIN pedidos_venta pv ON pv.id = pvp.pedido_venta_id
        AND COALESCE(pv.estado, '') <> 'Cancelado'
        AND pv.fecha >= NOW() - make_interval(days => ${DIAS_ROTACION})
      JOIN formula_componentes fc ON fc.formula_id = pvp.formula_id
      GROUP BY fc.materia_prima_id
    )
    SELECT e.id, e.nombre,
           COALESCE(d.disp, 0)::numeric AS disponible,
           m.g_frasco_grande, m.tamano_grande,
           p.perfumes, p.perfume_ids,
           COALESCE(v.vendidos, 0) AS vendidos,
           COALESCE(v.consumo, 0)::numeric AS consumo
    FROM esencias e
    JOIN mayor m ON m.esencia_id = e.id
    LEFT JOIN disponible d ON d.producto_id = e.id
    LEFT JOIN perfumes p ON p.esencia_id = e.id
    LEFT JOIN ventas v ON v.esencia_id = e.id
    WHERE m.g_frasco_grande > 0
      AND COALESCE(d.disp, 0) >= m.g_frasco_grande
      AND COALESCE(d.disp, 0) < m.g_frasco_grande * ${UMBRAL_FRASCOS}
  `;

  const esencias = (filas || []).map((f) => {
    const disponible = Number(f.disponible) || 0;
    const gGrande = Number(f.g_frasco_grande) || 0;
    const vendidos = Number(f.vendidos) || 0;
    const consumo = Number(f.consumo) || 0;
    const porDia = consumo / DIAS_ROTACION;
    return {
      id: Number(f.id),
      nombre: f.nombre,
      disponible_g: disponible,
      g_por_frasco_grande: gGrande,
      // "196. PRADA CANDY NIGHT Presentación 60ml" -> "60 ml"
      tamano_grande: (String(f.tamano_grande || '').match(/(\d+(?:[.,]\d+)?)\s*ml/i) || [])[1]
        ? `${String(f.tamano_grande).match(/(\d+(?:[.,]\d+)?)\s*ml/i)[1]} ml`
        : (f.tamano_grande || null),
      frascos_grandes: gGrande > 0 ? Math.floor(disponible / gGrande) : 0,
      vendidos_periodo: vendidos,
      dias_estimados: porDia > 0 ? Math.max(0, Math.floor(disponible / porDia)) : null,
      rotacion: vendidos >= VENTAS_ALTA_ROTACION ? 'alta' : 'baja',
      perfumes: Array.isArray(f.perfumes) ? f.perfumes : [],
      perfume_ids: (f.perfume_ids || []).map(Number),
    };
  });

  // Primero las de alta rotación (las que se acaban antes), luego las demás por lo que queda
  esencias.sort((a, b) => {
    if (a.rotacion !== b.rotacion) return a.rotacion === 'alta' ? -1 : 1;
    if (a.dias_estimados != null && b.dias_estimados != null) return a.dias_estimados - b.dias_estimados;
    return a.frascos_grandes - b.frascos_grandes || a.disponible_g - b.disponible_g;
  });

  // Perfumes agotados (para el filtro de Productos)
  const terminados = await sql`
    SELECT DISTINCT f.producto_terminado_id AS id FROM formulas f WHERE f.activo = TRUE AND f.producto_terminado_id IS NOT NULL
  `;
  const agotados = await getAgotadoProductIds((terminados || []).map((r) => r.id), sql);

  return {
    criterio: {
      umbral_frascos: UMBRAL_FRASCOS,
      dias_rotacion: DIAS_ROTACION,
      ventas_alta_rotacion: VENTAS_ALTA_ROTACION,
    },
    esencias,
    perfumes_agotados: Array.from(agotados),
  };
}

module.exports = { getEstadoEsencias, UMBRAL_FRASCOS, DIAS_ROTACION, VENTAS_ALTA_ROTACION };
