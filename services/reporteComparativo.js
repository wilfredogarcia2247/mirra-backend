// Reporte "Cómo vamos": compara dos periodos (ventas, perfumes, presentaciones, productos, clientes,
// entregas, pagos y cupones) y muestra la evolución mes a mes.
//
// Mismos criterios que "Clientes y recompras" (services/clientesFrecuentes.js):
// - Solo pedidos completados; la fecha es la del pago (completado_en) o, si no hay, la del pedido.
// - El monto de cada pedido resta cupón, descuento al mayor y descuentos manuales; no incluye delivery ni envío.
// - El descuento del pedido se reparte entre sus perfumes en proporción a su precio.
// - Costo de cada perfume: el guardado al vender o, si es 0, el costo actual de su presentación.
//   La ganancia solo se calcula sobre lo que tiene costo; "cobertura" dice qué parte de las ventas lo tiene.

const { ESTADOS_COMPLETADOS, RECOMPRA_CTES } = require('./clientesFrecuentes');

// Perfumes de los pedidos del periodo, con su parte del monto neto y su presentación (ml).
// Requiere RECOMPRA_CTES (usa en_periodo).
const LINEAS_CTE = `
  lineas AS (
    SELECT
      e.id AS pedido_id,
      e.fecha,
      e.monto AS monto_pedido,
      pvp.producto_id,
      COALESCE(pvp.cantidad, 0)::numeric AS cantidad,
      COALESCE(pvp.cantidad, 0) * COALESCE(pvp.precio_venta, prod.precio_venta, 0) AS bruto,
      COALESCE(NULLIF(pvp.costo_unitario, 0), NULLIF(f.costo, 0), 0) AS costo_guardado,
      COALESCE(NULLIF(TRIM(prod.nombre), ''), NULLIF(TRIM(pvp.nombre_producto), ''), 'Producto #' || pvp.producto_id::text) AS producto,
      LOWER(COALESCE(pvp.formula_nombre, pvp.nombre_producto, prod.nombre, '')) AS nombre_pres
    FROM en_periodo e
    JOIN pedido_venta_productos pvp ON pvp.pedido_venta_id = e.id
    LEFT JOIN productos prod ON prod.id = pvp.producto_id
    LEFT JOIN formulas f ON f.id = pvp.formula_id
  ),
  lineas_ml AS (
    SELECT l.*, REPLACE(SUBSTRING(l.nombre_pres FROM '([0-9]+(?:[.,][0-9]+)?)\\s*ml'), ',', '.') AS ml
    FROM lineas l
  ),
  -- Costo de cada perfume: el especial de ese perfume y tamaño, si no el general del tamaño
  -- (Finanzas → Costos por presentación), si no el guardado en la venta o en la presentación.
  -- La tabla costos_presentacion la crea services/costosPresentacion.js antes de esta consulta.
  lineas_netas AS (
    SELECT l.*,
      CASE WHEN SUM(l.bruto) OVER (PARTITION BY l.pedido_id) > 0
        THEN l.bruto * l.monto_pedido / SUM(l.bruto) OVER (PARTITION BY l.pedido_id)
        ELSE 0 END AS neto,
      COALESCE(
        (SELECT c.costo FROM costos_presentacion c WHERE c.producto_id = l.producto_id AND c.ml = NULLIF(l.ml, '')::numeric),
        (SELECT c.costo FROM costos_presentacion c WHERE c.producto_id = 0 AND c.ml = NULLIF(l.ml, '')::numeric),
        NULLIF(l.costo_guardado, 0),
        0) AS costo_u
    FROM lineas_ml l
  )`;

const num = (v) => Number(v || 0);
const dinero = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

