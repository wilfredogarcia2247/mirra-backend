#!/usr/bin/env node
require('dotenv').config();
const request = require('supertest');
const app = require('../app');

(async function main(){
  try {
    const unique = Date.now();
    const email = `tester.bancos.${unique}@example.com`;
    // Register
    await request(app).post('/api/auth/register').send({ nombre: 'Tester Manual', email, password: 'testpass', rol: 'admin' });
    // Login
    const login = await request(app).post('/api/auth/login').send({ email, password: 'testpass' });
    if (login.status !== 200) {
      console.error('Login failed', login.status, login.body);
      process.exit(1);
    }
    const token = login.body.token;
    console.log('Token obtenido.');

    const auth = { Authorization: `Bearer ${token}` };

    // Obtener formas de pago existentes
    const formasRes = await request(app).get('/api/formas-pago').set(auth);
    console.log('Formas de pago disponibles:', formasRes.body.map(f => ({ id: f.id, nombre: f.nombre })));

    const transferencia = formasRes.body.find(f => f.nombre === 'Transferencia');
    const pagoMovil = formasRes.body.find(f => f.nombre === 'Pago Movil' || f.nombre === 'Pago Móvil');
    const efectivo = formasRes.body.find(f => f.nombre === 'Efectivo');

    // Crear banco con varias formas
    const bankPayload = {
      nombre: `Banco Prueba ${unique}`,
      formas_pago: []
    };
    if (transferencia) bankPayload.formas_pago.push({ forma_pago_id: transferencia.id, detalles: { numero_cuenta: '00011122233', documento: 'V-12345678' } });
    if (pagoMovil) bankPayload.formas_pago.push({ forma_pago_id: pagoMovil.id, detalles: { numero_telefono: '04241234567', documento: 'V-12345678', operador: 'MOV' } });
    if (efectivo) bankPayload.formas_pago.push({ forma_pago_id: efectivo.id, detalles: { observaciones: 'Pago en efectivo en caja' } });

    const createRes = await request(app).post('/api/bancos').set(auth).send(bankPayload);
    console.log('Crear banco status:', createRes.status);
    console.log('Crear banco body:', createRes.body);

    if (createRes.status === 201) {
      const id = createRes.body.id;
      const getRes = await request(app).get(`/api/bancos/${id}`).set(auth);
      console.log('GET banco:', getRes.status, getRes.body);
    }

    process.exit(0);
  } catch (e) {
    console.error('Error en script de prueba:', e);
    process.exit(2);
  }
})();
