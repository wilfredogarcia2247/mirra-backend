// Pruebas sin base de datos: reporte de entregas y estado/ciudad en envíos nacionales
const { buildDeliveryReport } = require('../services/deliveryReport');
const { normalizeOrderFulfillment } = require('../services/orderFulfillment');

describe('reporte de entregas', () => {
  const filas = [
    { tipo_entrega: 'envio_nacional', total: '20', datos_entrega: { transportista: 'MRW', estado: 'Zulia', ciudad: 'Maracaibo' } },
    { tipo_entrega: 'envio_nacional', total: '10', datos_entrega: { transportista: 'MRW', estado: 'Zulia', ciudad: 'Maracaibo' } },
    { tipo_entrega: 'envio_nacional', total: '5', datos_entrega: JSON.stringify({ transportista: 'ZOOM', estado: 'Lara', ciudad: 'Barquisimeto' }) },
    { tipo_entrega: 'envio_nacional', total: '7', datos_entrega: { transportista: 'OTRA', transportista_otro: 'Tealca' } },
    { tipo_entrega: 'tienda', total: '15', datos_entrega: { sucursal_nombre: 'Centro' } },
    { tipo_entrega: 'delivery', total: '8', datos_entrega: {} },
    { tipo_entrega: null, total: '3', datos_entrega: {} },
  ];
  const r = buildDeliveryReport(filas);

  test('totales y métodos', () => {
    expect(r.total_pedidos).toBe(7);
    expect(r.total_monto).toBe(68);
    expect(r.metodos[0]).toMatchObject({ tipo: 'envio_nacional', pedidos: 4, monto: 42 });
    expect(r.metodos.find((m) => m.tipo === 'sin_dato').pedidos).toBe(1);
    expect(r.metodos.reduce((s, m) => s + m.porcentaje, 0)).toBeCloseTo(100, 0);
  });

  test('estados, ciudades y empresas', () => {
    expect(r.estados[0]).toMatchObject({ estado: 'Zulia', pedidos: 2, monto: 30 });
    expect(r.ciudades[0]).toMatchObject({ ciudad: 'Maracaibo', estado: 'Zulia', pedidos: 2 });
    expect(r.envios_nacionales).toBe(4);
    expect(r.envios_sin_destino).toBe(1);
    expect(r.empresas_envio.map((e) => e.empresa)).toEqual(['MRW', 'Tealca', 'ZOOM']); // empate en pedidos: primero el de mayor monto
    expect(r.sucursales[0]).toMatchObject({ sucursal: 'Centro', pedidos: 1 });
  });

  test('lista vacía', () => {
    expect(buildDeliveryReport([])).toMatchObject({ total_pedidos: 0, metodos: [], estados: [] });
  });
});

describe('envío nacional guarda estado y ciudad', () => {
  const base = { tipo: 'envio_nacional', transportista: 'MRW', agencia_codigo: '123', agencia_direccion: 'Av. 5' };

  test('con estado y ciudad', () => {
    const { value } = normalizeOrderFulfillment({ ...base, estado: ' Zulia ', ciudad: 'Maracaibo' });
    expect(value).toMatchObject({ estado: 'Zulia', ciudad: 'Maracaibo' });
  });

  test('sin estado ni ciudad sigue siendo válido (páginas viejas)', () => {
    const r = normalizeOrderFulfillment(base);
    expect(r.error).toBeUndefined();
    expect(r.value.estado).toBeUndefined();
  });

  test('ciudad demasiado larga', () => {
    expect(normalizeOrderFulfillment({ ...base, estado: 'Zulia', ciudad: 'x'.repeat(101) }).error).toBeTruthy();
  });
});
