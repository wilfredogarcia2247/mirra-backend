const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

// Las fechas de pago de los pedidos se interpretan en hora de Venezuela,
// aunque la base de datos trabaje en UTC.
const BUSINESS_TZ = 'America/Caracas';

let schemaReady = null;

/**
 * Prepara las liquidaciones por período (desde / hasta):
 * - `influencer_comision_pagos.fecha_desde` y `fecha_hasta`: período pagado.
 * - `cupon_usos.comision_pago_id`: liquidación que pagó cada comisión, para
 *   que ninguna comisión se pague dos veces.
 * Es idempotente: se puede ejecutar varias veces sin duplicar nada.
 */
async function ensurePayoutPeriodSchema(sqlClient = sql) {
  await sqlClient`ALTER TABLE influencer_comision_pagos ADD COLUMN IF NOT EXISTS fecha_desde DATE`;
  await sqlClient`ALTER TABLE influencer_comision_pagos ADD COLUMN IF NOT EXISTS fecha_hasta DATE`;
  await sqlClient`ALTER TABLE cupon_usos ADD COLUMN IF NOT EXISTS comision_pago_id INTEGER REFERENCES influencer_comision_pagos(id) ON DELETE SET NULL`;
  await sqlClient`CREATE INDEX IF NOT EXISTS idx_cupon_usos_comision_pago ON cupon_usos(comision_pago_id)`;

  // Liquidaciones anteriores (solo tenían fecha de corte): el período va desde el
  // día siguiente al corte anterior (o desde el inicio) hasta su fecha de corte.
  const legacyPayments = await sqlClient`
    SELECT id FROM influencer_comision_pagos WHERE fecha_hasta IS NULL LIMIT 1
  `;
  if (!legacyPayments.length) return;

  await sqlClient`
    UPDATE influencer_comision_pagos p
    SET fecha_hasta = p.fecha_corte,
        fecha_desde = prev.corte_anterior + 1
    FROM (
      SELECT id, LAG(fecha_corte) OVER (PARTITION BY colaborador_id ORDER BY fecha_corte, id) AS corte_anterior
      FROM influencer_comision_pagos
    ) prev
    WHERE prev.id = p.id AND p.fecha_hasta IS NULL
  `;

  // Cada comisión pagada en esos cortes queda vinculada a la primera liquidación que la cubrió.
  // Solo cuentan los pedidos ya pagados cuando se registró la liquidación: uno que se pagó
  // el mismo día del corte pero después del registro no entró en ese monto y sigue pendiente.
  const payments = await sqlClient`
    SELECT id, colaborador_id, fecha_hasta, fecha_pago FROM influencer_comision_pagos
    ORDER BY colaborador_id, fecha_hasta, id
  `;
  for (const payment of payments || []) {
    await sqlClient`
      UPDATE cupon_usos cu
      SET comision_pago_id = ${payment.id}
      FROM cupones c, pedidos_venta pv
      WHERE c.id = cu.cupon_id
        AND pv.id = cu.pedido_venta_id
        AND c.colaborador_id = ${payment.colaborador_id}
        AND cu.comision_pago_id IS NULL
        AND cu.pedido_pagado_en IS NOT NULL
        AND (cu.pedido_pagado_en AT TIME ZONE ${BUSINESS_TZ})::date <= ${payment.fecha_hasta}::date
        AND cu.pedido_pagado_en <= ${payment.fecha_pago}
        AND LOWER(COALESCE(pv.estado, '')) NOT IN ('cancelado', 'cancelada', 'anulado')
    `;
  }
}

function ensurePayoutPeriodSchemaOnce() {
  if (!schemaReady) {
    schemaReady = ensurePayoutPeriodSchema().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

module.exports = { BUSINESS_TZ, ensurePayoutPeriodSchema, ensurePayoutPeriodSchemaOnce };
