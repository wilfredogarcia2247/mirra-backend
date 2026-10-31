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

// ---------------------------------------------------------------------------
// Recompras: cada pedido se marca como "nuevo" (primera compra del cliente en toda su historia)
// o "recompra" (el cliente ya había comprado antes). Los grupos cuentan TODAS las compras del
// cliente, pero solo aparecen los clientes que compraron dentro del periodo elegido.
// Parámetros: $1 estados, $2 fecha inicio ('' = sin límite), $3 fecha fin ('' = sin límite).
// ---------------------------------------------------------------------------
const RECOMPRA_CTES = `
  ${PEDIDOS_CLIENTE_CTE},
  numerados AS (
    SELECT pc.*,
      ROW_NUMBER() OVER (PARTITION BY cliente_key ORDER BY fecha, id) AS n_compra,
      LAG(fecha) OVER (PARTITION BY cliente_key ORDER BY fecha, id) AS fecha_anterior
    FROM pedidos_cliente pc
  ),
  en_periodo AS (
    SELECT * FROM numerados
    WHERE (NULLIF($2, '')::date IS NULL OR fecha >= NULLIF($2, '')::date)
      AND (NULLIF($3, '')::date IS NULL OR fecha < NULLIF($3, '')::date + INTERVAL '1 day')
  ),
  historico AS (
    SELECT
      cliente_key,
      COUNT(*)::int AS compras,
      COALESCE(SUM(monto), 0) AS monto,
      MIN(fecha) AS primera_compra,
      MAX(fecha) AS ultima_compra,
      (ARRAY_AGG(nombre ORDER BY fecha DESC, id DESC) FILTER (WHERE nombre IS NOT NULL))[1] AS nombre,
      (ARRAY_AGG(cedula ORDER BY fecha DESC, id DESC) FILTER (WHERE cedula IS NOT NULL))[1] AS cedula,
      (ARRAY_AGG(telefono ORDER BY fecha DESC, id DESC) FILTER (WHERE telefono IS NOT NULL))[1] AS telefono
    FROM pedidos_cliente
    GROUP BY cliente_key
  ),
  activos AS (
    SELECT h.*,
      CASE WHEN h.compras >= 10 THEN '10+' WHEN h.compras >= 6 THEN '6-9' ELSE h.compras::text END AS grupo,
      COALESCE(p.compras_periodo, 0) AS compras_periodo,
      COALESCE(p.monto_periodo, 0) AS monto_periodo
    FROM historico h
    JOIN (
      SELECT cliente_key, COUNT(*)::int AS compras_periodo, COALESCE(SUM(monto), 0) AS monto_periodo
      FROM en_periodo GROUP BY cliente_key
    ) p ON p.cliente_key = h.cliente_key
  )`;

const GRUPOS = [
  { id: '1', etiqueta: '1 vez', minimo: 1 },
  { id: '2', etiqueta: '2 veces', minimo: 2 },
  { id: '3', etiqueta: '3 veces', minimo: 3 },
  { id: '4', etiqueta: '4 veces', minimo: 4 },
  { id: '5', etiqueta: '5 veces', minimo: 5 },
  { id: '6-9', etiqueta: '6 a 9 veces', minimo: 6 },
  { id: '10+', etiqueta: '10 veces o más', minimo: 10 },
];

const pct = (parte, total) => (Number(total) > 0 ? Math.round((Number(parte) / Number(total)) * 1000) / 10 : 0);

