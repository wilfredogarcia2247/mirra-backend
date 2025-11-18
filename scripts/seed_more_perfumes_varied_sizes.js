#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function seedMore() {
  console.log('Seed adicional: insertando más productos de perfumería con tamaños variados');
  try {
    const items = [
      {
        nombre: 'Mini Sampler Pack - Citrus',
        categoria: 'Perfumes',
        marca: 'Aromas',
        proveedor: 'Proveedor Aromas',
        tamanos: [
          { nombre: '5ml', cantidad: 5, unidad: 'ml', costo: 0.08, precio_venta: 3.5 },
          { nombre: '10ml', cantidad: 10, unidad: 'ml', costo: 0.15, precio_venta: 6.0 }
        ]
      },
      {
        nombre: 'Body Mist - Floral Light',
        categoria: 'Perfumes',
        marca: 'Aromas',
        proveedor: 'Proveedor Aromas',
        tamanos: [
          { nombre: '100ml', cantidad: 100, unidad: 'ml', costo: 0.9, precio_venta: 18.0 },
          { nombre: '200ml', cantidad: 200, unidad: 'ml', costo: 1.6, precio_venta: 30.0 }
        ]
      },
      {
        nombre: 'Eau de Parfum - Limited Edition',
        categoria: 'Perfumes',
        marca: 'Aromas',
        proveedor: 'Proveedor Aromas',
        tamanos: [
          { nombre: '30ml', cantidad: 30, unidad: 'ml', costo: 0.9, precio_venta: 18.0 },
          { nombre: '75ml', cantidad: 75, unidad: 'ml', costo: 2.0, precio_venta: 44.0 },
          { nombre: '150ml', cantidad: 150, unidad: 'ml', costo: 3.8, precio_venta: 80.0 }
        ]
      },
      {
        nombre: 'Gift Set - Floral Trio',
        categoria: 'Perfumes',
        marca: 'Aromas',
        proveedor: 'Proveedor Aromas',
        tamanos: [
          { nombre: '3x10ml', cantidad: 10, unidad: 'ml', costo: 0.4, precio_venta: 20.0 } 
        ]
      },
      {
        nombre: 'Roll-on Solid Perfume - Vanilla',
        categoria: 'Perfumes',
        marca: 'Aromas',
        proveedor: 'Proveedor Aromas',
        tamanos: [
          { nombre: '8ml', cantidad: 8, unidad: 'ml', costo: 0.25, precio_venta: 7.0 }
        ]
      }
    ];

    // Asegurar categorías/marcas/proveedores
    for (const it of items) {
      const cat = await sql`SELECT id FROM categorias WHERE nombre = ${it.categoria} LIMIT 1`;
      if (!cat || cat.length === 0) await sql`INSERT INTO categorias (nombre, descripcion) VALUES (${it.categoria}, ${it.categoria})`;
      const mar = await sql`SELECT id FROM marcas WHERE nombre = ${it.marca} LIMIT 1`;
      if (!mar || mar.length === 0) await sql`INSERT INTO marcas (nombre, descripcion) VALUES (${it.marca}, ${it.marca})`;
      const prov = await sql`SELECT id FROM proveedores WHERE nombre = ${it.proveedor} LIMIT 1`;
      if (!prov || prov.length === 0) await sql`INSERT INTO proveedores (nombre, telefono, email) VALUES (${it.proveedor}, '000000000', 'proveedor@demo')`;
    }

    // Alinear secuencia productos
    try { await sql`SELECT setval(pg_get_serial_sequence('productos','id'), (SELECT COALESCE(MAX(id),0) + 1 FROM productos), true)`; } catch (e) {}

    for (const it of items) {
      const exists = await sql`SELECT id FROM productos WHERE nombre = ${it.nombre} LIMIT 1`;
      let prodId;
      if (exists && exists.length > 0) {
        prodId = exists[0].id;
        console.log(`Producto existente: ${it.nombre} (id=${prodId})`);
      } else {
        const catId = (await sql`SELECT id FROM categorias WHERE nombre = ${it.categoria} LIMIT 1`)[0].id;
        const marId = (await sql`SELECT id FROM marcas WHERE nombre = ${it.marca} LIMIT 1`)[0].id;
        const provId = (await sql`SELECT id FROM proveedores WHERE nombre = ${it.proveedor} LIMIT 1`)[0].id;
        const res = await sql`
          WITH existing AS (SELECT id FROM productos WHERE nombre = ${it.nombre} LIMIT 1),
          ins AS (
            INSERT INTO productos (nombre, unidad, stock, costo, precio_venta, proveedor_id, categoria_id, marca_id)
            SELECT ${it.nombre}, 'unidad', 0, 0, NULL, ${provId}, ${catId}, ${marId}
            WHERE NOT EXISTS (SELECT 1 FROM existing)
            RETURNING id
          )
          SELECT id FROM existing
          UNION ALL
          SELECT id FROM ins
          LIMIT 1
        `;
        prodId = res[0].id;
        console.log(`Producto creado/asegurado: ${it.nombre} (id=${prodId})`);
      }

      // Insertar tamaños y precios demo
      for (const t of it.tamanos) {
        const tam = await sql`SELECT id FROM tamanos WHERE producto_id = ${prodId} AND nombre = ${t.nombre} LIMIT 1`;
        let tamId;
        if (tam && tam.length > 0) {
          tamId = tam[0].id;
          await sql`UPDATE tamanos SET cantidad = ${t.cantidad}, unidad = ${t.unidad}, costo = ${t.costo}, precio_venta = ${t.precio_venta} WHERE id = ${tamId}`;
          console.log(`  Tamaño actualizado: ${t.nombre} (id=${tamId})`);
        } else {
          const inserted = await sql`INSERT INTO tamanos (nombre, cantidad, unidad, producto_id, costo, precio_venta, factor_multiplicador_venta) VALUES (${t.nombre}, ${t.cantidad}, ${t.unidad}, ${prodId}, ${t.costo}, ${t.precio_venta}, ${1.0}) RETURNING *`;
          tamId = inserted[0].id;
          console.log(`  Tamaño creado: ${t.nombre} (id=${tamId})`);
        }

        const price = await sql`SELECT id FROM precio_productos WHERE producto_id = ${prodId} AND tamano_id = ${tamId} LIMIT 1`;
        const demoPrice = Number(t.precio_venta) || null;
        if (price && price.length > 0) {
          await sql`UPDATE precio_productos SET precio_venta_final = ${demoPrice}, actualizado_en = NOW() WHERE id = ${price[0].id}`;
        } else {
          await sql`INSERT INTO precio_productos (producto_id, tamano_id, sku, precio_venta_final, actualizado_en) VALUES (${prodId}, ${tamId}, ${'SKU-' + prodId + '-' + tamId}, ${demoPrice}, NOW())`;
        }
      }
    }

    console.log('Seed adicional completado.');
    process.exit(0);
  } catch (err) {
    console.error('Error en seed adicional:', err);
    process.exit(2);
  }
}

seedMore();
