const request = require('supertest');
const app = require('../app');

let authHeader = {};

beforeAll(async () => {
  // Registrar y loguear
  await request(app)
    .post('/api/auth/register')
    .send({ nombre: 'TPtester', email: 'tp.tester@example.com', password: 'testpass', rol: 'admin' });
  const loginRes = await request(app).post('/api/auth/login').send({ email: 'tp.tester@example.com', password: 'testpass' });
  expect(loginRes.statusCode).toBe(200);
  authHeader = { Authorization: `Bearer ${loginRes.body.token}` };
});

describe('Pedido precio snapshot', () => {
  test('Al crear pedido se guarda precio_venta y no cambia al actualizar producto', async () => {
    // 1) Crear producto
    const prodRes = await request(app).post('/api/productos').set(authHeader).send({
      nombre: 'SnapshotTest Producto', unidad: 'unidad', stock: 0, costo: 5, precio_venta: 10
    });
    expect(prodRes.statusCode).toBe(201);
    const prod = prodRes.body;

  // 2) Poner stock en algún almacén de tipo 'Venta' (buscar dinámicamente)
  const almacenesRes = await request(app).get('/api/almacenes').set(authHeader);
  expect(almacenesRes.statusCode).toBe(200);
  const ventaAlmacen = (almacenesRes.body || []).find(a => a.tipo === 'venta');
  expect(ventaAlmacen).toBeDefined();
  const invRes = await request(app).post(`/api/productos/${prod.id}/almacen`).set(authHeader).send({ almacen_id: ventaAlmacen.id, cantidad: 10 });
  expect([200,201]).toContain(invRes.statusCode);

    // 3) Crear pedido con ese producto
    const pedidoBody = {
      cliente_id: 1,
      productos: [{ producto_id: prod.id, cantidad: 2 }],
      estado: 'Pendiente',
      nombre_cliente: 'Cliente Test'
    };
    const pedidoRes = await request(app).post('/api/pedidos-venta').set(authHeader).send(pedidoBody);
    expect(pedidoRes.statusCode).toBe(201);
    const pedido = pedidoRes.body;
    expect(pedido.productos && pedido.productos.length).toBeGreaterThan(0);
    const linea = pedido.productos.find(p => Number(p.producto_id) === prod.id);
    expect(linea).toBeDefined();
    // Precio guardado al crear
    expect(Number(linea.precio_venta)).toBe(10);

    // 4) Actualizar producto precio
    const updRes = await request(app).put(`/api/productos/${prod.id}`).set(authHeader).send({ nombre: prod.nombre, unidad: prod.unidad, stock: prod.stock, costo: prod.costo, precio_venta: 99 });
    expect(updRes.statusCode).toBe(200);

    // 5) Obtener pedido y verificar precio sigue siendo el antiguo
    const getRes = await request(app).get(`/api/pedidos-venta/${pedido.id}`).set(authHeader);
    expect(getRes.statusCode).toBe(200);
    const pedido2 = getRes.body;
    const linea2 = pedido2.productos.find(p => Number(p.producto_id) === prod.id);
    expect(Number(linea2.precio_venta)).toBe(10);
  }, 20000);
});
