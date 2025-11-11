#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

(async ()=>{
  try {
    console.log('--- Contenido de banco_formas_pago (raw) ---');
    const raw = await sql`SELECT bf.id, bf.banco_id, bf.forma_pago_id, bf.detalles, f.nombre as forma_nombre, b.nombre as banco_nombre FROM banco_formas_pago bf JOIN formas_pago f ON f.id = bf.forma_pago_id JOIN bancos b ON b.id = bf.banco_id ORDER BY bf.id`;
    console.log(JSON.stringify(raw, null, 2));

    console.log('\n--- Agregación equivalente a GET /api/bancos ---');
    const agg = await sql`
      SELECT b.id as banco_id, b.nombre as banco_nombre, COALESCE(json_agg(json_build_object('id', f.id, 'nombre', f.nombre, 'detalles', bf.detalles)) FILTER (WHERE f.id IS NOT NULL), '[]') AS formas_pago
      FROM bancos b
      LEFT JOIN banco_formas_pago bf ON bf.banco_id = b.id
      LEFT JOIN formas_pago f ON f.id = bf.forma_pago_id
      GROUP BY b.id
      ORDER BY b.id
    `;
    console.log(JSON.stringify(agg, null, 2));

    process.exit(0);
  } catch (e) {
    console.error('ERROR', e);
    process.exit(2);
  }
})();
