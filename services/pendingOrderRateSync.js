async function hasPaymentsTable(sql) {
  const paymentTable = await sql`SELECT to_regclass('pagos') AS table_name`;
  return Boolean(paymentTable?.[0]?.table_name);
}

function buildPendingUnpaidOrderRateUpdateQuery(sql, { rate, hasPaymentTable, activeRateId }) {
  const rateFromActiveRow = activeRateId != null;
  if (hasPaymentTable) {
    return rateFromActiveRow
      ? sql`
      UPDATE pedidos_venta AS pv
      SET tasa_cambio_monto = (
        SELECT monto FROM tasas_cambio WHERE id = ${activeRateId} AND activo = TRUE
      )
      WHERE LOWER(TRIM(COALESCE(pv.estado, ''))) = 'pendiente'
        AND EXISTS (SELECT 1 FROM tasas_cambio WHERE id = ${activeRateId} AND activo = TRUE)
        AND pv.tasa_cambio_monto IS DISTINCT FROM (
          SELECT monto FROM tasas_cambio WHERE id = ${activeRateId} AND activo = TRUE
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pagos AS p
          WHERE p.pedido_venta_id = pv.id
        )
      RETURNING pv.id
    `
      : sql`
      UPDATE pedidos_venta AS pv
      SET tasa_cambio_monto = ${rate}
      WHERE LOWER(TRIM(COALESCE(pv.estado, ''))) = 'pendiente'
        AND pv.tasa_cambio_monto IS DISTINCT FROM ${rate}
        AND NOT EXISTS (
          SELECT 1
          FROM pagos AS p
          WHERE p.pedido_venta_id = pv.id
        )
      RETURNING pv.id
    `;
  }

  return rateFromActiveRow
    ? sql`
      UPDATE pedidos_venta
      SET tasa_cambio_monto = (
        SELECT monto FROM tasas_cambio WHERE id = ${activeRateId} AND activo = TRUE
      )
      WHERE LOWER(TRIM(COALESCE(estado, ''))) = 'pendiente'
        AND EXISTS (SELECT 1 FROM tasas_cambio WHERE id = ${activeRateId} AND activo = TRUE)
        AND tasa_cambio_monto IS DISTINCT FROM (
          SELECT monto FROM tasas_cambio WHERE id = ${activeRateId} AND activo = TRUE
        )
      RETURNING id
    `
    : sql`
      UPDATE pedidos_venta
      SET tasa_cambio_monto = ${rate}
      WHERE LOWER(TRIM(COALESCE(estado, ''))) = 'pendiente'
        AND tasa_cambio_monto IS DISTINCT FROM ${rate}
      RETURNING id
    `;
}

async function updatePendingUnpaidOrderRates(sql, rate) {
  const updated = await buildPendingUnpaidOrderRateUpdateQuery(sql, {
    rate,
    hasPaymentTable: await hasPaymentsTable(sql),
  });
  return updated?.length || 0;
}

module.exports = {
  buildPendingUnpaidOrderRateUpdateQuery,
  hasPaymentsTable,
  updatePendingUnpaidOrderRates,
};
