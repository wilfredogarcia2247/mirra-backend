jest.setTimeout(30000);
const request = require('supertest');
const app = require('../app');

let authHeader = {};

beforeAll(async () => {
  await request(app).post('/api/auth/register').send({
    nombre: 'PagoQueryTester',
    email: 'pagos.query@example.com',
    password: 'testpass',
    rol: 'admin',
  });
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'pagos.query@example.com', password: 'testpass' });
  expect(loginRes.statusCode).toBe(200);
  authHeader = { Authorization: `Bearer ${loginRes.body.token}` };
});

describe('GET /api/pedidos-venta/:id/pagos', () => {
  test('Devuelve pagos asociados a un pedido', async () => {
    // crear forma
    const forma = await request(app)
      .post('/api/formas-pago')
      .set(authHeader)
      .send({ nombre: 'QueryPago' });
    expect(forma.statusCode).toBe(201);
    const formaId = forma.body.id;

    // crear banco
    const banco = await request(app)
      .post('/api/bancos')
      .set(authHeader)
      .send({
        nombre: 'Banco QueryPago',
        formas_pago: [{ forma_pago_id: formaId, detalles: {} }],
        moneda: 'QRY',
      });
    expect(banco.statusCode).toBe(201);
    const bancoId = banco.body.id;

    // crear producto
    const prodRes = await request(app)
      .post('/api/productos')
      .set(authHeader)
      .send({ nombre: 'Query Producto', unidad: 'u', stock: 0, costo: 1, precio_venta: 10 });
    expect(prodRes.statusCode).toBe(201);
    const prod = prodRes.body;

    // poner stock
    const almacenesRes = await request(app).get('/api/almacenes').set(authHeader);
    expect(almacenesRes.statusCode).toBe(200);
    const ventaAlmacen = (almacenesRes.body || []).find((a) => a.tipo === 'venta');
    expect(ventaAlmacen).toBeDefined();
    const invRes = await request(app)
      .post(`/api/productos/${prod.id}/almacen`)
      .set(authHeader)
      .send({ almacen_id: ventaAlmacen.id, cantidad: 5 });
    expect([200, 201]).toContain(invRes.statusCode);

    // crear pedido público
    const pedidoBody = {
      cliente_id: 1,
      productos: [{ producto_id: prod.id, cantidad: 1 }],
      estado: 'Pendiente',
      nombre_cliente: 'Cliente Query',
    };
    const pedidoRes = await request(app)
      .post('/api/pedidos-venta')
      .set(authHeader)
      .send(pedidoBody);
    expect(pedidoRes.statusCode).toBe(201);
    const pedido = pedidoRes.body;

    // registrar pago adicional (usa endpoint implementado antes)
    const pagoPayload = {
      forma_pago_id: formaId,
      banco_id: bancoId,
      monto: 10.0,
      referencia: 'QRY-PAGO-1',
      fecha_transaccion: new Date().toISOString(),
    };
    const pagoRes = await request(app)
      .post(`/api/pedidos-venta/${pedido.id}/pagos`)
      .set(authHeader)
      .send(pagoPayload);
    expect(pagoRes.statusCode).toBe(201);

    // consultar pagos por pedido
    const getRes = await request(app).get(`/api/pedidos-venta/${pedido.id}/pagos`).set(authHeader);
    expect(getRes.statusCode).toBe(200);
    expect(Array.isArray(getRes.body)).toBe(true);
    const found = getRes.body.find((p) => p.referencia === 'QRY-PAGO-1');
    expect(found).toBeDefined();
    expect(Number(found.monto)).toBeCloseTo(10.0, 5);
  });
});
