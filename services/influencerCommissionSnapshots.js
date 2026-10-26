const { neon } = require('@neondatabase/serverless');
const {
  calculateCommission,
  calculateCommissionableBase,
  isOrderPaid,
} = require('./influencerCommissions');

const sql = neon(process.env.DATABASE_URL);
let supportTablesEnsured = false;

async function ensureSnapshotSupportTables(sqlClient) {
  if (supportTablesEnsured) return;
  await sqlClient`
    CREATE TABLE IF NOT EXISTS pedido_venta_ajustes (
      id SERIAL PRIMARY KEY,
      pedido_venta_id INT NOT NULL,
      tipo VARCHAR(20) NOT NULL,
      modo VARCHAR(20) NOT NULL,
      valor NUMERIC NOT NULL,
      motivo TEXT NOT NULL,
      created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
    )
  `;
  await sqlClient`
    CREATE TABLE IF NOT EXISTS pagos (
      id SERIAL PRIMARY KEY,
      pedido_venta_id INT,
      forma_pago_id INT,
      banco_id INT,
      monto NUMERIC,
      referencia TEXT,
      fecha_transaccion TIMESTAMP,
      fecha TIMESTAMP,
      tasa NUMERIC,
      tasa_simbolo VARCHAR(10)
    )
  `;
  supportTablesEnsured = true;
}

async function snapshotPaidOrderCommission(orderId, sqlClient = sql) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id < 1) return { paid: false, reason: 'invalid_order' };
  await ensureSnapshotSupportTables(sqlClient);

  const [orders, lines, coupons] = await Promise.all([
    sqlClient`
      SELECT id, estado, fecha, tasa_cambio_monto, descuento_cupon
      FROM pedidos_venta WHERE id = ${id} LIMIT 1
    `,
    sqlClient`
      SELECT COALESCE(SUM(pvp.cantidad * COALESCE(pvp.precio_venta, prod.precio_venta, 0)), 0)::numeric AS subtotal
      FROM pedido_venta_productos pvp
      LEFT JOIN productos prod ON prod.id = pvp.producto_id
      WHERE pvp.pedido_venta_id = ${id}
    `,
    sqlClient`
      SELECT cu.id, cu.descuento_aplicado, cu.porcentaje_comision,
        cu.total_pedido_snapshot, cu.recargo_snapshot, cu.iva_snapshot,
        cu.tasa_cambio_snapshot, cu.base_comisionable, cu.comision_monto,
        cu.pedido_pagado_en, col.porcentaje_comision AS tasa_actual, col.tipo
      FROM cupon_usos cu
      JOIN cupones c ON c.id = cu.cupon_id
      JOIN colaboradores col ON col.id = c.colaborador_id
      WHERE cu.pedido_venta_id = ${id} AND col.tipo = 'influencer'
      LIMIT 1
    `,
  ]);
  if (!orders.length || !coupons.length) return { paid: false, reason: 'no_influencer_coupon' };
  if (coupons[0].pedido_pagado_en) {
    return {
      paid: true,
      total_usd: Number(coupons[0].total_pedido_snapshot || 0),
      recargos: Number(coupons[0].recargo_snapshot || 0),
      iva: Number(coupons[0].iva_snapshot || 0),
      base_comisionable: Number(coupons[0].base_comisionable || 0),
      porcentaje_comision: Number(coupons[0].porcentaje_comision || 0),
      comision_monto: Number(coupons[0].comision_monto || 0),
      tasa_cambio_monto: coupons[0].tasa_cambio_snapshot == null ? null : Number(coupons[0].tasa_cambio_snapshot),
    };
  }

  const order = orders[0];
  const subtotal = Number(lines[0]?.subtotal || 0);
  const adjustmentsWithBase = await sqlClient`
    SELECT
      COALESCE(SUM(CASE WHEN LOWER(tipo) = 'descuento' THEN
        CASE WHEN LOWER(modo) = 'porcentaje' THEN ${subtotal}::numeric * valor / 100 ELSE valor END
        ELSE 0 END), 0)::numeric AS descuentos,
      COALESCE(SUM(CASE WHEN LOWER(tipo) = 'recargo' THEN
        CASE WHEN LOWER(modo) = 'porcentaje' THEN ${subtotal}::numeric * valor / 100 ELSE valor END
        ELSE 0 END), 0)::numeric AS recargos
    FROM pedido_venta_ajustes WHERE pedido_venta_id = ${id}
  `;
  const discounts = Number(adjustmentsWithBase[0]?.descuentos || 0);
  const surcharges = Number(adjustmentsWithBase[0]?.recargos || 0);
  const couponDiscount = Number(order.descuento_cupon ?? coupons[0].descuento_aplicado ?? 0);
  const totalUsd = Math.max(0, Number((subtotal - discounts - couponDiscount + surcharges).toFixed(2)));
  const payments = await sqlClient`
    SELECT monto, tasa, tasa_simbolo FROM pagos WHERE pedido_venta_id = ${id}
  `;
  if (!isOrderPaid(order.estado, totalUsd, payments, order.tasa_cambio_monto)) {
    return { paid: false, reason: 'not_fully_paid' };
  }

  let exchangeRate = order.tasa_cambio_monto == null ? null : Number(order.tasa_cambio_monto);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    let rateRows = await sqlClient`
      SELECT monto FROM tasas_cambio
      WHERE creado_en <= ${order.fecha}
      ORDER BY creado_en DESC, id DESC LIMIT 1
    `;
    if (!rateRows.length) {
      rateRows = await sqlClient`
        SELECT monto FROM tasas_cambio
        WHERE activo = TRUE ORDER BY id DESC LIMIT 1
      `;
    }
    exchangeRate = rateRows.length ? Number(rateRows[0].monto) : null;
  }

  const base = calculateCommissionableBase(totalUsd, surcharges);
  const iva = Number(((totalUsd - surcharges) - base).toFixed(2));
  const percentage = Number(coupons[0].porcentaje_comision ?? coupons[0].tasa_actual ?? 0);
  const commission = calculateCommission(base, percentage);
  await sqlClient`
    UPDATE cupon_usos SET
      total_pedido_snapshot = ${totalUsd},
      recargo_snapshot = ${surcharges},
      iva_snapshot = ${iva},
      base_comisionable = ${base},
      tasa_cambio_snapshot = ${exchangeRate},
      comision_monto = ${commission},
      pedido_pagado_en = NOW()
    WHERE id = ${coupons[0].id} AND pedido_pagado_en IS NULL
    RETURNING pedido_pagado_en
  `;

  return {
    paid: true,
    total_usd: totalUsd,
    recargos: surcharges,
    iva,
    base_comisionable: base,
    porcentaje_comision: percentage,
    comision_monto: commission,
    tasa_cambio_monto: exchangeRate,
  };
}

module.exports = { snapshotPaidOrderCommission };
