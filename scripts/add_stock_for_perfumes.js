#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('Asegurando stock para perfumes en almacén de venta (idempotente)');
  try {
    const almacen = await sql`SELECT id FROM almacenes WHERE es_materia_prima IS NOT TRUE LIMIT 1`;
    if (!almacen || almacen.length === 0) {
      console.log('No existe almacén de venta. Crea uno en initNeonDB o seed antes.');
      process.exit(1);
    }
    const almacenId = almacen[0].id;

    // Seleccionar productos tipo 'Perfume %'
    const perfumes = await sql`SELECT id, nombre FROM productos WHERE nombre ILIKE 'Perfume %'`;
    if (!perfumes || perfumes.length === 0) {
      console.log('No se encontraron productos tipo Perfume.');
      process.exit(0);
    }

    for (const p of perfumes) {
      const inv = await sql`SELECT id, stock_fisico FROM inventario WHERE producto_id = ${p.id} AND almacen_id = ${almacenId} LIMIT 1`;
      const desired = 20; // stock por defecto para catálogo
      if (!inv || inv.length === 0) {
        await sql`INSERT INTO inventario (producto_id, almacen_id, stock_fisico, stock_comprometido) VALUES (${p.id}, ${almacenId}, ${desired}, 0)`;
        console.log(`Inventario creado para ${p.nombre}: ${desired}`);
      } else {
        const current = Number(inv[0].stock_fisico || 0);
        if (current < desired) {
          await sql`UPDATE inventario SET stock_fisico = ${desired} WHERE id = ${inv[0].id}`;
          console.log(`Inventario actualizado para ${p.nombre}: ${current} -> ${desired}`);
        } else {
          console.log(`Inventario suficiente para ${p.nombre}: ${current}`);
        }
      }
    }

    console.log('Stock asegurado.');
    process.exit(0);
  } catch (err) {
    console.error('Error asegurando stock:', err);
    process.exit(2);
  }
}

main();