/** Todos los datos de un periodo (fechas 'AAAA-MM-DD', ambas incluidas). */
async function datosPeriodo(sql, inicio, fin) {
  const rows = await sql.query(`
    WITH ${RECOMPRA_CTES},
    ${LINEAS_CTE},
    pedidos AS (
      SELECT e.id, e.monto, e.n_compra, e.cliente_key, pv.tipo_entrega, pv.datos_entrega,
             pv.cupon_codigo, COALESCE(pv.descuento_cupon, 0) AS descuento_cupon, COALESCE(pv.descuento_mayor, 0) AS descuento_mayor
      FROM en_periodo e
      JOIN pedidos_venta pv ON pv.id = e.id
    )
    SELECT
      (SELECT COUNT(*) FROM pedidos)::int AS pedidos,
      (SELECT COUNT(*) FROM pedidos WHERE n_compra > 1)::int AS pedidos_recompra,
      (SELECT COUNT(DISTINCT cliente_key) FROM pedidos)::int AS clientes,
      (SELECT COUNT(*) FROM pedidos WHERE n_compra = 1)::int AS clientes_nuevos,
      (SELECT COALESCE(SUM(monto), 0) FROM pedidos) AS ventas,
      (SELECT COALESCE(SUM(cantidad), 0) FROM lineas_netas) AS unidades,
      (SELECT COALESCE(SUM(bruto), 0) FROM lineas_netas) AS bruto,
      (SELECT COALESCE(SUM(neto), 0) FROM lineas_netas WHERE costo_u > 0) AS ventas_con_costo,
      (SELECT COALESCE(SUM(cantidad * costo_u), 0) FROM lineas_netas WHERE costo_u > 0) AS costo,
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT COALESCE(ml, 'otro') AS ml, SUM(cantidad) AS unidades, SUM(neto) AS monto,
                SUM(cantidad * costo_u) FILTER (WHERE costo_u > 0) AS costo,
                SUM(neto) FILTER (WHERE costo_u > 0) AS monto_con_costo
         FROM lineas_netas GROUP BY 1
      ) x) AS presentaciones,
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT producto_id, MAX(producto) AS nombre, SUM(cantidad) AS unidades, SUM(neto) AS monto
         FROM lineas_netas GROUP BY producto_id
      ) x) AS productos,
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT COALESCE(NULLIF(TRIM(tipo_entrega), ''), 'sin_dato') AS id, COUNT(*) AS pedidos, SUM(monto) AS monto
         FROM pedidos GROUP BY 1
      ) x) AS entregas,
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT INITCAP(LOWER(TRIM(datos_entrega->>'estado'))) AS id, COUNT(*) AS pedidos, SUM(monto) AS monto
         FROM pedidos
         WHERE tipo_entrega = 'envio_nacional' AND NULLIF(TRIM(datos_entrega->>'estado'), '') IS NOT NULL
         GROUP BY 1
      ) x) AS estados,
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT COALESCE(NULLIF(TRIM(fp.nombre), ''), 'Sin método') AS id, COUNT(DISTINCT p.id) AS pedidos
         FROM pedidos p
         JOIN pagos pg ON pg.pedido_venta_id = p.id
         LEFT JOIN formas_pago fp ON fp.id = pg.forma_pago_id
         GROUP BY 1
      ) x) AS pagos,
      (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
         SELECT UPPER(TRIM(cupon_codigo)) AS id, COUNT(*) AS pedidos, SUM(descuento_cupon) AS descuento
         FROM pedidos WHERE NULLIF(TRIM(cupon_codigo), '') IS NOT NULL GROUP BY 1
         UNION ALL
         SELECT 'Descuento al mayor', COUNT(*), SUM(descuento_mayor)
         FROM pedidos WHERE descuento_mayor > 0
         HAVING COUNT(*) > 0
      ) x) AS cupones
  `, [ESTADOS_COMPLETADOS, inicio, fin]);

  const r = rows[0] || {};
  const pedidos = num(r.pedidos);
  const ventas = dinero(r.ventas);
  const unidades = num(r.unidades);
  const ventasConCosto = dinero(r.ventas_con_costo);
  const costo = dinero(r.costo);
  const lista = (v, campos) => (Array.isArray(v) ? v : []).map((x) => {
    const o = { ...x };
    for (const c of campos) o[c] = ['monto', 'descuento', 'costo', 'monto_con_costo'].includes(c) ? dinero(o[c]) : num(o[c]);
    return o;
  });

  return {
    inicio,
    fin,
    resumen: {
      ventas,
      pedidos,
      unidades,
      ticket_promedio: pedidos > 0 ? dinero(ventas / pedidos) : 0,
      perfumes_por_pedido: pedidos > 0 ? Math.round((unidades / pedidos) * 100) / 100 : 0,
      clientes: num(r.clientes),
      clientes_nuevos: num(r.clientes_nuevos),
      pedidos_recompra: num(r.pedidos_recompra),
      porcentaje_recompra: pedidos > 0 ? Math.round((num(r.pedidos_recompra) / pedidos) * 1000) / 10 : 0,
      descuentos: dinero(Math.max(0, num(r.bruto) - ventas)),
      costo,
      ganancia: dinero(ventasConCosto - costo),
      ventas_con_costo: ventasConCosto,
      // Qué parte de las ventas tiene costo cargado (0 a 100)
      cobertura_costo: ventas > 0 ? Math.round((ventasConCosto / ventas) * 1000) / 10 : 0,
    },
    presentaciones: lista(r.presentaciones, ['unidades', 'monto', 'costo', 'monto_con_costo']),
    productos: lista(r.productos, ['producto_id', 'unidades', 'monto']),
    entregas: lista(r.entregas, ['pedidos', 'monto']),
    estados: lista(r.estados, ['pedidos', 'monto']),
    pagos: lista(r.pagos, ['pedidos']),
    cupones: lista(r.cupones, ['pedidos', 'descuento']),
  };
}

