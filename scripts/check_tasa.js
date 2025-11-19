require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');

async function run() {
  const token = jwt.sign({ id: 1, rol: 'admin' }, process.env.JWT_SECRET || 'secret');
  console.log('Usando token:', token.slice(0, 20) + '...');
  try {
    const res = await request(app)
      .post('/api/tasas-cambio')
      .set('Authorization', `Bearer ${token}`)
      .send({ monto: 1.23, simbolo: 'USD', descripcion: 'Prueba automatizada', activo: true });
    console.log('Status:', res.status);
    console.log('Body:', res.body);
  } catch (err) {
    console.error('Error ejecutando request:', err.message || err);
    if (err.response) console.error('Response body:', err.response.body);
  }
}

run();
