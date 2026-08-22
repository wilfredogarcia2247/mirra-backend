const request = require('supertest');
const app = require('../app');

describe('Catálogo público de productos', () => {
  test('GET /api/productos/catalogo responde 200 y devuelve un arreglo', async () => {
    const res = await request(app).get('/api/productos/catalogo');
    expect([200, 204]).toContain(res.statusCode);
    // Si hay contenido esperado que sea array
    if (res.body) {
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        // el catálogo ahora incluye image_url por producto (puede ser null)
        expect(res.body[0]).toHaveProperty('image_url');
      }
    }
  });

  test('no incluye productos marcados como ocultos en el catálogo público', async () => {
    const res = await request(app).get('/api/productos/catalogo');
    expect([200, 204]).toContain(res.statusCode);
    if (Array.isArray(res.body) && res.body.length > 0) {
      const hidden = res.body.filter((p) => p.visible_en_catalogo === false);
      expect(hidden).toHaveLength(0);
    }
  });
});