/** Lista de meses 'AAAA-MM' entre dos fechas (ambas incluidas). */
function mesesEntre(inicio, fin) {
  const [ya, ma] = inicio.split('-').map(Number);
  const [yb, mb] = fin.split('-').map(Number);
  const meses = [];
  let y = ya;
  let m = ma;
  while ((y < yb || (y === yb && m <= mb)) && meses.length < 120) {
    meses.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return meses;
}

/** Totales por mes entre dos fechas, con perfumes por presentación. Los meses sin ventas salen en 0. */
async function evolucionMensual(sql, inicio, fin) {
  const rows = await sql.query(`
    WITH ${RECOMPRA_CTES},
    ${LINEAS_CTE},
    por_mes AS (
      SELECT TO_CHAR(DATE_TRUNC('month', fecha), 'YYYY-MM') AS mes,
        COUNT(*)::int AS pedidos,
        COALESCE(SUM(monto), 0) AS ventas,
        COUNT(DISTINCT cliente_key)::int AS clientes,
        COUNT(*) FILTER (WHERE n_compra = 1)::int AS clientes_nuevos,
        COUNT(*) FILTER (WHERE n_compra > 1)::int AS pedidos_recompra
      FROM en_periodo GROUP BY 1
    ),
    unidades_mes AS (
      SELECT TO_CHAR(DATE_TRUNC('month', fecha), 'YYYY-MM') AS mes, COALESCE(ml, 'otro') AS ml, SUM(cantidad) AS unidades
      FROM lineas_netas GROUP BY 1, 2
    )
    SELECT p.*,
      (SELECT COALESCE(json_object_agg(u.ml, u.unidades), '{}'::json) FROM unidades_mes u WHERE u.mes = p.mes) AS por_presentacion
    FROM por_mes p
    ORDER BY p.mes
  `, [ESTADOS_COMPLETADOS, inicio, fin]);

  const porMes = new Map((rows || []).map((r) => [r.mes, r]));
  return mesesEntre(inicio, fin).map((mes) => {
    const r = porMes.get(mes) || {};
    const pedidos = num(r.pedidos);
    const ventas = dinero(r.ventas);
    const porPresentacion = {};
    for (const [ml, u] of Object.entries(r.por_presentacion || {})) porPresentacion[ml] = num(u);
    const unidades = Object.values(porPresentacion).reduce((s, u) => s + u, 0);
    return {
      mes,
      ventas,
      pedidos,
      unidades,
      ticket_promedio: pedidos > 0 ? dinero(ventas / pedidos) : 0,
      clientes: num(r.clientes),
      clientes_nuevos: num(r.clientes_nuevos),
      porcentaje_recompra: pedidos > 0 ? Math.round((num(r.pedidos_recompra) / pedidos) * 1000) / 10 : 0,
      por_presentacion: porPresentacion,
    };
  });
}

module.exports = { datosPeriodo, evolucionMensual, mesesEntre };
