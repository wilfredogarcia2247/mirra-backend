#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

async function seed() {
  console.log('Seed: creando productos y fórmulas (tamaños en `formulas`)');
  try {
    // Alinear secuencia de productos
    try {
      await sql`SELECT setval(pg_get_serial_sequence('productos','id'), (SELECT COALESCE(MAX(id),0) + 1 FROM productos), true)`;
    } catch (e) { console.warn('No se pudo setear secuencia productos:', e.message || e); }

    const perfumes = [
      {
        nombre: 'Demo Perfume Azul',
        marca: 'Aromas',
        categoria: 'Perfumes',
        tamanos: [
          { nombre: '30ml', cantidad: 30, unidad: 'ml', costo: 0.5, precio_venta: 12.0 },
          { nombre: '50ml', cantidad: 50, unidad: 'ml', costo: 0.9, precio_venta: 22.0 }
        ]
      },
      {
        nombre: 'Demo Perfume Verde',
        marca: 'Aromas',
        categoria: 'Perfumes',
        tamanos: [
          { nombre: '15ml', cantidad: 15, unidad: 'ml', costo: 0.2, precio_venta: 7.0 },
          { nombre: '75ml', cantidad: 75, unidad: 'ml', costo: 1.4, precio_venta: 35.0 }
        ]
      }
    ];

    // Asegurar marcas y categorias (proveedores eliminados)
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
      // Insertar producto si no existe
      const exists = await sql`SELECT id FROM productos WHERE nombre = ${p.nombre} LIMIT 1`;
      let productoId;
      if (exists && exists.length > 0) {
        productoId = exists[0].id;
        console.log(`Producto existente: ${p.nombre} (id=${productoId})`);
      } else {
        const categoriaId = (await sql`SELECT id FROM categorias WHERE nombre = ${p.categoria} LIMIT 1`)[0].id;
        const marcaId = (await sql`SELECT id FROM marcas WHERE nombre = ${p.marca} LIMIT 1`)[0].id;
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
        productoId = prodRes[0].id;
        console.log(`Producto asegurado: ${p.nombre} (id=${productoId})`);
      }

      // Crear fórmulas (cada fórmula representa un tamaño con costo/precio)
      for (const t of p.tamanos) {
        const fExists = await sql`SELECT id FROM formulas WHERE producto_terminado_id = ${productoId} AND nombre = ${t.nombre} LIMIT 1`;
        if (fExists && fExists.length > 0) {
          const fid = fExists[0].id;
          console.log(`  Fórmula existente para ${t.nombre} (id=${fid}), actualizando costo/precio`);
          await sql`UPDATE formulas SET costo = ${t.costo}, precio_venta = ${t.precio_venta} WHERE id = ${fid}`;
        } else {
          const ins = await sql`INSERT INTO formulas (producto_terminado_id, nombre, costo, precio_venta) VALUES (${productoId}, ${t.nombre}, ${t.costo}, ${t.precio_venta}) RETURNING *`;
          console.log(`  Fórmula creada: ${t.nombre} (id=${ins[0].id})`);
        }
      }
    }

    // Crear un pedido de prueba que use las fórmulas para snapshot de tamaño
    // Insertar pedido
    const pedido = await sql`INSERT INTO pedidos_venta (cliente_id, estado, fecha, nombre_cliente) VALUES (1, 'Pendiente', NOW(), 'Cliente Test') RETURNING *`;
    const pedidoId = pedido[0].id;
    console.log('Pedido de prueba creado id=', pedidoId);

    // Tomar dos productos y fórmulas para líneas
    const prodList = await sql`SELECT p.id AS producto_id, f.id AS formula_id, f.nombre AS formula_nombre, f.costo AS formula_costo, f.precio_venta AS formula_precio
                              FROM productos p
                              JOIN formulas f ON f.producto_terminado_id = p.id
                              ORDER BY p.id LIMIT 2`;
    let line = 1;
    for (const r of prodList) {
      await sql`INSERT INTO pedido_venta_productos (pedido_venta_id, producto_id, cantidad, costo_unitario, precio_venta, nombre_producto, tamano_nombre)
                VALUES (${pedidoId}, ${r.producto_id}, ${1}, ${r.formula_costo}, ${r.formula_precio}, ${'Pedido demo producto ' + r.producto_id}, ${r.formula_nombre})`;
      console.log(`  Línea ${line} insertada: producto ${r.producto_id} size='${r.formula_nombre}'`);
      line++;
    }

    console.log('Seed de fórmulas completado.');
    process.exit(0);
  } catch (err) {
    console.error('Error en seed de fórmulas:', err);
    process.exit(2);
  }
}

seed();
