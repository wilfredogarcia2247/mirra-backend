jest.setTimeout(30000);
const request = require('supertest');
const app = require('../app');

let authHeader = {};

beforeAll(async () => {
  await request(app).post('/api/auth/register').send({
    nombre: 'PagoAddTester',
    email: 'pagos.add@example.com',
    password: 'testpass',
    rol: 'admin',
  });
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'pagos.add@example.com', password: 'testpass' });
  expect(loginRes.statusCode).toBe(200);
  authHeader = { Authorization: `Bearer ${loginRes.body.token}` };
});

describe('POST /api/pedidos-venta/:id/pagos', () => {
  test('Registra pago adicional y aplica tasa según banco', async () => {
    // crear forma
    const forma = await request(app)
      .post('/api/formas-pago')
      .set(authHeader)
      .send({ nombre: 'PagoAdd' });
    expect(forma.statusCode).toBe(201);
    const formaId = forma.body.id;

    // crear banco con moneda única para evitar interferencias entre tests
    const banco = await request(app)
      .post('/api/bancos')
      .set(authHeader)
      .send({
        nombre: 'Banco PagoAdd',
        formas_pago: [{ forma_pago_id: formaId, detalles: {} }],
        moneda: 'VES_ADD',
      });
    expect(banco.statusCode).toBe(201);
    const bancoId = banco.body.id;

    // crear tasa activa
    const tasa = await request(app)
      .post('/api/tasas-cambio')
      .set(authHeader)
      .send({ monto: 8.5, simbolo: 'VES', descripcion: 'tasa add', activo: true });
    expect([200, 201]).toContain(tasa.statusCode);

    // crear producto
    const prodRes = await request(app)
      .post('/api/productos')
      .set(authHeader)
      .send({ nombre: 'PagoAdd Producto', unidad: 'u', stock: 0, costo: 1, precio_venta: 10 });
    expect(prodRes.statusCode).toBe(201);
    const prod = prodRes.body;

    // obtener almacen Venta
    const almacenesRes = await request(app).get('/api/almacenes').set(authHeader);
    expect(almacenesRes.statusCode).toBe(200);
    const ventaAlmacen = (almacenesRes.body || []).find((a) => a.tipo === 'venta');
    expect(ventaAlmacen).toBeDefined();

    // agregar stock
    const invRes = await request(app)
      .post(`/api/productos/${prod.id}/almacen`)
      .set(authHeader)
      .send({ almacen_id: ventaAlmacen.id, cantidad: 5 });
    expect([200, 201]).toContain(invRes.statusCode);

    // crear pedido (public)
    const pedidoBody = {
      cliente_id: 1,
      productos: [{ producto_id: prod.id, cantidad: 1 }],
      estado: 'Pendiente',
      nombre_cliente: 'Cliente PagoAdd',
    };
    const pedidoRes = await request(app)
      .post('/api/pedidos-venta')
      .set(authHeader)
      .send(pedidoBody);
    expect(pedidoRes.statusCode).toBe(201);
    const pedido = pedidoRes.body;

    // ahora registrar pago adicional
    const pagoPayload = {
      forma_pago_id: formaId,
      banco_id: bancoId,
      monto: 10.0,
      referencia: 'ADD-PAGO-1',
      fecha_transaccion: new Date().toISOString(),
    };
    const pagoRes = await request(app)
      .post(`/api/pedidos-venta/${pedido.id}/pagos`)
      .set(authHeader)
      .send(pagoPayload);
    expect(pagoRes.statusCode).toBe(201);
    expect(pagoRes.body.ok).toBe(true);
    expect(pagoRes.body.pago).toBeDefined();
    expect(pagoRes.body.pago.tasa).toBeDefined();
    expect(pagoRes.body.pago.tasa_simbolo).toBeDefined();
    expect(String(pagoRes.body.pago.tasa_simbolo)).toBe('VES');

    // verificar en GET /api/pagos
    const pagosList = await request(app).get('/api/pagos').set(authHeader);
    expect(pagosList.statusCode).toBe(200);
    const found = (pagosList.body || []).find(
      (p) => Number(p.pedido_venta_id) === pedido.id && p.referencia === 'ADD-PAGO-1'
    );
    expect(found).toBeDefined();
  }, 30000);
});
