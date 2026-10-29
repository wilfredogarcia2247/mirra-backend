const request = require('supertest');
const app = require('../app');

describe('public order delivery validation', () => {
  const basePayload = {
    nombre_cliente: 'Cliente de prueba',
    cedula: 'V-12345678',
    entrega: {
      tipo: 'delivery',
      ubicacion_link: 'https://maps.app.goo.gl/example',
    },
    lineas: [{ producto_id: 1, cantidad: 1 }],
  };

  test.each([
    ['too few digits', '0414123456'],
    ['letters', '0414abc1234567'],
  ])('rejects a delivery phone with %s before database access', async (_caseName, telefono) => {
    const response = await request(app)
      .post('/api/pedidos-venta')
      .send({ ...basePayload, telefono });

    expect(response.statusCode).toBe(400);
    expect(response.body.error).toMatch(/teléfono debe contener al menos 11 dígitos numéricos/i);
  });
});
