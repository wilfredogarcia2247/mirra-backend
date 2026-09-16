const request = require('supertest');
const app = require('../app');

describe('clientes + pedidos integration', () => {
    let authHeader = {};
    let createdProductId = null;
    const cedula = 'V-12345678';

    beforeAll(async () => {
        await request(app).post('/api/auth/register').send({
            nombre: 'Cliente Test User',
            email: 'clientes.test.user@example.com',
            password: 'testpass123',
            rol: 'admin',
        });

        const loginRes = await request(app).post('/api/auth/login').send({
            email: 'clientes.test.user@example.com',
            password: 'testpass123',
        });

        expect(loginRes.statusCode).toBe(200);
        authHeader = { Authorization: `Bearer ${loginRes.body.token}` };

        const prodRes = await request(app).post('/api/productos').set(authHeader).send({
            nombre: 'Producto Cliente Test',
            unidad: 'ml',
            stock: 50,
            costo: 10,
            precio_venta: 20,
        });

        expect(prodRes.statusCode).toBe(201);
        createdProductId = prodRes.body.id;
    });

    test('lookup by cédula returns existing cliente or creates one', async () => {
        const lookupRes = await request(app).get('/api/clientes/lookup').query({ cedula });
        expect(lookupRes.statusCode).toBe(200);
        expect(lookupRes.body).toHaveProperty('exists');
        expect(lookupRes.body).toHaveProperty('cliente');

        const createRes = await request(app).post('/api/clientes/lookup-or-create').send({
            nombre: 'María Pérez',
            telefono: '04141234567',
            cedula,
            email: 'maria@example.com',
            direccion: 'Caracas',
        });

        expect(createRes.statusCode).toBe(201);
        expect(createRes.body).toHaveProperty('id');
        expect(createRes.body.cedula).toBe('V-12345678');
    });

    test('pedido público reusa cliente_id al crear pedido con cédula', async () => {
        const res = await request(app).post('/api/pedidos-venta').send({
            nombre_cliente: 'María Pérez',
            telefono: '04141234567',
            cedula,
            lineas: [{ producto_id: createdProductId, cantidad: 2 }],
        });

        expect(res.statusCode).toBe(201);
        expect(res.body).toHaveProperty('cliente_id');
        expect(Number(res.body.cliente_id)).toBeGreaterThan(0);
        expect(res.body.cedula).toBe(cedula);
    });
});
