// Pagos con Cashea (compra en cuotas).
//
// El cliente paga una inicial (0 % a 50 %, u otro monto) con otro método (pago móvil, transferencia,
// Binance...) y el resto lo financia Cashea en 3 o 6 cuotas. Por cada compra se guardan 2 pagos:
//   1. La inicial, con su método, banco y referencia (si la inicial es mayor que 0).
//   2. La parte de Cashea (monto financiado), siempre en dólares.
// Los datos de la compra (monto total, inicial, cuotas...) van en la tabla pagos_cashea.
//
// Comisión: Cashea cobra a la tienda un porcentaje del MONTO FINANCIADO (4 %). Se guarda el porcentaje
// de cada compra y solo se muestra en los reportes, nunca en el pedido.

const CUOTAS_VALIDAS = [3, 6];
const COMISION_PORCENTAJE = 4;

const redondear = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Calcula y valida una compra con Cashea.
 * Entrada: { monto_total, cuotas, inicial_porcentaje? , inicial_monto? } (si llega inicial_monto, manda ese).
 * Devuelve { ok: true, datos } o { ok: false, error }.
 */
function calcularCashea(entrada) {
  const e = entrada || {};
  const total = redondear(e.monto_total);
  if (!Number.isFinite(total) || total <= 0) return { ok: false, error: 'El monto total de la compra debe ser mayor que 0' };
  const cuotas = Number(e.cuotas);
  if (!CUOTAS_VALIDAS.includes(cuotas)) return { ok: false, error: 'Las cuotas deben ser 3 o 6' };

  let inicial;
  if (e.inicial_monto !== undefined && e.inicial_monto !== null && e.inicial_monto !== '') {
    inicial = redondear(e.inicial_monto);
  } else {
    const pct = Number(e.inicial_porcentaje);
    if (!Number.isFinite(pct)) return { ok: false, error: 'Indica la inicial' };
    inicial = redondear((total * pct) / 100);
  }
  if (!Number.isFinite(inicial) || inicial < 0) return { ok: false, error: 'La inicial no puede ser negativa' };
  if (inicial >= total) return { ok: false, error: 'La inicial debe ser menor que el monto total' };

  const financiado = redondear(total - inicial);
  return {
    ok: true,
    datos: {
      monto_total: total,
      inicial_monto: inicial,
      inicial_porcentaje: redondear((inicial / total) * 100),
      monto_financiado: financiado,
      cuotas,
      monto_cuota: redondear(financiado / cuotas),
      comision_porcentaje: COMISION_PORCENTAJE,
    },
  };
}

