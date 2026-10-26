const {
  buildPendingUnpaidOrderRateUpdateQuery,
  updatePendingUnpaidOrderRates,
} = require('../services/pendingOrderRateSync');

function createSqlMock({ paymentsTableExists, updatedIds = [] }) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const query = strings.join('?');
    calls.push({ query, values });
    if (query.includes('to_regclass')) {
      return [{ table_name: paymentsTableExists ? 'pagos' : null }];
    }
    if (query.includes('UPDATE pedidos_venta')) {
      return updatedIds.map((id) => ({ id }));
    }
    throw new Error(`Unexpected SQL in test: ${query}`);
  };
  return { sql, calls };
}

describe('pending unpaid order exchange-rate synchronization', () => {
  test('updates only pending orders without payments when payment records exist', async () => {
    const { sql, calls } = createSqlMock({ paymentsTableExists: true, updatedIds: [10, 11] });

    await expect(updatePendingUnpaidOrderRates(sql, 925)).resolves.toBe(2);

    const updateCall = calls.find((call) => call.query.includes('UPDATE pedidos_venta'));
    expect(updateCall.query).toContain("LOWER(TRIM(COALESCE(pv.estado, ''))) = 'pendiente'");
    expect(updateCall.query).toContain('NOT EXISTS');
    expect(updateCall.query).toContain('FROM pagos AS p');
    expect(updateCall.query).toContain('p.pedido_venta_id = pv.id');
    expect(updateCall.query).toContain('pv.tasa_cambio_monto IS DISTINCT FROM ?');
    expect(updateCall.values).toContain(925);
  });

  test('updates pending orders if the optional payments table does not exist yet', async () => {
    const { sql, calls } = createSqlMock({ paymentsTableExists: false, updatedIds: [12] });

    await expect(updatePendingUnpaidOrderRates(sql, 930)).resolves.toBe(1);

    const updateCall = calls.find((call) => call.query.includes('UPDATE pedidos_venta'));
    expect(updateCall.query).toContain("LOWER(TRIM(COALESCE(estado, ''))) = 'pendiente'");
    expect(updateCall.query).not.toContain('NOT EXISTS');
    expect(updateCall.values).toContain(930);
  });

  test('uses the active rate within a transaction and excludes any order with a payment', () => {
    const sql = (strings, ...values) => ({ query: strings.join('?'), values });

    const query = buildPendingUnpaidOrderRateUpdateQuery(sql, {
      activeRateId: 25,
      hasPaymentTable: true,
    });

    expect(query.query).toContain('SELECT monto FROM tasas_cambio WHERE id = ? AND activo = TRUE');
    expect(query.query).toContain('p.pedido_venta_id = pv.id');
    expect(query.query).toContain('pv.tasa_cambio_monto IS DISTINCT FROM');
    expect(query.values).toContain(25);
    expect(query.query).toContain('NOT EXISTS');
  });
});
