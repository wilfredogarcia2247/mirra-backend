const { buildDailySalesClose, getPresentation } = require('../services/dailySalesClose');

describe('daily sales close aggregation', () => {
  test('includes completed-order totals, adjustments, saved-rate conversion and presentations', () => {
    const rows = [
      {
        pedido_id: 12,
        fecha: '2026-10-26T10:00:00',
        nombre_cliente: 'Ana',
        tasa_cambio_monto: 36.5,
        descuento_cupon: 5,
        cupon_codigo: 'OCT10',
        producto_id: 7,
        cantidad: 2,
        precio_venta: 50,
        presentacion_nombre: 'Perfume Floral 7ml',
      },
      {
        pedido_id: 12,
        fecha: '2026-10-26T10:00:00',
        nombre_cliente: 'Ana',
        tasa_cambio_monto: 36.5,
        descuento_cupon: 5,
        cupon_codigo: 'OCT10',
        producto_id: 8,
        cantidad: 1,
        precio_venta: 20,
        presentacion_nombre: 'Perfume Floral 50 ml',
      },
    ];
    const adjustments = new Map([[12, [
      { id: 1, tipo: 'descuento', modo: 'porcentaje', valor: 10, motivo: 'Promoción' },
      { id: 2, tipo: 'recargo', modo: 'monto', valor: 3, motivo: 'Delivery' },
    ]]]);

    const close = buildDailySalesClose(rows, adjustments, '2026-10-26');

    expect(close.cantidad_pedidos).toBe(1);
    expect(close.resumen).toMatchObject({
      subtotal_usd: 120,
      descuento_cupon_usd: 5,
      descuentos_ajustes_usd: 12,
      descuentos_usd: 17,
      recargos_usd: 3,
      total_usd: 106,
      subtotal_bs: 4380,
      descuento_cupon_bs: 182.5,
      descuentos_ajustes_bs: 438,
      descuentos_bs: 620.5,
      recargos_bs: 109.5,
      total_bs: 3869,
    });
    expect(close.pedidos[0].ajustes).toEqual([
      expect.objectContaining({ tipo: 'descuento', motivo: 'Promoción', monto_usd: 12, monto_bs: 438 }),
      expect.objectContaining({ tipo: 'recargo', motivo: 'Delivery', monto_usd: 3, monto_bs: 109.5 }),
    ]);
    expect(close.presentaciones).toEqual([
      { presentacion: '7ml', unidades: 2 },
      { presentacion: '50ml', unidades: 1 },
    ]);
  });

  test('marks Bs totals unavailable if any completed order has no saved exchange rate', () => {
    const close = buildDailySalesClose([{
      pedido_id: 3,
      fecha: '2026-10-26T12:00:00',
      nombre_cliente: 'Luis',
      tasa_cambio_monto: null,
      producto_id: 9,
      cantidad: 1,
      precio_venta: 20,
      presentacion_nombre: 'Perfume 100ml',
    }], new Map(), '2026-10-26');

    expect(close.pedidos_sin_tasa).toBe(1);
    expect(close.pedidos[0].total_bs).toBeNull();
    expect(close.resumen.total_bs).toBeNull();
    expect(close.presentaciones).toEqual([{ presentacion: '100ml', unidades: 1 }]);
  });

  test('normalizes presentation labels and keeps unknown sizes visible', () => {
    expect(getPresentation('Perfume 30 ML')).toBe('30ml');
    expect(getPresentation('Producto sin tamaño')).toBe('Sin presentación');
  });
});
