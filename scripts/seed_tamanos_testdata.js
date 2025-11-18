#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('Insertando datos de prueba: tamanos y precio_productos (demo)');

  try {
    // Usaremos el producto de ejemplo creado en initNeonDB (id 7: 'Perfume Floral N°5 - 50ml')
    const demoProductoId = 7;

    const tamanosToCreate = [
      { nombre: '50ml', cantidad: 50, unidad: 'ml', costo: 0.8, precio_venta: 25.0, factor: 1.0 },
      { nombre: '100ml', cantidad: 100, unidad: 'ml', costo: 1.4, precio_venta: 45.0, factor: 1.05 }
    ];

    for (const t of tamanosToCreate) {
      const exists = await sql`SELECT id FROM tamanos WHERE producto_id = ${demoProductoId} AND nombre = ${t.nombre}`;
      if (exists && exists.length > 0) {
        console.log(`Tamaño existente: ${t.nombre} (id=${exists[0].id})`);
      } else {
        const inserted = await sql`
          INSERT INTO tamanos (nombre, cantidad, unidad, producto_id, costo, precio_venta, factor_multiplicador_venta)
          VALUES (${t.nombre}, ${t.cantidad}, ${t.unidad}, ${demoProductoId}, ${t.costo}, ${t.precio_venta}, ${t.factor}) RETURNING *`;
        console.log('Tamaño creado:', inserted[0]);
      }
    }

    // Insertar precios calculados de ejemplo (si no existen)
    const tamanos = await sql`SELECT id, nombre FROM tamanos WHERE producto_id = ${demoProductoId}`;
    for (const t of tamanos) {
      const keyExists = await sql`SELECT id FROM precio_productos WHERE producto_id = ${demoProductoId} AND tamano_id = ${t.id}`;
      if (keyExists && keyExists.length > 0) {
        console.log(`Precio ya existe para tamano ${t.nombre} (id=${t.id})`);
      } else {
        // Precio demo: si nombre contiene 50 -> 23.45, else 44.9
        const precioDemo = (t.nombre && t.nombre.includes('50')) ? 23.45 : 44.90;
        const inserted = await sql`
          INSERT INTO precio_productos (producto_id, tamano_id, sku, costo_formula, costo_total_fabricacion, margen_aplicado, precio_venta_base, factor_tamano, precio_venta_final)
          VALUES (${demoProductoId}, ${t.id}, ${'SKU-' + demoProductoId + '-' + t.id}, ${0.0}, ${0.0}, ${3.0}, ${0.0}, ${1.0}, ${precioDemo}) RETURNING *`;
        console.log('Precio demo creado:', inserted[0]);
      }
    }

    console.log('Seed completado.');
    process.exit(0);
  } catch (err) {
    console.error('Error insertando seed:', err);
    process.exit(2);
  }
}

main();
