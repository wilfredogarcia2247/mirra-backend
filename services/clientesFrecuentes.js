// Historial de compras por cliente: cuántos pedidos completados tiene y cuánto ha comprado.
// Lo usan la ficha del pedido (panel) y el reporte "Clientes frecuentes", así ambos dan lo mismo.

const ESTADOS_COMPLETADOS = ['completado', 'completada', 'completa', 'finalizado', 'finalizada', 'entregado', 'pagado', 'terminado'];

// Identifica a la persona por los números de su cédula ("V-12.345.678" y "12345678" son el mismo cliente).
// Si no hay cédula usa el cliente registrado y, en último caso, el teléfono.
const CLIENTE_KEY = `
  CASE
    WHEN LENGTH(REGEXP_REPLACE(COALESCE(pv.cedula, ''), '[^0-9]', '', 'g')) >= 5
      THEN 'ced:' || REGEXP_REPLACE(pv.cedula, '[^0-9]', '', 'g')
    WHEN pv.cliente_id IS NOT NULL THEN 'id:' || pv.cliente_id::text
    WHEN LENGTH(REGEXP_REPLACE(COALESCE(pv.telefono, ''), '[^0-9]', '', 'g')) >= 7
      THEN 'tel:' || RIGHT(REGEXP_REPLACE(pv.telefono, '[^0-9]', '', 'g'), 10)
    ELSE 'pedido:' || pv.id::text
  END`;

// Pedidos completados con su monto: productos menos cupón, descuento al mayor y descuentos manuales.
// Los recargos (delivery, envío) no cuentan como compra. La fecha es la del pago (completado_en) si existe.
// $1 = lista de estados completados.
const PEDIDOS_CLIENTE_CTE = `
  pedidos_cliente AS (
    SELECT
      pv.id,
      COALESCE(pv.completado_en, pv.fecha) AS fecha,
      ${CLIENTE_KEY} AS cliente_key,
      NULLIF(TRIM(pv.nombre_cliente), '') AS nombre,
      NULLIF(TRIM(pv.cedula), '') AS cedula,
      NULLIF(TRIM(pv.telefono), '') AS telefono,
      COALESCE(l.items, 0) AS items,
      GREATEST(0,
        COALESCE(l.subtotal, 0)
        - COALESCE(pv.descuento_cupon, 0)
        - COALESCE(pv.descuento_mayor, 0)
        - COALESCE((
            SELECT SUM(CASE WHEN a.modo = 'porcentaje' THEN COALESCE(l.subtotal, 0) * a.valor / 100 ELSE a.valor END)
            FROM pedido_venta_ajustes a
            WHERE a.pedido_venta_id = pv.id AND a.tipo = 'descuento'
          ), 0)
      ) AS monto
    FROM pedidos_venta pv
    LEFT JOIN LATERAL (
      SELECT
        SUM(COALESCE(pvp.cantidad, 0) * COALESCE(pvp.precio_venta, prod.precio_venta, 0)) AS subtotal,
        SUM(COALESCE(pvp.cantidad, 0)) AS items
      FROM pedido_venta_productos pvp
      LEFT JOIN productos prod ON prod.id = pvp.producto_id
      WHERE pvp.pedido_venta_id = pv.id
    ) l ON TRUE
    WHERE LOWER(TRIM(COALESCE(pv.estado, ''))) = ANY($1)
  )`;

const redondear = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

// Resumen de compras del cliente de un pedido (todas las fechas).
async function historialClienteDePedido(sql, pedidoId) {
  const rows = await sql.query(`
    WITH ${PEDIDOS_CLIENTE_CTE},
    objetivo AS (SELECT ${CLIENTE_KEY} AS k FROM pedidos_venta pv WHERE pv.id = $2)
    SELECT COUNT(*)::int AS pedidos, COALESCE(SUM(monto), 0) AS monto, MIN(fecha) AS primera_compra, MAX(fecha) AS ultima_compra
    FROM pedidos_cliente
    WHERE cliente_key = (SELECT k FROM objetivo)
  `, [ESTADOS_COMPLETADOS, Number(pedidoId)]);
  const r = rows && rows[0] ? rows[0] : {};
  return {
    pedidos_completados: Number(r.pedidos || 0),
    monto_total: redondear(r.monto),
    primera_compra: r.primera_compra || null,
    ultima_compra: r.ultima_compra || null,
  };
}

