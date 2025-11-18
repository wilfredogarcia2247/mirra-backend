#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function seed() {
  console.log('Seed: creando productos perfumes con tamaños (idempotente)');
  try {
    // Alinear secuencia de productos para evitar conflictos si hubo inserciones con ids explícitos
    try {
      await sql`SELECT setval(pg_get_serial_sequence('productos','id'), (SELECT COALESCE(MAX(id),0) + 1 FROM productos), true)`;
    } catch (e) {
      // no fatal; seguimos
      console.warn('Warning: no se pudo setear secuencia de productos:', e.message || e);
    }
    const perfumes = [
      {
        nombre: 'Perfume Citrus Breeze',
        marca: 'Aromas',
        categoria: 'Perfumes',
        tamanos: [
          { nombre: '30ml', cantidad: 30, unidad: 'ml', costo: 0.4, precio_venta: 12.0 },
          { nombre: '50ml', cantidad: 50, unidad: 'ml', costo: 0.7, precio_venta: 20.0 },
          { nombre: '100ml', cantidad: 100, unidad: 'ml', costo: 1.2, precio_venta: 36.0 }
        ]
      },
      {
        nombre: 'Perfume Floral Garden',
        marca: 'Aromas',
        categoria: 'Perfumes',
        tamanos: [
          { nombre: '30ml', cantidad: 30, unidad: 'ml', costo: 0.45, precio_venta: 13.0 },
          { nombre: '50ml', cantidad: 50, unidad: 'ml', costo: 0.8, precio_venta: 22.0 },
          { nombre: '100ml', cantidad: 100, unidad: 'ml', costo: 1.5, precio_venta: 40.0 }
        ]
      },
      {
        nombre: 'Perfume Oriental Night',
        marca: 'Aromas',
        categoria: 'Perfumes',
        tamanos: [
          { nombre: '30ml', cantidad: 30, unidad: 'ml', costo: 0.6, precio_venta: 15.0 },
          { nombre: '50ml', cantidad: 50, unidad: 'ml', costo: 1.0, precio_venta: 26.0 },
          { nombre: '100ml', cantidad: 100, unidad: 'ml', costo: 1.9, precio_venta: 48.0 }
        ]
      }
    ];

    // Añadir más perfumes de ejemplo
    const extraPerfumes = [
      {
        nombre: 'Aqua Marine Essence',
        marca: 'Aromas',
        categoria: 'Perfumes',
        tamanos: [
          { nombre: '15ml', cantidad: 15, unidad: 'ml', costo: 0.25, precio_venta: 8.0 },
          { nombre: '30ml', cantidad: 30, unidad: 'ml', costo: 0.45, precio_venta: 15.0 },
          { nombre: '75ml', cantidad: 75, unidad: 'ml', costo: 1.0, precio_venta: 32.0 }
        ]
      },
      {
        nombre: 'Woody Musk',
        marca: 'Aromas',
        categoria: 'Perfumes',
        tamanos: [
          { nombre: '30ml', cantidad: 30, unidad: 'ml', costo: 0.6, precio_venta: 14.0 },
          { nombre: '50ml', cantidad: 50, unidad: 'ml', costo: 1.0, precio_venta: 25.0 }
        ]
      },
      {
        nombre: 'Vanilla Bloom',
        marca: 'Aromas',
        categoria: 'Perfumes',
        tamanos: [
          { nombre: '30ml', cantidad: 30, unidad: 'ml', costo: 0.5, precio_venta: 13.0 },
          { nombre: '100ml', cantidad: 100, unidad: 'ml', costo: 2.0, precio_venta: 50.0 }
        ]
      },
      {
        nombre: 'Citrus Oud',
        marca: 'Aromas',
        categoria: 'Perfumes',
        tamanos: [
          { nombre: '50ml', cantidad: 50, unidad: 'ml', costo: 1.2, precio_venta: 28.0 },
          { nombre: '100ml', cantidad: 100, unidad: 'ml', costo: 2.4, precio_venta: 55.0 }
        ]
      }
    ];

    perfumes.push(...extraPerfumes);

    // Asegurar marca y categoria existen (proveedor eliminado)
    for (const p of perfumes) {
      const cat = await sql`SELECT id FROM categorias WHERE nombre = ${p.categoria} LIMIT 1`;
      if (!cat || cat.length === 0) {
        await sql`INSERT INTO categorias (nombre, descripcion) VALUES (${p.categoria}, ${p.categoria})`;
      }
      const mar = await sql`SELECT id FROM marcas WHERE nombre = ${p.marca} LIMIT 1`;
      if (!mar || mar.length === 0) {
        await sql`INSERT INTO marcas (nombre, descripcion) VALUES (${p.marca}, ${p.marca})`;
      }
    }

    for (const p of perfumes) {
      // Insertar producto si no existe (por nombre)
      const exists = await sql`SELECT id FROM productos WHERE nombre = ${p.nombre} LIMIT 1`;
      let productoId;
      if (exists && exists.length > 0) {
        productoId = exists[0].id;
        console.log(`Producto existente: ${p.nombre} (id=${productoId})`);
      } else {
        const categoriaId = (await sql`SELECT id FROM categorias WHERE nombre = ${p.categoria} LIMIT 1`)[0].id;
        const marcaId = (await sql`SELECT id FROM marcas WHERE nombre = ${p.marca} LIMIT 1`)[0].id;
        // Insertar sólo si no existe (atomic usando CTE) para evitar conflictos con secuencias
        const prodRes = await sql`
          WITH existing AS (SELECT id FROM productos WHERE nombre = ${p.nombre} LIMIT 1),
          ins AS (
            INSERT INTO productos (nombre, unidad, stock, costo, precio_venta, categoria_id, marca_id)
            SELECT ${p.nombre}, 'unidad', 0, 0, NULL, ${categoriaId}, ${marcaId}
            WHERE NOT EXISTS (SELECT 1 FROM existing)
            RETURNING id
          )
          SELECT id FROM existing
          UNION ALL
          SELECT id FROM ins
          LIMIT 1
        `;
        if (prodRes && prodRes.length > 0) {
          productoId = prodRes[0].id;
          console.log(`Producto asegurado: ${p.nombre} (id=${productoId})`);
        } else {
          throw new Error('No se pudo insertar/recuperar producto ' + p.nombre);
        }
      }

      // Insertar tamaños y precios demo
      for (const t of p.tamanos) {
        const tamExists = await sql`SELECT id FROM tamanos WHERE producto_id = ${productoId} AND nombre = ${t.nombre} LIMIT 1`;
        let tamId;
        if (tamExists && tamExists.length > 0) {
          tamId = tamExists[0].id;
          console.log(`  Tamaño existente: ${t.nombre} (id=${tamId})`);
          // actualizar costo/precio si es diferente
          await sql`UPDATE tamanos SET cantidad=${t.cantidad}, unidad=${t.unidad}, costo=${t.costo}, precio_venta=${t.precio_venta} WHERE id = ${tamId}`;
        } else {
          const insertedTam = await sql`INSERT INTO tamanos (nombre, cantidad, unidad, producto_id, costo, precio_venta, factor_multiplicador_venta) VALUES (${t.nombre}, ${t.cantidad}, ${t.unidad}, ${productoId}, ${t.costo}, ${t.precio_venta}, ${1.0}) RETURNING *`;
          tamId = insertedTam[0].id;
          console.log(`  Tamaño creado: ${t.nombre} (id=${tamId})`);
        }

        // Insertar/actualizar precio calculado demo
        const precioExists = await sql`SELECT id FROM precio_productos WHERE producto_id = ${productoId} AND tamano_id = ${tamId} LIMIT 1`;
        const demoPrice = Number(t.precio_venta) || null;
        if (precioExists && precioExists.length > 0) {
          await sql`UPDATE precio_productos SET precio_venta_final = ${demoPrice}, actualizado_en = NOW() WHERE id = ${precioExists[0].id}`;
          console.log(`    Precio actualizado: ${demoPrice}`);
        } else {
          await sql`INSERT INTO precio_productos (producto_id, tamano_id, sku, costo_formula, costo_total_fabricacion, margen_aplicado, precio_venta_base, factor_tamano, precio_venta_final) VALUES (${productoId}, ${tamId}, ${'SKU-' + productoId + '-' + tamId}, 0, 0, 3.0, 0, 1.0, ${demoPrice})`;
          console.log(`    Precio creado: ${demoPrice}`);
        }
      }
    }

    console.log('Seed perfumes completado.');
    process.exit(0);
  } catch (err) {
    console.error('Error en seed perfumes:', err);
    process.exit(2);
  }
}

seed();