async function estadisticasRecompra(sql, { fechaInicio = '', fechaFin = '' } = {}) {
  const params = [ESTADOS_COMPLETADOS, fechaInicio, fechaFin];

  const [resumenRows, mesesRows, gruposRows] = await Promise.all([
    sql.query(`
      WITH ${RECOMPRA_CTES}
      SELECT
        (SELECT COUNT(*) FROM en_periodo)::int AS pedidos,
        (SELECT COUNT(*) FROM en_periodo WHERE n_compra = 1)::int AS pedidos_nuevos,
        (SELECT COUNT(*) FROM en_periodo WHERE n_compra > 1)::int AS pedidos_recompra,
        (SELECT COALESCE(SUM(monto), 0) FROM en_periodo) AS monto,
        (SELECT COALESCE(SUM(monto), 0) FROM en_periodo WHERE n_compra = 1) AS monto_nuevos,
        (SELECT COALESCE(SUM(monto), 0) FROM en_periodo WHERE n_compra > 1) AS monto_recompra,
        (SELECT COUNT(*) FROM activos)::int AS clientes,
        (SELECT COUNT(*) FROM activos WHERE compras >= 2)::int AS clientes_recurrentes,
        (SELECT COUNT(DISTINCT cliente_key) FROM en_periodo WHERE n_compra = 1)::int AS clientes_nuevos,
        (SELECT COUNT(*) FROM activos a WHERE a.compras >= 2
           AND EXISTS (SELECT 1 FROM en_periodo e WHERE e.cliente_key = a.cliente_key AND e.n_compra = 1))::int AS nuevos_que_volvieron,
        (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (fecha - fecha_anterior)) / 86400)
           FROM en_periodo WHERE n_compra = 2) AS dias_segunda_compra,
        -- Clientes que ya habían comprado ANTES del periodo: cuántos volvieron y cuántos no.
        -- Sin fecha de inicio ("Todo") no hay un antes: "no volvieron" = compraron una sola vez.
        (SELECT COUNT(*) FROM historico WHERE NULLIF($2, '') IS NOT NULL AND primera_compra < NULLIF($2, '')::date)::int AS clientes_anteriores,
        (SELECT COUNT(*) FROM activos WHERE NULLIF($2, '') IS NOT NULL AND primera_compra < NULLIF($2, '')::date)::int AS anteriores_volvieron,
        (SELECT COUNT(*) FROM historico WHERE compras = 1)::int AS clientes_una_compra,
        (SELECT COALESCE(SUM(compras), 0) FROM historico)::int AS pedidos_historicos,
        (SELECT COUNT(*) FROM historico)::int AS clientes_historicos
    `, params),
    sql.query(`
      WITH ${RECOMPRA_CTES},
      base AS (
        SELECT * FROM en_periodo
        WHERE NOT (NULLIF($2, '') IS NULL AND NULLIF($3, '') IS NULL)
           OR fecha >= DATE_TRUNC('month', NOW()) - INTERVAL '11 months'
      )
      SELECT
        TO_CHAR(DATE_TRUNC('month', b.fecha), 'YYYY-MM') AS mes,
        COUNT(*) FILTER (WHERE b.n_compra = 1)::int AS pedidos_nuevos,
        COUNT(*) FILTER (WHERE b.n_compra > 1)::int AS pedidos_recompra,
        COALESCE(SUM(b.monto) FILTER (WHERE b.n_compra = 1), 0) AS monto_nuevos,
        COALESCE(SUM(b.monto) FILTER (WHERE b.n_compra > 1), 0) AS monto_recompra,
        COUNT(*) FILTER (WHERE b.n_compra = 1 AND h.compras >= 2)::int AS nuevos_que_volvieron
      FROM base b
      JOIN historico h ON h.cliente_key = b.cliente_key
      GROUP BY 1
      ORDER BY 1
    `, params),
    sql.query(`
      WITH ${RECOMPRA_CTES}
      SELECT grupo, COUNT(*)::int AS clientes, COALESCE(SUM(monto), 0) AS monto, COALESCE(SUM(compras), 0)::int AS compras
      FROM activos
      GROUP BY grupo
    `, params),
  ]);

  const r = resumenRows[0] || {};
  const resumen = {
    pedidos: Number(r.pedidos || 0),
    pedidos_nuevos: Number(r.pedidos_nuevos || 0),
    pedidos_recompra: Number(r.pedidos_recompra || 0),
    tasa_recompra: pct(r.pedidos_recompra, r.pedidos),
    monto: redondear(r.monto),
    monto_nuevos: redondear(r.monto_nuevos),
    monto_recompra: redondear(r.monto_recompra),
    porcentaje_monto_recompra: pct(r.monto_recompra, r.monto),
    clientes: Number(r.clientes || 0),
    clientes_recurrentes: Number(r.clientes_recurrentes || 0),
    porcentaje_clientes_recurrentes: pct(r.clientes_recurrentes, r.clientes),
    clientes_nuevos: Number(r.clientes_nuevos || 0),
    nuevos_que_volvieron: Number(r.nuevos_que_volvieron || 0),
    porcentaje_nuevos_que_volvieron: pct(r.nuevos_que_volvieron, r.clientes_nuevos),
    dias_segunda_compra: r.dias_segunda_compra == null ? null : Math.round(Number(r.dias_segunda_compra)),
    compras_por_cliente: Number(r.clientes) > 0 ? Math.round((Number(r.pedidos) / Number(r.clientes)) * 100) / 100 : 0,
    pedidos_historicos: Number(r.pedidos_historicos || 0),
    clientes_historicos: Number(r.clientes_historicos || 0),
  };

  // Los 3 grupos de clientes del periodo (no se mezclan):
  // nuevos (primera compra en el periodo), volvieron (ya eran clientes y compraron otra vez)
  // y no volvieron (ya eran clientes y no compraron en el periodo).
  // Con "Todo" no hay un antes: volvieron = 2 compras o más, no volvieron = una sola compra.
  const conInicio = Boolean(fechaInicio);
  const volvieron = conInicio ? Number(r.anteriores_volvieron || 0) : resumen.clientes_historicos - Number(r.clientes_una_compra || 0);
  const noVolvieron = conInicio ? Number(r.clientes_anteriores || 0) - volvieron : Number(r.clientes_una_compra || 0);
  resumen.grupos_clientes = {
    modo: conInicio ? 'periodo' : 'todo',
    nuevos: conInicio ? resumen.clientes_nuevos : 0,
    volvieron,
    no_volvieron: noVolvieron,
    // De los clientes que ya teníamos, qué parte volvió a comprar
    porcentaje_volvieron: pct(volvieron, volvieron + noVolvieron),
  };

  const meses = (mesesRows || []).map((m) => {
    const nuevos = Number(m.pedidos_nuevos || 0);
    const recompra = Number(m.pedidos_recompra || 0);
    return {
      mes: m.mes,
      pedidos: nuevos + recompra,
      pedidos_nuevos: nuevos,
      pedidos_recompra: recompra,
      tasa_recompra: pct(recompra, nuevos + recompra),
      monto_nuevos: redondear(m.monto_nuevos),
      monto_recompra: redondear(m.monto_recompra),
      clientes_nuevos: nuevos,
      nuevos_que_volvieron: Number(m.nuevos_que_volvieron || 0),
      porcentaje_nuevos_que_volvieron: pct(m.nuevos_que_volvieron, nuevos),
    };
  });

  const porGrupo = new Map((gruposRows || []).map((g) => [g.grupo, g]));
  const totalClientes = resumen.clientes;
  const grupos = GRUPOS.map((g) => {
    const row = porGrupo.get(g.id) || {};
    const clientes = Number(row.clientes || 0);
    const alMenos = (gruposRows || [])
      .filter((x) => {
        const n = x.grupo === '10+' ? 10 : x.grupo === '6-9' ? 6 : Number(x.grupo);
        return n >= g.minimo;
      })
      .reduce((s, x) => s + Number(x.clientes || 0), 0);
    return {
      id: g.id,
      etiqueta: g.etiqueta,
      minimo: g.minimo,
      clientes,
      porcentaje: pct(clientes, totalClientes),
      monto: redondear(row.monto),
      compras: Number(row.compras || 0),
      ticket_promedio: Number(row.compras) > 0 ? redondear(Number(row.monto) / Number(row.compras)) : 0,
      al_menos: alMenos,
      porcentaje_al_menos: pct(alMenos, totalClientes),
    };
  });

  return { resumen, meses, grupos };
}

