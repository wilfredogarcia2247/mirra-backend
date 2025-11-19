#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  const pedidoId = process.argv[2] ? Number(process.argv[2]) : 40;
  if (!pedidoId || isNaN(pedidoId)) {
    console.error('Usage: node scripts/inspect_pagos.js <pedidoId>');
    process.exit(2);
  }
  try {
    console.log('Consultando pagos para pedido:', pedidoId);
    const rows =
      await sql`SELECT p.*, b.nombre as banco_nombre, b.moneda as banco_moneda, f.nombre as forma_nombre FROM pagos p LEFT JOIN bancos b ON b.id = p.banco_id LEFT JOIN formas_pago f ON f.id = p.forma_pago_id WHERE p.pedido_venta_id = ${pedidoId} ORDER BY fecha DESC`;
    if (!rows || rows.length === 0) {
      console.log('No se encontraron pagos para el pedido', pedidoId);
      // Mostrar conteo rápido de filas en la tabla pagos
      try {
        const cnt =
          await sql`SELECT COUNT(*)::int AS c FROM pagos WHERE pedido_venta_id = ${pedidoId}`;
        console.log('Conteo directo en DB:', (cnt && cnt[0] && cnt[0].c) || 0);
      } catch (e) {}
      process.exit(0);
    }
    console.log('Pagos encontrados:', rows.length);
    for (const r of rows) {
      console.log('---');
      console.log(
        'id:',
        r.id,
        'monto:',
        r.monto,
        'forma:',
        r.forma_nombre || r.forma_pago_id,
        'banco:',
        r.banco_nombre || r.banco_id
      );
      console.log('referencia:', r.referencia, 'fecha_transaccion:', r.fecha_transaccion);
      console.log('tasa:', r.tasa, 'tasa_simbolo:', r.tasa_simbolo, 'fecha registro:', r.fecha);
    }
    process.exit(0);
  } catch (err) {
    console.error('Error consultando pagos:', err && err.message ? err.message : err);
    process.exit(2);
  }
}

main();
