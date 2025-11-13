jest.setTimeout(30000);
const request = require('supertest');
const app = require('../app');

let authHeader = {};

beforeAll(async () => {
  // Registrar y loguear
  await request(app)
    .post('/api/auth/register')
    .send({ nombre: 'PagoTester', email: 'pago.tester@example.com', password: 'testpass', rol: 'admin' });
  const loginRes = await request(app).post('/api/auth/login').send({ email: 'pago.tester@example.com', password: 'testpass' });
  expect(loginRes.statusCode).toBe(200);
  authHeader = { Authorization: `Bearer ${loginRes.body.token}` };
});

describe('Pagos E2E: finalizar pedido con pago y tasa aplicada', () => {
  test('Crear pedido y finalizar con pago que registra tasa y simbolo', async () => {
    // 1) Crear forma de pago
    const formaRes = await request(app).post('/api/formas-pago').set(authHeader).send({ nombre: 'Efectivo' });
    expect(formaRes.statusCode).toBe(201);
    const formaId = formaRes.body.id;

    // 2) Crear banco con esa forma y moneda VES
    const bancoRes = await request(app).post('/api/bancos').set(authHeader).send({ nombre: 'Banco Test Pago', formas_pago: [{ forma_pago_id: formaId, detalles: {} }], moneda: 'VES' });
    expect(bancoRes.statusCode).toBe(201);
    const bancoId = bancoRes.body.id;

    // 3) Crear una tasa activa para VES
    const tasaRes = await request(app).post('/api/tasas-cambio').set(authHeader).send({ monto: 7.23, simbolo: 'VES', descripcion: 'Tasa de prueba', activo: true });
    expect([200,201]).toContain(tasaRes.statusCode);

    // 4) Crear producto
    const prodRes = await request(app).post('/api/productos').set(authHeader).send({ nombre: 'PagoTest Producto', tipo: 'ProductoTerminado', unidad: 'unidad', stock: 0, costo: 5, precio_venta: 10 });
    expect(prodRes.statusCode).toBe(201);
    const prod = prodRes.body;

    // 5) Obtener un almacén de tipo Venta
    const almacenesRes = await request(app).get('/api/almacenes').set(authHeader);
    expect(almacenesRes.statusCode).toBe(200);
    const ventaAlmacen = (almacenesRes.body || []).find(a => a.tipo === 'Venta');
    expect(ventaAlmacen).toBeDefined();

    // 6) Añadir stock al almacén de Venta
    const invRes = await request(app).post(`/api/productos/${prod.id}/almacen`).set(authHeader).send({ almacen_id: ventaAlmacen.id, cantidad: 10 });
    expect([200,201]).toContain(invRes.statusCode);

    // 7) Crear pedido
    const pedidoBody = { cliente_id: 1, productos: [{ producto_id: prod.id, cantidad: 2 }], estado: 'Pendiente', nombre_cliente: 'Cliente PagoTest' };
    const pedidoRes = await request(app).post('/api/pedidos-venta').set(authHeader).send(pedidoBody);
    expect(pedidoRes.statusCode).toBe(201);
    const pedido = pedidoRes.body;

    // 8) Finalizar con pago
    const pagoPayload = { pago: { forma_pago_id: formaId, banco_id: bancoId, monto: 20.00, referencia: 'TEST-PAGO-1', fecha_transaccion: new Date().toISOString() } };
    const finalizarRes = await request(app).post(`/api/pedidos-venta/${pedido.id}/finalizar`).set(authHeader).send(pagoPayload);
    expect(finalizarRes.statusCode).toBe(200);
    expect(finalizarRes.body.pago).toBeDefined();
    const pagoInserted = finalizarRes.body.pago;
    expect(pagoInserted.tasa).toBeDefined();
    expect(pagoInserted.tasa_simbolo).toBeDefined();
    // La tasa y su símbolo deben haberse registrado; no forzamos un valor numérico exacto
    expect(pagoInserted.tasa).toBeDefined();
    expect(Number(pagoInserted.tasa) > 0).toBe(true);
    expect(String(pagoInserted.tasa_simbolo)).toBe('VES');

    // 9) Verificar en GET /api/pagos que hay al menos una fila para este pedido
    const pagosList = await request(app).get('/api/pagos').set(authHeader);
    expect(pagosList.statusCode).toBe(200);
    const pagosForPedido = (pagosList.body || []).filter(p => Number(p.pedido_venta_id) === pedido.id);
    expect(pagosForPedido.length).toBeGreaterThanOrEqual(1);
  }, 30000);
});
