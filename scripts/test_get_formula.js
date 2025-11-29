const request = require('supertest');
const app = require('../app');

async function run() {
  try {
    // Intentar registrar (puede fallar si ya existe)
    try {
      await request(app).post('/api/auth/register').send({
        nombre: 'Tester',
        email: 'tester@example.com',
        password: 'testpassword',
        rol: 'admin',
      });
    } catch (e) {
      // Ignorar errores de registro (usuario existente)
    }

    const loginRes = await request(app).post('/api/auth/login').send({
      email: 'tester@example.com',
      password: 'testpassword',
    });

    if (!loginRes || !loginRes.body || !loginRes.body.token) {
      console.error('Login falló:', loginRes && loginRes.body);
      process.exit(2);
    }

    const token = loginRes.body.token;
    const authHeader = { Authorization: `Bearer ${token}` };

    // Probar página 1
    console.log('GET /api/formulas?page=1');
    let start = process.hrtime.bigint();
    let res = await request(app).get('/api/formulas?page=1').set(authHeader);
    let end = process.hrtime.bigint();
    let ms = Number(end - start) / 1e6;
    console.log('Status:', res.statusCode, `- tiempo: ${ms.toFixed(2)}ms`);
    console.log('Body data length:', res.body && Array.isArray(res.body.data) ? res.body.data.length : 0);

    // Probar página 2
    console.log('GET /api/formulas?page=2');
    start = process.hrtime.bigint();
    res = await request(app).get('/api/formulas?page=2').set(authHeader);
    end = process.hrtime.bigint();
    ms = Number(end - start) / 1e6;
    console.log('Status:', res.statusCode, `- tiempo: ${ms.toFixed(2)}ms`);
    console.log('Body data length:', res.body && Array.isArray(res.body.data) ? res.body.data.length : 0);

    // Probar búsqueda por nombre (ejemplo: "GOOD GIRL")
    console.log('GET /api/formulas/search?q=GOOD GIRL&page=1');
    start = process.hrtime.bigint();
    res = await request(app).get('/api/formulas/search?q=GOOD GIRL&page=1').set(authHeader);
    end = process.hrtime.bigint();
    ms = Number(end - start) / 1e6;
    console.log('Status:', res.statusCode, `- tiempo: ${ms.toFixed(2)}ms`);
    console.log('Search data length:', res.body && Array.isArray(res.body.data) ? res.body.data.length : 0);
    process.exit(0);
  } catch (err) {
    console.error('Error al ejecutar la prueba:', err);
    process.exit(1);
  }
}

run();
