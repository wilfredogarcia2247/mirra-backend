// Cálculo de compras con Cashea (no usa la base de datos)
const { calcularCashea } = require('../services/cashea');

describe('calcularCashea', () => {
  test('$40, inicial 20 %, 3 cuotas', () => {
    const r = calcularCashea({ monto_total: 40, inicial_porcentaje: 20, cuotas: 3 });
    expect(r.ok).toBe(true);
    expect(r.datos).toMatchObject({
      monto_total: 40,
      inicial_monto: 8,
      inicial_porcentaje: 20,
      monto_financiado: 32,
      cuotas: 3,
      monto_cuota: 10.67,
      comision_porcentaje: 4,
    });
  });

  test('inicial 0 %: todo lo financia Cashea', () => {
    const r = calcularCashea({ monto_total: 60, inicial_porcentaje: 0, cuotas: 6 });
    expect(r.datos.inicial_monto).toBe(0);
    expect(r.datos.monto_financiado).toBe(60);
    expect(r.datos.monto_cuota).toBe(10);
  });

  test('"Otro": inicial por monto manda sobre el porcentaje', () => {
    const r = calcularCashea({ monto_total: 50, inicial_monto: 7.5, inicial_porcentaje: 99, cuotas: 3 });
    expect(r.datos.inicial_monto).toBe(7.5);
    expect(r.datos.inicial_porcentaje).toBe(15);
    expect(r.datos.monto_financiado).toBe(42.5);
    expect(r.datos.monto_cuota).toBe(14.17);
  });

  test('rechaza datos inválidos', () => {
    expect(calcularCashea({ monto_total: 0, inicial_porcentaje: 10, cuotas: 3 }).ok).toBe(false);
    expect(calcularCashea({ monto_total: 40, inicial_porcentaje: 10, cuotas: 4 }).ok).toBe(false);
    expect(calcularCashea({ monto_total: 40, inicial_monto: 40, cuotas: 3 }).ok).toBe(false);
    expect(calcularCashea({ monto_total: 40, inicial_monto: -1, cuotas: 3 }).ok).toBe(false);
    expect(calcularCashea({ monto_total: 40, cuotas: 3 }).ok).toBe(false);
  });
});
