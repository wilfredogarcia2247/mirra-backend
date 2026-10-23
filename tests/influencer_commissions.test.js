const {
  calculateCommission,
  calculateCommissionableBase,
  isOrderPaid,
  maskPersonalNumber,
  summarizeCouponHistory,
} = require('../services/influencerCommissions');

describe('influencer commission calculations', () => {
  test('removes surcharges and 16% VAT before calculating commission', () => {
    const base = calculateCommissionableBase(100, 2);

    expect(base).toBe(84.48);
    expect(calculateCommission(base, 10)).toBe(8.45);
  });

  test('does not produce a negative base or commission', () => {
    expect(calculateCommissionableBase(50, 80)).toBe(0);
    expect(calculateCommission(-100, 10)).toBe(0);
  });

  test('rounds commission to cents and rejects invalid rates', () => {
    expect(calculateCommission(10, 10)).toBe(1);
    expect(calculateCommission(900, 12.5)).toBe(112.5);
    expect(calculateCommission(10, 101)).toBe(0);
  });

  test('preserves historical earnings for exhausted codes and identifies the active code', () => {
    const coupons = summarizeCouponHistory([
      { id: 1, codigo: 'ANTERIOR', activo: 1, uso_actual: 2, uso_maximo: 2 },
      { id: 2, codigo: 'ACTUAL', activo: 1, uso_actual: 1, uso_maximo: 70 },
    ], [
      { cupon_id: 1, base_comisionable: 100, comision_monto: 10 },
      { cupon_id: 1, base_comisionable: 100, comision_monto: 10 },
      { cupon_id: 2, base_comisionable: 84.48, comision_monto: 8.45 },
    ]);

    expect(coupons[0]).toMatchObject({ estado: 'agotado', codigo_activo: false, pedidos: 2, base_comisionable: 200, comision_estimada: 20 });
    expect(coupons[1]).toMatchObject({ estado: 'activo', codigo_activo: true, pedidos: 1, base_comisionable: 84.48, comision_estimada: 8.45 });
  });

  test('only exposes completed orders paid in full', () => {
    expect(isOrderPaid('Pendiente', 100, [{ monto: 100 }])).toBe(false);
    expect(isOrderPaid('Completado', 100, [{ monto: 50 }])).toBe(false);
    expect(isOrderPaid('Completado', 100, [{ monto: 3645, tasa: 36.45 }])).toBe(true);
    expect(isOrderPaid('Pagado', 100, [{ monto: 99.96 }])).toBe(true);
  });

  test('masks customer identity and phone numbers', () => {
    expect(maskPersonalNumber('V-12.345.678')).toBe('V-**.***.*78');
    expect(maskPersonalNumber('0414-1234567', 4)).toBe('****-***4567');
  });
});