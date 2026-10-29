const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

// Perfumes que llevan la etiqueta "🔥 Más pedido" en la tienda:
// los más pedidos de mujer y de hombre (los unisex cuentan en ambos).
const CUPOS = { mujer: 15, hombre: 10 };
// Primero cuentan los pedidos recientes; si no alcanzan, se completa con el historial completo
const DIAS_RECIENTES = 90;

let cache = { at: 0, ranking: new Map() };
const CACHE_MS = 10 * 60 * 1000;

// { producto_id -> { recientes, total, unidades } } con los pedidos no cancelados
async function getRanking(sqlClient = sql) {
  if (Date.now() - cache.at < CACHE_MS) return cache.ranking;
  const rows = await sqlClient`
    SELECT pvp.producto_id,
      COUNT(DISTINCT pv.id) FILTER (WHERE pv.fecha >= NOW() - (${DIAS_RECIENTES} * INTERVAL '1 day'))::int AS recientes,
      COUNT(DISTINCT pv.id)::int AS total,
      COALESCE(SUM(pvp.cantidad), 0)::int AS unidades
    FROM pedido_venta_productos pvp
    JOIN pedidos_venta pv ON pv.id = pvp.pedido_venta_id
    WHERE pv.estado NOT ILIKE 'cancel%'
    GROUP BY pvp.producto_id`;
  const ranking = new Map(rows.map((r) => [Number(r.producto_id), { recientes: r.recientes, total: r.total, unidades: r.unidades }]));
  cache = { at: Date.now(), ranking };
  return ranking;
}

function normalizar(nombre) {
  return String(nombre || '').trim().toLowerCase();
}

/**
 * Elige los "Más pedido" entre los productos que se muestran en la tienda.
 * @param {number[]} candidatos ids de productos visibles y no agotados
 * @param {Record<number, {nombre: string}[]>} categoriasPorProducto
 * @returns {Promise<Set<number>>}
 */
async function getMasPedidosIds(candidatos, categoriasPorProducto, sqlClient = sql) {
  const ranking = await getRanking(sqlClient);
  const conPedidos = (candidatos || [])
    .map(Number)
    .filter((id) => (ranking.get(id)?.total ?? 0) > 0)
    .sort((a, b) => {
      const ra = ranking.get(a);
      const rb = ranking.get(b);
      return rb.recientes - ra.recientes || rb.total - ra.total || rb.unidades - ra.unidades;
    });

  const elegidos = new Set();
  for (const [categoria, cupo] of Object.entries(CUPOS)) {
    const lista = conPedidos.filter((id) => {
      const nombres = (categoriasPorProducto[id] || []).map((c) => normalizar(c.nombre));
      // "unisex" es la categoría antigua (antes de permitir Hombre y Mujer a la vez)
      return nombres.includes(categoria) || nombres.includes('unisex');
    });
    lista.slice(0, cupo).forEach((id) => elegidos.add(id));
  }
  return elegidos;
}

module.exports = { getMasPedidosIds };