// Ranking de clientes por monto comprado (o por cantidad de pedidos), con sus últimos pedidos.
async function rankingClientes(sql, { fechaInicio = '', fechaFin = '', limit = 20, pedidosLimit = 5, orden = 'monto' } = {}) {
  const ordenSql = orden === 'pedidos' ? 'pedidos DESC, monto DESC' : 'monto DESC, pedidos DESC';
  const rows = await sql.query(`
    WITH ${PEDIDOS_CLIENTE_CTE},
    filtrados AS (
      SELECT * FROM pedidos_cliente
      WHERE (NULLIF($2, '')::date IS NULL OR fecha >= NULLIF($2, '')::date)
        AND (NULLIF($3, '')::date IS NULL OR fecha < NULLIF($3, '')::date + INTERVAL '1 day')
    ),
    por_cliente AS (
      SELECT
        cliente_key,
        COUNT(*)::int AS pedidos,
        COALESCE(SUM(monto), 0) AS monto,
        MAX(fecha) AS ultima_compra,
        (ARRAY_AGG(nombre ORDER BY fecha DESC, id DESC) FILTER (WHERE nombre IS NOT NULL))[1] AS nombre,
        (ARRAY_AGG(cedula ORDER BY fecha DESC, id DESC) FILTER (WHERE cedula IS NOT NULL))[1] AS cedula,
        (ARRAY_AGG(telefono ORDER BY fecha DESC, id DESC) FILTER (WHERE telefono IS NOT NULL))[1] AS telefono
      FROM filtrados
      GROUP BY cliente_key
    ),
    totales AS (
      SELECT COUNT(*)::int AS clientes, COUNT(*) FILTER (WHERE pedidos >= 2)::int AS recurrentes,
             COALESCE(SUM(monto), 0) AS monto, COALESCE(SUM(pedidos), 0)::int AS pedidos
      FROM por_cliente
    ),
    top AS (
      SELECT *, ROW_NUMBER() OVER (ORDER BY ${ordenSql}, cliente_key) AS puesto
      FROM por_cliente
      ORDER BY ${ordenSql}, cliente_key
      LIMIT $4
    ),
    ultimos AS (
      SELECT f.*, ROW_NUMBER() OVER (PARTITION BY f.cliente_key ORDER BY f.fecha DESC, f.id DESC) AS rn
      FROM filtrados f JOIN top t ON t.cliente_key = f.cliente_key
    )
    SELECT t.*, u.id AS pedido_id, u.fecha AS pedido_fecha, u.monto AS pedido_monto, u.items AS pedido_items,
           tot.clientes AS tot_clientes, tot.recurrentes AS tot_recurrentes, tot.monto AS tot_monto, tot.pedidos AS tot_pedidos
    FROM top t
    CROSS JOIN totales tot
    LEFT JOIN ultimos u ON u.cliente_key = t.cliente_key AND u.rn <= $5
    ORDER BY t.puesto, u.fecha DESC, u.id DESC
  `, [ESTADOS_COMPLETADOS, fechaInicio, fechaFin, limit, pedidosLimit]);

  const data = [];
  const porKey = new Map();
  let resumen = { clientes: 0, recurrentes: 0, monto_total: 0, pedidos: 0 };
  for (const row of rows || []) {
    resumen = {
      clientes: Number(row.tot_clientes || 0),
      recurrentes: Number(row.tot_recurrentes || 0),
      monto_total: redondear(row.tot_monto),
      pedidos: Number(row.tot_pedidos || 0),
    };
    if (!porKey.has(row.cliente_key)) {
      const pedidos = Number(row.pedidos || 0);
      const monto = redondear(row.monto);
      const cliente = {
        cliente_key: row.cliente_key,
        nombre: row.nombre || 'Cliente sin nombre',
        cedula: row.cedula || null,
        telefono: row.telefono || null,
        pedidos,
        monto,
        ticket_promedio: pedidos > 0 ? redondear(monto / pedidos) : 0,
        ultima_compra: row.ultima_compra || null,
        pedidos_resumen: [],
      };
      porKey.set(row.cliente_key, cliente);
      data.push(cliente);
    }
    if (row.pedido_id != null) {
      porKey.get(row.cliente_key).pedidos_resumen.push({
        id: Number(row.pedido_id),
        fecha: row.pedido_fecha,
        total: redondear(row.pedido_monto),
        items_count: Number(row.pedido_items || 0),
      });
    }
  }
  return { resumen, data };
}

module.exports = { historialClienteDePedido, rankingClientes, ESTADOS_COMPLETADOS };
