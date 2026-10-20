const request = require('supertest');
const { neon } = require('@neondatabase/serverless');
const app = require('../app');
const sql = neon(process.env.DATABASE_URL);

describe('cupón en el checkout público', () => {
    const codigo = 'TESTCUPON20';
    const porcentaje = 20;
    let productoId = null;
    let cuponId = null;

    beforeAll(async () => {
        const prod = await sql`
            INSERT INTO productos (nombre, unidad, stock, costo, precio_venta)
            VALUES ('Producto Test Cupon', 'ml', 100, 10, 50)
            RETURNING id
        `;
        productoId = prod[0].id;

        const cupon = await sql`
            INSERT INTO cupones (codigo, descuento_porcentaje, descripcion, fecha_inicio, uso_maximo, activo)
            VALUES (${codigo}, ${porcentaje}, 'Cupón de prueba', NOW(), 5, 1)
            RETURNING id
        `;
        cuponId = cupon[0].id;
    });

    afterAll(async () => {
        await sql`DELETE FROM cupones WHERE codigo = ${codigo}`;
        if (productoId) {
            await sql`DELETE FROM pedido_venta_productos WHERE producto_id = ${productoId}`;
            await sql`DELETE FROM productos WHERE id = ${productoId}`;
        }
    });

    test('validar cupón devuelve el descuento y rechaza códigos inexistentes', async () => {
        const ok = await request(app).post('/api/cupones/validar').send({ codigo: codigo.toLowerCase() });
        expect(ok.statusCode).toBe(200);
        expect(ok.body.valid).toBe(true);
        expect(ok.body.codigo).toBe(codigo);
        expect(Number(ok.body.descuento_porcentaje)).toBe(porcentaje);

        const inexistente = await request(app).post('/api/cupones/validar').send({ codigo: 'NOEXISTE-XYZ' });
        expect(inexistente.statusCode).toBe(404);
        expect(inexistente.body.valid).toBe(false);

        const vacio = await request(app).post('/api/cupones/validar').send({ codigo: '  ' });
        expect(vacio.statusCode).toBe(400);
    });

    test('el pedido público aplica el descuento y registra el canje', async () => {
        const res = await request(app).post('/api/pedidos-venta').send({
            nombre_cliente: 'Cliente Cupón',
            telefono: '04141234567',
            cedula: 'V-99999999',
            lineas: [{ producto_id: productoId, cantidad: 2 }],
            cupon_codigo: codigo,
        });

        expect(res.statusCode).toBe(201);
        // 2 x 50 = 100 bruto, 20% de descuento = 20
        expect(Number(res.body.total_base)).toBe(100);
        expect(Number(res.body.descuento_cupon)).toBe(20);
        expect(Number(res.body.total)).toBe(80);
        expect(res.body.cupon_codigo).toBe(codigo);
        expect(Number(res.body.cupon_id)).toBe(cuponId);

        const fila = await sql`
            SELECT cu.descuento_aplicado, pv.descuento_cupon, pv.cupon_codigo
            FROM cupon_usos cu
            JOIN pedidos_venta pv ON pv.id = cu.pedido_venta_id
            WHERE cu.cupon_id = ${cuponId}
        `;
        expect(fila.length).toBeGreaterThan(0);
        expect(Number(fila[0].descuento_aplicado)).toBe(20);
        expect(Number(fila[0].descuento_cupon)).toBe(20);
        expect(fila[0].cupon_codigo).toBe(codigo);

        await sql`DELETE FROM pedido_venta_productos WHERE pedido_venta_id = ${res.body.id}`;
        await sql`DELETE FROM pedidos_venta WHERE id = ${res.body.id}`;
    });

    test('un cupón inválido no permite crear el pedido', async () => {
        const res = await request(app).post('/api/pedidos-venta').send({
            nombre_cliente: 'Cliente Cupón',
            telefono: '04141234567',
            lineas: [{ producto_id: productoId, cantidad: 1 }],
            cupon_codigo: 'NOEXISTE-XYZ',
        });

        expect(res.statusCode).toBe(400);
        expect(res.body.cupon_invalido).toBe(true);
    });
});