let tablaLista = null;
/** Crea la tabla pagos_cashea la primera vez (como el resto de tablas del sistema). */
function asegurarTablaCashea(sql) {
  if (!tablaLista) {
    tablaLista = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS pagos_cashea (
          id SERIAL PRIMARY KEY,
          pedido_venta_id INT NOT NULL,
          pago_id INT,
          pago_inicial_id INT,
          monto_total NUMERIC(12, 2) NOT NULL,
          inicial_porcentaje NUMERIC(6, 2) NOT NULL,
          inicial_monto NUMERIC(12, 2) NOT NULL,
          monto_financiado NUMERIC(12, 2) NOT NULL,
          cuotas INT NOT NULL,
          monto_cuota NUMERIC(12, 2) NOT NULL,
          comision_porcentaje NUMERIC(5, 2) NOT NULL DEFAULT 4,
          creado_en TIMESTAMP DEFAULT (NOW() AT TIME ZONE 'America/Caracas')
        )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_pagos_cashea_pedido ON pagos_cashea (pedido_venta_id)`;
    })().catch((err) => { tablaLista = null; throw err; });
  }
  return tablaLista;
}

/** ¿La forma de pago es Cashea? (por su nombre) */
async function esFormaCashea(sql, formaPagoId) {
  const rows = await sql`SELECT 1 FROM formas_pago WHERE id = ${Number(formaPagoId)} AND nombre ILIKE '%cashea%' LIMIT 1`;
  return rows.length > 0;
}

/**
 * Tasa de un pago según la moneda de su banco (misma regla que al registrar cualquier pago):
 * tasa de la moneda del banco → detalles banco/forma → tasa activa.
 */
async function resolverTasaPago(sql, pago) {
  if (pago.banco_id != null) {
    try {
      const banco = await sql`SELECT moneda FROM bancos WHERE id = ${pago.banco_id}`;
      const moneda = banco?.[0]?.moneda || null;
      if (moneda) {
        const t = await sql`SELECT monto FROM tasas_cambio WHERE simbolo = ${moneda} LIMIT 1`;
        if (t?.[0]) return { tasa: t[0].monto, simbolo: moneda };
      }
    } catch (e) { /* sigue con la siguiente regla */ }
    try {
      const bf = await sql`SELECT detalles FROM banco_formas_pago WHERE banco_id = ${pago.banco_id} AND forma_pago_id = ${pago.forma_pago_id} LIMIT 1`;
      const det = bf?.[0]?.detalles;
      if (det && det.tasa != null) return { tasa: det.tasa, simbolo: det.tasa_simbolo || det.simbolo || null };
    } catch (e) { /* sigue con la siguiente regla */ }
  }
  try {
    const activa = await sql`SELECT monto, simbolo FROM tasas_cambio WHERE activo = TRUE LIMIT 1`;
    if (activa?.[0]) return { tasa: activa[0].monto, simbolo: activa[0].simbolo };
  } catch (e) { /* sin tasa */ }
  return { tasa: null, simbolo: null };
}

/**
 * Guarda la compra con Cashea en un solo paso (todo o nada):
 * la inicial (si hay), la parte de Cashea en dólares y sus datos en pagos_cashea.
 * `inicial`: { forma_pago_id, banco_id?, monto (en la moneda del banco), referencia?, fecha_transaccion? } o null.
 * `casheaPago`: { forma_pago_id (Cashea), referencia?, fecha_transaccion? }.
 */
async function registrarCompraCashea(sql, pedidoId, { datos, inicial, casheaPago }) {
  await asegurarTablaCashea(sql);
  const fechaCashea = casheaPago.fecha_transaccion || null;
  if (inicial) {
    const tasaInicial = await resolverTasaPago(sql, inicial);
    const rows = await sql`
      WITH ini AS (
        INSERT INTO pagos (pedido_venta_id, forma_pago_id, banco_id, monto, referencia, fecha_transaccion, fecha, tasa, tasa_simbolo)
        VALUES (${pedidoId}, ${inicial.forma_pago_id}, ${inicial.banco_id ?? null}, ${inicial.monto}, ${inicial.referencia || null},
                ${inicial.fecha_transaccion || null}, NOW(), ${tasaInicial.tasa ?? null}, ${tasaInicial.simbolo ?? null})
        RETURNING id
      ),
      cas AS (
        INSERT INTO pagos (pedido_venta_id, forma_pago_id, banco_id, monto, referencia, fecha_transaccion, fecha, tasa, tasa_simbolo)
        VALUES (${pedidoId}, ${casheaPago.forma_pago_id}, NULL, ${datos.monto_financiado}, ${casheaPago.referencia || null},
                ${fechaCashea}, NOW(), 1, 'USD')
        RETURNING id
      )
      INSERT INTO pagos_cashea (pedido_venta_id, pago_id, pago_inicial_id, monto_total, inicial_porcentaje, inicial_monto,
                                monto_financiado, cuotas, monto_cuota, comision_porcentaje)
      SELECT ${pedidoId}, (SELECT id FROM cas), (SELECT id FROM ini), ${datos.monto_total}, ${datos.inicial_porcentaje},
             ${datos.inicial_monto}, ${datos.monto_financiado}, ${datos.cuotas}, ${datos.monto_cuota}, ${datos.comision_porcentaje}
      RETURNING *`;
    return rows[0];
  }
  const rows = await sql`
    WITH cas AS (
      INSERT INTO pagos (pedido_venta_id, forma_pago_id, banco_id, monto, referencia, fecha_transaccion, fecha, tasa, tasa_simbolo)
      VALUES (${pedidoId}, ${casheaPago.forma_pago_id}, NULL, ${datos.monto_financiado}, ${casheaPago.referencia || null},
              ${fechaCashea}, NOW(), 1, 'USD')
      RETURNING id
    )
    INSERT INTO pagos_cashea (pedido_venta_id, pago_id, pago_inicial_id, monto_total, inicial_porcentaje, inicial_monto,
                              monto_financiado, cuotas, monto_cuota, comision_porcentaje)
    SELECT ${pedidoId}, (SELECT id FROM cas), NULL, ${datos.monto_total}, ${datos.inicial_porcentaje},
           ${datos.inicial_monto}, ${datos.monto_financiado}, ${datos.cuotas}, ${datos.monto_cuota}, ${datos.comision_porcentaje}
    RETURNING *`;
  return rows[0];
}

/** Compras con Cashea de un pedido (para mostrarlas en el detalle; sin comisión). */
async function casheaDePedido(sql, pedidoId) {
  await asegurarTablaCashea(sql);
  const rows = await sql`
    SELECT id, pago_id, pago_inicial_id, monto_total, inicial_porcentaje, inicial_monto, monto_financiado, cuotas, monto_cuota
    FROM pagos_cashea WHERE pedido_venta_id = ${pedidoId} ORDER BY id`;
  return rows.map(paraPedido);
}

function paraPedido(r) {
  return {
    id: r.id,
    pago_id: r.pago_id,
    pago_inicial_id: r.pago_inicial_id,
    monto_total: Number(r.monto_total),
    inicial_porcentaje: Number(r.inicial_porcentaje),
    inicial_monto: Number(r.inicial_monto),
    monto_financiado: Number(r.monto_financiado),
    cuotas: Number(r.cuotas),
    monto_cuota: Number(r.monto_cuota),
  };
}

const ESTADOS_ANULADOS = ['cancelado', 'cancelada', 'anulado', 'anulada'];

/**
 * Resumen de Cashea para reportes (con comisión). Fechas 'AAAA-MM-DD' ('' = sin límite).
 * Cuenta las compras por la fecha en que se registró el pago; no cuenta pedidos cancelados.
 */
async function resumenCashea(sql, { fechaInicio = '', fechaFin = '' } = {}) {
  await asegurarTablaCashea(sql);
  const rows = await sql`
    WITH compras AS (
      SELECT pc.*
      FROM pagos_cashea pc
      JOIN pedidos_venta pv ON pv.id = pc.pedido_venta_id
      LEFT JOIN pagos p ON p.id = pc.pago_id
      WHERE LOWER(TRIM(COALESCE(pv.estado, ''))) <> ALL(${ESTADOS_ANULADOS})
        AND (NULLIF(${fechaInicio}, '')::date IS NULL OR COALESCE(p.fecha_transaccion, p.fecha, pc.creado_en) >= NULLIF(${fechaInicio}, '')::date)
        AND (NULLIF(${fechaFin}, '')::date IS NULL OR COALESCE(p.fecha_transaccion, p.fecha, pc.creado_en) < NULLIF(${fechaFin}, '')::date + INTERVAL '1 day')
    )
    SELECT
      COUNT(*)::int AS compras,
      COUNT(DISTINCT pedido_venta_id)::int AS pedidos,
      COALESCE(SUM(monto_total), 0) AS monto_total,
      COALESCE(SUM(inicial_monto), 0) AS iniciales,
      COALESCE(SUM(monto_financiado), 0) AS monto_financiado,
      COALESCE(SUM(monto_financiado * comision_porcentaje / 100), 0) AS comision,
      COUNT(*) FILTER (WHERE cuotas = 3)::int AS cuotas_3,
      COUNT(*) FILTER (WHERE cuotas = 6)::int AS cuotas_6,
      (SELECT json_agg(x ORDER BY x.compras DESC, x.porcentaje) FROM (
         SELECT ROUND(inicial_porcentaje)::int AS porcentaje, COUNT(*)::int AS compras FROM compras GROUP BY 1
      ) x) AS iniciales_por_porcentaje
    FROM compras`;
  const r = rows[0] || {};
  const financiado = redondear(r.monto_financiado || 0);
  const comision = redondear(r.comision || 0);
  return {
    compras: Number(r.compras || 0),
    pedidos: Number(r.pedidos || 0),
    monto_total: redondear(r.monto_total || 0),
    iniciales: redondear(r.iniciales || 0),
    monto_financiado: financiado,
    comision,
    llega_de_cashea: redondear(financiado - comision),
    cuotas_3: Number(r.cuotas_3 || 0),
    cuotas_6: Number(r.cuotas_6 || 0),
    iniciales_por_porcentaje: Array.isArray(r.iniciales_por_porcentaje) ? r.iniciales_por_porcentaje : [],
  };
}

/** Cashea de los pedidos completados un día (para el cierre diario; sin comisión). */
async function casheaDelDia(sql, pedidoIds) {
  const ids = (pedidoIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const vacio = { pedidos: 0, monto_total: 0, iniciales: 0, monto_financiado: 0, por_pedido: {} };
  if (ids.length === 0) return vacio;
  await asegurarTablaCashea(sql);
  const rows = await sql`
    SELECT pedido_venta_id, SUM(monto_total) AS monto_total, SUM(inicial_monto) AS iniciales,
           SUM(monto_financiado) AS monto_financiado, MAX(cuotas) AS cuotas
    FROM pagos_cashea WHERE pedido_venta_id = ANY(${ids}) GROUP BY pedido_venta_id`;
  const res = { ...vacio, por_pedido: {} };
  for (const r of rows) {
    const item = {
      monto_total: redondear(r.monto_total),
      iniciales: redondear(r.iniciales),
      monto_financiado: redondear(r.monto_financiado),
      cuotas: Number(r.cuotas),
    };
    res.por_pedido[r.pedido_venta_id] = item;
    res.pedidos += 1;
    res.monto_total = redondear(res.monto_total + item.monto_total);
    res.iniciales = redondear(res.iniciales + item.iniciales);
    res.monto_financiado = redondear(res.monto_financiado + item.monto_financiado);
  }
  return res;
}

module.exports = {
  CUOTAS_VALIDAS,
  COMISION_PORCENTAJE,
  calcularCashea,
  asegurarTablaCashea,
  esFormaCashea,
  registrarCompraCashea,
  casheaDePedido,
  resumenCashea,
  casheaDelDia,
};