// Filtro de la lista "no volvieron" por tiempo sin comprar (días desde su última compra)
const INACTIVIDADES = ['todos', 'hasta60', '60-90', '90+'];

// Lista paginada de los clientes de un grupo (o todos / 2+ / no_volvieron), con sus últimas compras.
// "no_volvieron": ya habían comprado antes del periodo y no compraron en él
// (sin fecha de inicio: clientes que compraron una sola vez).
async function clientesPorGrupo(sql, { fechaInicio = '', fechaFin = '', grupo = 'todos', page = 1, pageSize = 20, orden = 'monto', q = '', inactividad = 'todos' } = {}) {
  const ordenSql = orden === 'compras'
    ? 'compras DESC, monto DESC'
    : orden === 'reciente' ? 'ultima_compra DESC' : 'monto DESC, compras DESC';
  const offset = (page - 1) * pageSize;
  const busqueda = String(q || '').trim();
  const busquedaDigitos = busqueda.replace(/[^0-9]/g, '');
  const filtroDias = INACTIVIDADES.includes(inactividad) ? inactividad : 'todos';
  const params = [ESTADOS_COMPLETADOS, fechaInicio, fechaFin, grupo, busqueda, busquedaDigitos, pageSize, offset, filtroDias];

  const rows = await sql.query(`
    WITH ${RECOMPRA_CTES},
    base AS (
      SELECT a.cliente_key, a.compras, a.monto, a.primera_compra, a.ultima_compra, a.nombre, a.cedula, a.telefono,
             a.grupo, a.compras_periodo, a.monto_periodo
      FROM activos a
      WHERE $4 <> 'no_volvieron'
      UNION ALL
      SELECT h.cliente_key, h.compras, h.monto, h.primera_compra, h.ultima_compra, h.nombre, h.cedula, h.telefono,
             'no_volvieron' AS grupo, 0 AS compras_periodo, 0 AS monto_periodo
      FROM historico h
      WHERE $4 = 'no_volvieron'
        AND CASE
          WHEN NULLIF($2, '') IS NULL THEN h.compras = 1
          ELSE h.primera_compra < NULLIF($2, '')::date
               AND NOT EXISTS (SELECT 1 FROM en_periodo e WHERE e.cliente_key = h.cliente_key)
        END
    ),
    con_dias AS (
      SELECT b.*, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ((NOW() AT TIME ZONE 'America/Caracas') - b.ultima_compra)) / 86400))::int AS dias_sin_comprar
      FROM base b
    ),
    filtrados AS (
      SELECT * FROM con_dias
      WHERE ($4 IN ('todos', 'no_volvieron') OR ($4 = '2+' AND compras >= 2) OR grupo = $4)
        AND ($9 = 'todos'
             OR ($9 = 'hasta60' AND dias_sin_comprar < 60)
             OR ($9 = '60-90' AND dias_sin_comprar >= 60 AND dias_sin_comprar < 90)
             OR ($9 = '90+' AND dias_sin_comprar >= 90))
        AND ($5 = '' OR nombre ILIKE '%' || $5 || '%'
             OR ($6 <> '' AND (REGEXP_REPLACE(COALESCE(cedula, ''), '[^0-9]', '', 'g') LIKE '%' || $6 || '%'
                               OR REGEXP_REPLACE(COALESCE(telefono, ''), '[^0-9]', '', 'g') LIKE '%' || $6 || '%')))
    ),
    pagina AS (
      SELECT *, COUNT(*) OVER () AS total
      FROM filtrados
      ORDER BY ${ordenSql}, cliente_key
      LIMIT $7 OFFSET $8
    ),
    ultimos AS (
      SELECT pc.cliente_key, pc.id, pc.fecha, pc.monto, pc.items,
        ROW_NUMBER() OVER (PARTITION BY pc.cliente_key ORDER BY pc.fecha DESC, pc.id DESC) AS rn
      FROM pedidos_cliente pc JOIN pagina p ON p.cliente_key = pc.cliente_key
    )
    SELECT p.*, u.id AS pedido_id, u.fecha AS pedido_fecha, u.monto AS pedido_monto, u.items AS pedido_items
    FROM pagina p
    LEFT JOIN ultimos u ON u.cliente_key = p.cliente_key AND u.rn <= 5
    ORDER BY ${ordenSql.replace(/(compras|monto|ultima_compra)/g, 'p.$1')}, p.cliente_key, u.fecha DESC, u.id DESC
  `, params);

  let total = 0;
  const data = [];
  const porKey = new Map();
  for (const row of rows || []) {
    total = Number(row.total || 0);
    if (!porKey.has(row.cliente_key)) {
      const compras = Number(row.compras || 0);
      const monto = redondear(row.monto);
      const c = {
        cliente_key: row.cliente_key,
        nombre: row.nombre || 'Cliente sin nombre',
        cedula: row.cedula || null,
        telefono: row.telefono || null,
        compras,
        monto,
        ticket_promedio: compras > 0 ? redondear(monto / compras) : 0,
        compras_periodo: Number(row.compras_periodo || 0),
        monto_periodo: redondear(row.monto_periodo),
        primera_compra: row.primera_compra || null,
        ultima_compra: row.ultima_compra || null,
        dias_sin_comprar: row.dias_sin_comprar == null ? null : Number(row.dias_sin_comprar),
        pedidos_resumen: [],
      };
      porKey.set(row.cliente_key, c);
      data.push(c);
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
  return { total, page, page_size: pageSize, paginas: Math.max(1, Math.ceil(total / pageSize)), data };
}

module.exports = { historialClienteDePedido, rankingClientes, estadisticasRecompra, clientesPorGrupo, ESTADOS_COMPLETADOS, GRUPOS, INACTIVIDADES, RECOMPRA_CTES };
