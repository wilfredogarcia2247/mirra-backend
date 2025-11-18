const request = require('supertest');
const app = require('../app');


let authHeader = {};

beforeAll(async () => {
  // Registrar el usuario antes de login (ignorar si ya existe)
  await request(app)
    .post('/api/auth/register')
    .send({
      nombre: 'Leonardo',
      email: 'urdaneta.leonardo92@gmail.com',
      password: '8121230219',
      rol: 'admin'
    });
  // Login con el usuario admin creado en la semilla
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'urdaneta.leonardo92@gmail.com',
        password: '8121230219'
      });
  expect(loginRes.statusCode).toBe(200);
  const token = loginRes.body.token;
  authHeader = { Authorization: `Bearer ${token}` };
});

describe('API Endpoints', () => {
  test('GET /api/productos', async () => {
    const res = await request(app).get('/api/productos').set(authHeader);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('POST /api/productos', async () => {
    const res = await request(app)
      .post('/api/productos')
      .set(authHeader)
      .send({
        nombre: 'Test Producto',
        unidad: 'ml',
        stock: 100,
        costo: 1,
        precio_venta: 2
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.nombre).toBe('Test Producto');
  });

  test('GET /api/proveedores', async () => {
    // proveedores removed per database cleanup
    return;
  });

  test('GET /api/almacenes', async () => {
    const res = await request(app).get('/api/almacenes').set(authHeader);
    expect(res.statusCode).toBe(200);
  });

  test('GET /api/formulas', async () => {
    const res = await request(app).get('/api/formulas').set(authHeader);
    expect(res.statusCode).toBe(200);
  });

  test('GET /api/ordenes-produccion', async () => {
    const res = await request(app).get('/api/ordenes-produccion').set(authHeader);
    expect(res.statusCode).toBe(200);
  });

  test('GET /api/inventario', async () => {
    const res = await request(app).get('/api/inventario').set(authHeader);
    expect(res.statusCode).toBe(200);
  });

  test('GET /api/pedidos-venta', async () => {
    const res = await request(app).get('/api/pedidos-venta').set(authHeader);
    expect(res.statusCode).toBe(200);
  });

  test('GET /api/pedidos-compra', async () => {
    // pedidos-compra functionality removed along with proveedores
    return;
  });

  test('GET /api/contactos', async () => {
    // contactos removed per database cleanup
    return;
  });

  test('GET /api/bancos', async () => {
    const res = await request(app).get('/api/bancos').set(authHeader);
    expect(res.statusCode).toBe(200);
  });

  test('GET /api/formas-pago', async () => {
    const res = await request(app).get('/api/formas-pago').set(authHeader);
    expect(res.statusCode).toBe(200);
  });

  test('GET /api/cliente-bancos', async () => {
    // cliente_bancos removed per database cleanup
    return;
  });

  test('GET /api/pagos', async () => {
    const res = await request(app).get('/api/pagos').set(authHeader);
    expect(res.statusCode).toBe(200);
  });
});
